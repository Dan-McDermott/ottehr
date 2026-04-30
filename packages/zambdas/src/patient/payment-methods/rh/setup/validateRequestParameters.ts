import { isValidUUID, NOT_AUTHORIZED, RHPaymentMethodSetupParameters, Secrets } from 'utils';
import { ZambdaInput } from '../../../../shared';

export function validateRequestParameters(
  input: ZambdaInput
): RHPaymentMethodSetupParameters & { secrets: Secrets | null; authorization: string } {
  const authorization = input.headers.Authorization;
  if (!authorization) {
    throw NOT_AUTHORIZED;
  }
  if (!input.body) {
    throw new Error('No request body provided');
  }

  const { patientId, encryptedCardData, makeDefault } = JSON.parse(input.body);

  if (!patientId) {
    throw new Error('patientId is not defined');
  }
  if (!isValidUUID(patientId)) {
    throw new Error('patientId is not a valid UUID');
  }
  if (!encryptedCardData || typeof encryptedCardData !== 'string') {
    throw new Error('encryptedCardData is not defined or not a string');
  }

  return {
    patientId,
    encryptedCardData,
    makeDefault: makeDefault === true,
    secrets: input.secrets,
    authorization,
  };
}
