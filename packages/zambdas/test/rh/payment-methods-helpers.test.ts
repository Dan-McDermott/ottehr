import { Account, Identifier, Organization } from 'fhir/r4b';
import { Secrets, SecretsKeys } from 'utils';
import { describe, expect, it, vi } from 'vitest';
import {
  buildAccountIdentifierPatchOperations,
  buildRectangleHealthPaymentTokenIdentifier,
  getBrandFromIdentifier,
  getLast4FromIdentifier,
  getMerchantAccountCodeFromOrganization,
  getRectangleHealthPaymentTokenIdentifiers,
  isDefaultRectangleHealthPaymentTokenIdentifier,
  isRectangleHealthPaymentTokenIdentifier,
  resolveRHClinicEntityForPatient,
  resolveRHClinicEntityFromMerchantAccountCode,
  RH_MERCHANT_ACCOUNT_CODE_EXTENSION_URL,
  RH_PAYMENT_TOKEN_BRAND_EXTENSION_URL,
  RH_PAYMENT_TOKEN_LAST4_EXTENSION_URL,
  setDefaultPaymentTokenIdentifiers,
} from '../../src/patient/payment-methods/rh/helpers';
import { RH_PAYMENT_TOKEN_ID_SYSTEM } from '../../src/shared/rectangleHealth';

const SECRETS: Secrets = {
  [SecretsKeys.RH_MAC_AFTEROURS]: 'mac-afterours-001',
  [SecretsKeys.RH_MAC_SPIRE]: 'mac-spire-002',
} as unknown as Secrets;

const rhIdentifier = (value: string, isDefault: boolean): Identifier => ({
  system: RH_PAYMENT_TOKEN_ID_SYSTEM,
  value,
  use: isDefault ? 'official' : 'secondary',
});

describe('rh/helpers — identifier helpers', () => {
  it('detects RH payment-token identifiers and ignores others', () => {
    const account: Account = {
      resourceType: 'Account',
      status: 'active',
      identifier: [rhIdentifier('tok_a', true), rhIdentifier('tok_b', false), { system: 'https://other', value: 'x' }],
    };
    const ids = getRectangleHealthPaymentTokenIdentifiers(account);
    expect(ids.map((i) => i.value)).toEqual(['tok_a', 'tok_b']);
    expect(ids.map(isRectangleHealthPaymentTokenIdentifier)).toEqual([true, true]);
    expect(isDefaultRectangleHealthPaymentTokenIdentifier(ids[0])).toBe(true);
    expect(isDefaultRectangleHealthPaymentTokenIdentifier(ids[1])).toBe(false);
  });

  it('builds a payment-token identifier with brand/last4 extensions', () => {
    const id = buildRectangleHealthPaymentTokenIdentifier({
      paymentToken: 'tok_x',
      isDefault: true,
      brand: 'visa',
      last4: '4242',
    });
    expect(id.system).toBe(RH_PAYMENT_TOKEN_ID_SYSTEM);
    expect(id.value).toBe('tok_x');
    expect(id.use).toBe('official');
    expect(getBrandFromIdentifier(id)).toBe('visa');
    expect(getLast4FromIdentifier(id)).toBe('4242');
    expect(id.extension?.find((e) => e.url === RH_PAYMENT_TOKEN_BRAND_EXTENSION_URL)?.valueString).toBe('visa');
    expect(id.extension?.find((e) => e.url === RH_PAYMENT_TOKEN_LAST4_EXTENSION_URL)?.valueString).toBe('4242');
  });

  it('omits extensions when no brand/last4 supplied', () => {
    const id = buildRectangleHealthPaymentTokenIdentifier({
      paymentToken: 'tok_y',
      isDefault: false,
    });
    expect(id.use).toBe('secondary');
    expect(id.extension).toBeUndefined();
  });

  it('rewrites use=official only on the matching identifier', () => {
    const ids = [rhIdentifier('a', true), rhIdentifier('b', false), rhIdentifier('c', false)];
    const result = setDefaultPaymentTokenIdentifiers(ids, 'b');
    expect(result.map((i) => i.use)).toEqual(['secondary', 'official', 'secondary']);
  });

  it('emits add op when identifier array missing, replace otherwise', () => {
    const empty: Account = { resourceType: 'Account', status: 'active' };
    const filled: Account = { resourceType: 'Account', status: 'active', identifier: [] };
    expect(buildAccountIdentifierPatchOperations(empty, [rhIdentifier('a', true)])[0].op).toBe('add');
    expect(buildAccountIdentifierPatchOperations(filled, [rhIdentifier('a', true)])[0].op).toBe('replace');
  });
});

describe('rh/helpers — entity resolution', () => {
  it('reads MAC from Organization extension', () => {
    const org: Organization = {
      resourceType: 'Organization',
      extension: [{ url: RH_MERCHANT_ACCOUNT_CODE_EXTENSION_URL, valueString: 'mac-afterours-001' }],
    };
    expect(getMerchantAccountCodeFromOrganization(org)).toBe('mac-afterours-001');
  });

  it('maps MAC -> entity', () => {
    expect(resolveRHClinicEntityFromMerchantAccountCode('mac-afterours-001', SECRETS)).toBe('afterours');
    expect(resolveRHClinicEntityFromMerchantAccountCode('mac-spire-002', SECRETS)).toBe('spire');
    expect(resolveRHClinicEntityFromMerchantAccountCode('unknown', SECRETS)).toBeUndefined();
    expect(resolveRHClinicEntityFromMerchantAccountCode(undefined, SECRETS)).toBeUndefined();
  });

  it('resolves entity for a patient with managingOrganization (afterours)', async () => {
    const oystehr = {
      fhir: {
        get: vi.fn(async ({ resourceType, id }: { resourceType: string; id: string }) => {
          if (resourceType === 'Patient') {
            return { resourceType: 'Patient', id, managingOrganization: { reference: 'Organization/org-1' } };
          }
          if (resourceType === 'Organization') {
            return {
              resourceType: 'Organization',
              id: 'org-1',
              extension: [{ url: RH_MERCHANT_ACCOUNT_CODE_EXTENSION_URL, valueString: 'mac-afterours-001' }],
            };
          }
          throw new Error('unexpected resourceType ' + resourceType);
        }),
      },
    } as any;
    await expect(resolveRHClinicEntityForPatient('p-1', oystehr, SECRETS)).resolves.toBe('afterours');
  });

  it('resolves entity for a patient with managingOrganization (spire)', async () => {
    const oystehr = {
      fhir: {
        get: vi.fn(async ({ resourceType }: { resourceType: string }) => {
          if (resourceType === 'Patient') {
            return { resourceType: 'Patient', id: 'p-2', managingOrganization: { reference: 'Organization/org-2' } };
          }
          return {
            resourceType: 'Organization',
            id: 'org-2',
            extension: [{ url: RH_MERCHANT_ACCOUNT_CODE_EXTENSION_URL, valueString: 'mac-spire-002' }],
          };
        }),
      },
    } as any;
    await expect(resolveRHClinicEntityForPatient('p-2', oystehr, SECRETS)).resolves.toBe('spire');
  });

  it('falls back to afterours when MAC is unrecognised or patient has no org', async () => {
    const oystehr = {
      fhir: {
        get: vi.fn(async ({ resourceType }: { resourceType: string }) => {
          if (resourceType === 'Patient') return { resourceType: 'Patient', id: 'p-3' };
          throw new Error('should not be called');
        }),
      },
    } as any;
    await expect(resolveRHClinicEntityForPatient('p-3', oystehr, SECRETS)).resolves.toBe('afterours');
  });
});
