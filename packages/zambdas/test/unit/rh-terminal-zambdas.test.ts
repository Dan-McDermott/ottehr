import { describe, expect, test } from 'vitest';
import { validateRequestParameters as validateCancel } from '../../src/ehr/patient-payments/terminal/rh-cancel';
import {
  mapCanonicalStatus,
  validateRequestParameters as validateCheckStatus,
} from '../../src/ehr/patient-payments/terminal/rh-check-payment-status';
import {
  resolveTerminalMode,
  validateRequestParameters as validateGetConfig,
} from '../../src/ehr/patient-payments/terminal/rh-get-config';
import { validateRequestParameters as validateInitiate } from '../../src/ehr/patient-payments/terminal/rh-initiate-payment';
import { ZambdaInput } from '../../src/shared';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';
const VALID_UUID_2 = '22222222-2222-4222-8222-222222222222';

const inputWith = (body: unknown): ZambdaInput => ({
  body: typeof body === 'string' ? body : JSON.stringify(body),
  headers: { Authorization: 'Bearer t' },
  secrets: null,
});

describe('rh-get-config / validateRequestParameters', () => {
  test('accepts a valid UUID locationId', () => {
    expect(validateGetConfig(inputWith({ locationId: VALID_UUID }))).toEqual({ locationId: VALID_UUID });
  });
  test('rejects missing body', () => {
    expect(() => validateGetConfig({ headers: {}, secrets: null } as ZambdaInput)).toThrow();
  });
  test('rejects missing locationId', () => {
    expect(() => validateGetConfig(inputWith({}))).toThrow();
  });
  test('rejects non-UUID locationId', () => {
    expect(() => validateGetConfig(inputWith({ locationId: 'not-a-uuid' }))).toThrow();
  });
});

describe('rh-get-config / resolveTerminalMode', () => {
  test('UAT when RH_BASE_URL contains "sandbox"', () => {
    expect(resolveTerminalMode({ RH_BASE_URL: 'https://services-sandbox.rectanglehealth.com' })).toBe('UAT');
  });
  test('PROD when RH_BASE_URL is the production domain', () => {
    expect(resolveTerminalMode({ RH_BASE_URL: 'https://services.rectanglehealth.com' })).toBe('PROD');
  });
});

describe('rh-initiate-payment / validateRequestParameters', () => {
  const valid = { locationId: VALID_UUID, amount: '12.34', invNum: 'INV-1' };
  test('accepts minimal valid input', () => {
    expect(validateInitiate(inputWith(valid))).toEqual({
      locationId: VALID_UUID,
      amount: '12.34',
      invNum: 'INV-1',
      acceptPartialAmount: undefined,
      encounterId: undefined,
    });
  });
  test('accepts encounterId UUID and acceptPartialAmount', () => {
    const r = validateInitiate(inputWith({ ...valid, encounterId: VALID_UUID_2, acceptPartialAmount: true }));
    expect(r.encounterId).toBe(VALID_UUID_2);
    expect(r.acceptPartialAmount).toBe(true);
  });
  test('rejects negative or zero amount', () => {
    expect(() => validateInitiate(inputWith({ ...valid, amount: '0' }))).toThrow();
    expect(() => validateInitiate(inputWith({ ...valid, amount: '-1.00' }))).toThrow();
  });
  test('rejects non-string amount', () => {
    expect(() => validateInitiate(inputWith({ ...valid, amount: 12.34 }))).toThrow();
  });
  test('rejects amount with too many decimals', () => {
    expect(() => validateInitiate(inputWith({ ...valid, amount: '12.345' }))).toThrow();
  });
  test('rejects empty invNum', () => {
    expect(() => validateInitiate(inputWith({ ...valid, invNum: '' }))).toThrow();
  });
  test('rejects non-UUID encounterId', () => {
    expect(() => validateInitiate(inputWith({ ...valid, encounterId: 'bad' }))).toThrow();
  });
});

describe('rh-check-payment-status / validateRequestParameters', () => {
  test('accepts valid input for afterours', () => {
    expect(validateCheckStatus(inputWith({ transactionId: 'TX-1', entity: 'afterours' }))).toEqual({
      transactionId: 'TX-1',
      entity: 'afterours',
    });
  });
  test('accepts valid input for spire', () => {
    expect(validateCheckStatus(inputWith({ transactionId: 'TX-2', entity: 'spire' })).entity).toBe('spire');
  });
  test('rejects unknown entity', () => {
    expect(() => validateCheckStatus(inputWith({ transactionId: 'TX', entity: 'humana' }))).toThrow();
  });
  test('rejects missing transactionId', () => {
    expect(() => validateCheckStatus(inputWith({ entity: 'spire' }))).toThrow();
  });
});

describe('rh-check-payment-status / mapCanonicalStatus', () => {
  test('approved variants', () => {
    expect(mapCanonicalStatus('approved')).toBe('approved');
    expect(mapCanonicalStatus('Success')).toBe('approved');
    expect(mapCanonicalStatus('CAPTURED')).toBe('approved');
  });
  test('declined variants', () => {
    expect(mapCanonicalStatus('declined')).toBe('declined');
    expect(mapCanonicalStatus('failed')).toBe('declined');
    expect(mapCanonicalStatus('error')).toBe('declined');
  });
  test('canceled variants', () => {
    expect(mapCanonicalStatus('canceled')).toBe('canceled');
    expect(mapCanonicalStatus('cancelled')).toBe('canceled');
    expect(mapCanonicalStatus('voided')).toBe('canceled');
  });
  test('pending variants', () => {
    expect(mapCanonicalStatus('pending')).toBe('pending');
    expect(mapCanonicalStatus('in_progress')).toBe('pending');
    expect(mapCanonicalStatus(undefined)).toBe('pending');
  });
  test('unknown for anything else', () => {
    expect(mapCanonicalStatus('weird-status')).toBe('unknown');
  });
});

describe('rh-cancel / validateRequestParameters', () => {
  test('accepts a transactionId', () => {
    expect(validateCancel(inputWith({ transactionId: 'TX-1' }))).toEqual({ transactionId: 'TX-1' });
  });
  test('rejects empty transactionId', () => {
    expect(() => validateCancel(inputWith({ transactionId: '' }))).toThrow();
  });
});
