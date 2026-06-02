import { useMutation, UseMutationResult } from '@tanstack/react-query';
import { useApiClients } from 'src/hooks/useAppClients';
import { chooseJson, FinixPaymentMethodSetupZambdaOutput } from 'utils';

interface SetupFinixPaymentMethodParams {
  token: string;
  makeDefault?: boolean;
  onSuccess?: (data: FinixPaymentMethodSetupZambdaOutput) => void;
  onError?: (error: unknown) => void;
}

export const useSetupFinixPaymentMethod = (
  patientId: string | undefined
): UseMutationResult<FinixPaymentMethodSetupZambdaOutput, Error, SetupFinixPaymentMethodParams> => {
  const { oystehrZambda: oystehr } = useApiClients();

  return useMutation({
    mutationFn: async ({
      token,
      makeDefault,
      onSuccess,
      onError,
    }: SetupFinixPaymentMethodParams): Promise<FinixPaymentMethodSetupZambdaOutput> => {
      if (!oystehr || !patientId) {
        throw new Error('api client not defined or patientId not provided');
      }
      try {
        const result = await oystehr.zambda.execute({
          id: 'finix-payment-methods-setup',
          patientId,
          token,
          makeDefault: makeDefault === true,
        });
        const parsed = chooseJson<FinixPaymentMethodSetupZambdaOutput>(result);
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
