import { useMutation, UseMutationResult, useQuery, UseQueryResult } from '@tanstack/react-query';
import {
  chooseJson,
  FinixHostedFieldsConfigZambdaOutput,
  FinixListPaymentMethodsZambdaOutput,
  FinixPaymentMethodSetupZambdaOutput,
  useSuccessQuery,
} from 'utils';
import { useUCZambdaClient } from '../../../hooks/useUCZambdaClient';

export const FINIX_PAYMENT_METHODS_QUERY_KEY = 'finix-payment-methods-list';
export const FINIX_PAYMENT_CONFIG_QUERY_KEY = 'finix-payment-methods-config';

interface GetFinixPaymentMethodsParams {
  patientId: string | undefined;
  enabled?: boolean;
  onSuccess?: (data: FinixListPaymentMethodsZambdaOutput | null) => void;
}

export const useGetFinixPaymentMethods = (
  input: GetFinixPaymentMethodsParams
): UseQueryResult<FinixListPaymentMethodsZambdaOutput, Error> => {
  const { patientId, enabled = true, onSuccess } = input;
  const zambdaClient = useUCZambdaClient({ tokenless: false });

  const queryResult = useQuery({
    queryKey: [FINIX_PAYMENT_METHODS_QUERY_KEY, patientId],

    queryFn: async () => {
      if (!zambdaClient) {
        throw new Error('zambda client not defined');
      }
      if (!patientId) {
        throw new Error('patientId not defined');
      }

      const result = await zambdaClient.execute('finix-payment-methods-list', { patientId });
      return chooseJson<FinixListPaymentMethodsZambdaOutput>(result);
    },

    enabled: enabled && Boolean(patientId) && Boolean(zambdaClient),
  });

  useSuccessQuery(queryResult.data, onSuccess);

  return queryResult;
};

// Fetches the non-secret config (Finix environment + per-entity Application ID)
// the browser needs to mount Finix.js Hosted Fields for the patient's clinic.
export const useGetFinixPaymentConfig = (
  patientId: string | undefined
): UseQueryResult<FinixHostedFieldsConfigZambdaOutput, Error> => {
  const zambdaClient = useUCZambdaClient({ tokenless: false });
  return useQuery({
    queryKey: [FINIX_PAYMENT_CONFIG_QUERY_KEY, patientId],
    queryFn: async () => {
      if (!zambdaClient) throw new Error('zambda client not defined');
      if (!patientId) throw new Error('patientId not defined');
      const result = await zambdaClient.execute('finix-payment-methods-config', { patientId });
      return chooseJson<FinixHostedFieldsConfigZambdaOutput>(result);
    },
    enabled: Boolean(patientId) && Boolean(zambdaClient),
    staleTime: 1000 * 60 * 30,
  });
};

interface SetupFinixPaymentMethodParams {
  token: string;
  makeDefault?: boolean;
  onSuccess?: (data: FinixPaymentMethodSetupZambdaOutput) => void;
  onError?: (error: unknown) => void;
}

export const useSetupFinixPaymentMethod = (
  patientId: string | undefined
): UseMutationResult<FinixPaymentMethodSetupZambdaOutput, Error, SetupFinixPaymentMethodParams> => {
  const zambdaClient = useUCZambdaClient({ tokenless: false });

  return useMutation({
    mutationFn: async ({
      token,
      makeDefault,
      onSuccess,
      onError,
    }: SetupFinixPaymentMethodParams): Promise<FinixPaymentMethodSetupZambdaOutput> => {
      if (!zambdaClient || !patientId) {
        throw new Error('zambda client not defined or patientId not provided');
      }
      try {
        const result = await zambdaClient.execute('finix-payment-methods-setup', {
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

interface SetDefaultFinixPaymentMethodParams {
  paymentMethodId: string;
  onSuccess?: () => void | Promise<void>;
  onError?: (error: unknown) => void;
}

export const useSetDefaultFinixPaymentMethod = (
  patientId: string | undefined
): UseMutationResult<void, Error, SetDefaultFinixPaymentMethodParams> => {
  const zambdaClient = useUCZambdaClient({ tokenless: false });

  return useMutation({
    mutationFn: async ({ paymentMethodId, onSuccess, onError }: SetDefaultFinixPaymentMethodParams) => {
      if (!zambdaClient || !patientId) {
        throw new Error('zambda client not defined or patientId not provided');
      }
      try {
        await zambdaClient.execute('finix-payment-methods-set-default', {
          patientId,
          paymentMethodId,
        });
        await onSuccess?.();
      } catch (error) {
        onError?.(error);
        throw error;
      }
    },
    retry: 0,
  });
};
