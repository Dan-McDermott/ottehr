// Lightweight shape-comparison test for the FHIR-based get-patient-balances zambda.
// Replaces the previous Candid-coupled live-server integration test: that test required Auth0,
// a live FHIR API, and injected URLs. The semantic balance math is covered in
// `test/unit/get-patient-balances.test.ts`; this file's job is to lock the *response shape*
// against the public `GetPatientBalancesZambdaOutput` contract so callers (EHR + intake) keep
// receiving the same field names and types they did under the old Candid implementation.
import { Appointment, Claim, ClaimResponse, Encounter, PaymentNotice } from 'fhir/r4b';
import { GetPatientBalancesZambdaOutput } from 'utils';
import { describe, expect, test } from 'vitest';
import { performEffect } from '../../src/ehr/get-patient-balances';

const ADJ_SYSTEM = 'http://terminology.hl7.org/CodeSystem/adjudication';
const PAY_SYSTEM = 'http://terminology.hl7.org/CodeSystem/paymentstatus';

const encounter: Encounter = {
  resourceType: 'Encounter',
  id: 'enc-shape-1',
  status: 'finished',
  class: { code: 'AMB' },
  subject: { reference: 'Patient/pat-shape' },
  appointment: [{ reference: 'Appointment/appt-shape-1' }],
};
const appointment: Appointment = {
  resourceType: 'Appointment',
  id: 'appt-shape-1',
  status: 'fulfilled',
  start: '2026-02-15T14:00:00Z',
  participant: [{ actor: { reference: 'Patient/pat-shape' }, status: 'accepted' }],
};
const claim: Claim = {
  resourceType: 'Claim',
  id: 'claim-shape-1',
  status: 'active',
  type: { coding: [{ code: 'professional' }] },
  use: 'claim',
  patient: { reference: 'Patient/pat-shape' },
  created: '2026-02-15',
  provider: { reference: 'Practitioner/p' },
  priority: { coding: [{ code: 'normal' }] },
  insurance: [{ sequence: 1, focal: true, coverage: { reference: 'Coverage/c' } }],
  item: [{ sequence: 1, productOrService: { coding: [{ code: '99213' }] }, net: { value: 150 } }],
};
const claimResponse: ClaimResponse = {
  resourceType: 'ClaimResponse',
  id: 'cr-shape-1',
  status: 'active',
  type: { coding: [{ code: 'professional' }] },
  use: 'claim',
  patient: { reference: 'Patient/pat-shape' },
  created: '2026-02-16',
  insurer: { reference: 'Organization/o' },
  outcome: 'complete',
  request: { reference: 'Claim/claim-shape-1' },
  item: [
    {
      itemSequence: 1,
      adjudication: [{ category: { coding: [{ system: ADJ_SYSTEM, code: 'benefit' }] }, amount: { value: 80 } }],
    },
  ],
};
const pendingNotice: PaymentNotice = {
  resourceType: 'PaymentNotice',
  id: 'pn-shape-pending',
  status: 'active',
  payment: { reference: 'PaymentReconciliation/y' },
  paymentDate: '2026-02-17',
  paymentStatus: { coding: [{ system: PAY_SYSTEM, code: 'paid' }] },
  request: { reference: 'Patient/pat-shape' },
  recipient: { reference: 'Patient/pat-shape' },
  amount: { value: 20 },
  created: '2026-02-17',
};

function makeOystehrMock(): unknown {
  return {
    fhir: {
      search: async ({ resourceType, params }: { resourceType: string; params: { name: string; value: string }[] }) => {
        if (resourceType === 'Encounter') return { unbundle: () => [encounter, appointment] };
        if (resourceType === 'Claim') return { unbundle: () => [claim, claimResponse] };
        if (resourceType === 'PaymentNotice') {
          const requestParam = params.find((p) => p.name === 'request');
          if (requestParam?.value.startsWith('Patient/')) return { unbundle: () => [pendingNotice] };
          return { unbundle: () => [] };
        }
        return { unbundle: () => [] };
      },
    },
  };
}

describe('get-patient-balances response shape (FHIR path)', () => {
  test('response conforms to GetPatientBalancesZambdaOutput field names and types', async () => {
    const oystehr = makeOystehrMock() as Parameters<typeof performEffect>[1];
    const result: GetPatientBalancesZambdaOutput = await performEffect(
      { body: { patientId: 'pat-shape' }, callerAccessToken: 'tok' },
      oystehr
    );

    // Top-level keys present and only those expected by the public contract.
    expect(Object.keys(result).sort()).toEqual(['encounters', 'pendingPaymentCents', 'totalBalanceCents']);
    expect(typeof result.totalBalanceCents).toBe('number');
    expect(typeof result.pendingPaymentCents).toBe('number');
    expect(Array.isArray(result.encounters)).toBe(true);

    // Each encounter row conforms to the documented sub-shape.
    expect(result.encounters.length).toBe(1);
    const row = result.encounters[0];
    expect(Object.keys(row).sort()).toEqual(['appointmentId', 'encounterDate', 'encounterId', 'patientBalanceCents']);
    expect(typeof row.encounterId).toBe('string');
    expect(typeof row.appointmentId).toBe('string');
    expect(typeof row.encounterDate).toBe('string');
    expect(typeof row.patientBalanceCents).toBe('number');
  });

  test('empty-patient response also matches contract shape', async () => {
    const emptyOystehr = {
      fhir: { search: async () => ({ unbundle: () => [] }) },
    } as unknown as Parameters<typeof performEffect>[1];
    const result: GetPatientBalancesZambdaOutput = await performEffect(
      { body: { patientId: 'pat-empty' }, callerAccessToken: 'tok' },
      emptyOystehr
    );
    expect(Object.keys(result).sort()).toEqual(['encounters', 'pendingPaymentCents', 'totalBalanceCents']);
    expect(result.encounters).toEqual([]);
    expect(result.totalBalanceCents).toBe(0);
    expect(result.pendingPaymentCents).toBe(0);
  });
});
