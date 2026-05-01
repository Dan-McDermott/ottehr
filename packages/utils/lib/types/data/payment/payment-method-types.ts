// ---------------------------------------------------------------------------
// Rectangle Health (v3) Card-on-File payment-method zambda contracts
// ---------------------------------------------------------------------------
// The RH v3 CoF flow encrypts cards client-side and stores an opaque
// payment_token, then exposes list / set-default / delete operations against
// the resulting Card-on-File records.

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
