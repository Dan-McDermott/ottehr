import { APIGatewayProxyResult } from 'aws-lambda';
import { INVALID_INPUT_ERROR, MISSING_REQUEST_BODY, MISSING_REQUIRED_PARAMETERS, RHClinicEntity } from 'utils';
import { lambdaResponse, wrapHandler, ZambdaInput } from '../../../../shared';
import {
  createRectangleHealthClient,
  RectangleHealthReportingResponse,
  RectangleHealthReportingTransaction,
} from '../../../../shared/rectangleHealth';

const ZAMBDA_NAME = 'patient-payments-terminal-rh-check-payment-status';

export type RHTerminalCanonicalStatus = 'pending' | 'approved' | 'declined' | 'canceled' | 'unknown';

export interface RHTerminalCheckStatusInput {
  transactionId: string;
  entity: RHClinicEntity;
}

export interface RHTerminalCheckStatusResponse {
  status: RHTerminalCanonicalStatus;
  rawStatus?: string;
  transaction?: RectangleHealthReportingTransaction;
  raw: RectangleHealthReportingResponse;
}

export const index = wrapHandler(ZAMBDA_NAME, async (input: ZambdaInput): Promise<APIGatewayProxyResult> => {
  const params = validateRequestParameters(input);
  const rh = createRectangleHealthClient(input.secrets, params.entity);
  const raw = await rh.getTransactionById(params.transactionId);
  const transaction =
    (raw.transactions ?? []).find(
      (t: RectangleHealthReportingTransaction) => t.transaction_id === params.transactionId
    ) ?? raw.transactions?.[0];
  const rawStatus = transaction?.status;
  const status = mapCanonicalStatus(rawStatus);
  const response: RHTerminalCheckStatusResponse = { status, rawStatus, transaction, raw };
  return lambdaResponse(200, response);
});

// Maps Rectangle Health reporting `status` strings onto the canonical lifecycle
// expected by the EHR. The v3 reporting spec used for W0.3 enumerates "approved"
// and "declined"; "pending" / "canceled" are best-effort common variants. Any
// unrecognized status surfaces as `unknown` so the EHR can keep polling.
export const mapCanonicalStatus = (raw: string | undefined): RHTerminalCanonicalStatus => {
  if (!raw) return 'pending';
  const lowered = raw.toLowerCase();
  if (['approved', 'success', 'successful', 'captured', 'completed', 'complete'].includes(lowered)) return 'approved';
  if (['declined', 'denied', 'failed', 'failure', 'error'].includes(lowered)) return 'declined';
  if (['canceled', 'cancelled', 'voided', 'reversed'].includes(lowered)) return 'canceled';
  if (['pending', 'in_progress', 'in-progress', 'processing', 'awaiting'].includes(lowered)) return 'pending';
  return 'unknown';
};

export const validateRequestParameters = (input: ZambdaInput): RHTerminalCheckStatusInput => {
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
