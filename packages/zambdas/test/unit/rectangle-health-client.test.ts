import { Encounter, Location, Organization } from 'fhir/r4b';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  getEntityForEncounter,
  RectangleHealthApiError,
  RectangleHealthClient,
  RectangleHealthEnvironment,
  RH_CIPHERPAY_API_KEY_PLACEHOLDER,
} from '../../src/shared/rectangleHealth';

const baseEnv = (overrides: Partial<RectangleHealthEnvironment> = {}): RectangleHealthEnvironment => ({
  entity: 'afterours',
  baseUrl: 'https://services-sandbox.rectanglehealth.com',
  cipherpayBaseUrl: 'https://api.qa.rectangle.health/cipherpay',
  username: 'u',
  password: 'p',
  merchantGroupCode: '78072000',
  merchantAccountCode: '78072001',
  cipherpayApiKey: 'live-key',
  ...overrides,
});

const mockFetch = (impl: typeof fetch): typeof fetch => {
  return vi.fn(impl) as unknown as typeof fetch;
};

const okJson = (data: unknown): Response =>
  ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(data),
  }) as Response;

describe('RectangleHealthClient', () => {
  const originalFetch = globalThis.fetch;
  let lastInit: RequestInit | undefined;
  let lastUrl: string | undefined;
  beforeEach(() => {
    lastInit = undefined;
    lastUrl = undefined;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('placeholder CipherPay key throws RectangleHealthApiError on sale', async () => {
    const client = new RectangleHealthClient(baseEnv({ cipherpayApiKey: RH_CIPHERPAY_API_KEY_PLACEHOLDER }));
    await expect(client.sale({ encrypted_card_data: 'enc', amount: '5.00', inv_num: 'inv-1' })).rejects.toBeInstanceOf(
      RectangleHealthApiError
    );
  });

  test('placeholder CipherPay key throws RectangleHealthApiError on saleViaToken', async () => {
    const client = new RectangleHealthClient(baseEnv({ cipherpayApiKey: RH_CIPHERPAY_API_KEY_PLACEHOLDER }));
    await expect(
      client.saleViaToken({ payment_token: 'tok', amount: '5.00', inv_num: 'inv-1' })
    ).rejects.toBeInstanceOf(RectangleHealthApiError);
  });

  test('sale posts encrypted_card_data with x-api-key', async () => {
    globalThis.fetch = mockFetch(async (url, init) => {
      lastUrl = String(url);
      lastInit = init;
      return okJson({ transaction_id: 'tx-1', status: 'approved' });
    });
    const client = new RectangleHealthClient(baseEnv());
    const res = await client.sale({ encrypted_card_data: 'ENC', amount: '12.34', inv_num: 'inv-9' });
    expect(res.transaction_id).toBe('tx-1');
    expect(lastUrl).toBe('https://api.qa.rectangle.health/cipherpay/api/v1/pay');
    expect((lastInit?.headers as Record<string, string>)['x-api-key']).toBe('live-key');
    const body = JSON.parse(lastInit?.body as string);
    expect(body).toMatchObject({
      encrypted_card_data: 'ENC',
      amount: '12.34',
      transaction_type: 'sale',
      merchant_account_code: '78072001',
      inv_num: 'inv-9',
    });
  });

  test('saleViaToken posts payment_token with x-api-key', async () => {
    globalThis.fetch = mockFetch(async (url, init) => {
      lastUrl = String(url);
      lastInit = init;
      return okJson({ transaction_id: 'tx-2', status: 'approved' });
    });
    const client = new RectangleHealthClient(baseEnv());
    const res = await client.saleViaToken({ payment_token: 'TOK', amount: '7.50', inv_num: 'inv-7' });
    expect(res.transaction_id).toBe('tx-2');
    expect(lastUrl).toBe('https://api.qa.rectangle.health/cipherpay/api/v1/pay');
    const body = JSON.parse(lastInit?.body as string);
    expect(body).toMatchObject({
      payment_token: 'TOK',
      amount: '7.50',
      transaction_type: 'sale',
      merchant_account_code: '78072001',
      inv_num: 'inv-7',
    });
    expect(body.encrypted_card_data).toBeUndefined();
  });

  test('refund posts transaction_id and refund_amount', async () => {
    globalThis.fetch = mockFetch(async (_url, init) => {
      lastInit = init;
      return okJson({ transaction_id: 'rfd-3', status: 'approved' });
    });
    const client = new RectangleHealthClient(baseEnv());
    const res = await client.refund({ transaction_id: 'tx-2', refund_amount: '7.50' });
    expect(res.transaction_id).toBe('rfd-3');
    const body = JSON.parse(lastInit?.body as string);
    expect(body).toEqual({ transaction_id: 'tx-2', refund_amount: '7.50' });
  });
});

describe('getEntityForEncounter', () => {
  const makeOystehr = (resources: { search?: any[]; org?: Organization }): any => ({
    fhir: {
      search: vi.fn(async () => ({ unbundle: () => resources.search ?? [] })),
      get: vi.fn(async () => resources.org as Organization),
    },
  });

  const encounter = (locId?: string): Encounter =>
    ({
      resourceType: 'Encounter',
      id: 'enc-1',
      status: 'finished',
      class: { code: 'AMB' },
      location: locId ? [{ location: { reference: `Location/${locId}` } }] : undefined,
    }) as Encounter;

  const location = (orgId?: string): Location =>
    ({
      resourceType: 'Location',
      id: 'loc-1',
      managingOrganization: orgId ? { reference: `Organization/${orgId}` } : undefined,
    }) as Location;

  test('resolves "afterours" for AfterOurs MAC', async () => {
    const oystehr = makeOystehr({
      search: [encounter('loc-1'), location('org-ao')],
      org: {
        resourceType: 'Organization',
        id: 'org-ao',
        identifier: [
          {
            system: 'https://fhir.oystehr.com/PaymentIdSystem/rectangle-health/merchant-account-code',
            value: '78072001',
          },
        ],
      } as Organization,
    });
    await expect(getEntityForEncounter('enc-1', oystehr)).resolves.toBe('afterours');
  });

  test('resolves "spire" for Spire MAC', async () => {
    const oystehr = makeOystehr({
      search: [encounter('loc-1'), location('org-sp')],
      org: {
        resourceType: 'Organization',
        id: 'org-sp',
        identifier: [
          {
            system: 'https://fhir.oystehr.com/PaymentIdSystem/rectangle-health/merchant-account-code',
            value: '78072002',
          },
        ],
      } as Organization,
    });
    await expect(getEntityForEncounter('enc-1', oystehr)).resolves.toBe('spire');
  });

  test('throws when MAC identifier is missing', async () => {
    const oystehr = makeOystehr({
      search: [encounter('loc-1'), location('org-x')],
      org: { resourceType: 'Organization', id: 'org-x', identifier: [] } as Organization,
    });
    await expect(getEntityForEncounter('enc-1', oystehr)).rejects.toThrow(/has no MAC identifier/);
  });

  test('throws when encounter has no location reference', async () => {
    const oystehr = makeOystehr({ search: [encounter()] });
    await expect(getEntityForEncounter('enc-1', oystehr)).rejects.toThrow(/no Location reference/);
  });
});
