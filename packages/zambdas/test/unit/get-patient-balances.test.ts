import { Appointment, Claim, ClaimResponse, Encounter, PaymentNotice } from 'fhir/r4b';
import { describe, expect, test } from 'vitest';
import {
  performEffect,
  sumChargedCents,
  sumInsurancePaidCents,
  sumPaidPaymentNoticeCents,
} from '../../src/ehr/get-patient-balances';

const ADJ_SYSTEM = 'http://terminology.hl7.org/CodeSystem/adjudication';
const PAY_SYSTEM = 'http://terminology.hl7.org/CodeSystem/paymentstatus';

describe('get-patient-balances FHIR helpers', () => {
  test('sumChargedCents sums Claim item.net (or unitPrice fallback) in cents', () => {
    const claims: Claim[] = [
      {
        resourceType: 'Claim',
        status: 'active',
        type: { coding: [{ code: 'professional' }] },
        use: 'claim',
        patient: { reference: 'Patient/p' },
        created: '2026-01-01',
        provider: { reference: 'Practitioner/p' },
        priority: { coding: [{ code: 'normal' }] },
        insurance: [{ sequence: 1, focal: true, coverage: { reference: 'Coverage/c' } }],
        item: [
          {
            sequence: 1,
            productOrService: { coding: [{ code: '99213' }] },
            net: { value: 200, currency: 'USD' },
          },
          {
            sequence: 2,
            productOrService: { coding: [{ code: '85025' }] },
            unitPrice: { value: 50, currency: 'USD' },
          },
        ],
      },
    ];
    expect(sumChargedCents(claims)).toBe(25000);
  });

  test('sumInsurancePaidCents sums benefit + paidtoprovider adjudications, ignores others', () => {
    const claimResponses: ClaimResponse[] = [
      {
        resourceType: 'ClaimResponse',
        status: 'active',
        type: { coding: [{ code: 'professional' }] },
        use: 'claim',
        patient: { reference: 'Patient/p' },
        created: '2026-01-02',
        insurer: { reference: 'Organization/o' },
        outcome: 'complete',
        item: [
          {
            itemSequence: 1,
            adjudication: [
              { category: { coding: [{ system: ADJ_SYSTEM, code: 'benefit' }] }, amount: { value: 120 } },
              { category: { coding: [{ system: ADJ_SYSTEM, code: 'deductible' }] }, amount: { value: 30 } },
            ],
          },
          {
            itemSequence: 2,
            adjudication: [
              { category: { coding: [{ system: ADJ_SYSTEM, code: 'paidtoprovider' }] }, amount: { value: 40 } },
            ],
          },
        ],
      },
    ];
    expect(sumInsurancePaidCents(claimResponses)).toBe(16000);
  });

  test('sumPaidPaymentNoticeCents counts only notices with status=paid', () => {
    const notices: PaymentNotice[] = [
      {
        resourceType: 'PaymentNotice',
        status: 'active',
        payment: { reference: 'PaymentReconciliation/x' },
        paymentDate: '2026-01-03',
        paymentStatus: { coding: [{ system: PAY_SYSTEM, code: 'paid' }] },
        recipient: { reference: 'Patient/p' },
        amount: { value: 25 },
        created: '2026-01-03',
      },
      {
        resourceType: 'PaymentNotice',
        status: 'active',
        payment: { reference: 'PaymentReconciliation/y' },
        paymentDate: '2026-01-04',
        paymentStatus: { coding: [{ system: PAY_SYSTEM, code: 'cleared' }] },
        recipient: { reference: 'Patient/p' },
        amount: { value: 10 },
        created: '2026-01-04',
      },
    ];
    expect(sumPaidPaymentNoticeCents(notices)).toBe(2500);
  });
});

describe('performEffect (FHIR-based)', () => {
  const encounter: Encounter = {
    resourceType: 'Encounter',
    id: 'enc-1',
    status: 'finished',
    class: { code: 'AMB' },
    subject: { reference: 'Patient/pat-1' },
    appointment: [{ reference: 'Appointment/appt-1' }],
  };
  const appointment: Appointment = {
    resourceType: 'Appointment',
    id: 'appt-1',
    status: 'fulfilled',
    start: '2026-01-01T10:00:00Z',
    participant: [{ actor: { reference: 'Patient/pat-1' }, status: 'accepted' }],
  };
  const claim: Claim = {
    resourceType: 'Claim',
    id: 'claim-1',
    status: 'active',
    type: { coding: [{ code: 'professional' }] },
    use: 'claim',
    patient: { reference: 'Patient/pat-1' },
    created: '2026-01-01',
    provider: { reference: 'Practitioner/p' },
    priority: { coding: [{ code: 'normal' }] },
    insurance: [{ sequence: 1, focal: true, coverage: { reference: 'Coverage/c' } }],
    item: [{ sequence: 1, productOrService: { coding: [{ code: '99213' }] }, net: { value: 200 } }],
  };
  const claimResponse: ClaimResponse = {
    resourceType: 'ClaimResponse',
    id: 'cr-1',
    status: 'active',
    type: { coding: [{ code: 'professional' }] },
    use: 'claim',
    patient: { reference: 'Patient/pat-1' },
    created: '2026-01-02',
    insurer: { reference: 'Organization/o' },
    outcome: 'complete',
    request: { reference: 'Claim/claim-1' },
    item: [
      {
        itemSequence: 1,
        adjudication: [{ category: { coding: [{ system: ADJ_SYSTEM, code: 'benefit' }] }, amount: { value: 120 } }],
      },
    ],
  };
  const paidPatientNotice: PaymentNotice = {
    resourceType: 'PaymentNotice',
    id: 'pn-paid',
    status: 'active',
    payment: { reference: 'PaymentReconciliation/x' },
    paymentDate: '2026-01-03',
    paymentStatus: { coding: [{ system: PAY_SYSTEM, code: 'paid' }] },
    recipient: { reference: 'Patient/pat-1' },
    request: { reference: 'Encounter/enc-1' },
    amount: { value: 25 },
    created: '2026-01-03',
  };
  // Per spec Locked Decision #5, "pending" = paymentStatus="paid" AND the notice's `request`
  // references the Patient directly (i.e., not yet allocated to a billed Encounter).
  const pendingPatientNotice: PaymentNotice = {
    resourceType: 'PaymentNotice',
    id: 'pn-pending',
    status: 'active',
    payment: { reference: 'PaymentReconciliation/y' },
    paymentDate: '2026-01-04',
    paymentStatus: { coding: [{ system: PAY_SYSTEM, code: 'paid' }] },
    request: { reference: 'Patient/pat-1' },
    recipient: { reference: 'Patient/pat-1' },
    amount: { value: 10 },
    created: '2026-01-04',
  };

  function makeOystehrMock(): unknown {
    return {
      fhir: {
        search: async ({
          resourceType,
          params,
        }: {
          resourceType: string;
          params: { name: string; value: string }[];
        }) => {
          if (resourceType === 'Encounter') {
            return { unbundle: () => [encounter, appointment] };
          }
          if (resourceType === 'Claim') {
            return { unbundle: () => [claim, claimResponse] };
          }
          if (resourceType === 'PaymentNotice') {
            const requestParam = params.find((p) => p.name === 'request');
            if (requestParam?.value.startsWith('Encounter/')) {
              return { unbundle: () => [paidPatientNotice] };
            }
            if (requestParam?.value.startsWith('Patient/')) {
              return { unbundle: () => [pendingPatientNotice] };
            }
            return { unbundle: () => [] };
          }
          return { unbundle: () => [] };
        },
      },
    };
  }

  test('aggregates encounter balance from Claim/ClaimResponse/PaymentNotice and reports pending', async () => {
    const oystehr = makeOystehrMock() as Parameters<typeof performEffect>[1];
    const validatedInput = { body: { patientId: 'pat-1' }, callerAccessToken: 'tok' };

    const result = await performEffect(validatedInput, oystehr);

    // charged 200 - insurance 120 - patient paid 25 = 55
    expect(result.encounters).toHaveLength(1);
    expect(result.encounters[0]).toMatchObject({
      encounterId: 'enc-1',
      appointmentId: 'appt-1',
      encounterDate: '2026-01-01T10:00:00Z',
      patientBalanceCents: 5500,
    });
    expect(result.totalBalanceCents).toBe(5500);
    expect(result.pendingPaymentCents).toBe(1000);
  });

  test('returns empty result when patient has no encounters', async () => {
    const oystehr = {
      fhir: {
        search: async () => ({ unbundle: () => [] }),
      },
    } as unknown as Parameters<typeof performEffect>[1];
    const result = await performEffect({ body: { patientId: 'pat-1' }, callerAccessToken: 't' }, oystehr);
    expect(result).toEqual({ encounters: [], totalBalanceCents: 0, pendingPaymentCents: 0 });
  });
});
