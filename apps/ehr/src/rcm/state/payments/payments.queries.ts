import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { useApiClients } from 'src/hooks/useAppClients';
import { getPaymentLocations, PaymentLocation } from './payments.api';

export const usePaymentLocationsQuery = (): UseQueryResult<PaymentLocation[], Error> => {
  const { oystehrZambda } = useApiClients();

  return useQuery({
    queryKey: ['rcm-payment-locations'],

    queryFn: async () => {
      if (!oystehrZambda) throw new Error('OystehrZambda is not defined');

      const result = await getPaymentLocations(oystehrZambda);
      return result.locations;
    },

    enabled: !!oystehrZambda,
  });
};
