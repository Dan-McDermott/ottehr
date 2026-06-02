import { APIGatewayProxyResult } from 'aws-lambda';
import { FinixHostedFieldsConfigZambdaOutput, getSecret, SecretsKeys } from 'utils';
import { createOystehrClient, getAuth0Token, lambdaResponse, wrapHandler, ZambdaInput } from '../../../../shared';
import { validateUserHasAccessToPatientAccount } from '../../helpers';
import { resolveClinicEntityForPatient } from '../helpers';
import { validateRequestParameters } from './validateRequestParameters';

let m2mClientToken: string;

// Returns the non-secret config the browser needs to mount Finix.js Hosted
// Fields for the patient's clinic entity: the Finix environment and the
// per-entity Application ID. The API key is never exposed to the client.
export const index = wrapHandler('finix-payment-config', async (input: ZambdaInput): Promise<APIGatewayProxyResult> => {
  let validatedParameters: ReturnType<typeof validateRequestParameters>;
  try {
    validatedParameters = validateRequestParameters(input);
  } catch (error: any) {
    return lambdaResponse(400, { message: error.message });
  }
  const { patientId, secrets } = validatedParameters;

  if (!m2mClientToken) {
    m2mClientToken = await getAuth0Token(secrets);
  }
  const oystehr = createOystehrClient(m2mClientToken, secrets);

  void (await validateUserHasAccessToPatientAccount(
    { beneficiaryPatientId: patientId, secrets, zambdaInput: input },
    oystehr
  ));

  const entity = await resolveClinicEntityForPatient(patientId, oystehr);
  const applicationId = getSecret(
    entity === 'afterours' ? SecretsKeys.FINIX_APPLICATION_ID_AFTEROURS : SecretsKeys.FINIX_APPLICATION_ID_SPIRE,
    secrets
  );
  const baseUrl = getSecret(SecretsKeys.FINIX_API_BASE_URL, secrets);
  const environment: 'sandbox' | 'prod' = /sandbox/i.test(baseUrl) ? 'sandbox' : 'prod';

  const output: FinixHostedFieldsConfigZambdaOutput = { environment, applicationId };
  return lambdaResponse(200, output);
});
