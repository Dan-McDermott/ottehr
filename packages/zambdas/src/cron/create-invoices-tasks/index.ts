import Oystehr from '@oystehr/sdk';
import { captureException } from '@sentry/aws-serverless';
import { APIGatewayProxyResult } from 'aws-lambda';
import { Claim, ClaimResponse, Encounter, PaymentNotice, Task } from 'fhir/r4b';
import { DateTime } from 'luxon';
import {
  createReference,
  InvoiceTaskInput,
  mapDisplayToInvoiceTaskStatus,
  RCM_TASK_SYSTEM,
  RcmTaskCode,
  RcmTaskCodings,
  ZERO_BALANCE_BUSINESS_STATUS,
} from 'utils';
import { createInvoiceTaskInput } from 'utils/lib/helpers/tasks/invoices-tasks';
import {
  getOrCreateInvoicingConfig,
  ParsedInvoicingConfig,
  parseInvoicingConfig,
} from '../../rcm/invoice-config/helpers';
import { checkOrCreateM2MClientToken, createOystehrClient, wrapHandler, ZambdaInput } from '../../shared';

let m2mToken: string;

const ZAMBDA_NAME = 'create-invoices-tasks';
const readyTaskStatus = mapDisplayToInvoiceTaskStatus('ready');
const LOOKBACK_DAYS = 2;

// FHIR adjudication category codes (http://terminology.hl7.org/CodeSystem/adjudication).
const ADJUDICATION_CATEGORY_BENEFIT = 'benefit';
const ADJUDICATION_CATEGORY_PAID_TO_PROVIDER = 'paidtoprovider';
// FHIR PaymentStatus codes (http://terminology.hl7.org/CodeSystem/paymentstatus).
const PAYMENT_STATUS_PAID = 'paid';

interface EncounterPackage {
  encounter: Encounter;
  claim: Claim;
  amountCents: number;
  finalizationDateIso: string;
  externalClaimId: string;
}

export const index = wrapHandler(ZAMBDA_NAME, async (input: ZambdaInput): Promise<APIGatewayProxyResult> => {
  const { secrets } = input;
  m2mToken = await checkOrCreateM2MClientToken(m2mToken, secrets);
  const oystehr = createOystehrClient(m2mToken, secrets);

  console.log('Fetching invoicing config from FHIR');
  const { questionnaireResponse } = await getOrCreateInvoicingConfig(oystehr);
  const invoicingConfig = parseInvoicingConfig(questionnaireResponse);
  console.log('Invoicing config loaded, dueDays:', invoicingConfig.dueDaysFromGeneration);

  const since = DateTime.now().minus({ days: LOOKBACK_DAYS });
  console.log('Fetching FHIR Claims created since:', since.toISO());
  const claimsByEncounterId = await getRecentClaimsByEncounter(oystehr, since);

  const packagesToCreate = await buildPackagesForEncountersWithoutTask(oystehr, claimsByEncounterId);

  console.log(
    `Packages to create tasks for: ${packagesToCreate.length} ${JSON.stringify(
      packagesToCreate.map((p) => ({
        encounterId: p.encounter.id,
        claimId: p.externalClaimId,
        amountCents: p.amountCents,
      }))
    )}`
  );

  await Promise.all(packagesToCreate.map((pkg) => createTaskForEncounter(oystehr, pkg, invoicingConfig)));

  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Successfully created tasks for encounters' }),
  };
});

function getInvoiceTaskInput(
  claimId: string,
  finalizationDateIso: string,
  patientBalanceInCents: number,
  config: ParsedInvoicingConfig
): InvoiceTaskInput {
  const dueDate = DateTime.now().plus({ days: config.dueDaysFromGeneration }).toISODate();

  return {
    smsTextMessage: config.defaultSmsTemplate,
    memo: config.defaultInvoiceMemo,
    dueDate,
    amountCents: patientBalanceInCents,
    claimId,
    finalizationDate: finalizationDateIso,
  };
}

export async function createTaskForEncounter(
  oystehr: Oystehr,
  encounterPkg: EncounterPackage,
  config: ParsedInvoicingConfig
): Promise<void> {
  try {
    const { encounter, amountCents, finalizationDateIso, externalClaimId } = encounterPkg;
    const patientId = encounter.subject?.reference?.replace('Patient/', '');

    if (!patientId) throw new Error('Patient ID not found in encounter: ' + encounter.id);

    const prefilledInvoiceInfo = getInvoiceTaskInput(externalClaimId, finalizationDateIso, amountCents, config);

    console.log(
      `Creating task. patient: ${patientId}, claim: ${externalClaimId}, encounter: ${encounter.id}, balance (cents): ${amountCents}`
    );

    const task: Task = {
      resourceType: 'Task',
      status: readyTaskStatus,
      description: `Send invoice for $${(amountCents / 100).toFixed(2)}`,
      intent: 'order',
      code: RcmTaskCodings.sendInvoiceToPatient,
      encounter: createReference(encounter),
      for: { reference: `Patient/${patientId}` },
      authoredOn: prefilledInvoiceInfo.finalizationDate ?? DateTime.now().toISO(),
      ...(encounter.period?.start
        ? { executionPeriod: { start: encounter.period.start, end: encounter.period.start } }
        : {}),
      ...(amountCents === 0 ? { businessStatus: ZERO_BALANCE_BUSINESS_STATUS } : {}),
      input: createInvoiceTaskInput(prefilledInvoiceInfo),
    };

    console.log('Creating task:', JSON.stringify(task));

    const created = await oystehr.fhir.create(task);

    console.log(`Created task: ${created.id} (encounter: ${encounter.id}, claim: ${externalClaimId})`);
  } catch (error) {
    console.error(
      `Failed to create task for encounter ${encounterPkg.encounter.id}, claim ${encounterPkg.externalClaimId}:`,
      error
    );

    captureException(error, {
      tags: {
        claimId: encounterPkg.externalClaimId,
        encounterId: encounterPkg.encounter.id,
      },
    });
  }
}

function dollarsToCents(value: number | undefined): number {
  if (value == null || Number.isNaN(value)) return 0;
  return Math.round(value * 100);
}

// Exported for unit testing.
export function sumChargedCents(claims: Claim[]): number {
  let charged = 0;
  for (const claim of claims) {
    for (const item of claim.item ?? []) {
      charged += dollarsToCents(item.net?.value ?? item.unitPrice?.value);
    }
  }
  return charged;
}

// Exported for unit testing.
export function sumInsurancePaidCents(claimResponses: ClaimResponse[]): number {
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

// Exported for unit testing.
export function sumPaidPaymentNoticeCents(notices: PaymentNotice[]): number {
  return notices.reduce((acc, n) => {
    const code =
      n.paymentStatus?.coding?.find((c) => c.system?.includes('paymentstatus'))?.code ??
      n.paymentStatus?.coding?.[0]?.code;
    return code === PAYMENT_STATUS_PAID ? acc + dollarsToCents(n.amount?.value) : acc;
  }, 0);
}

function getEncounterIdFromClaim(claim: Claim): string | undefined {
  // FHIR R4 references the Encounter at the item level (Claim.item[].encounter[]).
  for (const item of claim.item ?? []) {
    for (const enc of item.encounter ?? []) {
      const ref = enc.reference;
      if (ref?.startsWith('Encounter/')) return ref.slice('Encounter/'.length);
    }
  }
  return undefined;
}

function getExternalClaimId(claim: Claim): string {
  // Prefer a stable external identifier (e.g. X12 CLM01) when available; fall back to FHIR id.
  return claim.identifier?.[0]?.value ?? claim.id ?? '';
}

// Discover Claims authored within the lookback window and group them by Encounter id.
// Multiple Claims per Encounter are kept; we use the latest-by-`created` for task metadata.
export async function getRecentClaimsByEncounter(oystehr: Oystehr, since: DateTime): Promise<Map<string, Claim[]>> {
  const sinceIso = since.toISO();
  const bundle = (
    await oystehr.fhir.search<Claim | Encounter>({
      resourceType: 'Claim',
      params: [
        { name: 'created', value: `ge${sinceIso}` },
        { name: '_include', value: 'Claim:encounter' },
      ],
    })
  ).unbundle();

  const claims = bundle.filter((r): r is Claim => r.resourceType === 'Claim');
  const byEncounter = new Map<string, Claim[]>();
  for (const claim of claims) {
    const encounterId = getEncounterIdFromClaim(claim);
    if (!encounterId) continue;
    const list = byEncounter.get(encounterId) ?? [];
    list.push(claim);
    byEncounter.set(encounterId, list);
  }
  console.log(`Found ${claims.length} Claims across ${byEncounter.size} Encounters since ${sinceIso}`);
  return byEncounter;
}

// Returns the set of Encounter ids that already have a sendInvoiceToPatient Task.
export async function findEncountersWithExistingInvoiceTask(
  oystehr: Oystehr,
  encounterIds: string[]
): Promise<Set<string>> {
  if (encounterIds.length === 0) return new Set();
  const tasks = (
    await oystehr.fhir.search<Task>({
      resourceType: 'Task',
      params: [
        { name: 'code', value: `${RCM_TASK_SYSTEM}|${RcmTaskCode.sendInvoiceToPatient}` },
        { name: 'encounter', value: encounterIds.map((id) => `Encounter/${id}`).join(',') },
      ],
    })
  ).unbundle();
  const result = new Set<string>();
  for (const task of tasks) {
    const ref = task.encounter?.reference;
    if (ref?.startsWith('Encounter/')) {
      result.add(ref.slice('Encounter/'.length));
    }
  }
  return result;
}

// Compute the patient balance for a single Encounter using the same FHIR formula as
// `get-patient-balances`: charged − insurance-paid − patient-paid (floored at zero).
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

// For each Encounter that has Claim activity in the window and no existing invoice Task,
// compute its patient balance and assemble an EncounterPackage.
export async function buildPackagesForEncountersWithoutTask(
  oystehr: Oystehr,
  claimsByEncounterId: Map<string, Claim[]>
): Promise<EncounterPackage[]> {
  if (claimsByEncounterId.size === 0) return [];

  const encounterIds = Array.from(claimsByEncounterId.keys());
  const withTask = await findEncountersWithExistingInvoiceTask(oystehr, encounterIds);
  const todoIds = encounterIds.filter((id) => !withTask.has(id));
  console.log(
    `Encounters with Claim activity: ${encounterIds.length} total, ${withTask.size} already have a task, ${todoIds.length} need one`
  );
  if (todoIds.length === 0) return [];

  const encounters = (
    await oystehr.fhir.search<Encounter>({
      resourceType: 'Encounter',
      params: [{ name: '_id', value: todoIds.join(',') }],
    })
  ).unbundle();

  const packages: EncounterPackage[] = [];
  for (const encounter of encounters) {
    if (!encounter.id) continue;
    const claims = claimsByEncounterId.get(encounter.id) ?? [];
    if (claims.length === 0) continue;

    // Use the latest claim by created date as the canonical claim for task metadata.
    const sortedByCreated = [...claims].sort((a, b) => {
      const aT = a.created ? DateTime.fromISO(a.created).toMillis() : 0;
      const bT = b.created ? DateTime.fromISO(b.created).toMillis() : 0;
      return bT - aT;
    });
    const claim = sortedByCreated[0];
    const finalizationDateIso = claim.created ?? DateTime.now().toISO()!;
    const externalClaimId = getExternalClaimId(claim);

    const amountCents = await computeEncounterPatientBalance(oystehr, encounter.id, claims);
    packages.push({ encounter, claim, amountCents, finalizationDateIso, externalClaimId });
  }
  return packages;
}
