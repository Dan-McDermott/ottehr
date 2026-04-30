import { QueryObserverResult, RefetchOptions } from '@tanstack/react-query';
import { QuestionnaireResponse, QuestionnaireResponseItem } from 'fhir/r4b';
import { useOutletContext } from 'react-router-dom';
import {
  AppointmentSummary,
  CreditCardInfo,
  IntakeQuestionnaireItem,
  PaperworkPatient,
  PaymentMethodSetupZambdaOutput,
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
  cardsAreLoading: boolean;
  paymentMethodStateInitializing: boolean;
  paymentMethods: CreditCardInfo[];
  stripeSetupData: PaymentMethodSetupZambdaOutput | undefined;
  // Rectangle Health (v3) — primary credit-card paperwork path. The Stripe
  // fields above are kept wired for telemed/legacy callers per the
  // "swap, don't demolish" operating principle.
  rhPaymentMethods: RHCreditCardInfo[];
  rhCardsAreLoading: boolean;
  rhPaymentMethodStateInitializing: boolean;
  refetchRHPaymentMethods: (
    options?: RefetchOptions | undefined
  ) => Promise<QueryObserverResult<RHListPaymentMethodsZambdaOutput, Error>>;
  setContinueLabel?: (label: string | undefined) => void;
  saveButtonDisabled?: boolean;
  refetchPaymentMethods: (options?: RefetchOptions | undefined) => Promise<
    QueryObserverResult<
      {
        cards: CreditCardInfo[];
      },
      Error
    >
  >;
  refetchSetupData: (
    options?: RefetchOptions | undefined
  ) => Promise<QueryObserverResult<PaymentMethodSetupZambdaOutput, Error>>;
  setSaveButtonDisabled: (newVal: boolean) => void;
  findAnswerWithLinkId: (linkId: string) => QuestionnaireResponseItem | undefined;
}

export const usePaperworkContext = (): PaperworkContext => {
  return useOutletContext<PaperworkContext>();
};
