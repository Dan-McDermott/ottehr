// ---------------------------------------------------------------------------
// Finix Card-on-File payment-method zambda contracts
// ---------------------------------------------------------------------------
// The Finix flow tokenizes cards client-side via Hosted Fields (producing a
// single-use `token`), which the backend exchanges for a reusable Payment
// Instrument stored as a saved card, then exposes list / set-default / delete
// operations against the resulting records.

export interface FinixPaymentMethodSetupParameters {
  patientId: string;
  token: string;
  makeDefault?: boolean;
}

export interface FinixPaymentMethodSetupZambdaOutput {
  paymentMethodId: string;
  default: boolean;
  last4?: string;
  brand?: string;
}

export interface FinixPaymentMethodListParameters {
  patientId: string;
}

export interface FinixCreditCardInfo {
  id: string;
  default: boolean;
  last4?: string;
  brand?: string;
}

export interface FinixListPaymentMethodsZambdaOutput {
  cards: FinixCreditCardInfo[];
}

export interface FinixPaymentMethodSetDefaultParameters {
  patientId: string;
  paymentMethodId: string;
}

export type FinixPaymentMethodSetDefaultZambdaOutput = Record<string, never>;

export interface FinixPaymentMethodDeleteParameters {
  patientId: string;
  paymentMethodId: string;
}

export type FinixPaymentMethodDeleteZambdaOutput = Record<string, never>;

// Lightweight config the browser needs to mount Finix.js Hosted Fields for a
// patient's clinic entity. Neither value is secret.
export interface FinixHostedFieldsConfigParameters {
  patientId: string;
}

export interface FinixHostedFieldsConfigZambdaOutput {
  environment: 'sandbox' | 'prod';
  applicationId: string;
}

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
