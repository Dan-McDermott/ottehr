import { FinixPaymentMethodSetupParameters, isValidUUID, NOT_AUTHORIZED, Secrets } from 'utils';
import { ZambdaInput } from '../../../../shared';

export function validateRequestParameters(
  input: ZambdaInput
): FinixPaymentMethodSetupParameters & { secrets: Secrets | null; authorization: string } {
  const authorization = input.headers.Authorization;
  if (!authorization) {
    throw NOT_AUTHORIZED;
  }
  if (!input.body) {
    throw new Error('No request body provided');
  }

  const { patientId, token, makeDefault } = JSON.parse(input.body);

  if (!patientId) {
    throw new Error('patientId is not defined');
  }
  if (!isValidUUID(patientId)) {
    throw new Error('patientId is not a valid UUID');
  }
  if (!token || typeof token !== 'string') {
    throw new Error('token is not defined or not a string');
  }

  return {
    patientId,
    token,
    makeDefault: makeDefault === true,
    secrets: input.secrets,
    authorization,
  };
}
