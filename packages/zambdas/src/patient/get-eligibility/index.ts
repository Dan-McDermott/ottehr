import { APIGatewayProxyResult } from 'aws-lambda';
import { CoverageEligibilityRequest } from 'fhir/r4b';
import {
  createOystehrClient,
  FHIR_RESOURCE_NOT_FOUND,
  getSecret,
  InsuranceCheckStatusWithDate,
  SecretsKeys,
} from 'utils';
import { getAuth0Token, lambdaResponse, wrapHandler, ZambdaInput } from '../../shared';
import { fetchLatestEligibilityStatusForCoverage, getPayorRef, makeCoverageEligibilityRequest } from './helpers';
import { prevalidationHandler } from './prevalidation-handler';
import { complexInsuranceValidation, validateRequestParameters } from './validation';

// Lifting up value to outside of the handler allows it to stay in memory across warm lambda invocations
let oystehrToken: string;

export const index = wrapHandler('get-eligibility', async (input: ZambdaInput): Promise<APIGatewayProxyResult> => {
  let primary: InsuranceCheckStatusWithDate | undefined;
  let secondary: InsuranceCheckStatusWithDate | undefined;
  console.group('validateRequestParameters');
  let validatedParameters: ReturnType<typeof validateRequestParameters>;
  try {
    validatedParameters = validateRequestParameters(input);
  } catch (error: any) {
    console.error(error);
    return lambdaResponse(400, { message: error.message });
  }
  const validatedParams = validatedParameters;
  const { secrets } = validatedParams;
  console.groupEnd();
  console.debug('validateRequestParameters success');
  console.log('validatedParameters', JSON.stringify(validatedParameters));

  if (!oystehrToken) {
    console.log('getting token');
    oystehrToken = await getAuth0Token(secrets);
  } else {
    console.log('already have token');
  }

  console.group('createOystehrClient');
  const oystehr = createOystehrClient(
    oystehrToken,
    getSecret(SecretsKeys.FHIR_API, secrets),
    getSecret(SecretsKeys.PROJECT_API, secrets)
  );
  console.groupEnd();
  console.debug('createOystehrClient success');

  const complexInput = await complexInsuranceValidation(validatedParams, oystehr);

  if (complexInput.type === 'prevalidation') {
    console.log('prevalidation path...');
    const result = await prevalidationHandler({ ...complexInput, secrets: secrets }, oystehr);
    console.log('prevalidation primary', JSON.stringify(result.primary));
    console.log('prevalidation secondary', JSON.stringify(result.secondary));
    primary = result.primary;
    secondary = result.secondary;
  } else {
    const { patientId, billingProvider, coverageResources, coverageToCheck } = complexInput;
    const { coverages, insuranceOrgs } = coverageResources;

    // coverages is an object with keys "primary" and "secondary", which are the same values coverageToCheck can take on
    const coverageToUse = coverages[coverageToCheck];

    if (!coverageToUse) {
      throw FHIR_RESOURCE_NOT_FOUND('Coverage');
    }

    const payorReference = getPayorRef(coverageToUse, insuranceOrgs);

    if (!payorReference) {
      throw new Error('Payor reference not found');
    }

    // Create a CoverageEligibilityRequest so the Temporal/Stedi 270/271 pipeline picks it up.
    // ottehr no longer performs a synchronous eligibility-check round-trip; the pipeline writes
    // a CoverageEligibilityResponse asynchronously which we read below.
    const CER = makeCoverageEligibilityRequest({
      coverageReference: `Coverage/${coverageToUse.id}`,
      payorReference: payorReference,
      providerReference: billingProvider,
      patientReference: `Patient/${patientId}`,
    });

    await oystehr.fhir.create<CoverageEligibilityRequest>(CER);

    console.log('coverageToCheck', coverageToCheck);

    // Look up the most recent CoverageEligibilityResponse already on file for this patient + coverage.
    // If present, surface it; otherwise return Pending so the UI can show a "Checking eligibility…" state.
    const eligibilityCheckResult = await fetchLatestEligibilityStatusForCoverage({
      oystehr,
      patientId,
      coverageId: coverageToUse.id ?? '',
    });

    if (coverageToCheck === 'primary') {
      primary = eligibilityCheckResult;
      secondary = undefined;
    } else {
      secondary = eligibilityCheckResult;
      primary = undefined;
    }
  }
  return lambdaResponse(200, { primary, secondary });
});
