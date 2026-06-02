import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { useApiClients } from 'src/hooks/useAppClients';
import { chooseJson, FinixListPaymentMethodsZambdaOutput, useSuccessQuery } from 'utils';

interface GetFinixPaymentMethodsParams {
  patientId: string | undefined;
  enabled?: boolean;
  onSuccess?: (data: FinixListPaymentMethodsZambdaOutput | null) => void;
}

export const FINIX_PAYMENT_METHODS_QUERY_KEY = 'finix-payment-methods-list';

export const useGetFinixPaymentMethods = (
  input: GetFinixPaymentMethodsParams
): UseQueryResult<FinixListPaymentMethodsZambdaOutput, Error> => {
  const { patientId, enabled = true, onSuccess } = input;
  const { oystehrZambda } = useApiClients();

  const queryResult = useQuery({
    queryKey: [FINIX_PAYMENT_METHODS_QUERY_KEY, patientId],

    queryFn: async () => {
      if (!oystehrZambda) {
        throw new Error('zambda client not defined');
      }
      if (!patientId) {
        throw new Error('patientId not defined');
      }

      const result = await oystehrZambda.zambda.execute({
        id: 'finix-payment-methods-list',
        patientId,
      });
      return chooseJson<FinixListPaymentMethodsZambdaOutput>(result);
    },

    enabled: enabled && Boolean(patientId) && Boolean(oystehrZambda),
  });

  useSuccessQuery(queryResult.data, onSuccess);

  return queryResult;
};
