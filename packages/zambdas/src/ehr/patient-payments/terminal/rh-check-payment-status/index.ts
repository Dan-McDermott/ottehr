import { APIGatewayProxyResult } from 'aws-lambda';
import { ClinicEntity, INVALID_INPUT_ERROR, MISSING_REQUEST_BODY, MISSING_REQUIRED_PARAMETERS } from 'utils';
import { lambdaResponse, wrapHandler, ZambdaInput } from '../../../../shared';

const ZAMBDA_NAME = 'patient-payments-terminal-rh-check-payment-status';

export type FinixTerminalCanonicalStatus = 'pending' | 'approved' | 'declined' | 'canceled' | 'unknown';

export interface FinixTerminalCheckStatusInput {
  transactionId: string;
  entity: ClinicEntity;
}

// DEFERRED: card-present terminal status polling via Finix is not yet
// implemented (pending Finix device provisioning). See rh-get-config for
// context. Route kept registered to return a structured "not configured"
// response.
export const index = wrapHandler(ZAMBDA_NAME, async (input: ZambdaInput): Promise<APIGatewayProxyResult> => {
  validateRequestParameters(input);
  return lambdaResponse(501, {
    code: 'finix-terminal-not-implemented',
    message: 'Finix card-present terminal payments are not yet configured; status polling is unavailable.',
  });
});

export const validateRequestParameters = (input: ZambdaInput): FinixTerminalCheckStatusInput => {
  if (!input.body) throw MISSING_REQUEST_BODY;
  const { transactionId, entity } = JSON.parse(input.body);
  const missing: string[] = [];
  if (!transactionId) missing.push('transactionId');
  if (!entity) missing.push('entity');
  if (missing.length > 0) throw MISSING_REQUIRED_PARAMETERS(missing);
  if (typeof transactionId !== 'string' || transactionId.trim() === '') {
    throw INVALID_INPUT_ERROR('"transactionId" must be a non-empty string.');
  }
  if (entity !== 'afterours' && entity !== 'spire') {
    throw INVALID_INPUT_ERROR('"entity" must be "afterours" or "spire".');
  }
  return { transactionId, entity };
};
