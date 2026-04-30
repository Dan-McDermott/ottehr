import { APIGatewayProxyResult } from 'aws-lambda';
import { Money, PaymentNotice, PaymentReconciliation } from 'fhir/r4b';
import { DateTime } from 'luxon';
import {
  INVALID_INPUT_ERROR,
  isValidUUID,
  MISSING_REQUEST_BODY,
  MISSING_REQUIRED_PARAMETERS,
  PAYMENT_METHOD_EXTENSION_URL,
  RHClinicEntity,
} from 'utils';
import { createOystehrClient, getAuth0Token, lambdaResponse, wrapHandler, ZambdaInput } from '../../../../shared';
import {
  createRectangleHealthClient,
  makeBusinessIdentifierForRectangleHealthPayment,
  RectangleHealthCardPresentInitResponse,
} from '../../../../shared/rectangleHealth';
import { loadRHTerminalConfig } from '../rh-get-config';

const ZAMBDA_NAME = 'patient-payments-terminal-rh-initiate-payment';

let oystehrM2MClientToken: string;

export interface RHTerminalInitiatePaymentInput {
  locationId: string;
  amount: string;
  invNum: string;
  acceptPartialAmount?: boolean;
  encounterId?: string;
}

export interface RHTerminalInitiatePaymentResponse {
  transactionId?: string;
  status?: string;
  entity: RHClinicEntity;
  terminalID: string;
  paymentNoticeId?: string;
  raw: RectangleHealthCardPresentInitResponse;
}

export const index = wrapHandler(ZAMBDA_NAME, async (input: ZambdaInput): Promise<APIGatewayProxyResult> => {
  const params = validateRequestParameters(input);

  if (!oystehrM2MClientToken) {
    oystehrM2MClientToken = await getAuth0Token(input.secrets);
  }
  const oystehr = createOystehrClient(oystehrM2MClientToken, input.secrets);

  const { terminalID, entity, mode } = await loadRHTerminalConfig(params.locationId, input.secrets, oystehr);
  const rh = createRectangleHealthClient(input.secrets, entity);

  const raw = await rh.cardPresentInitPayment({
    terminalID,
    mode,
    amount: params.amount,
    invNum: params.invNum,
    tenderType: 'CREDIT',
    transType: 'SALE',
    acceptPartialAmount: params.acceptPartialAmount,
  });

  let paymentNoticeId: string | undefined;
  const recipientOrgId = await resolveRecipientOrganizationId(params.locationId, oystehr);
  if (params.encounterId && raw.transactionID) {
    const notice = await oystehr.fhir.create<PaymentNotice>(
      makePendingTerminalPaymentNotice({
        encounterId: params.encounterId,
        amount: params.amount,
        transactionId: raw.transactionID,
        recipientOrgId,
      })
    );
    paymentNoticeId = notice.id;
  }

  const response: RHTerminalInitiatePaymentResponse = {
    transactionId: raw.transactionID,
    status: raw.status,
    entity,
    terminalID,
    paymentNoticeId,
    raw,
  };
  return lambdaResponse(200, response);
});

export const makePendingTerminalPaymentNotice = (input: {
  encounterId: string;
  amount: string;
  transactionId: string;
  recipientOrgId: string;
}): PaymentNotice => {
  const created = DateTime.utc().toISO();
  if (!created) throw new Error('failed to compute timestamp for PaymentNotice');
  const amountValue = Number(input.amount);
  const paymentAmount: Money = { value: amountValue, currency: 'USD' };
  const reconciliation: PaymentReconciliation = {
    resourceType: 'PaymentReconciliation',
    id: 'contained-reconciliation',
    status: 'active',
    created,
    disposition: 'rectangle-health card-present payment initiated; awaiting terminal completion',
    outcome: 'queued',
    paymentDate: created.slice(0, 10),
    paymentAmount,
  };
  const notice: PaymentNotice = {
    resourceType: 'PaymentNotice',
    status: 'active',
    request: { reference: `Encounter/${input.encounterId}`, type: 'Encounter' },
    created,
    amount: paymentAmount,
    contained: [reconciliation],
    extension: [{ url: PAYMENT_METHOD_EXTENSION_URL, valueString: 'card' }],
    payment: { reference: `#${reconciliation.id}` },
    recipient: { reference: `Organization/${input.recipientOrgId}` },
    identifier: [makeBusinessIdentifierForRectangleHealthPayment(input.transactionId)],
  };
  return notice;
};

export const validateRequestParameters = (input: ZambdaInput): RHTerminalInitiatePaymentInput => {
  if (!input.body) throw MISSING_REQUEST_BODY;
  const { locationId, amount, invNum, acceptPartialAmount, encounterId } = JSON.parse(input.body);
  const missing: string[] = [];
  if (!locationId) missing.push('locationId');
  if (!amount) missing.push('amount');
  if (!invNum) missing.push('invNum');
  if (missing.length > 0) throw MISSING_REQUIRED_PARAMETERS(missing);

  if (typeof locationId !== 'string' || !isValidUUID(locationId)) {
    throw INVALID_INPUT_ERROR('"locationId" must be a valid UUID.');
  }
  if (typeof amount !== 'string' || !/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
    throw INVALID_INPUT_ERROR('"amount" must be a positive decimal string (e.g. "10.00").');
  }
  if (typeof invNum !== 'string' || invNum.trim() === '') {
    throw INVALID_INPUT_ERROR('"invNum" must be a non-empty string.');
  }
  if (encounterId !== undefined && (typeof encounterId !== 'string' || !isValidUUID(encounterId))) {
    throw INVALID_INPUT_ERROR('"encounterId" must be a valid UUID if provided.');
  }
  if (acceptPartialAmount !== undefined && typeof acceptPartialAmount !== 'boolean') {
    throw INVALID_INPUT_ERROR('"acceptPartialAmount" must be a boolean if provided.');
  }
  return { locationId, amount, invNum, acceptPartialAmount, encounterId };
};

const resolveRecipientOrganizationId = async (
  locationId: string,
  oystehr: import('@oystehr/sdk').default
): Promise<string> => {
  const loc = await oystehr.fhir.get<import('fhir/r4b').Location>({ resourceType: 'Location', id: locationId });
  const ref = loc.managingOrganization?.reference;
  const orgId = ref?.startsWith('Organization/') ? ref.slice('Organization/'.length) : undefined;
  if (!orgId) {
    throw new Error(`Location/${locationId} has no managingOrganization; cannot persist PaymentNotice.recipient`);
  }
  return orgId;
};
