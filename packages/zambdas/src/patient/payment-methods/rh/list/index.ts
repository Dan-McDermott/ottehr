import { APIGatewayProxyResult } from 'aws-lambda';
import { Account } from 'fhir/r4b';
import { RHCreditCardInfo, RHListPaymentMethodsZambdaOutput } from 'utils';
import { createOystehrClient, getAuth0Token, lambdaResponse, wrapHandler, ZambdaInput } from '../../../../shared';
import { getBillingAccountForPatient, validateUserHasAccessToPatientAccount } from '../../helpers';
import {
  getBrandFromIdentifier,
  getLast4FromIdentifier,
  getRectangleHealthPaymentTokenIdentifiers,
  isDefaultRectangleHealthPaymentTokenIdentifier,
} from '../helpers';
import { validateRequestParameters } from './validateRequestParameters';

let m2mClientToken: string;

export const index = wrapHandler('rh-payment-list', async (input: ZambdaInput): Promise<APIGatewayProxyResult> => {
  console.group('validateRequestParameters');
  let validatedParameters: ReturnType<typeof validateRequestParameters>;
  try {
    validatedParameters = validateRequestParameters(input);
  } catch (error: any) {
    console.log(error);
    return lambdaResponse(400, { message: error.message });
  }
  const { patientId, secrets } = validatedParameters;
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
  const identifiers = getRectangleHealthPaymentTokenIdentifiers(account);

  const cards: RHCreditCardInfo[] = identifiers
    .filter((id): id is typeof id & { value: string } => typeof id.value === 'string' && id.value.length > 0)
    .map((id) => ({
      id: id.value,
      default: isDefaultRectangleHealthPaymentTokenIdentifier(id),
      brand: getBrandFromIdentifier(id),
      last4: getLast4FromIdentifier(id),
    }))
    .sort((a, b) => {
      if (a.default && !b.default) return -1;
      if (!a.default && b.default) return 1;
      return 0;
    });

  const output: RHListPaymentMethodsZambdaOutput = { cards };
  return lambdaResponse(200, output);
});
