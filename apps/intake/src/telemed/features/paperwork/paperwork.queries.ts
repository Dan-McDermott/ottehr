import { useMutation, useQuery, UseQueryResult } from '@tanstack/react-query';
import { QuestionnaireItemAnswerOption, QuestionnaireResponseItem } from 'fhir/r4b';
import { OystehrAPIClient } from 'ui-components';
import { useSuccessQuery } from 'utils';
import { GetAnswerOptionsRequest, isNullOrUndefined, PromiseReturnType } from 'utils';
import { useOystehrAPIClient } from '../../utils';
import { useAppointmentStore } from '../appointments';

export const useGetPaperwork = (
  onSuccess?: (data: PromiseReturnType<ReturnType<OystehrAPIClient['getPaperwork']>> | null) => void,
  params?: {
    enabled?: boolean;
    staleTime?: number;
    onError?: (error: any) => void;
  }
): UseQueryResult<PromiseReturnType<ReturnType<OystehrAPIClient['getPaperwork']>>, Error> => {
  const apiClient = useOystehrAPIClient();
  const appointmentID = useAppointmentStore((state) => state.appointmentID);

  const queryResult = useQuery({
    queryKey: ['paperwork', appointmentID],

    queryFn: () => {
      if (apiClient && appointmentID) {
        return apiClient.getPaperwork({
          appointmentID: appointmentID,
        });
      }

      throw new Error('api client not defined or appointmentID is not provided');
    },

    enabled:
      (params?.enabled && Boolean(apiClient && appointmentID)) ||
      (isNullOrUndefined(params?.enabled) && Boolean(apiClient && appointmentID)),

    staleTime: params?.staleTime,
  });

  useSuccessQuery(queryResult.data, onSuccess);

  return queryResult;
};

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const useUpdatePaperworkMutation = () => {
  return useMutation({
    // todo: figure out what is going on with the ts here
    mutationFn: async ({
      apiClient,
      questionnaireResponseId,
      answers,
    }: {
      apiClient: OystehrAPIClient;
      questionnaireResponseId: string;
      answers: QuestionnaireResponseItem;
    }) => {
      await apiClient.patchPaperwork({
        questionnaireResponseId,
        answers,
      });
    },
  });
};

export const useAnswerOptionsQuery = (
  enabled = true,
  params: GetAnswerOptionsRequest | undefined,
  onSuccess?: (data: QuestionnaireItemAnswerOption[] | null) => void
): UseQueryResult<QuestionnaireItemAnswerOption[], Error> => {
  const apiClient = useOystehrAPIClient();

  const queryResult = useQuery({
    queryKey: ['insurances', { apiClient }],

    queryFn: async () => {
      if (!apiClient) {
        throw new Error('App client is not provided');
      }

      const resources = await apiClient.getAnswerOptions(params as GetAnswerOptionsRequest);
      return resources;
    },

    enabled: !!apiClient && enabled && params !== undefined,
  });

  useSuccessQuery(queryResult.data, onSuccess);

  return queryResult;
};


