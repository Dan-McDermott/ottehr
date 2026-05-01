import { APIGatewayProxyResult } from 'aws-lambda';
import { INVALID_INPUT_ERROR, MISSING_REQUEST_BODY, MISSING_REQUIRED_PARAMETERS } from 'utils';
import { lambdaResponse, wrapHandler, ZambdaInput } from '../../../../shared';

const ZAMBDA_NAME = 'patient-payments-terminal-rh-cancel';

export interface RHTerminalCancelInput {
  transactionId: string;
}

// Rectangle Health v3 (Card-Present) does not expose a public endpoint to cancel
// an in-flight terminal transaction; cancellation must be performed at the
// physical device. This zambda always returns a clear "not supported" error so
// the EHR can surface a meaningful message to staff.
export const index = wrapHandler(ZAMBDA_NAME, async (input: ZambdaInput): Promise<APIGatewayProxyResult> => {
  validateRequestParameters(input);
  return lambdaResponse(501, {
    code: 'rh-terminal-cancel-not-supported',
    message:
      'Rectangle Health v3 Card-Present transactions cannot be cancelled remotely. ' +
      'Cancel the operation directly on the physical terminal device.',
  });
});

export const validateRequestParameters = (input: ZambdaInput): RHTerminalCancelInput => {
  if (!input.body) throw MISSING_REQUEST_BODY;
  const { transactionId } = JSON.parse(input.body);
  const missing: string[] = [];
  if (!transactionId) missing.push('transactionId');
  if (missing.length > 0) throw MISSING_REQUIRED_PARAMETERS(missing);
  if (typeof transactionId !== 'string' || transactionId.trim() === '') {
    throw INVALID_INPUT_ERROR('"transactionId" must be a non-empty string.');
  }
  return { transactionId };
};
