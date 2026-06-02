import { APIGatewayProxyResult } from 'aws-lambda';
import { Account, Patient } from 'fhir/r4b';
import { FHIR_RESOURCE_NOT_FOUND, FinixPaymentMethodSetupZambdaOutput } from 'utils';
import { createOystehrClient, getAuth0Token, lambdaResponse, wrapHandler, ZambdaInput } from '../../../../shared';
import { createFinixClient } from '../../../../shared/finix';
import { getBillingAccountForPatient, validateUserHasAccessToPatientAccount } from '../../helpers';
import {
  buildAccountIdentifierPatchOperations,
  buildFinixPaymentInstrumentIdentifier,
  FINIX_PAYMENT_INSTRUMENT_USE_NON_DEFAULT,
  getFinixPaymentInstrumentIdentifiers,
  getOrCreateBuyerIdentityId,
  isFinixPaymentInstrumentIdentifier,
  resolveClinicEntityForPatient,
} from '../helpers';
import { validateRequestParameters } from './validateRequestParameters';

let m2mClientToken: string;

export const index = wrapHandler('finix-payment-setup', async (input: ZambdaInput): Promise<APIGatewayProxyResult> => {
  console.group('validateRequestParameters');
  const validatedParameters = validateRequestParameters(input);
  const { patientId, token, makeDefault, secrets } = validatedParameters;
  console.groupEnd();
  console.debug('validateRequestParameters success');

  if (!m2mClientToken) {
    m2mClientToken = await getAuth0Token(secrets);
  }
  const oystehr = createOystehrClient(m2mClientToken, secrets);

  void (await validateUserHasAccessToPatientAccount(
    { beneficiaryPatientId: patientId, secrets, zambdaInput: input },
    oystehr
  ));

  const account: Account | undefined = await getBillingAccountForPatient(patientId, oystehr);
  if (!account?.id) {
    throw FHIR_RESOURCE_NOT_FOUND('Account');
  }

  const entity = await resolveClinicEntityForPatient(patientId, oystehr);
  console.log('Resolved Finix entity for patient', { patientId, entity });

  const finix = createFinixClient(secrets, entity);
  const patient = await oystehr.fhir.get<Patient>({ resourceType: 'Patient', id: patientId }).catch(() => undefined);
  const buyerIdentityId = await getOrCreateBuyerIdentityId({ account, patient, finixClient: finix, oystehr });

  const instrument = await finix.createPaymentInstrument({ token, identityId: buyerIdentityId });
  const paymentInstrumentId = instrument.id;
  if (!paymentInstrumentId) {
    throw new Error('Finix did not return a payment_instrument id');
  }

  const brand = pickString(instrument, ['brand', 'card_brand']);
  const last4 = pickString(instrument, ['last_four', 'lastFour', 'last4']);

  const existingIdentifiers = getFinixPaymentInstrumentIdentifiers(account);
  const isFirstCard = existingIdentifiers.length === 0;
  const isDefault = makeDefault === true || isFirstCard;

  const newIdentifier = buildFinixPaymentInstrumentIdentifier({
    paymentInstrumentId,
    isDefault,
    brand,
    last4,
  });

  // Demote previous defaults if this card becomes default; preserve non-Finix identifiers
  // (including the buyer-Identity identifier just persisted by getOrCreateBuyerIdentityId,
  // so re-read the account to capture it).
  const refreshedAccount = (await getBillingAccountForPatient(patientId, oystehr)) ?? account;
  const otherIdentifiers = (refreshedAccount.identifier ?? []).filter((id) => !isFinixPaymentInstrumentIdentifier(id));
  const updatedExistingIdentifiers = isDefault
    ? getFinixPaymentInstrumentIdentifiers(refreshedAccount).map((id) => ({
        ...id,
        use: FINIX_PAYMENT_INSTRUMENT_USE_NON_DEFAULT,
      }))
    : getFinixPaymentInstrumentIdentifiers(refreshedAccount);
  const nextIdentifiers = [...otherIdentifiers, ...updatedExistingIdentifiers, newIdentifier];

  await oystehr.fhir.patch<Account>({
    id: refreshedAccount.id!,
    resourceType: 'Account',
    operations: buildAccountIdentifierPatchOperations(refreshedAccount, nextIdentifiers),
  });

  const response: FinixPaymentMethodSetupZambdaOutput = {
    paymentMethodId: paymentInstrumentId,
    default: isDefault,
    last4,
    brand,
  };
  return lambdaResponse(200, response);
});

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}
