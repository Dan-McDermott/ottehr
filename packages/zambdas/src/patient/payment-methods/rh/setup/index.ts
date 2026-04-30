import { APIGatewayProxyResult } from 'aws-lambda';
import { Account } from 'fhir/r4b';
import { FHIR_RESOURCE_NOT_FOUND, RHPaymentMethodSetupZambdaOutput } from 'utils';
import { createOystehrClient, getAuth0Token, lambdaResponse, wrapHandler, ZambdaInput } from '../../../../shared';
import { createRectangleHealthClient } from '../../../../shared/rectangleHealth';
import { getBillingAccountForPatient, validateUserHasAccessToPatientAccount } from '../../helpers';
import {
  buildAccountIdentifierPatchOperations,
  buildRectangleHealthPaymentTokenIdentifier,
  getRectangleHealthPaymentTokenIdentifiers,
  isRectangleHealthPaymentTokenIdentifier,
  resolveRHClinicEntityForPatient,
  RH_PAYMENT_TOKEN_USE_NON_DEFAULT,
} from '../helpers';
import { validateRequestParameters } from './validateRequestParameters';

let m2mClientToken: string;

export const index = wrapHandler('rh-payment-setup', async (input: ZambdaInput): Promise<APIGatewayProxyResult> => {
  console.group('validateRequestParameters');
  const validatedParameters = validateRequestParameters(input);
  const { patientId, encryptedCardData, makeDefault, secrets } = validatedParameters;
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

  const entity = await resolveRHClinicEntityForPatient(patientId, oystehr, secrets);
  console.log('Resolved RH entity for patient', { patientId, entity });

  const rh = createRectangleHealthClient(secrets, entity);
  const tokenResponse = await rh.createPaymentToken({ encrypted_card_data: encryptedCardData });
  const paymentToken = tokenResponse.payment_token ?? tokenResponse.token_reference;
  if (!paymentToken) {
    throw new Error('Rectangle Health did not return a payment_token');
  }

  // Best-effort extraction of card metadata; v3 sandbox response may include
  // either snake_case or camelCase variants depending on the surface.
  const brand = pickString(tokenResponse, ['card_brand', 'cardBrand', 'brand']);
  const last4 = pickString(tokenResponse, ['last_four', 'lastFour', 'last4']);

  const existingRhIdentifiers = getRectangleHealthPaymentTokenIdentifiers(account);
  const isFirstCard = existingRhIdentifiers.length === 0;
  const isDefault = makeDefault === true || isFirstCard;

  const newIdentifier = buildRectangleHealthPaymentTokenIdentifier({
    paymentToken,
    isDefault,
    brand,
    last4,
  });

  // Demote previous defaults if this card becomes default; preserve non-RH identifiers.
  const otherIdentifiers = (account.identifier ?? []).filter((id) => !isRectangleHealthPaymentTokenIdentifier(id));
  const updatedRhIdentifiers = isDefault
    ? existingRhIdentifiers.map((id) => ({ ...id, use: RH_PAYMENT_TOKEN_USE_NON_DEFAULT }))
    : existingRhIdentifiers;
  const nextIdentifiers = [...otherIdentifiers, ...updatedRhIdentifiers, newIdentifier];

  await oystehr.fhir.patch<Account>({
    id: account.id,
    resourceType: 'Account',
    operations: buildAccountIdentifierPatchOperations(account, nextIdentifiers),
  });

  const response: RHPaymentMethodSetupZambdaOutput = {
    paymentMethodId: paymentToken,
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
