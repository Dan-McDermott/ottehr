import { useMutation, UseMutationResult } from '@tanstack/react-query';
import { useApiClients } from 'src/hooks/useAppClients';

interface DeleteFinixPaymentMethodParams {
  paymentMethodId: string;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}

export const useDeleteFinixPaymentMethod = (
  patientId: string | undefined
): UseMutationResult<void, Error, DeleteFinixPaymentMethodParams> => {
  const { oystehrZambda: oystehr } = useApiClients();

  return useMutation({
    mutationFn: async ({ paymentMethodId, onSuccess, onError }: DeleteFinixPaymentMethodParams) => {
      if (!oystehr || !patientId) {
        throw new Error('api client not defined or patientId not provided');
      }
      try {
        await oystehr.zambda.execute({
          id: 'finix-payment-methods-delete',
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
