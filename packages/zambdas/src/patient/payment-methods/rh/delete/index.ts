import { APIGatewayProxyResult } from 'aws-lambda';
import { Account } from 'fhir/r4b';
import { FHIR_RESOURCE_NOT_FOUND, RHPaymentMethodDeleteZambdaOutput } from 'utils';
import { createOystehrClient, getAuth0Token, lambdaResponse, wrapHandler, ZambdaInput } from '../../../../shared';
import { createRectangleHealthClient, RectangleHealthApiError } from '../../../../shared/rectangleHealth';
import { getBillingAccountForPatient, validateUserHasAccessToPatientAccount } from '../../helpers';
import {
  buildAccountIdentifierPatchOperations,
  getRectangleHealthPaymentTokenIdentifiers,
  isDefaultRectangleHealthPaymentTokenIdentifier,
  isRectangleHealthPaymentTokenIdentifier,
  resolveRHClinicEntityForPatient,
  RH_PAYMENT_TOKEN_USE_DEFAULT,
} from '../helpers';
import { validateRequestParameters } from './validateRequestParameters';

let m2mClientToken: string;

export const index = wrapHandler(
  'rh-del-payment-method',
  async (input: ZambdaInput): Promise<APIGatewayProxyResult> => {
    console.group('validateRequestParameters');
    let validatedParameters: ReturnType<typeof validateRequestParameters>;
    try {
      validatedParameters = validateRequestParameters(input);
    } catch (error: any) {
      console.log(error);
      return lambdaResponse(400, { message: error.message });
    }
    const { patientId, paymentMethodId, secrets } = validatedParameters;
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

    const rhIdentifiers = getRectangleHealthPaymentTokenIdentifiers(account);
    const target = rhIdentifiers.find((id) => id.value === paymentMethodId);
    if (!target) {
      return lambdaResponse(404, { message: 'paymentMethodId ' + paymentMethodId + ' not found on Account' });
    }
    const wasDefault = isDefaultRectangleHealthPaymentTokenIdentifier(target);

    const entity = await resolveRHClinicEntityForPatient(patientId, oystehr, secrets);
    const rh = createRectangleHealthClient(secrets, entity);

    try {
      await rh.deletePaymentToken(paymentMethodId);
    } catch (error: unknown) {
      // 404 from RH means the token is already gone — proceed with FHIR cleanup.
      if (error instanceof RectangleHealthApiError && error.status === 404) {
        console.warn('RH reports payment_token ' + paymentMethodId + ' already absent; proceeding with FHIR cleanup');
      } else {
        throw error;
      }
    }

    // Promote the next remaining RH identifier to default if the removed one was default.
    const remaining = rhIdentifiers.filter((id) => id.value !== paymentMethodId);
    if (wasDefault && remaining.length > 0) {
      remaining[0] = { ...remaining[0], use: RH_PAYMENT_TOKEN_USE_DEFAULT };
    }
    const otherIdentifiers = (account.identifier ?? []).filter((id) => !isRectangleHealthPaymentTokenIdentifier(id));
    const nextIdentifiers = [...otherIdentifiers, ...remaining];

    await oystehr.fhir.patch<Account>({
      id: account.id,
      resourceType: 'Account',
      operations: buildAccountIdentifierPatchOperations(account, nextIdentifiers),
    });

    const response: RHPaymentMethodDeleteZambdaOutput = {};
    return lambdaResponse(200, response);
  }
);
