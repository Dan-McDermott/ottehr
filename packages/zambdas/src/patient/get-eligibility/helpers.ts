import Oystehr from '@oystehr/sdk';
import { captureException } from '@sentry/aws-serverless';
import {
  Coverage,
  CoverageEligibilityRequest,
  CoverageEligibilityResponse,
  DomainResource,
  Organization,
} from 'fhir/r4b';
import { DateTime } from 'luxon';
import {
  ELIGIBILITY_BENEFIT_CODES,
  InsuranceCheckStatusWithDate,
  InsuranceEligibilityCheckStatus,
  parseCoverageEligibilityResponse,
  removeTimeFromDate,
} from 'utils';

interface InsuranceIds {
  primary: string;
  secondary?: string;
}

export const getInsurancePlansAndOrgs = async (
  planIds: InsuranceIds,
  oystehrClient: Oystehr
): Promise<Organization[]> => {
  const orgs = (
    await oystehrClient.fhir.search<Organization>({
      resourceType: 'Organization',
      params: [
        {
          name: '_id',
          value: `${planIds.primary}${planIds.secondary ? `,${planIds.secondary}` : ''}`,
        },
      ],
    })
  ).unbundle();

  const sorted = orgs.sort((r1, r2) => {
    if (r1.id === planIds.primary) {
      return -1;
    } else if (r2.id === planIds.secondary) {
      return 1;
    }
    return 0;
  });
  console.log('sorted', JSON.stringify(sorted, null, 2));
  return sorted;
};

export interface MakeCoverageEligibilityRequestInput {
  coverageReference: string;
  payorReference: string;
  providerReference: string;
  patientReference: string;
  contained?: DomainResource['contained'];
}

export const makeCoverageEligibilityRequest = (
  input: MakeCoverageEligibilityRequestInput
): CoverageEligibilityRequest => {
  const { coverageReference, patientReference, payorReference, providerReference, contained } = input;
  const today = removeTimeFromDate(DateTime.now().toISO());
  const coverageEligibilityRequest: CoverageEligibilityRequest = {
    resourceType: 'CoverageEligibilityRequest',
    status: 'active',
    purpose: ['benefits'],
    created: today,
    servicedDate: today,
    contained,
    patient: {
      reference: patientReference,
    },
    insurer: {
      reference: payorReference,
    },
    provider: {
      reference: providerReference,
    },
    item: [
      {
        category: {
          coding: [
            {
              system: 'http://terminology.oystehr.com/CodeSystem/benefit-category',
              code: ELIGIBILITY_BENEFIT_CODES,
            },
          ],
        },
      },
    ],
    insurance: [
      {
        coverage: {
          reference: coverageReference,
        },
      },
    ],
  };
  return coverageEligibilityRequest;
};

export const getPayorRef = (coverage: Coverage, orgs: Organization[]): string | undefined => {
  const payor = orgs.find((org) => {
    return coverage.payor.some((res) => {
      return res.reference === `Organization/${org.id}`;
    });
  });
  return payor ? `Organization/${payor.id}` : undefined;
};

interface FetchLatestEligibilityStatusInput {
  oystehr: Oystehr;
  patientId: string;
  coverageId: string;
}

// Look up the most recent CoverageEligibilityResponse already on file for the given patient,
// scoped (best-effort) to the supplied coverage. The Temporal/Stedi 270/271 pipeline writes
// CoverageEligibilityResponse resources asynchronously, so callers should treat absence as Pending.
export const fetchLatestEligibilityStatusForCoverage = async (
  input: FetchLatestEligibilityStatusInput
): Promise<InsuranceCheckStatusWithDate> => {
  const { oystehr, patientId, coverageId } = input;
  const now = DateTime.now().toISO();
  try {
    const bundle = await oystehr.fhir.search<CoverageEligibilityResponse>({
      resourceType: 'CoverageEligibilityResponse',
      params: [
        { name: 'patient', value: `Patient/${patientId}` },
        { name: '_sort', value: '-created' },
        { name: '_count', value: '10' },
      ],
    });
    const responses = bundle.unbundle();
    const matchForCoverage = coverageId
      ? responses.find((cer) =>
          cer.insurance?.some((ins) => ins.coverage?.reference?.endsWith(`Coverage/${coverageId}`))
        )
      : undefined;
    const latest = matchForCoverage ?? responses[0];
    if (!latest) {
      return { status: InsuranceEligibilityCheckStatus.eligibilityPending, dateISO: now };
    }
    return parseCoverageEligibilityResponse(latest);
  } catch (error: any) {
    console.error('error fetching latest CoverageEligibilityResponse', error);
    captureException(error);
    return { status: InsuranceEligibilityCheckStatus.eligibilityPending, dateISO: now };
  }
};
