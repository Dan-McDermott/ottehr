import { APIGatewayProxyResult } from 'aws-lambda';
import { INVALID_INPUT_ERROR, isValidUUID, MISSING_REQUEST_BODY, MISSING_REQUIRED_PARAMETERS } from 'utils';
import { lambdaResponse, wrapHandler, ZambdaInput } from '../../../../shared';

const ZAMBDA_NAME = 'patient-payments-terminal-rh-initiate-payment';

export interface FinixTerminalInitiatePaymentInput {
  locationId: string;
  amountInCents: number;
  encounterId?: string;
}

// DEFERRED: card-present terminal sales via Finix Devices are not yet
// implemented (pending Finix device provisioning). See rh-get-config for
// context. Route kept registered to return a structured "not configured"
// response. Online / card-on-file payments are unaffected.
export const index = wrapHandler(ZAMBDA_NAME, async (input: ZambdaInput): Promise<APIGatewayProxyResult> => {
  validateRequestParameters(input);
  return lambdaResponse(501, {
    code: 'finix-terminal-not-implemented',
    message:
      'Finix card-present terminal payments are not yet configured. ' +
      'Use online / card-on-file payment instead; terminal support is pending Finix device provisioning.',
  });
});

export const validateRequestParameters = (input: ZambdaInput): FinixTerminalInitiatePaymentInput => {
  if (!input.body) throw MISSING_REQUEST_BODY;
  const { locationId, amountInCents, encounterId } = JSON.parse(input.body);
  const missing: string[] = [];
  if (!locationId) missing.push('locationId');
  if (amountInCents == null) missing.push('amountInCents');
  if (missing.length > 0) throw MISSING_REQUIRED_PARAMETERS(missing);
  if (typeof locationId !== 'string' || !isValidUUID(locationId)) {
    throw INVALID_INPUT_ERROR('"locationId" must be a valid UUID.');
  }
  if (encounterId !== undefined && (typeof encounterId !== 'string' || !isValidUUID(encounterId))) {
    throw INVALID_INPUT_ERROR('"encounterId" must be a valid UUID if provided.');
  }
  return { locationId, amountInCents, encounterId };
};
