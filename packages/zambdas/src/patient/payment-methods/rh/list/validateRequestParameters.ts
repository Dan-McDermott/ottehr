import { isValidUUID, NOT_AUTHORIZED, RHPaymentMethodListParameters, Secrets } from 'utils';
import { ZambdaInput } from '../../../../shared';

export function validateRequestParameters(
  input: ZambdaInput
): RHPaymentMethodListParameters & { secrets: Secrets | null; authorization: string } {
  const authorization = input.headers.Authorization;
  if (!authorization) {
    throw NOT_AUTHORIZED;
  }
  if (!input.body) {
    throw new Error('No request body provided');
  }

  const { patientId } = JSON.parse(input.body);

  if (!patientId) {
    throw new Error('patientId is not defined');
  }
  if (!isValidUUID(patientId)) {
    throw new Error('patientId is not a valid UUID');
  }

  return {
    patientId,
    secrets: input.secrets,
    authorization,
  };
}
