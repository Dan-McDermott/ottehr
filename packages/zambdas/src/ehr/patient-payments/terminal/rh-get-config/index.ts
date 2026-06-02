import { APIGatewayProxyResult } from 'aws-lambda';
import { INVALID_INPUT_ERROR, isValidUUID, MISSING_REQUEST_BODY, MISSING_REQUIRED_PARAMETERS } from 'utils';
import { lambdaResponse, wrapHandler, ZambdaInput } from '../../../../shared';

const ZAMBDA_NAME = 'patient-payments-terminal-rh-get-config';

export interface FinixTerminalGetConfigInput {
  locationId: string;
}

// DEFERRED: card-present terminal payments via Finix Devices are not yet
// implemented (pending Finix device provisioning). The route is kept registered
// so the EHR receives a clear, structured "not configured" response instead of a
// 404. Online / card-on-file payments are unaffected.
export const index = wrapHandler(ZAMBDA_NAME, async (input: ZambdaInput): Promise<APIGatewayProxyResult> => {
  validateRequestParameters(input);
  return lambdaResponse(501, {
    code: 'finix-terminal-not-implemented',
    message:
      'Finix card-present terminal payments are not yet configured. ' +
      'Online and card-on-file payments are available; terminal support is pending Finix device provisioning.',
  });
});

export const validateRequestParameters = (input: ZambdaInput): FinixTerminalGetConfigInput => {
  if (!input.body) {
    throw MISSING_REQUEST_BODY;
  }
  const { locationId } = JSON.parse(input.body);
  const missing: string[] = [];
  if (!locationId) missing.push('locationId');
  if (missing.length > 0) throw MISSING_REQUIRED_PARAMETERS(missing);
  if (typeof locationId !== 'string' || !isValidUUID(locationId)) {
    throw INVALID_INPUT_ERROR('"locationId" must be a valid UUID.');
  }
  return { locationId };
};
