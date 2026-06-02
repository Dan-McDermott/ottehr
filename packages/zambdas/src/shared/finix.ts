import Oystehr from '@oystehr/sdk';
import { Encounter, Identifier, Location } from 'fhir/r4b';
import { ClinicEntity, getEntityForLocation, getSecret, Secrets, SecretsKeys } from 'utils';

export type { ClinicEntity };

// Finix payments client.
// Docs: https://finix.com/docs/api/
//
// Single REST surface authenticated with HTTP Basic (`username:password`) plus a
// `Finix-Version` header. Unlike Rectangle Health (which had two surfaces —
// Services + CipherPay — and per-MAC `x-api-key` auth), Finix uses one base URL
// and one credential per Finix Application.
//
// Each clinic entity (afterours, spire) is a SEPARATE Finix Application with its
// own API key, Merchant, and Merchant Identity. The base URL/version are shared.
//
// Card data never touches our servers: the browser tokenizes the card via
// Finix.js / Hosted Fields, producing a single-use `token` (TKxxx). The backend
// exchanges that token for a reusable `Payment Instrument` (PIxxx) bound to a
// buyer `Identity` (IDxxx). Charges are `Transfers` (sales) sourced from a
// Payment Instrument; refunds are reversal Transfers.

// ---------------------------------------------------------------------------
// FHIR identifier systems for Finix resource IDs
// ---------------------------------------------------------------------------

export const FINIX_TRANSFER_ID_SYSTEM = 'https://fhir.oystehr.com/PaymentIdSystem/finix/transfer';
export const FINIX_PAYMENT_INSTRUMENT_ID_SYSTEM = 'https://fhir.oystehr.com/PaymentIdSystem/finix/payment-instrument';
export const FINIX_BUYER_IDENTITY_ID_SYSTEM = 'https://fhir.oystehr.com/PaymentIdSystem/finix/buyer-identity';

export const makeBusinessIdentifierForFinixTransfer = (transferId: string): Identifier => ({
  system: FINIX_TRANSFER_ID_SYSTEM,
  value: transferId,
});

export const makeBusinessIdentifierForFinixPaymentInstrument = (paymentInstrumentId: string): Identifier => ({
  system: FINIX_PAYMENT_INSTRUMENT_ID_SYSTEM,
  value: paymentInstrumentId,
});

export const makeBusinessIdentifierForFinixBuyerIdentity = (identityId: string): Identifier => ({
  system: FINIX_BUYER_IDENTITY_ID_SYSTEM,
  value: identityId,
});

// ---------------------------------------------------------------------------
// Entity / environment / config
// ---------------------------------------------------------------------------

const DEFAULT_FINIX_API_VERSION = '2022-02-01';

interface EntitySecretKeys {
  username: SecretsKeys;
  password: SecretsKeys;
  applicationId: SecretsKeys;
  merchantId: SecretsKeys;
  merchantIdentityId: SecretsKeys;
}

const ENTITY_SECRET_KEYS: Record<ClinicEntity, EntitySecretKeys> = {
  afterours: {
    username: SecretsKeys.FINIX_API_USERNAME_AFTEROURS,
    password: SecretsKeys.FINIX_API_PASSWORD_AFTEROURS,
    applicationId: SecretsKeys.FINIX_APPLICATION_ID_AFTEROURS,
    merchantId: SecretsKeys.FINIX_MERCHANT_ID_AFTEROURS,
    merchantIdentityId: SecretsKeys.FINIX_MERCHANT_IDENTITY_ID_AFTEROURS,
  },
  spire: {
    username: SecretsKeys.FINIX_API_USERNAME_SPIRE,
    password: SecretsKeys.FINIX_API_PASSWORD_SPIRE,
    applicationId: SecretsKeys.FINIX_APPLICATION_ID_SPIRE,
    merchantId: SecretsKeys.FINIX_MERCHANT_ID_SPIRE,
    merchantIdentityId: SecretsKeys.FINIX_MERCHANT_IDENTITY_ID_SPIRE,
  },
};

export interface FinixEnvironment {
  entity: ClinicEntity;
  baseUrl: string;
  apiVersion: string;
  username: string;
  password: string;
  applicationId: string;
  merchantId: string;
  merchantIdentityId: string;
}

export const validateFinixEnvironment = (secrets: Secrets | null, entity: ClinicEntity): FinixEnvironment => {
  const keys = ENTITY_SECRET_KEYS[entity];
  const baseUrl = getSecret(SecretsKeys.FINIX_API_BASE_URL, secrets);
  let apiVersion: string;
  try {
    apiVersion = getSecret(SecretsKeys.FINIX_API_VERSION, secrets) || DEFAULT_FINIX_API_VERSION;
  } catch {
    apiVersion = DEFAULT_FINIX_API_VERSION;
  }
  return {
    entity,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiVersion,
    username: getSecret(keys.username, secrets),
    password: getSecret(keys.password, secrets),
    applicationId: getSecret(keys.applicationId, secrets),
    merchantId: getSecret(keys.merchantId, secrets),
    merchantIdentityId: getSecret(keys.merchantIdentityId, secrets),
  };
};

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class FinixApiError extends Error {
  status: number;
  responseBody: unknown;
  endpoint: string;

  constructor(params: { status: number; responseBody: unknown; endpoint: string; message?: string }) {
    super(params.message ?? `Finix API error (${params.status}) on ${params.endpoint}`);
    this.name = 'FinixApiError';
    this.status = params.status;
    this.responseBody = params.responseBody;
    this.endpoint = params.endpoint;
  }
}

// ---------------------------------------------------------------------------
// Response shapes (typed where the Finix API is unambiguous, otherwise unknown)
// ---------------------------------------------------------------------------

export type FinixTransferState = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | string;

export interface FinixTransfer {
  id?: string;
  state?: FinixTransferState;
  amount?: number;
  currency?: string;
  type?: string;
  merchant?: string;
  merchant_identity?: string;
  source?: string;
  trace_id?: string;
  failure_code?: string | null;
  failure_message?: string | null;
  [key: string]: unknown;
}

export interface FinixPaymentInstrument {
  id?: string;
  fingerprint?: string;
  last_four?: string;
  brand?: string;
  card_type?: string;
  identity?: string;
  enabled?: boolean;
  [key: string]: unknown;
}

export interface FinixIdentity {
  id?: string;
  [key: string]: unknown;
}

// Canonical status mapping shared with the rest of the payment code.
export type CanonicalPaymentStatus = 'approved' | 'declined' | 'canceled' | 'pending' | 'unknown';

export const mapFinixTransferState = (state: FinixTransferState | undefined): CanonicalPaymentStatus => {
  switch ((state ?? '').toUpperCase()) {
    case 'SUCCEEDED':
      return 'approved';
    case 'FAILED':
      return 'declined';
    case 'CANCELED':
      return 'canceled';
    case 'PENDING':
      return 'pending';
    default:
      return 'unknown';
  }
};

// ---------------------------------------------------------------------------
// Request inputs
// ---------------------------------------------------------------------------

export interface FinixBuyerIdentityInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
}

export interface FinixCreatePaymentInstrumentInput {
  token: string;
  identityId: string;
}

export interface FinixSaleInput {
  paymentInstrumentId: string;
  amountInCents: number;
  idempotencyId?: string;
  tags?: Record<string, string>;
}

export interface FinixRefundInput {
  transferId: string;
  amountInCents: number;
  idempotencyId?: string;
  tags?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Internal HTTP helper
// ---------------------------------------------------------------------------

type HttpMethod = 'GET' | 'POST' | 'PUT';

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class FinixClient {
  readonly env: FinixEnvironment;

  constructor(env: FinixEnvironment) {
    this.env = env;
  }

  private async request<T>(method: HttpMethod, endpoint: string, body?: Record<string, unknown>): Promise<T> {
    const url = `${this.env.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/hal+json',
      'Finix-Version': this.env.apiVersion,
      Authorization: basicAuthHeader(this.env.username, this.env.password),
    };

    let response: Response;
    try {
      response = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (error: unknown) {
      console.error(`Finix fetch failed: ${method} ${url}`, error);
      throw error;
    }

    const text = await response.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = text;
    }

    if (!response.ok) {
      throw new FinixApiError({ status: response.status, responseBody: json, endpoint });
    }
    return json as T;
  }

  // -- Buyer Identities -----------------------------------------------------

  /** Create a buyer Identity to own Payment Instruments for a single patient. */
  async createBuyerIdentity(input: FinixBuyerIdentityInput = {}): Promise<FinixIdentity> {
    const entity: Record<string, unknown> = {};
    if (input.firstName) entity.first_name = input.firstName;
    if (input.lastName) entity.last_name = input.lastName;
    if (input.email) entity.email = input.email;
    if (input.phone) entity.phone = input.phone;
    return this.request<FinixIdentity>('POST', '/identities', { entity });
  }

  // -- Payment Instruments (saved cards) ------------------------------------

  /** Exchange a Finix.js single-use `token` for a reusable Payment Instrument. */
  async createPaymentInstrument(input: FinixCreatePaymentInstrumentInput): Promise<FinixPaymentInstrument> {
    if (!input.token) throw new Error('token is required');
    if (!input.identityId) throw new Error('identityId is required');
    return this.request<FinixPaymentInstrument>('POST', '/payment_instruments', {
      type: 'TOKEN',
      token: input.token,
      identity: input.identityId,
    });
  }

  /** Finix has no hard delete; instruments are disabled instead. */
  async disablePaymentInstrument(paymentInstrumentId: string): Promise<FinixPaymentInstrument> {
    if (!paymentInstrumentId) throw new Error('paymentInstrumentId is required');
    return this.request<FinixPaymentInstrument>('PUT', `/payment_instruments/${paymentInstrumentId}`, {
      enabled: false,
    });
  }

  async getPaymentInstrument(paymentInstrumentId: string): Promise<FinixPaymentInstrument> {
    if (!paymentInstrumentId) throw new Error('paymentInstrumentId is required');
    return this.request<FinixPaymentInstrument>('GET', `/payment_instruments/${paymentInstrumentId}`);
  }

  // -- Sales / Refunds ------------------------------------------------------

  /** Charge a saved Payment Instrument (card-not-present sale). Amount in cents. */
  async sale(input: FinixSaleInput): Promise<FinixTransfer> {
    if (!input.paymentInstrumentId) throw new Error('paymentInstrumentId is required');
    if (!Number.isInteger(input.amountInCents) || input.amountInCents <= 0) {
      throw new Error('amountInCents must be a positive integer');
    }
    const body: Record<string, unknown> = {
      merchant: this.env.merchantId,
      currency: 'USD',
      amount: input.amountInCents,
      source: input.paymentInstrumentId,
    };
    if (input.idempotencyId) body.idempotency_id = input.idempotencyId;
    if (input.tags) body.tags = input.tags;
    return this.request<FinixTransfer>('POST', '/transfers', body);
  }

  /** Refund (full or partial) a prior sale Transfer via a reversal. Amount in cents. */
  async refund(input: FinixRefundInput): Promise<FinixTransfer> {
    if (!input.transferId) throw new Error('transferId is required');
    if (!Number.isInteger(input.amountInCents) || input.amountInCents <= 0) {
      throw new Error('amountInCents must be a positive integer');
    }
    const body: Record<string, unknown> = { refund_amount: input.amountInCents };
    if (input.idempotencyId) body.idempotency_id = input.idempotencyId;
    if (input.tags) body.tags = input.tags;
    return this.request<FinixTransfer>('POST', `/transfers/${input.transferId}/reversals`, body);
  }

  async getTransfer(transferId: string): Promise<FinixTransfer> {
    if (!transferId) throw new Error('transferId is required');
    return this.request<FinixTransfer>('GET', `/transfers/${transferId}`);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createFinixClient(secrets: Secrets | null, entity: ClinicEntity): FinixClient {
  return new FinixClient(validateFinixEnvironment(secrets, entity));
}

// ---------------------------------------------------------------------------
// Entity resolution: Encounter -> Location -> Organization -> ClinicEntity
// ---------------------------------------------------------------------------
// Delegates to the canonical `getEntityForLocation` helper from `utils`, which
// owns the Organization -> entity mapping.

export const getEntityForEncounter = async (encounterId: string, oystehr: Oystehr): Promise<ClinicEntity> => {
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
    throw new Error(`Cannot resolve Finix entity for Encounter/${encounterId}: encounter not found`);
  }
  const locationRef = encounter.location?.[0]?.location?.reference;
  if (!locationRef || !locationRef.startsWith('Location/')) {
    throw new Error(`Cannot resolve Finix entity for Encounter/${encounterId}: encounter has no Location reference`);
  }
  const locationId = locationRef.slice('Location/'.length);
  const location = resources.find((r): r is Location => r.resourceType === 'Location' && r.id === locationId);
  if (!location) {
    throw new Error(
      `Cannot resolve Finix entity for Encounter/${encounterId}: included Location/${locationId} missing`
    );
  }
  return getEntityForLocation(location, oystehr);
};
