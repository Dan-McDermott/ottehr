import { APIGatewayProxyResult } from 'aws-lambda';
import { Account } from 'fhir/r4b';
import { FHIR_RESOURCE_NOT_FOUND, RHPaymentMethodSetDefaultZambdaOutput } from 'utils';
import { createOystehrClient, getAuth0Token, lambdaResponse, wrapHandler, ZambdaInput } from '../../../../shared';
import { getBillingAccountForPatient, validateUserHasAccessToPatientAccount } from '../../helpers';
import {
  buildAccountIdentifierPatchOperations,
  getRectangleHealthPaymentTokenIdentifiers,
  isRectangleHealthPaymentTokenIdentifier,
  setDefaultPaymentTokenIdentifiers,
} from '../helpers';
import { validateRequestParameters } from './validateRequestParameters';

let m2mClientToken: string;

export const index = wrapHandler(
  'rh-payment-set-default',
  async (input: ZambdaInput): Promise<APIGatewayProxyResult> => {
    console.group('validateRequestParameters');
    const validatedParameters = validateRequestParameters(input);
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
    const targetExists = rhIdentifiers.some((id) => id.value === paymentMethodId);
    if (!targetExists) {
      return lambdaResponse(404, { message: 'paymentMethodId ' + paymentMethodId + ' not found on Account' });
    }

    const otherIdentifiers = (account.identifier ?? []).filter((id) => !isRectangleHealthPaymentTokenIdentifier(id));
    const reflagged = setDefaultPaymentTokenIdentifiers(rhIdentifiers, paymentMethodId);
    const nextIdentifiers = [...otherIdentifiers, ...reflagged];

    await oystehr.fhir.patch<Account>({
      id: account.id,
      resourceType: 'Account',
      operations: buildAccountIdentifierPatchOperations(account, nextIdentifiers),
    });

    const response: RHPaymentMethodSetDefaultZambdaOutput = {};
    return lambdaResponse(200, response);
  }
);
