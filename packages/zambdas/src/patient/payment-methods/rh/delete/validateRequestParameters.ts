import { isValidUUID, NOT_AUTHORIZED, RHPaymentMethodDeleteParameters, Secrets } from 'utils';
import { ZambdaInput } from '../../../../shared';

export function validateRequestParameters(
  input: ZambdaInput
): RHPaymentMethodDeleteParameters & { secrets: Secrets | null; authorization: string } {
  const authorization = input.headers.Authorization;
  if (!authorization) {
    throw NOT_AUTHORIZED;
  }
  if (!input.body) {
    throw new Error('No request body provided');
  }

  const { patientId, paymentMethodId } = JSON.parse(input.body);

  if (!patientId) {
    throw new Error('patientId is not defined');
  }
  if (!isValidUUID(patientId)) {
    throw new Error('patientId is not a valid UUID');
  }
  if (!paymentMethodId || typeof paymentMethodId !== 'string') {
    throw new Error('paymentMethodId is not defined or not a string');
  }

  return {
    patientId,
    paymentMethodId,
    secrets: input.secrets,
    authorization,
  };
}
