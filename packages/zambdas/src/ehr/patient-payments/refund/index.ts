import { APIGatewayProxyResult } from 'aws-lambda';
import { Identifier, Money, PaymentNotice, PaymentReconciliation, Reference } from 'fhir/r4b';
import { DateTime } from 'luxon';
import {
  FHIR_RESOURCE_NOT_FOUND,
  INVALID_INPUT_ERROR,
  isValidUUID,
  MISSING_REQUEST_BODY,
  MISSING_REQUIRED_PARAMETERS,
  NOT_AUTHORIZED,
  PAYMENT_METHOD_EXTENSION_URL,
  RefundPatientPaymentInput,
  RefundPatientPaymentResponse,
  TIMEZONES,
} from 'utils';
import {
  createFinixClient,
  createOystehrClient,
  FINIX_TRANSFER_ID_SYSTEM,
  getAuth0Token,
  getEntityForEncounter,
  getUser,
  lambdaResponse,
  makeBusinessIdentifierForFinixTransfer,
  mapFinixTransferState,
  wrapHandler,
  ZambdaInput,
} from '../../../shared';

const ZAMBDA_NAME = 'patient-payments-refund';

let oystehrM2MClientToken: string;

export const index = wrapHandler(ZAMBDA_NAME, async (input: ZambdaInput): Promise<APIGatewayProxyResult> => {
  const authorization = input.headers.Authorization;
  const secrets = input.secrets;
  if (!authorization) throw NOT_AUTHORIZED;
  const user = await getUser(authorization.replace('Bearer ', ''), secrets);
  if (!user.profile) throw NOT_AUTHORIZED;

  let validatedParameters: RefundPatientPaymentInput;
  try {
    validatedParameters = validateRequestParameters(input);
  } catch (error: any) {
    return lambdaResponse(400, { message: error.message });
  }

  if (!oystehrM2MClientToken) {
    oystehrM2MClientToken = await getAuth0Token(secrets);
  }
  const oystehrClient = createOystehrClient(oystehrM2MClientToken, secrets);

  const { patientId, encounterId, paymentNoticeId, amountInCents, reason } = validatedParameters;

  let originalNotice: PaymentNotice;
  try {
    originalNotice = await oystehrClient.fhir.get<PaymentNotice>({
      resourceType: 'PaymentNotice',
      id: paymentNoticeId,
    });
  } catch {
    throw FHIR_RESOURCE_NOT_FOUND('PaymentNotice');
  }

  const transactionId = originalNotice.identifier?.find((id) => id.system === FINIX_TRANSFER_ID_SYSTEM)?.value;
  if (!transactionId) {
    throw INVALID_INPUT_ERROR(`PaymentNotice/${paymentNoticeId} has no Finix transfer identifier; refund unsupported.`);
  }

  const entity = await getEntityForEncounter(encounterId, oystehrClient);
  const finixClient = createFinixClient(secrets, entity);

  const reversal = await finixClient.refund({
    transferId: transactionId,
    amountInCents,
    tags: reason ? { reason } : undefined,
  });
  const reversalStatus = mapFinixTransferState(reversal.state);
  // Finix reversals start PENDING and settle to SUCCEEDED asynchronously; treat
  // anything not explicitly declined/failed as accepted.
  if (reversalStatus === 'declined') {
    throw new Error(
      `Finix refund declined (state=${reversal.state ?? 'unknown'}): ${
        reversal.failure_message ?? reversal.failure_code ?? 'no failure detail'
      }`
    );
  }

  const refundTransactionId = reversal.id ?? transactionId;
  const dateTimeIso = DateTime.now().toISO() || '';
  const refundNotice = makeRefundPaymentNotice({
    encounterId,
    amountInCents,
    finixTransferId: refundTransactionId,
    submitterRef: { reference: user.profile },
    recipientRef: originalNotice.recipient,
    dateTimeIso,
    reason,
  });

  const createdNotice = await oystehrClient.fhir.create<PaymentNotice>(refundNotice);
  if (!createdNotice.id) throw new Error('Refund PaymentNotice creation did not return an id');

  const response: RefundPatientPaymentResponse = {
    paymentNoticeId,
    refundPaymentNoticeId: createdNotice.id,
    transactionId: refundTransactionId,
  };
  return lambdaResponse(200, { ...response, patientId });
});

const validateRequestParameters = (input: ZambdaInput): RefundPatientPaymentInput => {
  if (!input.body) throw MISSING_REQUEST_BODY;
  const { patientId, encounterId, paymentNoticeId, amountInCents, reason } = JSON.parse(input.body);
  const missing: string[] = [];
  if (!patientId) missing.push('patientId');
  if (!encounterId) missing.push('encounterId');
  if (!paymentNoticeId) missing.push('paymentNoticeId');
  if (amountInCents == null) missing.push('amountInCents');
  if (missing.length) throw MISSING_REQUIRED_PARAMETERS(missing);
  if (!isValidUUID(patientId)) throw INVALID_INPUT_ERROR('"patientId" must be a valid UUID.');
  if (!isValidUUID(encounterId)) throw INVALID_INPUT_ERROR('"encounterId" must be a valid UUID.');
  if (!isValidUUID(paymentNoticeId)) throw INVALID_INPUT_ERROR('"paymentNoticeId" must be a valid UUID.');
  const verifiedAmount = parseInt(amountInCents);
  if (isNaN(verifiedAmount) || verifiedAmount <= 0) {
    throw INVALID_INPUT_ERROR('"amountInCents" must be a valid non-zero integer.');
  }
  if (reason !== undefined && typeof reason !== 'string') {
    throw INVALID_INPUT_ERROR('"reason" must be a string if provided.');
  }
  return { patientId, encounterId, paymentNoticeId, amountInCents: verifiedAmount, reason };
};

interface RefundNoticeInput {
  encounterId: string;
  amountInCents: number;
  finixTransferId: string;
  submitterRef: Reference;
  recipientRef?: Reference;
  dateTimeIso: string;
  reason?: string;
}

const makeRefundPaymentNotice = (input: RefundNoticeInput): PaymentNotice => {
  const { encounterId, amountInCents, finixTransferId, submitterRef, recipientRef, dateTimeIso, reason } = input;
  const paymentDate = DateTime.fromISO(dateTimeIso).setZone(TIMEZONES[0]).toFormat('yyyy-MM-dd');
  const created = DateTime.fromISO(dateTimeIso).toUTC().toISO();
  if (!created) throw new Error('Invalid dateTimeIso provided for refund PaymentNotice creation');
  const refundAmount: Money = { value: -(amountInCents / 100.0), currency: 'USD' };
  const reconciliation: PaymentReconciliation = {
    resourceType: 'PaymentReconciliation',
    id: 'contained-reconciliation',
    status: 'active',
    created,
    disposition: reason ? `card refund processed by Finix: ${reason}` : 'card refund processed by Finix',
    outcome: 'complete',
    paymentDate,
    paymentAmount: refundAmount,
    detail: [
      {
        type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/payment-type', code: 'refund' }] },
        submitter: submitterRef,
      },
    ],
  };
  const identifier: Identifier = makeBusinessIdentifierForFinixTransfer(finixTransferId);
  const notice: PaymentNotice = {
    resourceType: 'PaymentNotice',
    status: 'active',
    request: { reference: `Encounter/${encounterId}`, type: 'Encounter' },
    created,
    amount: refundAmount,
    contained: [reconciliation],
    extension: [{ url: PAYMENT_METHOD_EXTENSION_URL, valueString: 'finix-card' }],
    payment: { reference: `#${reconciliation.id}` },
    identifier: [identifier],
    recipient: recipientRef ?? { display: 'Finix' },
  };
  return notice;
};
