export interface CashPaymentDTO {
  paymentMethod: 'cash' | 'check' | 'card-reader' | 'external-card-reader';
  amountInCents: number;
  dateISO: string;
  fhirPaymentNotificationId?: string;
  cardBrand?: string;
  cardLast4?: string;
  description?: string;
}
