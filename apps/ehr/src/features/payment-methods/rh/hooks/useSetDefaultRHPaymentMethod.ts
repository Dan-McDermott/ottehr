import { useMutation, UseMutationResult } from '@tanstack/react-query';
import { useApiClients } from 'src/hooks/useAppClients';

interface SetDefaultFinixPaymentMethodParams {
  paymentMethodId: string;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}

export const useSetDefaultFinixPaymentMethod = (
  patientId: string | undefined
): UseMutationResult<void, Error, SetDefaultFinixPaymentMethodParams> => {
  const { oystehrZambda: oystehr } = useApiClients();

  return useMutation({
    mutationFn: async ({ paymentMethodId, onSuccess, onError }: SetDefaultFinixPaymentMethodParams) => {
      if (!oystehr || !patientId) {
        throw new Error('api client not defined or patientId not provided');
      }
      try {
        await oystehr.zambda.execute({
          id: 'finix-payment-methods-set-default',
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
