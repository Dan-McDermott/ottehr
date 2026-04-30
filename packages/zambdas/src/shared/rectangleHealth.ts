import Oystehr from '@oystehr/sdk';
import { Encounter, Identifier, Location } from 'fhir/r4b';
import { getEntityForLocation, getSecret, Secrets, SecretsKeys } from 'utils';

// Rectangle Health (RH) v3 API client.
// Docs: https://docs.rectanglehealth.com/api-runner/rectanglehealth/rh_api/v3
//
// Two service surfaces:
//   - Services (Card-Present + Reporting + Card-on-File): RH_BASE_URL
//     Auth: HTTP Basic (RH_API_USERNAME / RH_API_PASSWORD).
//     Endpoints: /api/v1/reporting, /api/v1/payment_token (GET/POST/DELETE),
//                /req/payment.
//   - CipherPay (CNP Sale + Refund only): RH_CIPHERPAY_BASE_URL
//     Auth: x-api-key header (per-MAC: RH_CIPHERPAY_API_KEY_<MAC>).
//     Endpoints: /api/v1/pay, /api/v1/refund.
//
// CipherPay client-side encryption (browser, W2.1):
//   The browser uses the Rectangle Health CipherPay JavaScript SDK to encrypt
//   cardholder data PCI-safely before it ever reaches our server. The SDK
//   produces a single `encrypted_card_data` string which is then forwarded to
//   the zambda for sale or token-creation. Token creation (Card-on-File)
//   yields a `payment_token` that can be reused for subsequent sales without
//   re-encrypting card data.
//   Reference: https://docs.rectanglehealth.com/api-runner/rectanglehealth/rh_api/v3/rectangle-health-pay-card-not-present/payment-encryption

// ---------------------------------------------------------------------------
// FHIR identifier system for RH transaction IDs
// ---------------------------------------------------------------------------

export const RH_PAYMENT_ID_SYSTEM = 'https://fhir.oystehr.com/PaymentIdSystem/rectangle-health/transaction';
export const RH_PAYMENT_TOKEN_ID_SYSTEM = 'https://fhir.oystehr.com/PaymentIdSystem/rectangle-health/payment-token';

export const makeBusinessIdentifierForRectangleHealthPayment = (transactionId: string): Identifier => ({
  system: RH_PAYMENT_ID_SYSTEM,
  value: transactionId,
});

export const makeBusinessIdentifierForRectangleHealthPaymentToken = (tokenReference: string): Identifier => ({
  system: RH_PAYMENT_TOKEN_ID_SYSTEM,
  value: tokenReference,
});

// ---------------------------------------------------------------------------
// Entity / environment / config
// ---------------------------------------------------------------------------

export type RHClinicEntity = 'afterours' | 'spire';

export const RH_CIPHERPAY_API_KEY_PLACEHOLDER = 'PLACEHOLDER_GET_FROM_RH_CONSOLE';

export interface RectangleHealthEnvironment {
  entity: RHClinicEntity;
  baseUrl: string;
  cipherpayBaseUrl: string;
  username: string;
  password: string;
  merchantGroupCode: string;
  merchantAccountCode: string;
  cipherpayApiKey: string;
}

export const validateRectangleHealthEnvironment = (
  secrets: Secrets | null,
  entity: RHClinicEntity
): RectangleHealthEnvironment => {
  const username = getSecret(SecretsKeys.RH_API_USERNAME, secrets);
  const password = getSecret(SecretsKeys.RH_API_PASSWORD, secrets);
  const baseUrl = getSecret(SecretsKeys.RH_BASE_URL, secrets);
  const cipherpayBaseUrl = getSecret(SecretsKeys.RH_CIPHERPAY_BASE_URL, secrets);
  const merchantGroupCode = getSecret(SecretsKeys.RH_MERCHANT_GROUP_CODE, secrets);
  const merchantAccountCode = getSecret(
    entity === 'afterours' ? SecretsKeys.RH_MAC_AFTEROURS : SecretsKeys.RH_MAC_SPIRE,
    secrets
  );
  const cipherpayApiKey = getSecret(
    entity === 'afterours' ? SecretsKeys.RH_CIPHERPAY_API_KEY_AFTEROURS : SecretsKeys.RH_CIPHERPAY_API_KEY_SPIRE,
    secrets
  );

  return {
    entity,
    baseUrl,
    cipherpayBaseUrl,
    username,
    password,
    merchantGroupCode,
    merchantAccountCode,
    cipherpayApiKey,
  };
};

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class RectangleHealthApiError extends Error {
  status: number;
  responseBody: unknown;
  surface: 'cipherpay' | 'services';
  endpoint: string;

  constructor(params: {
    status: number;
    responseBody: unknown;
    surface: 'cipherpay' | 'services';
    endpoint: string;
    message?: string;
  }) {
    const msg =
      params.message ?? `Rectangle Health ${params.surface} API error (${params.status}) on ${params.endpoint}`;
    super(msg);
    this.name = 'RectangleHealthApiError';
    this.status = params.status;
    this.responseBody = params.responseBody;
    this.surface = params.surface;
    this.endpoint = params.endpoint;
  }
}

// ---------------------------------------------------------------------------
// Response shapes (typed where v3 docs are unambiguous, otherwise unknown)
// ---------------------------------------------------------------------------

export interface RectangleHealthReportingTransaction {
  transaction_id?: string;
  inv_num?: string;
  amount?: string;
  status?: string;
  transaction_type?: string;
  merchant_account_code?: string;
  [key: string]: unknown;
}

export interface RectangleHealthReportingResponse {
  transactions?: RectangleHealthReportingTransaction[];
  [key: string]: unknown;
}

export interface RectangleHealthSaleResponse {
  transaction_id?: string;
  status?: string;
  amount?: string;
  [key: string]: unknown;
}

export interface RectangleHealthRefundResponse {
  transaction_id?: string;
  status?: string;
  refund_amount?: string;
  [key: string]: unknown;
}

export interface RectangleHealthPaymentTokenResponse {
  payment_token?: string;
  token_reference?: string;
  merchant_account_code?: string;
  [key: string]: unknown;
}

export interface RectangleHealthCardPresentInitResponse {
  transactionID?: string;
  status?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Request inputs
// ---------------------------------------------------------------------------

export interface AccountHolder {
  name?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country_code?: string;
  phone?: string;
  email?: string;
}

export interface RectangleHealthSaleInput {
  encrypted_card_data: string;
  amount: string;
  inv_num: string;
  accept_partial_amount?: boolean;
  non_surcharge?: boolean;
  account_holder?: AccountHolder;
}

export interface RectangleHealthSaleViaTokenInput {
  payment_token: string;
  amount: string;
  inv_num: string;
  accept_partial_amount?: boolean;
  non_surcharge?: boolean;
  account_holder?: AccountHolder;
}

export interface RectangleHealthRefundInput {
  transaction_id: string;
  refund_amount: string;
  refund_reason?: string;
}

export interface RectangleHealthCreatePaymentTokenInput {
  encrypted_card_data: string;
  token_reference?: string;
}

export interface RectangleHealthCardPresentInitInput {
  terminalID: string;
  amount: string;
  invNum: string;
  tenderType?: 'CREDIT' | 'DEBIT';
  transType?: 'SALE' | 'REFUND' | 'AUTH';
  acceptPartialAmount?: boolean;
  mode?: 'UAT' | 'PROD';
}

// ---------------------------------------------------------------------------
// Internal HTTP helpers
// ---------------------------------------------------------------------------

type HttpMethod = 'GET' | 'POST' | 'DELETE';

async function rhRequest<T>(params: {
  surface: 'cipherpay' | 'services';
  method: HttpMethod;
  url: string;
  endpoint: string;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
}): Promise<T> {
  const { surface, method, url, endpoint, headers, body } = params;
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Connection: 'keep-alive',
    ...headers,
  };
  const requestBody = body ? JSON.stringify(body) : undefined;

  let response: Response;
  try {
    response = await fetch(url, { method, headers: requestHeaders, body: requestBody });
  } catch (error: unknown) {
    console.error(`Rectangle Health ${surface} fetch failed: ${method} ${url}`, error);
    throw error;
  }

  const responseText = await response.text();
  let responseJson: unknown;
  try {
    responseJson = responseText ? JSON.parse(responseText) : undefined;
  } catch {
    responseJson = responseText;
  }

  if (!response.ok) {
    throw new RectangleHealthApiError({
      status: response.status,
      responseBody: responseJson,
      surface,
      endpoint,
    });
  }

  return responseJson as T;
}

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

function assertCipherpayKeyConfigured(env: RectangleHealthEnvironment): void {
  if (!env.cipherpayApiKey || env.cipherpayApiKey === RH_CIPHERPAY_API_KEY_PLACEHOLDER) {
    throw new RectangleHealthApiError({
      status: 412,
      surface: 'cipherpay',
      endpoint: '/cipherpay',
      responseBody: undefined,
      message:
        `Rectangle Health CipherPay API key for entity "${env.entity}" is the placeholder; ` +
        `populate RH_CIPHERPAY_API_KEY_${env.entity.toUpperCase()} in your local secrets.`,
    });
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class RectangleHealthClient {
  readonly env: RectangleHealthEnvironment;

  constructor(env: RectangleHealthEnvironment) {
    this.env = env;
  }

  // -- Reporting (Services / Basic Auth) ------------------------------------

  async getTransactionsByInvoice(invNum: string): Promise<RectangleHealthReportingResponse> {
    if (!invNum) throw new Error('invNum is required');
    return rhRequest<RectangleHealthReportingResponse>({
      surface: 'services',
      method: 'POST',
      url: `${this.env.baseUrl}/api/v1/reporting`,
      endpoint: '/api/v1/reporting',
      headers: { Authorization: basicAuthHeader(this.env.username, this.env.password) },
      body: { merchant_account_code: this.env.merchantAccountCode, inv_num: invNum },
    });
  }

  async getTransactionById(transactionId: string): Promise<RectangleHealthReportingResponse> {
    if (!transactionId) throw new Error('transactionId is required');
    return rhRequest<RectangleHealthReportingResponse>({
      surface: 'services',
      method: 'POST',
      url: `${this.env.baseUrl}/api/v1/reporting`,
      endpoint: '/api/v1/reporting',
      headers: { Authorization: basicAuthHeader(this.env.username, this.env.password) },
      body: { transaction_id: transactionId },
    });
  }

  // -- Card-on-File / Payment Token (Services / Basic Auth) -----------------

  async getPaymentToken(tokenReference: string): Promise<RectangleHealthPaymentTokenResponse> {
    if (!tokenReference) throw new Error('tokenReference is required');
    const qs = new URLSearchParams({
      merchant_account_code: this.env.merchantAccountCode,
      token_reference: tokenReference,
    }).toString();
    return rhRequest<RectangleHealthPaymentTokenResponse>({
      surface: 'services',
      method: 'GET',
      url: `${this.env.baseUrl}/api/v1/payment_token?${qs}`,
      endpoint: '/api/v1/payment_token',
      headers: { Authorization: basicAuthHeader(this.env.username, this.env.password) },
    });
  }

  async createPaymentToken(
    input: RectangleHealthCreatePaymentTokenInput
  ): Promise<RectangleHealthPaymentTokenResponse> {
    if (!input.encrypted_card_data) throw new Error('encrypted_card_data is required');
    const body: Record<string, unknown> = {
      encrypted_card_data: input.encrypted_card_data,
      merchant_account_code: this.env.merchantAccountCode,
    };
    if (input.token_reference) body.token_reference = input.token_reference;
    return rhRequest<RectangleHealthPaymentTokenResponse>({
      surface: 'services',
      method: 'POST',
      url: `${this.env.baseUrl}/api/v1/payment_token`,
      endpoint: '/api/v1/payment_token',
      headers: { Authorization: basicAuthHeader(this.env.username, this.env.password) },
      body,
    });
  }

  async deletePaymentToken(tokenReference: string): Promise<RectangleHealthPaymentTokenResponse> {
    if (!tokenReference) throw new Error('tokenReference is required');
    const qs = new URLSearchParams({
      merchant_account_code: this.env.merchantAccountCode,
      token_reference: tokenReference,
    }).toString();
    return rhRequest<RectangleHealthPaymentTokenResponse>({
      surface: 'services',
      method: 'DELETE',
      url: `${this.env.baseUrl}/api/v1/payment_token?${qs}`,
      endpoint: '/api/v1/payment_token',
      headers: { Authorization: basicAuthHeader(this.env.username, this.env.password) },
    });
  }

  // -- Sale / Refund (CipherPay / x-api-key) --------------------------------

  async sale(input: RectangleHealthSaleInput): Promise<RectangleHealthSaleResponse> {
    assertCipherpayKeyConfigured(this.env);
    const body: Record<string, unknown> = {
      encrypted_card_data: input.encrypted_card_data,
      amount: input.amount,
      transaction_type: 'sale',
      merchant_account_code: this.env.merchantAccountCode,
      inv_num: input.inv_num,
    };
    if (input.accept_partial_amount !== undefined) body.accept_partial_amount = input.accept_partial_amount;
    if (input.non_surcharge !== undefined) body.non_surcharge = input.non_surcharge;
    if (input.account_holder) body.account_holder = input.account_holder;
    return rhRequest<RectangleHealthSaleResponse>({
      surface: 'cipherpay',
      method: 'POST',
      url: `${this.env.cipherpayBaseUrl}/api/v1/pay`,
      endpoint: '/api/v1/pay',
      headers: { 'x-api-key': this.env.cipherpayApiKey },
      body,
    });
  }

  /**
   * Sale via Payment Token (Card-on-File charge).
   *
   * Body shape extracted from the RH v3 documentation api-runner SSR JSON for
   *   /api-runner/rectanglehealth/rh_api/v3/rectangle-health-pay-card-not-present/sale-with-payment-token
   * on 2026-04-30. Same endpoint as `sale` (`POST /api/v1/pay`); the difference
   * is that the body carries `payment_token` (created via Card-on-File flow on
   * the Services surface) instead of `encrypted_card_data`. Headers and
   * surface auth (x-api-key) match the standard CipherPay sale.
   */
  async saleViaToken(input: RectangleHealthSaleViaTokenInput): Promise<RectangleHealthSaleResponse> {
    if (!input.payment_token) throw new Error('payment_token is required');
    if (!input.amount) throw new Error('amount is required');
    if (!input.inv_num) throw new Error('inv_num is required');
    assertCipherpayKeyConfigured(this.env);
    const body: Record<string, unknown> = {
      payment_token: input.payment_token,
      amount: input.amount,
      transaction_type: 'sale',
      merchant_account_code: this.env.merchantAccountCode,
      inv_num: input.inv_num,
    };
    if (input.accept_partial_amount !== undefined) body.accept_partial_amount = input.accept_partial_amount;
    if (input.non_surcharge !== undefined) body.non_surcharge = input.non_surcharge;
    if (input.account_holder) body.account_holder = input.account_holder;
    return rhRequest<RectangleHealthSaleResponse>({
      surface: 'cipherpay',
      method: 'POST',
      url: `${this.env.cipherpayBaseUrl}/api/v1/pay`,
      endpoint: '/api/v1/pay',
      headers: { 'x-api-key': this.env.cipherpayApiKey },
      body,
    });
  }

  async refund(input: RectangleHealthRefundInput): Promise<RectangleHealthRefundResponse> {
    if (!input.transaction_id) throw new Error('transaction_id is required');
    if (!input.refund_amount) throw new Error('refund_amount is required');
    assertCipherpayKeyConfigured(this.env);
    const body: Record<string, unknown> = {
      transaction_id: input.transaction_id,
      refund_amount: input.refund_amount,
    };
    if (input.refund_reason) body.refund_reason = input.refund_reason;
    return rhRequest<RectangleHealthRefundResponse>({
      surface: 'cipherpay',
      method: 'POST',
      url: `${this.env.cipherpayBaseUrl}/api/v1/refund`,
      endpoint: '/api/v1/refund',
      headers: { 'x-api-key': this.env.cipherpayApiKey },
      body,
    });
  }

  // -- Card-Present (Services / Basic Auth) ---------------------------------

  async cardPresentInitPayment(
    input: RectangleHealthCardPresentInitInput
  ): Promise<RectangleHealthCardPresentInitResponse> {
    if (!input.terminalID) throw new Error('terminalID is required');
    if (!input.amount) throw new Error('amount is required');
    if (!input.invNum) throw new Error('invNum is required');
    const body: Record<string, unknown> = {
      terminalID: input.terminalID,
      mode: input.mode ?? 'UAT',
      amount: input.amount,
      invNum: input.invNum,
      tenderType: input.tenderType ?? 'CREDIT',
      transType: input.transType ?? 'SALE',
    };
    if (input.acceptPartialAmount !== undefined) body.acceptPartialAmount = input.acceptPartialAmount;
    return rhRequest<RectangleHealthCardPresentInitResponse>({
      surface: 'services',
      method: 'POST',
      url: `${this.env.baseUrl}/req/payment`,
      endpoint: '/req/payment',
      headers: { Authorization: basicAuthHeader(this.env.username, this.env.password) },
      body,
    });
  }

  /**
   * Surcharged Card-Present Payment Initialization. The full v3 request body
   * shape (additional surcharge fields beyond the standard init payload) is
   * not enumerated in the v3 spec note used for W0.3. Stub left in place;
   * escalate to coordinator with a captured sandbox response when ready.
   */
  async cardPresentInitSurchargedPayment(
    _input: RectangleHealthCardPresentInitInput
  ): Promise<RectangleHealthCardPresentInitResponse> {
    throw new Error(
      'RectangleHealthClient.cardPresentInitSurchargedPayment is not yet implemented — v3 request body shape pending confirmation'
    );
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createRectangleHealthClient(secrets: Secrets | null, entity: RHClinicEntity): RectangleHealthClient {
  return new RectangleHealthClient(validateRectangleHealthEnvironment(secrets, entity));
}

// ---------------------------------------------------------------------------
// Entity resolution: Encounter -> Location -> Organization -> RHClinicEntity
// ---------------------------------------------------------------------------
// TODO(W1.4): replace this inline resolver with the canonical
// `getEntityForEncounter` helper once W1.4 lands the Organization → MAC
// mapping in `utils/fhir/payments.ts`.

const macToEntity = (mac: string | undefined): RHClinicEntity | undefined => {
  if (mac === RH_MAC_AFTEROURS) return 'afterours';
  if (mac === RH_MAC_SPIRE) return 'spire';
  return undefined;
};

export const getEntityForEncounter = async (encounterId: string, oystehr: Oystehr): Promise<RHClinicEntity> => {
  const bundle = await oystehr.fhir.search<Encounter | Location>({
    resourceType: 'Encounter',
    params: [
      { name: '_id', value: encounterId },
      { name: '_include', value: 'Encounter:location' },
    ],
  });
  const resources = bundle.unbundle();
  const encounter = resources.find((r): r is Encounter => r.resourceType === 'Encounter' && r.id === encounterId);
  if (!encounter) {
    throw new Error(`Cannot resolve Rectangle Health entity for Encounter/${encounterId}: encounter not found`);
  }
  const locationRef = encounter.location?.[0]?.location?.reference;
  if (!locationRef || !locationRef.startsWith('Location/')) {
    throw new Error(
      `Cannot resolve Rectangle Health entity for Encounter/${encounterId}: encounter has no Location reference`
    );
  }
  const locationId = locationRef.slice('Location/'.length);
  const location = resources.find((r): r is Location => r.resourceType === 'Location' && r.id === locationId);
  if (!location) {
    throw new Error(
      `Cannot resolve Rectangle Health entity for Encounter/${encounterId}: included Location/${locationId} missing`
    );
  }
  const orgRef = location.managingOrganization?.reference;
  if (!orgRef || !orgRef.startsWith('Organization/')) {
    throw new Error(
      `Cannot resolve Rectangle Health entity for Location/${locationId}: missing managingOrganization`
    );
  }
  const orgId = orgRef.slice('Organization/'.length);
  const org = await oystehr.fhir.get<Organization>({ resourceType: 'Organization', id: orgId });
  const mac = org.identifier?.find((ident) => ident.system === RH_MERCHANT_ACCOUNT_CODE_SYSTEM)?.value;
  const entity = macToEntity(mac);
  if (!entity) {
    throw new Error(
      `Cannot resolve Rectangle Health entity for Organization/${orgId}: identifier (system=${RH_MERCHANT_ACCOUNT_CODE_SYSTEM}) is missing or unrecognized`
    );
  }
  return entity;
};
