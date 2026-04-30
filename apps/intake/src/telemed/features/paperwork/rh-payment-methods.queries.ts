import { useMutation, UseMutationResult, useQuery, UseQueryResult } from '@tanstack/react-query';
import {
  chooseJson,
  RHListPaymentMethodsZambdaOutput,
  RHPaymentMethodSetupZambdaOutput,
  useSuccessQuery,
} from 'utils';
import { useUCZambdaClient } from '../../../hooks/useUCZambdaClient';

export const RH_PAYMENT_METHODS_QUERY_KEY = 'rh-payment-methods-list';

interface GetRHPaymentMethodsParams {
  patientId: string | undefined;
  enabled?: boolean;
  onSuccess?: (data: RHListPaymentMethodsZambdaOutput | null) => void;
}

export const useGetRHPaymentMethods = (
  input: GetRHPaymentMethodsParams
): UseQueryResult<RHListPaymentMethodsZambdaOutput, Error> => {
  const { patientId, enabled = true, onSuccess } = input;
  const zambdaClient = useUCZambdaClient({ tokenless: false });

  const queryResult = useQuery({
    queryKey: [RH_PAYMENT_METHODS_QUERY_KEY, patientId],

    queryFn: async () => {
      if (!zambdaClient) {
        throw new Error('zambda client not defined');
      }
      if (!patientId) {
        throw new Error('patientId not defined');
      }

      const result = await zambdaClient.execute('rh-payment-methods-list', { patientId });
      return chooseJson<RHListPaymentMethodsZambdaOutput>(result);
    },

    enabled: enabled && Boolean(patientId) && Boolean(zambdaClient),
  });

  useSuccessQuery(queryResult.data, onSuccess);

  return queryResult;
};

interface SetupRHPaymentMethodParams {
  encryptedCardData: string;
  makeDefault?: boolean;
  onSuccess?: (data: RHPaymentMethodSetupZambdaOutput) => void;
  onError?: (error: unknown) => void;
}

export const useSetupRHPaymentMethod = (
  patientId: string | undefined
): UseMutationResult<RHPaymentMethodSetupZambdaOutput, Error, SetupRHPaymentMethodParams> => {
  const zambdaClient = useUCZambdaClient({ tokenless: false });

  return useMutation({
    mutationFn: async ({
      encryptedCardData,
      makeDefault,
      onSuccess,
      onError,
    }: SetupRHPaymentMethodParams): Promise<RHPaymentMethodSetupZambdaOutput> => {
      if (!zambdaClient || !patientId) {
        throw new Error('zambda client not defined or patientId not provided');
      }
      try {
        const result = await zambdaClient.execute('rh-payment-methods-setup', {
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

interface SetDefaultRHPaymentMethodParams {
  paymentMethodId: string;
  onSuccess?: () => void | Promise<void>;
  onError?: (error: unknown) => void;
}

export const useSetDefaultRHPaymentMethod = (
  patientId: string | undefined
): UseMutationResult<void, Error, SetDefaultRHPaymentMethodParams> => {
  const zambdaClient = useUCZambdaClient({ tokenless: false });

  return useMutation({
    mutationFn: async ({ paymentMethodId, onSuccess, onError }: SetDefaultRHPaymentMethodParams) => {
      if (!zambdaClient || !patientId) {
        throw new Error('zambda client not defined or patientId not provided');
      }
      try {
        await zambdaClient.execute('rh-payment-methods-set-default', {
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
