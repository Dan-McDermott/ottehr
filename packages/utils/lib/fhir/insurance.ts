import { VALUE_SETS } from '../ottehr-config/value-sets';

export const INSURANCE_PLAN_TYPE_SYSTEM = 'https://fhir.ottehr.com/CodeSystem/insurance-plan-type';

export const INSURANCE_PLAN_TYPE_CODES = VALUE_SETS.insuranceTypeOptions.map(
  (planType) => planType.planCode
) as string[];
