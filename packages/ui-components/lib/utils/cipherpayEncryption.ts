// Rectangle Health CipherPay (v3) client-side card-data encryption helper.
//
// The Rectangle Health Pay v3 "Create Payment Token" endpoint accepts an
// `encrypted_card_data` field that must be produced by RH's client-side
// encryption method (https://docs.rectanglehealth.com/rh_api/rectangle-health-pay-card-not-present/payment-encryption).
// In production the encryption is performed by a small JS module hosted at
// `${RH_CIPHERPAY_BASE_URL}` which RSA-encrypts the cardholder data against a
// public key embedded in the loader. Until that loader is wired up we ship a
// deterministic placeholder that base64-encodes a normalised JSON envelope so
// the surrounding plumbing (form -> zambda -> RH client) can be exercised end
// to end without leaking PAN data through query strings or logs.

export interface RHCardData {
  cardNumber: string;
  cvv: string;
  expirationMonth: string; // 1-2 digits, MM
  expirationYear: string; // 4 digits, YYYY
}

export interface CipherPayEncryptionEnvelope {
  card_number: string;
  cvv: string;
  exp_month: string;
  exp_year: string;
}

const PAN_REGEX = /^\d{13,19}$/;
const CVV_REGEX = /^\d{3,4}$/;
const MONTH_REGEX = /^(0?[1-9]|1[0-2])$/;
const YEAR_REGEX = /^\d{4}$/;

export function normaliseCardNumber(value: string): string {
  return value.replace(/[\s-]+/g, '');
}

export function isValidCardNumber(value: string): boolean {
  return PAN_REGEX.test(normaliseCardNumber(value));
}

export function isValidCvv(value: string): boolean {
  return CVV_REGEX.test(value.trim());
}

export function isValidExpirationMonth(value: string): boolean {
  return MONTH_REGEX.test(value.trim());
}

export function isValidExpirationYear(value: string): boolean {
  return YEAR_REGEX.test(value.trim());
}

export function validateCardData(card: RHCardData): { valid: boolean; error?: string } {
  if (!isValidCardNumber(card.cardNumber)) {
    return { valid: false, error: 'Card number must be 13–19 digits' };
  }
  if (!isValidExpirationMonth(card.expirationMonth)) {
    return { valid: false, error: 'Expiration month is invalid' };
  }
  if (!isValidExpirationYear(card.expirationYear)) {
    return { valid: false, error: 'Expiration year must be 4 digits' };
  }
  if (!isValidCvv(card.cvv)) {
    return { valid: false, error: 'CVV must be 3 or 4 digits' };
  }
  return { valid: true };
}

function base64Encode(input: string): string {
  if (typeof btoa === 'function') {
    return btoa(unescape(encodeURIComponent(input)));
  }
  return Buffer.from(input, 'utf-8').toString('base64');
}

export async function encryptCardDataForCipherPay(card: RHCardData): Promise<string> {
  const validation = validateCardData(card);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'Invalid card data');
  }
  const envelope: CipherPayEncryptionEnvelope = {
    card_number: normaliseCardNumber(card.cardNumber),
    cvv: card.cvv.trim(),
    exp_month: card.expirationMonth.trim().padStart(2, '0'),
    exp_year: card.expirationYear.trim(),
  };
  return base64Encode(JSON.stringify(envelope));
}

export function detectCardBrand(cardNumber: string): string | undefined {
  const digits = normaliseCardNumber(cardNumber);
  if (/^4/.test(digits)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'mastercard';
  if (/^3[47]/.test(digits)) return 'amex';
  if (/^6(?:011|5)/.test(digits)) return 'discover';
  return undefined;
}

export function getLastFour(cardNumber: string): string | undefined {
  const digits = normaliseCardNumber(cardNumber);
  return digits.length >= 4 ? digits.slice(-4) : undefined;
}
