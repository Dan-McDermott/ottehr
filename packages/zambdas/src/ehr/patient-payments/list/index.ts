import { APIGatewayProxyResult } from 'aws-lambda';
import { Account } from 'fhir/r4b';
import {
  FHIR_RESOURCE_NOT_FOUND,
  INVALID_INPUT_ERROR,
  isValidUUID,
  ListPatientPaymentInput,
  ListPatientPaymentResponse,
  MISSING_REQUEST_BODY,
  MISSING_REQUIRED_PARAMETERS,
  NOT_AUTHORIZED,
} from 'utils';
import { createOystehrClient, getAuth0Token, lambdaResponse, wrapHandler, ZambdaInput } from '../../../shared';
import { getAccountAndCoverageResourcesForPatient } from '../../shared/harvest';
import { getPaymentsForPatient } from '../helpers';

// Lifting up value to outside of the handler allows it to stay in memory across warm lambda invocations
let oystehrM2MClientToken: string;

const ZAMBDA_NAME = 'patient-payments-list';

export const index = wrapHandler(ZAMBDA_NAME, async (input: ZambdaInput): Promise<APIGatewayProxyResult> => {
  console.group('validateRequestParameters');
  let validatedParameters: ReturnType<typeof validateRequestParameters>;
  try {
    validatedParameters = validateRequestParameters(input);
    console.log(JSON.stringify(validatedParameters, null, 4));
  } catch (error: any) {
    console.log(error);
    return lambdaResponse(400, { message: error.message });
  }

  const secrets = input.secrets;
  const { patientId, encounterId } = validatedParameters;
  console.groupEnd();
  console.debug('validateRequestParameters success');

  if (!oystehrM2MClientToken) {
    console.log('getting m2m token for service calls');
    oystehrM2MClientToken = await getAuth0Token(secrets); // keeping token externally for reuse
  } else {
    console.log('already have a token, no need to update');
  }

  const oystehrClient = createOystehrClient(oystehrM2MClientToken, secrets);

  const accountResources = await getAccountAndCoverageResourcesForPatient(patientId, oystehrClient);
  const account: Account | undefined = accountResources.account;

  if (!account?.id) {
    throw FHIR_RESOURCE_NOT_FOUND('Account');
  }

  const payments = await getPaymentsForPatient({ oystehrClient, patientId, encounterId });

  const response: ListPatientPaymentResponse = {
    patientId,
    payments,
    encounterId,
  };

  return lambdaResponse(200, response);
});

const validateRequestParameters = (input: ZambdaInput): ListPatientPaymentInput => {
  const authorization = input.headers.Authorization;
  if (!authorization) {
    throw NOT_AUTHORIZED;
  }
  if (!input.body) {
    throw MISSING_REQUEST_BODY;
  }

  const { patientId, encounterId } = JSON.parse(input.body);

  if (!patientId) {
    throw MISSING_REQUIRED_PARAMETERS(['patientId']);
  }

  if (!isValidUUID(patientId)) {
    throw INVALID_INPUT_ERROR('"patientId" must be a valid UUID.');
  }
  if (encounterId && !isValidUUID(encounterId)) {
    throw INVALID_INPUT_ERROR('"encounterId" must be a valid UUID.');
  }

  return {
    patientId,
    encounterId,
  };
};
