import { Claim, ClaimResponse, Encounter, PaymentNotice } from 'fhir/r4b';
import { describe, expect, test } from 'vitest';
import { getServiceLines } from '../../src/shared/statements/get-statement-details';

const ADJ_SYSTEM = 'http://terminology.hl7.org/CodeSystem/adjudication';

const encounter: Encounter = {
  resourceType: 'Encounter',
  id: 'enc-1',
  status: 'finished',
  class: { code: 'AMB' },
  subject: { reference: 'Patient/pat-1' },
};

const claim: Claim = {
  resourceType: 'Claim',
  id: 'claim-1',
  status: 'active',
  type: { coding: [{ code: 'professional' }] },
  use: 'claim',
  patient: { reference: 'Patient/pat-1' },
  created: '2026-01-01',
  provider: { reference: 'Practitioner/p-1' },
  priority: { coding: [{ code: 'normal' }] },
  insurance: [{ sequence: 1, focal: true, coverage: { reference: 'Coverage/c-1' } }],
  item: [
    {
      sequence: 1,
      productOrService: { coding: [{ system: 'http://www.ama-assn.org/go/cpt', code: '99213' }] },
      net: { value: 200, currency: 'USD' },
    },
    {
      sequence: 2,
      productOrService: { coding: [{ system: 'http://www.ama-assn.org/go/cpt', code: '85025' }] },
      net: { value: 50, currency: 'USD' },
    },
  ],
};

const claimResponse: ClaimResponse = {
  resourceType: 'ClaimResponse',
  id: 'cr-1',
  status: 'active',
  type: { coding: [{ code: 'professional' }] },
  use: 'claim',
  patient: { reference: 'Patient/pat-1' },
  created: '2026-01-02',
  insurer: { reference: 'Organization/org-1' },
  outcome: 'complete',
  request: { reference: 'Claim/claim-1' },
  item: [
    {
      itemSequence: 1,
      adjudication: [
        { category: { coding: [{ system: ADJ_SYSTEM, code: 'benefit' }] }, amount: { value: 120, currency: 'USD' } },
        { category: { coding: [{ system: ADJ_SYSTEM, code: 'deductible' }] }, amount: { value: 30, currency: 'USD' } },
      ],
    },
    {
      itemSequence: 2,
      adjudication: [
        {
          category: { coding: [{ system: ADJ_SYSTEM, code: 'paidtoprovider' }] },
          amount: { value: 40, currency: 'USD' },
        },
      ],
    },
  ],
};

const paymentNotice: PaymentNotice = {
  resourceType: 'PaymentNotice',
  id: 'pn-1',
  status: 'active',
  payment: { reference: 'PaymentReconciliation/pr-1' },
  paymentDate: '2026-01-03',
  paymentStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/paymentstatus', code: 'paid' }] },
  recipient: { reference: 'Patient/pat-1' },
  request: { reference: 'Encounter/enc-1' },
  amount: { value: 25, currency: 'USD' },
  created: '2026-01-03',
};

function makeOystehrMock(): {
  fhir: {
    search: (req: { resourceType: string }) => Promise<{ unbundle: () => unknown[] }>;
  };
  terminology: {
    searchCpt: (args: { query: string }) => Promise<{ codes: Array<{ code: string; display: string }> }>;
    searchHcpcs: (args: { query: string }) => Promise<{ codes: Array<{ code: string; display: string }> }>;
  };
} {
  return {
    fhir: {
      search: async ({ resourceType }) => {
        if (resourceType === 'Claim') {
          return { unbundle: () => [claim, claimResponse] };
        }
        if (resourceType === 'PaymentNotice') {
          return { unbundle: () => [paymentNotice] };
        }
        return { unbundle: () => [] };
      },
    },
    terminology: {
      searchCpt: async ({ query }) => ({
        codes: query === '99213' ? [{ code: '99213', display: 'Office visit' }] : [],
      }),
      searchHcpcs: async () => ({ codes: [] }),
    },
  };
}

describe('getServiceLines (FHIR-based)', () => {
  test('aggregates Claim items with ClaimResponse adjudications and PaymentNotice totals', async () => {
    const oystehr = makeOystehrMock() as unknown as Parameters<typeof getServiceLines>[1];
    const result = await getServiceLines(encounter, oystehr);

    expect(result.serviceLines).toHaveLength(2);
    expect(result.serviceLines[0]).toMatchObject({
      cpt: '99213',
      description: '99213 - Office visit',
      charged: '$200.00',
      insurancePaid: '$120.00',
      patientPaid: '$0.00',
      patientOwes: '$80.00',
    });
    expect(result.serviceLines[1]).toMatchObject({
      cpt: '85025',
      charged: '$50.00',
      insurancePaid: '$40.00',
      patientOwes: '$10.00',
    });

    expect(result.totals.charged).toBe('$250.00');
    expect(result.totals.insurancePaid).toBe('$160.00');
    expect(result.totals.deductible).toBe('$30.00');
    expect(result.totals.patientPaid).toBe('$25.00');
    // patient balance = (80 + 10) - 25 = 65
    expect(result.totals.balanceDue).toBe('$65.00');
  });
});
