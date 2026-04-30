import { useMutation, UseMutationResult } from '@tanstack/react-query';
import { useApiClients } from 'src/hooks/useAppClients';

interface SetDefaultRHPaymentMethodParams {
  paymentMethodId: string;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}

export const useSetDefaultRHPaymentMethod = (
  patientId: string | undefined
): UseMutationResult<void, Error, SetDefaultRHPaymentMethodParams> => {
  const { oystehrZambda: oystehr } = useApiClients();

  return useMutation({
    mutationFn: async ({ paymentMethodId, onSuccess, onError }: SetDefaultRHPaymentMethodParams) => {
      if (!oystehr || !patientId) {
        throw new Error('api client not defined or patientId not provided');
      }
      try {
        await oystehr.zambda.execute({
          id: 'rh-payment-methods-set-default',
          patientId,
          paymentMethodId,
        });
        onSuccess?.();
      } catch (error) {
        onError?.(error);
        throw error;
      }
    },
    retry: 0,
  });
};
