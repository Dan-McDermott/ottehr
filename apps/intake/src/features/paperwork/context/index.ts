import { QueryObserverResult, RefetchOptions } from '@tanstack/react-query';
import { QuestionnaireResponse, QuestionnaireResponseItem } from 'fhir/r4b';
import { useOutletContext } from 'react-router-dom';
import {
  AppointmentSummary,
  IntakeQuestionnaireItem,
  PaperworkPatient,
  QuestionnaireFormFields,
  RHCreditCardInfo,
  RHListPaymentMethodsZambdaOutput,
  UCGetPaperworkResponse,
} from 'utils';

export interface PaperworkContext
  extends Omit<UCGetPaperworkResponse, 'patient' | 'appointment' | 'questionnaireResponse'> {
  paperwork: QuestionnaireResponseItem[];
  paperworkInProgress: { [pageId: string]: QuestionnaireFormFields };
  pageItems: IntakeQuestionnaireItem[];
  pages: IntakeQuestionnaireItem[];
  appointment: AppointmentSummary | undefined;
  patient: PaperworkPatient | undefined;
  questionnaireResponse: QuestionnaireResponse | undefined;
  // Rectangle Health credit-card paperwork path.
  rhPaymentMethods: RHCreditCardInfo[];
  rhCardsAreLoading: boolean;
  rhPaymentMethodStateInitializing: boolean;
  refetchRHPaymentMethods: (
    options?: RefetchOptions | undefined
  ) => Promise<QueryObserverResult<RHListPaymentMethodsZambdaOutput, Error>>;
  setContinueLabel?: (label: string | undefined) => void;
  saveButtonDisabled?: boolean;
  setSaveButtonDisabled: (newVal: boolean) => void;
  findAnswerWithLinkId: (linkId: string) => QuestionnaireResponseItem | undefined;
}

export const usePaperworkContext = (): PaperworkContext => {
  return useOutletContext<PaperworkContext>();
};
