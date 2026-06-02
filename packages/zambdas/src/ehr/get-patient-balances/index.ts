import Oystehr from '@oystehr/sdk';
import { APIGatewayProxyResult } from 'aws-lambda';
import { Appointment, Claim, ClaimResponse, Encounter, PaymentNotice } from 'fhir/r4b';
import { GetPatientBalancesZambdaOutput } from 'utils';
import {
  checkOrCreateM2MClientToken,
  createOystehrClient,
  lambdaResponse,
  wrapHandler,
  ZambdaInput,
} from '../../shared';
import { ValidatedInput, validateInput, validateSecrets } from './validateRequestParameters';

type EncounterDataMap = Map<
  string,
  {
    encounterDate: string;
    appointmentId: string;
    patientBalanceCents?: number;
  }
>;

// Lifting up value to outside of the handler allows it to stay in memory across warm lambda invocations
let m2mToken: string;

const ZAMBDA_NAME = 'get-patient-balances';

// FHIR adjudication category codes (http://terminology.hl7.org/CodeSystem/adjudication).
const ADJUDICATION_CATEGORY_BENEFIT = 'benefit';
const ADJUDICATION_CATEGORY_PAID_TO_PROVIDER = 'paidtoprovider';
// FHIR PaymentStatus codes (http://terminology.hl7.org/CodeSystem/paymentstatus).
const PAYMENT_STATUS_PAID = 'paid';

export const index = wrapHandler(ZAMBDA_NAME, async (unsafeInput: ZambdaInput): Promise<APIGatewayProxyResult> => {
  const secrets = validateSecrets(unsafeInput.secrets);

  const validatedInput = await validateInput(unsafeInput);

  m2mToken = await checkOrCreateM2MClientToken(m2mToken, secrets);
  const oystehr = createOystehrClient(m2mToken, secrets);

  const response = await performEffect(validatedInput, oystehr);

  return lambdaResponse(200, response);
});

export async function performEffect(
  validatedInput: ValidatedInput,
  oystehr: Oystehr
): Promise<GetPatientBalancesZambdaOutput> {
  const { patientId } = validatedInput.body;

  const noData = {
    encounters: [],
    totalBalanceCents: 0,
    pendingPaymentCents: 0,
  };

  const { encounters, appointments } = await getFhirEncountersAndAppointmentsForPatient(oystehr, patientId);
  if (encounters.length === 0) {
    return noData;
  }

  const encounterDataMap: EncounterDataMap = new Map();
  encounters.forEach((encounter) => {
    const appointmentId = encounter.appointment?.[0].reference?.split('/')[1];
    const appointment = appointments.find((app) => app.id === appointmentId);
    const encounterDate = appointment?.start;
    if (!appointmentId || !encounterDate || !encounter.id) {
      return;
    }
    encounterDataMap.set(encounter.id, { encounterDate, appointmentId });
  });

  if (encounterDataMap.size === 0) {
    return noData;
  }

  await populateEncounterBalances(oystehr, encounterDataMap);
  const pendingPaymentCents = await getPendingPatientPayments(oystehr, patientId);

  const returnData = Array.from(encounterDataMap.entries())
    .filter(([, mapValue]) => (mapValue.patientBalanceCents ?? 0) > 0)
    .map(([encounterId, mapValue]) => ({
      encounterId,
      encounterDate: mapValue.encounterDate,
      appointmentId: mapValue.appointmentId,
      patientBalanceCents: mapValue.patientBalanceCents ?? 0,
    }));

  return {
    encounters: returnData,
    totalBalanceCents: returnData.reduce((acc, { patientBalanceCents }) => acc + patientBalanceCents, 0),
    pendingPaymentCents,
  };
}

async function getFhirEncountersAndAppointmentsForPatient(
  oystehr: Oystehr,
  patientId: string
): Promise<{ encounters: Encounter[]; appointments: Appointment[] }> {
  const resourcesResponse = await oystehr.fhir.search<Encounter | Appointment>({
    resourceType: 'Encounter',
    params: [
      { name: 'subject', value: `Patient/${patientId}` },
      { name: '_include', value: 'Encounter:appointment' },
      // exclude follow-up encounters that are missing appointment references
      { name: 'appointment:missing', value: 'false' },
    ],
  });
  const resources = resourcesResponse.unbundle();
  const encounters = resources.filter((r) => r.resourceType === 'Encounter') as Encounter[];
  const appointments = resources.filter((r) => r.resourceType === 'Appointment') as Appointment[];
  return { encounters, appointments };
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

function getPaymentNoticeStatusCode(notice: PaymentNotice): string | undefined {
  return (
    notice.paymentStatus?.coding?.find((c) => c.system?.includes('paymentstatus'))?.code ??
    notice.paymentStatus?.coding?.[0]?.code
  );
}

// Exported for unit testing.
export function sumPaidPaymentNoticeCents(notices: PaymentNotice[]): number {
  return notices.reduce((acc, n) => {
    return getPaymentNoticeStatusCode(n) === PAYMENT_STATUS_PAID ? acc + dollarsToCents(n.amount?.value) : acc;
  }, 0);
}

// Per-encounter charges and adjudications are correlated by FHIR reference (Claim.encounter and
// ClaimResponse.request) — the natural, in-graph join. The Track B X12 helpers
// (`findClaimByCLM01`, `findClaimResponseByPayerICN`, `getStediTransactionIds` from
// `utils/lib/types/data/x12`) exist for the *opposite* direction: locating FHIR resources from raw
// X12 control numbers (CLM01 / payer ICN). In this read path we already have the Encounter ID, so
// no X12 → FHIR resolution is required and the helpers don't fit. They will be the right tool for
// the Stedi → FHIR worker side (Track C downstream waves), not for read-time aggregation here.
async function populateEncounterBalances(oystehr: Oystehr, encounterDataMap: EncounterDataMap): Promise<void> {
  for (const encounterId of encounterDataMap.keys()) {
    const claimBundle = (
      await oystehr.fhir.search<Claim | ClaimResponse>({
        resourceType: 'Claim',
        params: [
          { name: 'encounter', value: `Encounter/${encounterId}` },
          { name: '_revinclude', value: 'ClaimResponse:request' },
        ],
      })
    ).unbundle();

    const claims = claimBundle.filter((r): r is Claim => r.resourceType === 'Claim');
    if (claims.length === 0) {
      continue;
    }
    const claimResponses = claimBundle.filter((r): r is ClaimResponse => r.resourceType === 'ClaimResponse');

    const chargedCents = sumChargedCents(claims);
    const insurancePaidCents = sumInsurancePaidCents(claimResponses);

    const paidNotices = (
      await oystehr.fhir.search<PaymentNotice>({
        resourceType: 'PaymentNotice',
        params: [{ name: 'request', value: `Encounter/${encounterId}` }],
      })
    ).unbundle();
    const paidPatientCents = sumPaidPaymentNoticeCents(paidNotices);

    const balanceCents = Math.max(0, chargedCents - insurancePaidCents - paidPatientCents);
    const mapValue = encounterDataMap.get(encounterId);
    if (mapValue) {
      mapValue.patientBalanceCents = balanceCents;
      encounterDataMap.set(encounterId, mapValue);
    }
  }
}

// "Pending" patient payments per spec Locked Decision #5: money the patient has actually pushed
// (paymentStatus = "paid") that has *not yet been allocated* to a billed Encounter. PaymentNotices
// whose `request` references an Encounter are already netted out per-encounter in
// populateEncounterBalances; we identify "unallocated" notices as those whose `request` references
// the Patient directly (target = Patient/{id} with no Encounter). This is the operationally
// equivalent simpler form of "paid AND payment-reference does not point to a PaymentReconciliation
// for an already-counted Encounter Invoice" — equivalent here because the codebase's Temporal
// workers attach paid-against-encounter notices to the Encounter via PaymentNotice.request, never
// indirectly through the PaymentReconciliation.
async function getPendingPatientPayments(oystehr: Oystehr, patientId: string): Promise<number> {
  const notices = (
    await oystehr.fhir.search<PaymentNotice>({
      resourceType: 'PaymentNotice',
      params: [{ name: 'request', value: `Patient/${patientId}` }],
    })
  ).unbundle();

  let pending = 0;
  for (const n of notices) {
    if (getPaymentNoticeStatusCode(n) === PAYMENT_STATUS_PAID) {
      pending += dollarsToCents(n.amount?.value);
    }
  }
  return pending;
}
