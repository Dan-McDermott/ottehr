import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { useApiClients } from 'src/hooks/useAppClients';
import { chooseJson, FinixHostedFieldsConfigZambdaOutput } from 'utils';

interface GetFinixPaymentConfigParams {
  patientId: string | undefined;
  enabled?: boolean;
}

export const FINIX_PAYMENT_CONFIG_QUERY_KEY = 'finix-payment-methods-config';

// Fetches the non-secret config (Finix environment + per-entity Application ID)
// the browser needs to mount Finix.js Hosted Fields for the patient's clinic.
export const useGetFinixPaymentConfig = (
  input: GetFinixPaymentConfigParams
): UseQueryResult<FinixHostedFieldsConfigZambdaOutput, Error> => {
  const { patientId, enabled = true } = input;
  const { oystehrZambda } = useApiClients();

  return useQuery({
    queryKey: [FINIX_PAYMENT_CONFIG_QUERY_KEY, patientId],
    queryFn: async () => {
      if (!oystehrZambda) {
        throw new Error('zambda client not defined');
      }
      if (!patientId) {
        throw new Error('patientId not defined');
      }
      const result = await oystehrZambda.zambda.execute({
        id: 'finix-payment-methods-config',
        patientId,
      });
      return chooseJson<FinixHostedFieldsConfigZambdaOutput>(result);
    },
    enabled: enabled && Boolean(patientId) && Boolean(oystehrZambda),
    staleTime: 1000 * 60 * 30,
  });
};
