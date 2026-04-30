import { Stripe } from 'stripe';
interface PaymentMethodPatientParameters {
  beneficiaryPatientId: string;
  appointmentId: string;
}

interface PaymentMethodParameters {
  paymentMethodId: string;
}

export type PaymentMethodSetupParameters = PaymentMethodPatientParameters;
export type PaymentMethodSetDefaultParameters = PaymentMethodPatientParameters & PaymentMethodParameters;
export type PaymentMethodListParameters = PaymentMethodPatientParameters;
export type PaymentMethodDeleteParameters = PaymentMethodPatientParameters & PaymentMethodParameters;

export interface CreditCardInfo {
  id: Stripe.PaymentMethod['id'];
  brand: Stripe.Card['brand'];
  expMonth: Stripe.Card['exp_month'];
  expYear: Stripe.Card['exp_year'];
  lastFour: Stripe.Card['last4'];
  default?: boolean;
}
export interface ListPaymentMethodsZambdaOutput {
  cards: CreditCardInfo[];
}

export interface PaymentMethodSetupZambdaOutput {
  clientSecret: string;
  stripeAccount: string | undefined;
}

// ---------------------------------------------------------------------------
// Rectangle Health (v3) Card-on-File payment-method zambda contracts
// ---------------------------------------------------------------------------
// These are intentionally separate from the Stripe shapes above; the RH v3
// CoF flow encrypts cards client-side and stores an opaque payment_token, so
// the request/response surface differs from Stripe's SetupIntent flow.

export interface RHPaymentMethodSetupParameters {
  patientId: string;
  encryptedCardData: string;
  makeDefault?: boolean;
}

export interface RHPaymentMethodSetupZambdaOutput {
  paymentMethodId: string;
  default: boolean;
  last4?: string;
  brand?: string;
}

export interface RHPaymentMethodListParameters {
  patientId: string;
}

export interface RHCreditCardInfo {
  id: string;
  default: boolean;
  last4?: string;
  brand?: string;
}

export interface RHListPaymentMethodsZambdaOutput {
  cards: RHCreditCardInfo[];
}

export interface RHPaymentMethodSetDefaultParameters {
  patientId: string;
  paymentMethodId: string;
}

export type RHPaymentMethodSetDefaultZambdaOutput = Record<string, never>;

export interface RHPaymentMethodDeleteParameters {
  patientId: string;
  paymentMethodId: string;
}

export type RHPaymentMethodDeleteZambdaOutput = Record<string, never>;

export interface GetPatientBalancesZambdaInput {
  patientId: string;
}

export interface GetPatientBalancesZambdaOutput {
  totalBalanceCents: number;
  pendingPaymentCents: number;
  encounters: {
    encounterId: string;
    encounterDate: string;
    appointmentId: string;
    patientBalanceCents: number;
  }[];
}
