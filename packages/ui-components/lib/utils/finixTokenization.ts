// Finix.js (v2) Hosted Fields tokenization helpers.
//
// Card data is entered into Finix-hosted iframe inputs and never touches our
// code or servers (PCI SAQ-A). `Finix.PaymentForm(elementId, environment,
// applicationId, options)` renders the hosted fields and returns a form handle
// whose `submit(cb)` yields a single-use token (`response.data.id`). The backend
// exchanges that token for a Payment Instrument.
//
// Docs: https://finix.com/docs/guides/online-payments/payment-tokenization/tokenization-forms

export type FinixEnvironment = 'sandbox' | 'prod';

export interface FinixBinInformation {
  cardBrand?: string;
  bin?: string;
  [key: string]: unknown;
}

export interface FinixTokenResponse {
  data?: {
    id?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface FinixFormHandle {
  submit: (callback: (error: unknown, response: FinixTokenResponse) => void) => void;
}

export interface FinixPaymentFormOptions {
  showAddress?: boolean;
  requireSecurityCode?: boolean;
  hideFields?: string[];
  onLoad?: () => void;
  onUpdate?: (state: unknown, binInformation: FinixBinInformation, hasErrors: boolean) => void;
  onSubmit?: (error: unknown, response: FinixTokenResponse) => void;
  [key: string]: unknown;
}

export interface FinixGlobal {
  PaymentForm: (
    elementId: string,
    environment: FinixEnvironment,
    applicationId: string,
    options: FinixPaymentFormOptions
  ) => FinixFormHandle;
}

declare global {
  interface Window {
    Finix?: FinixGlobal;
  }
}

const FINIX_JS_SRC = 'https://js.finix.com/v/2/finix.js';

let finixLoadPromise: Promise<FinixGlobal> | undefined;

/** Loads the Finix.js v2 script once and resolves with the global `Finix` object. */
export function loadFinixJs(): Promise<FinixGlobal> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Finix.js can only be loaded in a browser environment'));
  }
  if (window.Finix) {
    return Promise.resolve(window.Finix);
  }
  if (finixLoadPromise) {
    return finixLoadPromise;
  }

  finixLoadPromise = new Promise<FinixGlobal>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${FINIX_JS_SRC}"]`);
    const onReady = (): void => {
      if (window.Finix) {
        resolve(window.Finix);
      } else {
        reject(new Error('Finix.js loaded but window.Finix is undefined'));
      }
    };
    if (existing) {
      existing.addEventListener('load', onReady);
      existing.addEventListener('error', () => reject(new Error('Failed to load Finix.js')));
      if (window.Finix) onReady();
      return;
    }
    const script = document.createElement('script');
    script.src = FINIX_JS_SRC;
    script.async = true;
    script.onload = onReady;
    script.onerror = () => {
      finixLoadPromise = undefined;
      reject(new Error('Failed to load Finix.js'));
    };
    document.head.appendChild(script);
  });
  return finixLoadPromise;
}

const BRAND_NORMALIZE: Record<string, string> = {
  VISA: 'visa',
  MASTERCARD: 'mastercard',
  AMERICAN_EXPRESS: 'amex',
  AMEX: 'amex',
  DISCOVER: 'discover',
  DINERS_CLUB: 'diners',
  JCB: 'jcb',
};

/** Normalizes a Finix BIN card brand (e.g. "AMERICAN_EXPRESS") to our short form. */
export function normalizeFinixCardBrand(brand: string | undefined): string | undefined {
  if (!brand) return undefined;
  const upper = brand.toUpperCase();
  return BRAND_NORMALIZE[upper] ?? brand.toLowerCase();
}
