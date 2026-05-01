import Oystehr from '@oystehr/sdk';
import { APIGatewayProxyResult } from 'aws-lambda';
import { Identifier, Money, PaymentNotice, PaymentReconciliation, Reference } from 'fhir/r4b';
import { DateTime } from 'luxon';
import {
  getSecret,
  getTaskResource,
  INVALID_INPUT_ERROR,
  isValidUUID,
  MISCONFIGURED_ENVIRONMENT_ERROR,
  MISSING_REQUEST_BODY,
  MISSING_REQUIRED_PARAMETERS,
  NOT_AUTHORIZED,
  PAYMENT_METHOD_EXTENSION_URL,
  PostPatientPaymentInput,
  Secrets,
  SecretsKeys,
  TaskIndicator,
  TIMEZONES,
} from 'utils';
import {
  createOystehrClient,
  createRectangleHealthClient,
  getAuth0Token,
  getEntityForEncounter,
  getUser,
  lambdaResponse,
  makeBusinessIdentifierForRectangleHealthPayment,
  RectangleHealthSaleResponse,
  wrapHandler,
  ZambdaInput,
} from '../../../shared';

const ZAMBDA_NAME = 'post-patient-payment';

// Lifting up value to outside of the handler allows it to stay in memory across warm lambda invocations
let oystehrM2MClientToken: string;
export const index = wrapHandler(ZAMBDA_NAME, async (input: ZambdaInput): Promise<APIGatewayProxyResult> => {
  const authorization = input.headers.Authorization;
  const secrets = input.secrets;
  if (!authorization) {
    console.log('authorization header not found');
    throw NOT_AUTHORIZED;
  }
  const user = await getUser(authorization.replace('Bearer ', ''), secrets);

  const userProfile = user.profile;

  if (!userProfile) {
    throw NOT_AUTHORIZED;
  }

  console.group('patient-payment-post validateRequestParameters');
  let validatedParameters: ReturnType<typeof validateRequestParameters>;
  try {
    validatedParameters = validateRequestParameters(input);
    console.log(JSON.stringify(validatedParameters, null, 4));
  } catch (error: any) {
    console.log(error);
    return lambdaResponse(400, { message: error.message });
  }

  const requiredSecrets = validateEnvironmentParameters(input);
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

  const effectInput: EffectInput = {
    ...validatedParameters,
    ...requiredSecrets,
    userProfile,
  };

  const { notice } = await performEffect(effectInput, oystehrClient, requiredSecrets);

  return lambdaResponse(200, { notice, patientId, encounterId });
});

interface RequiredSecrets {
  organizationId: string;
  secrets: Secrets;
}

interface EffectInput extends PostPatientPaymentInput, RequiredSecrets {
  userProfile: string;
}

const performEffect = async (
  input: EffectInput,
  oystehrClient: Oystehr,
  requiredSecrets: RequiredSecrets
): Promise<{ notice: PaymentNotice }> => {
  const { encounterId, paymentDetails, organizationId, userProfile } = input;
  const { paymentMethod, amountInCents, description } = paymentDetails;
  const dateTimeIso = DateTime.now().toISO() || '';
  console.log('dateTimeIso', dateTimeIso);
  const paymentNoticeInput: PaymentNoticeInput = {
    encounterId,
    paymentDetails,
    submitterRef: { reference: userProfile },
    dateTimeIso,
    recipientId: organizationId,
  };

  if (paymentMethod === 'rh-card') {
    const entity = await getEntityForEncounter(encounterId, oystehrClient);
    const rhClient = createRectangleHealthClient(requiredSecrets.secrets, entity);
    const amountDecimal = (amountInCents / 100).toFixed(2);
    const invNum = `enc-${encounterId}`;
    let saleResponse: RectangleHealthSaleResponse;
    if (paymentDetails.paymentToken) {
      saleResponse = await rhClient.saleViaToken({
        payment_token: paymentDetails.paymentToken,
        amount: amountDecimal,
        inv_num: invNum,
      });
    } else if (paymentDetails.encryptedCardData) {
      saleResponse = await rhClient.sale({
        encrypted_card_data: paymentDetails.encryptedCardData,
        amount: amountDecimal,
        inv_num: invNum,
      });
    } else {
      throw INVALID_INPUT_ERROR(
        '"paymentDetails.encryptedCardData" or "paymentDetails.paymentToken" is required for rh-card payments.'
      );
    }
    if (!saleResponse.transaction_id) {
      throw new Error('Rectangle Health sale completed without a transaction_id');
    }
    paymentNoticeInput.rhTransactionId = saleResponse.transaction_id;
    console.log('Rectangle Health sale completed:', saleResponse.transaction_id);
  } else {
    console.log('handling non card payment:', paymentMethod, amountInCents, description);
    // here's where we might set a candidPayment id once candid stuff has been added
  }

  // Write Payment Notice
  const noticeToWrite = makePaymentNotice(paymentNoticeInput);
  const paymentNotice = await oystehrClient.fhir.create<PaymentNotice>(noticeToWrite);

  // Write Task that will kick off subscription to perform Candid sync and create receipt PDF
  if (!paymentNotice.id) {
    throw new Error('PaymentNotice ID is required to create task');
  }
  const paymentTaskResource = getTaskResource(
    TaskIndicator.patientPaymentCandidSyncAndReceipt,
    `Payment notice for $${(amountInCents / 100).toFixed(2)}`,
    paymentNotice.id,
    encounterId
  );
  // Update the task focus to reference PaymentNotice instead of Appointment
  paymentTaskResource.focus = {
    type: 'PaymentNotice',
    reference: `PaymentNotice/${paymentNotice.id}`,
  };
  const taskCreationResult = await oystehrClient.fhir.create(paymentTaskResource);
  console.log('Task creation result:', taskCreationResult);

  return { notice: paymentNotice };
};

const validateRequestParameters = (input: ZambdaInput): PostPatientPaymentInput => {
  const authorization = input.headers.Authorization;
  if (!authorization) {
    throw NOT_AUTHORIZED;
  }
  if (!input.body) {
    throw MISSING_REQUEST_BODY;
  }

  const { patientId, encounterId, paymentDetails } = JSON.parse(input.body);

  const missingParams: string[] = [];

  if (!patientId) {
    missingParams.push('patientId');
  }
  if (!encounterId) {
    missingParams.push('encounterId');
  }
  if (!paymentDetails) {
    missingParams.push('paymentDetails');
  }

  if (missingParams.length > 0) {
    throw MISSING_REQUIRED_PARAMETERS(missingParams);
  }

  if (typeof paymentDetails !== 'object' || !paymentDetails.paymentMethod || !paymentDetails.amountInCents) {
    throw INVALID_INPUT_ERROR(
      '"paymentDetails" must be an object with a "paymentMethod" property and an "amountInCents" property that is a valid non-zero integer.'
    );
  }

  if (!isValidUUID(patientId)) {
    throw INVALID_INPUT_ERROR('"patientId" must be a valid UUID.');
  }
  if (!isValidUUID(encounterId)) {
    throw INVALID_INPUT_ERROR('"encounterId" must be a valid UUID.');
  }

  const { paymentMethod, amountInCents, description, encryptedCardData, paymentToken } = paymentDetails;
  if (
    paymentMethod !== 'card-reader' &&
    paymentMethod !== 'external-card-reader' &&
    paymentMethod !== 'cash' &&
    paymentMethod !== 'check' &&
    paymentMethod !== 'rh-card'
  ) {
    throw INVALID_INPUT_ERROR(
      '"paymentDetails.paymentMethod" must be "rh-card", "card-reader", "external-card-reader", "cash", or "check".'
    );
  }
  if (paymentMethod === 'rh-card' && !encryptedCardData && !paymentToken) {
    throw INVALID_INPUT_ERROR(
      '"paymentDetails.encryptedCardData" or "paymentDetails.paymentToken" is required for rh-card payments.'
    );
  }
  if (paymentMethod === 'rh-card' && encryptedCardData && paymentToken) {
    throw INVALID_INPUT_ERROR(
      '"paymentDetails" cannot specify both "encryptedCardData" and "paymentToken" for rh-card payments.'
    );
  }
  const verifiedAmount = parseInt(amountInCents);
  if (isNaN(verifiedAmount) || verifiedAmount <= 0) {
    throw INVALID_INPUT_ERROR('"paymentDetails.amountInCents" must be a valid non-zero integer.');
  }
  if (description && typeof description !== 'string') {
    throw INVALID_INPUT_ERROR('"paymentDetails.description" must be a string if provided.');
  }

  return {
    patientId,
    encounterId,
    paymentDetails: {
      ...paymentDetails,
      amountInCents: verifiedAmount,
    },
  };
};

const validateEnvironmentParameters = (input: ZambdaInput): RequiredSecrets => {
  const secrets = input.secrets;
  if (!secrets) {
    throw new Error('Secrets are required for this operation.');
  }

  const organizationId = getSecret(SecretsKeys.ORGANIZATION_ID, secrets);
  if (!organizationId) {
    throw MISCONFIGURED_ENVIRONMENT_ERROR(
      '"ORGANIZATION_ID" environment variable was not set. Please ensure it is configured in project secrets.'
    );
  }

  return { organizationId, secrets };
};

interface PaymentNoticeInput extends Omit<PostPatientPaymentInput, 'patientId'> {
  submitterRef: Reference;
  rhTransactionId?: string;
  recipientId: string;
  dateTimeIso: string;
}

const makePaymentNotice = (input: PaymentNoticeInput): PaymentNotice => {
  const { encounterId, paymentDetails, submitterRef, rhTransactionId, dateTimeIso, recipientId } = input;

  const { paymentMethod, amountInCents } = paymentDetails;

  let identifier: Identifier | undefined;

  if (paymentMethod === 'rh-card' && rhTransactionId) {
    identifier = makeBusinessIdentifierForRectangleHealthPayment(rhTransactionId);
  }

  // the created timestamp is in UTC and the exact date in any timezone can always be derived from there
  // for now the payment date on the PaymentNotice is set to the default timezone (US Eastern)
  const paymentDate = DateTime.fromISO(dateTimeIso).setZone(TIMEZONES[0]).toFormat('yyyy-MM-dd');

  const created = DateTime.fromISO(dateTimeIso).toUTC().toISO();
  if (!created) {
    throw new Error('Invalid dateTimeIso provided for PaymentNotice creation');
  }

  console.log('payment date', paymentDate);

  const amountInDollars = amountInCents / 100.0;
  const paymentAmount: Money = {
    value: amountInDollars,
    currency: 'USD',
  };

  const reconciliation: PaymentReconciliation = {
    resourceType: 'PaymentReconciliation',
    id: 'contained-reconciliation',
    status: 'active',
    created,
    disposition:
      paymentMethod === 'rh-card'
        ? 'card payment processed by Rectangle Health'
        : `${paymentMethod} collected from patient`,
    outcome: 'complete',
    paymentDate,
    paymentAmount,
    detail: [
      {
        type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/payment-type', code: 'payment' }] },
        submitter: submitterRef,
      },
    ],
  };

  const notice: PaymentNotice = {
    resourceType: 'PaymentNotice',
    status: 'active',
    request: { reference: `Encounter/${encounterId}`, type: 'Encounter' },
    created,
    amount: paymentAmount,
    contained: [reconciliation],
    extension: [
      {
        url: PAYMENT_METHOD_EXTENSION_URL,
        valueString: paymentMethod,
      },
    ],
    payment: {
      reference: `#${reconciliation.id}`,
    },
    recipient: { reference: `Organization/${recipientId}` },
  };
  if (identifier) {
    notice.identifier = [identifier];
  }
  return notice;
};
