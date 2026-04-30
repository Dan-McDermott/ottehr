import { useMutation, UseMutationResult } from '@tanstack/react-query';
import { useApiClients } from 'src/hooks/useAppClients';
import { chooseJson, RHPaymentMethodSetupZambdaOutput } from 'utils';

interface SetupRHPaymentMethodParams {
  encryptedCardData: string;
  makeDefault?: boolean;
  onSuccess?: (data: RHPaymentMethodSetupZambdaOutput) => void;
  onError?: (error: unknown) => void;
}

export const useSetupRHPaymentMethod = (
  patientId: string | undefined
): UseMutationResult<RHPaymentMethodSetupZambdaOutput, Error, SetupRHPaymentMethodParams> => {
  const { oystehrZambda: oystehr } = useApiClients();

  return useMutation({
    mutationFn: async ({
      encryptedCardData,
      makeDefault,
      onSuccess,
      onError,
    }: SetupRHPaymentMethodParams): Promise<RHPaymentMethodSetupZambdaOutput> => {
      if (!oystehr || !patientId) {
        throw new Error('api client not defined or patientId not provided');
      }
      try {
        const result = await oystehr.zambda.execute({
          id: 'rh-payment-methods-setup',
          patientId,
          encryptedCardData,
          makeDefault: makeDefault === true,
        });
        const parsed = chooseJson<RHPaymentMethodSetupZambdaOutput>(result);
        onSuccess?.(parsed);
        return parsed;
      } catch (error) {
        onError?.(error);
        throw error;
      }
    },
    retry: 0,
  });
};
