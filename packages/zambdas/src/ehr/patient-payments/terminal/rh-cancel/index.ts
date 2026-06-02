import { APIGatewayProxyResult } from 'aws-lambda';
import { INVALID_INPUT_ERROR, MISSING_REQUEST_BODY, MISSING_REQUIRED_PARAMETERS } from 'utils';
import { lambdaResponse, wrapHandler, ZambdaInput } from '../../../../shared';

const ZAMBDA_NAME = 'patient-payments-terminal-rh-cancel';

export interface RHTerminalCancelInput {
  transactionId: string;
}

// DEFERRED: Finix card-present terminal payments are not yet configured, so
// there is no in-flight terminal transaction to cancel. Route kept registered
// to return a clear, structured response to the EHR.
export const index = wrapHandler(ZAMBDA_NAME, async (input: ZambdaInput): Promise<APIGatewayProxyResult> => {
  validateRequestParameters(input);
  return lambdaResponse(501, {
    code: 'finix-terminal-not-implemented',
    message: 'Finix card-present terminal payments are not yet configured; there is no terminal action to cancel.',
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
