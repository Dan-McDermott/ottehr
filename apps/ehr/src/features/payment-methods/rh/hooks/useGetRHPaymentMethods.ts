import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { useApiClients } from 'src/hooks/useAppClients';
import { chooseJson, RHListPaymentMethodsZambdaOutput, useSuccessQuery } from 'utils';

interface GetRHPaymentMethodsParams {
  patientId: string | undefined;
  enabled?: boolean;
  onSuccess?: (data: RHListPaymentMethodsZambdaOutput | null) => void;
}

export const RH_PAYMENT_METHODS_QUERY_KEY = 'rh-payment-methods-list';

export const useGetRHPaymentMethods = (
  input: GetRHPaymentMethodsParams
): UseQueryResult<RHListPaymentMethodsZambdaOutput, Error> => {
  const { patientId, enabled = true, onSuccess } = input;
  const { oystehrZambda } = useApiClients();

  const queryResult = useQuery({
    queryKey: [RH_PAYMENT_METHODS_QUERY_KEY, patientId],

    queryFn: async () => {
      if (!oystehrZambda) {
        throw new Error('zambda client not defined');
      }
      if (!patientId) {
        throw new Error('patientId not defined');
      }

      const result = await oystehrZambda.zambda.execute({
        id: 'rh-payment-methods-list',
        patientId,
      });
      return chooseJson<RHListPaymentMethodsZambdaOutput>(result);
    },

    enabled: enabled && Boolean(patientId) && Boolean(oystehrZambda),
  });

  useSuccessQuery(queryResult.data, onSuccess);

  return queryResult;
};
