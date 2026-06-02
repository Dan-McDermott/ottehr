import { APIGatewayProxyResult } from 'aws-lambda';
import { Account } from 'fhir/r4b';
import { FHIR_RESOURCE_NOT_FOUND, FinixPaymentMethodDeleteZambdaOutput } from 'utils';
import { createOystehrClient, getAuth0Token, lambdaResponse, wrapHandler, ZambdaInput } from '../../../../shared';
import { createFinixClient, FinixApiError } from '../../../../shared/finix';
import { getBillingAccountForPatient, validateUserHasAccessToPatientAccount } from '../../helpers';
import {
  buildAccountIdentifierPatchOperations,
  FINIX_PAYMENT_INSTRUMENT_USE_DEFAULT,
  getFinixPaymentInstrumentIdentifiers,
  isDefaultFinixPaymentInstrumentIdentifier,
  isFinixPaymentInstrumentIdentifier,
  resolveClinicEntityForPatient,
} from '../helpers';
import { validateRequestParameters } from './validateRequestParameters';

let m2mClientToken: string;

export const index = wrapHandler(
  'finix-del-payment-method',
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

    const finixIdentifiers = getFinixPaymentInstrumentIdentifiers(account);
    const target = finixIdentifiers.find((id) => id.value === paymentMethodId);
    if (!target) {
      return lambdaResponse(404, { message: 'paymentMethodId ' + paymentMethodId + ' not found on Account' });
    }
    const wasDefault = isDefaultFinixPaymentInstrumentIdentifier(target);

    const entity = await resolveClinicEntityForPatient(patientId, oystehr);
    const finix = createFinixClient(secrets, entity);

    try {
      // Finix has no hard delete; disabling the Payment Instrument prevents reuse.
      await finix.disablePaymentInstrument(paymentMethodId);
    } catch (error: unknown) {
      // 404 means the instrument is already gone — proceed with FHIR cleanup.
      if (error instanceof FinixApiError && error.status === 404) {
        console.warn(
          'Finix reports payment_instrument ' + paymentMethodId + ' already absent; proceeding with FHIR cleanup'
        );
      } else {
        throw error;
      }
    }

    // Promote the next remaining Finix identifier to default if the removed one was default.
    const remaining = finixIdentifiers.filter((id) => id.value !== paymentMethodId);
    if (wasDefault && remaining.length > 0) {
      remaining[0] = { ...remaining[0], use: FINIX_PAYMENT_INSTRUMENT_USE_DEFAULT };
    }
    const otherIdentifiers = (account.identifier ?? []).filter((id) => !isFinixPaymentInstrumentIdentifier(id));
    const nextIdentifiers = [...otherIdentifiers, ...remaining];

    await oystehr.fhir.patch<Account>({
      id: account.id,
      resourceType: 'Account',
      operations: buildAccountIdentifierPatchOperations(account, nextIdentifiers),
    });

    const response: FinixPaymentMethodDeleteZambdaOutput = {};
    return lambdaResponse(200, response);
  }
);
