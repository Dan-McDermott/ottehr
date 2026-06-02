import Oystehr from '@oystehr/sdk';
import { APIGatewayProxyResult } from 'aws-lambda';
import { Operation } from 'fast-json-patch';
import { Claim, ClaimResponse, PaymentNotice } from 'fhir/r4b';
import {
  createInvoiceTaskInput,
  getLatestTaskOutput,
  mapDisplayToInvoiceTaskStatus,
  ZERO_BALANCE_BUSINESS_STATUS,
} from 'utils';
import { checkOrCreateM2MClientToken, createOystehrClient, wrapHandler, ZambdaInput } from '../../../shared';
import { validateRequestParameters } from './validateRequestParameters';

let m2mToken: string;
const ZAMBDA_NAME = 'sub-refresh-invoice-task';

// FHIR adjudication category codes (http://terminology.hl7.org/CodeSystem/adjudication).
const ADJUDICATION_CATEGORY_BENEFIT = 'benefit';
const ADJUDICATION_CATEGORY_PAID_TO_PROVIDER = 'paidtoprovider';
// FHIR PaymentStatus codes (http://terminology.hl7.org/CodeSystem/paymentstatus).
const PAYMENT_STATUS_PAID = 'paid';

export const index = wrapHandler(ZAMBDA_NAME, async (input: ZambdaInput): Promise<APIGatewayProxyResult> => {
  const validatedParams = validateRequestParameters(input);
  const { task, secrets, invoiceTaskInput, taskId, encounterId } = validatedParams;

  m2mToken = await checkOrCreateM2MClientToken(m2mToken, secrets);
  const oystehr = createOystehrClient(m2mToken, secrets);

  const claims = await getClaimsForEncounter(oystehr, encounterId);
  const latestClaim = pickLatestClaim(claims);

  if (!latestClaim) {
    console.warn(`No Claim found for encounter ${encounterId}; marking task ${taskId} as error.`);
    await oystehr.fhir.patch({
      resourceType: 'Task',
      id: taskId,
      operations: [{ op: 'replace', path: '/status', value: mapDisplayToInvoiceTaskStatus('error') }],
    });
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Task was not updated because no Claim was found for the encounter.' }),
    };
  }

  console.log(`Found ${claims.length} Claim(s) for encounter ${encounterId}; using latest ${latestClaim.id}`);

  invoiceTaskInput.finalizationDate = latestClaim.created ?? invoiceTaskInput.finalizationDate;
  console.log('Updating finalization date: ', invoiceTaskInput.finalizationDate);

  if (!invoiceTaskInput.claimId) {
    invoiceTaskInput.claimId = latestClaim.identifier?.[0]?.value ?? latestClaim.id ?? '';
    console.log('Updating claim id: ', invoiceTaskInput.claimId);
  }

  invoiceTaskInput.amountCents = await computeEncounterPatientBalance(oystehr, encounterId, claims);
  console.log('Updating amount cents: ', invoiceTaskInput.amountCents);
  console.log('Updating task input...', JSON.stringify(createInvoiceTaskInput(invoiceTaskInput), null, 2));

  const isZeroBalance = invoiceTaskInput.amountCents === 0;
  const updateOperations: Operation[] = [
    { op: 'replace', path: '/input', value: createInvoiceTaskInput(invoiceTaskInput) },
    {
      op: task.authoredOn ? 'replace' : 'add',
      path: '/authoredOn',
      value: invoiceTaskInput.finalizationDate,
    },
  ];

  // Ensure executionPeriod.end stays in sync with start (appointment date).
  // FHIR sorts Period by lower bound (asc) and upper bound (desc) — setting start == end makes
  // both directions sort by the appointment date correctly.
  if (task.executionPeriod?.start && task.executionPeriod.end !== task.executionPeriod.start) {
    updateOperations.push({
      op: task.executionPeriod.end ? 'replace' : 'add',
      path: '/executionPeriod/end',
      value: task.executionPeriod.start,
    });
  }

  if (isZeroBalance) {
    updateOperations.push({
      op: task.businessStatus ? 'replace' : 'add',
      path: '/businessStatus',
      value: ZERO_BALANCE_BUSINESS_STATUS,
    });
  } else if (invoiceTaskInput.amountCents !== undefined && task.businessStatus) {
    updateOperations.push({ op: 'remove', path: '/businessStatus' });
  }

  const getLastTaskOutput = getLatestTaskOutput(task);
  if (getLastTaskOutput?.type === 'success') {
    updateOperations.push({ op: 'replace', path: '/status', value: mapDisplayToInvoiceTaskStatus('sent') });
  } else if (getLastTaskOutput?.type === 'error') {
    updateOperations.push({ op: 'replace', path: '/status', value: mapDisplayToInvoiceTaskStatus('error') });
  } else {
    updateOperations.push({ op: 'replace', path: '/status', value: mapDisplayToInvoiceTaskStatus('ready') });
  }

  await oystehr.fhir.patch({
    resourceType: 'Task',
    id: taskId,
    operations: updateOperations,
  });
  console.log(`Updated task input for task id: "${taskId}"`);
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Task was successfully updated.' }),
  };
});

async function getClaimsForEncounter(oystehr: Oystehr, encounterId: string): Promise<Claim[]> {
  const bundle = (
    await oystehr.fhir.search<Claim>({
      resourceType: 'Claim',
      params: [{ name: 'encounter', value: `Encounter/${encounterId}` }],
    })
  ).unbundle();
  return bundle.filter((r): r is Claim => r.resourceType === 'Claim');
}

function pickLatestClaim(claims: Claim[]): Claim | undefined {
  if (claims.length === 0) return undefined;
  return [...claims].sort((a, b) => {
    const aT = a.created ? Date.parse(a.created) : 0;
    const bT = b.created ? Date.parse(b.created) : 0;
    return bT - aT;
  })[0];
}

function dollarsToCents(value: number | undefined): number {
  if (value == null || Number.isNaN(value)) return 0;
  return Math.round(value * 100);
}

function sumChargedCents(claims: Claim[]): number {
  let charged = 0;
  for (const claim of claims) {
    for (const item of claim.item ?? []) {
      charged += dollarsToCents(item.net?.value ?? item.unitPrice?.value);
    }
  }
  return charged;
}

function sumInsurancePaidCents(claimResponses: ClaimResponse[]): number {
  let insurancePaidCents = 0;
  for (const cr of claimResponses) {
    for (const item of cr.item ?? []) {
      for (const adj of item.adjudication ?? []) {
        const code =
          adj.category?.coding?.find((c) => c.system?.includes('adjudication'))?.code ??
          adj.category?.coding?.[0]?.code;
        if (code === ADJUDICATION_CATEGORY_BENEFIT || code === ADJUDICATION_CATEGORY_PAID_TO_PROVIDER) {
          insurancePaidCents += dollarsToCents(adj.amount?.value);
        }
      }
    }
  }
  return insurancePaidCents;
}

function sumPaidPaymentNoticeCents(notices: PaymentNotice[]): number {
  return notices.reduce((acc, n) => {
    const code =
      n.paymentStatus?.coding?.find((c) => c.system?.includes('paymentstatus'))?.code ??
      n.paymentStatus?.coding?.[0]?.code;
    return code === PAYMENT_STATUS_PAID ? acc + dollarsToCents(n.amount?.value) : acc;
  }, 0);
}

async function computeEncounterPatientBalance(
  oystehr: Oystehr,
  encounterId: string,
  knownClaims: Claim[]
): Promise<number> {
  const claimResponseBundle = (
    await oystehr.fhir.search<ClaimResponse>({
      resourceType: 'ClaimResponse',
      params: [{ name: 'request', value: `Encounter/${encounterId}` }],
    })
  ).unbundle();
  const claimResponses = claimResponseBundle.filter((r): r is ClaimResponse => r.resourceType === 'ClaimResponse');

  const paidNotices = (
    await oystehr.fhir.search<PaymentNotice>({
      resourceType: 'PaymentNotice',
      params: [{ name: 'request', value: `Encounter/${encounterId}` }],
    })
  ).unbundle();

  const chargedCents = sumChargedCents(knownClaims);
  const insurancePaidCents = sumInsurancePaidCents(claimResponses);
  const paidPatientCents = sumPaidPaymentNoticeCents(paidNotices);
  return Math.max(0, chargedCents - insurancePaidCents - paidPatientCents);
}
