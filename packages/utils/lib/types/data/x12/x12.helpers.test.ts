// cSpell:ignore CLM, ICN
import { Claim, ClaimResponse } from 'fhir/r4b';
import { describe, expect, it } from 'vitest';
import {
  STEDI_CLAIM_TASK_STATUS_CODE,
  STEDI_CLAIM_TASK_STATUS_SYSTEM,
  STEDI_X12_CLM01_PATIENT_CONTROL_NUMBER_SYSTEM,
  STEDI_X12_PAYER_CLAIM_CONTROL_NUMBER_SYSTEM,
  STEDI_X12_ST02_277_TRANSACTION_CONTROL_NUMBER_SYSTEM,
  STEDI_X12_ST02_835_TRANSACTION_CONTROL_NUMBER_SYSTEM,
  STEDI_X12_ST02_837P_TRANSACTION_CONTROL_NUMBER_SYSTEM,
} from './x12.constants';
import {
  addStediTransactionId,
  findClaimByCLM01,
  findClaimResponseByPayerICN,
  getStediTransactionIds,
  isStediClaimTaskStatusCode,
  isStediTransactionIdentifier,
  isStediX12IdentifierSystem,
  isStediX12TransactionKind,
  kindForSystem,
  stediClaimTaskStatusCoding,
} from './x12.helpers';
import { STEDI_X12_TRANSACTION_KIND } from './x12.types';

const makeClaim = (identifier: Claim['identifier']): Claim => ({
  resourceType: 'Claim',
  status: 'active',
  type: { coding: [{ code: 'professional' }] },
  use: 'claim',
  patient: { reference: 'Patient/1' },
  created: '2026-01-01',
  provider: { reference: 'Organization/1' },
  priority: { coding: [{ code: 'normal' }] },
  insurance: [],
  identifier,
});

const makeClaimResponse = (identifier: ClaimResponse['identifier']): ClaimResponse => ({
  resourceType: 'ClaimResponse',
  status: 'active',
  type: { coding: [{ code: 'professional' }] },
  use: 'claim',
  patient: { reference: 'Patient/1' },
  created: '2026-01-02',
  insurer: { reference: 'Organization/2' },
  outcome: 'complete',
  identifier,
});

describe('x12.helpers — kindForSystem & type guards', () => {
  it('kindForSystem maps known system URLs back to logical kind', () => {
    expect(kindForSystem(STEDI_X12_ST02_837P_TRANSACTION_CONTROL_NUMBER_SYSTEM)).toBe(
      STEDI_X12_TRANSACTION_KIND.st02_837P
    );
    expect(kindForSystem(STEDI_X12_PAYER_CLAIM_CONTROL_NUMBER_SYSTEM)).toBe(
      STEDI_X12_TRANSACTION_KIND.payerClaimControlNumber
    );
  });

  it('kindForSystem returns undefined for unknown / undefined inputs', () => {
    expect(kindForSystem(undefined)).toBeUndefined();
    expect(kindForSystem('https://example.com/other')).toBeUndefined();
  });

  it('isStediTransactionIdentifier requires both system and value', () => {
    expect(isStediTransactionIdentifier(undefined)).toBe(false);
    expect(isStediTransactionIdentifier({})).toBe(false);
    expect(isStediTransactionIdentifier({ system: STEDI_X12_ST02_837P_TRANSACTION_CONTROL_NUMBER_SYSTEM })).toBe(false);
    expect(isStediTransactionIdentifier({ value: '123' })).toBe(false);
    expect(isStediTransactionIdentifier({ system: 'https://example.com/other', value: '123' })).toBe(false);
    expect(
      isStediTransactionIdentifier({ system: STEDI_X12_ST02_837P_TRANSACTION_CONTROL_NUMBER_SYSTEM, value: '123' })
    ).toBe(true);
  });

  it('isStediX12TransactionKind / isStediX12IdentifierSystem / isStediClaimTaskStatusCode', () => {
    expect(isStediX12TransactionKind('CLM01')).toBe(true);
    expect(isStediX12TransactionKind('NOPE')).toBe(false);
    expect(isStediX12TransactionKind(123)).toBe(false);

    expect(isStediX12IdentifierSystem(STEDI_X12_CLM01_PATIENT_CONTROL_NUMBER_SYSTEM)).toBe(true);
    expect(isStediX12IdentifierSystem('https://example.com/other')).toBe(false);

    expect(isStediClaimTaskStatusCode('paid')).toBe(true);
    expect(isStediClaimTaskStatusCode('not-a-status')).toBe(false);
  });
});

describe('x12.helpers — getStediTransactionIds', () => {
  it('returns [] when resource is undefined / has no identifiers', () => {
    expect(getStediTransactionIds(undefined)).toEqual([]);
    expect(getStediTransactionIds({})).toEqual([]);
    expect(getStediTransactionIds({ identifier: [] })).toEqual([]);
  });

  it('returns only Stedi/X12 identifiers and skips foreign systems', () => {
    const claim = makeClaim([
      { system: STEDI_X12_CLM01_PATIENT_CONTROL_NUMBER_SYSTEM, value: 'PCN-1' },
      { system: STEDI_X12_ST02_837P_TRANSACTION_CONTROL_NUMBER_SYSTEM, value: '0001' },
      { system: 'https://example.com/other', value: 'ignored' },
      { system: STEDI_X12_CLM01_PATIENT_CONTROL_NUMBER_SYSTEM /* missing value */ },
    ]);
    const ids = getStediTransactionIds(claim);
    expect(ids).toHaveLength(2);
    expect(ids).toContainEqual({
      kind: STEDI_X12_TRANSACTION_KIND.clm01,
      system: STEDI_X12_CLM01_PATIENT_CONTROL_NUMBER_SYSTEM,
      value: 'PCN-1',
    });
    expect(ids).toContainEqual({
      kind: STEDI_X12_TRANSACTION_KIND.st02_837P,
      system: STEDI_X12_ST02_837P_TRANSACTION_CONTROL_NUMBER_SYSTEM,
      value: '0001',
    });
  });

  it('filters by kind when supplied', () => {
    const cr = makeClaimResponse([
      { system: STEDI_X12_PAYER_CLAIM_CONTROL_NUMBER_SYSTEM, value: 'ICN-A' },
      { system: STEDI_X12_ST02_835_TRANSACTION_CONTROL_NUMBER_SYSTEM, value: '835-1' },
      { system: STEDI_X12_ST02_277_TRANSACTION_CONTROL_NUMBER_SYSTEM, value: '277-1' },
    ]);
    const only835 = getStediTransactionIds(cr, STEDI_X12_TRANSACTION_KIND.st02_835);
    expect(only835).toEqual([
      {
        kind: STEDI_X12_TRANSACTION_KIND.st02_835,
        system: STEDI_X12_ST02_835_TRANSACTION_CONTROL_NUMBER_SYSTEM,
        value: '835-1',
      },
    ]);
  });
});

describe('x12.helpers — addStediTransactionId', () => {
  it('creates an identifier array if missing and appends the new entry', () => {
    const claim = makeClaim(undefined);
    addStediTransactionId(claim, STEDI_X12_TRANSACTION_KIND.clm01, 'PCN-1');
    expect(claim.identifier).toEqual([{ system: STEDI_X12_CLM01_PATIENT_CONTROL_NUMBER_SYSTEM, value: 'PCN-1' }]);
  });

  it('is idempotent — adding the same (system, value) twice leaves one entry', () => {
    const claim = makeClaim([]);
    addStediTransactionId(claim, STEDI_X12_TRANSACTION_KIND.st02_837P, '0001');
    addStediTransactionId(claim, STEDI_X12_TRANSACTION_KIND.st02_837P, '0001');
    expect(claim.identifier).toHaveLength(1);
  });

  it('preserves existing foreign identifiers', () => {
    const claim = makeClaim([{ system: 'https://example.com/other', value: 'X' }]);
    addStediTransactionId(claim, STEDI_X12_TRANSACTION_KIND.clm01, 'PCN-2');
    expect(claim.identifier).toHaveLength(2);
    expect(claim.identifier?.[0]).toEqual({ system: 'https://example.com/other', value: 'X' });
  });

  it('throws on empty value or unknown kind', () => {
    const claim = makeClaim([]);
    expect(() => addStediTransactionId(claim, STEDI_X12_TRANSACTION_KIND.clm01, '')).toThrow();
    expect(() => addStediTransactionId(claim, 'NOT-A-KIND' as never, 'v')).toThrow();
  });
});

describe('x12.helpers — findClaimByCLM01 / findClaimResponseByPayerICN', () => {
  it('findClaimByCLM01 returns the matching Claim or undefined', () => {
    const a = makeClaim([{ system: STEDI_X12_CLM01_PATIENT_CONTROL_NUMBER_SYSTEM, value: 'PCN-A' }]);
    const b = makeClaim([{ system: STEDI_X12_CLM01_PATIENT_CONTROL_NUMBER_SYSTEM, value: 'PCN-B' }]);
    expect(findClaimByCLM01([a, b], 'PCN-B')).toBe(b);
    expect(findClaimByCLM01([a, b], 'PCN-X')).toBeUndefined();
    expect(findClaimByCLM01(undefined, 'PCN-A')).toBeUndefined();
    expect(findClaimByCLM01([a], '')).toBeUndefined();
  });

  it('findClaimByCLM01 ignores identifiers that match value but on the wrong system', () => {
    const a = makeClaim([{ system: 'https://example.com/other', value: 'PCN-A' }]);
    expect(findClaimByCLM01([a], 'PCN-A')).toBeUndefined();
  });

  it('findClaimResponseByPayerICN returns the matching ClaimResponse or undefined', () => {
    const a = makeClaimResponse([{ system: STEDI_X12_PAYER_CLAIM_CONTROL_NUMBER_SYSTEM, value: 'ICN-A' }]);
    const b = makeClaimResponse([{ system: STEDI_X12_PAYER_CLAIM_CONTROL_NUMBER_SYSTEM, value: 'ICN-B' }]);
    expect(findClaimResponseByPayerICN([a, b], 'ICN-A')).toBe(a);
    expect(findClaimResponseByPayerICN([a, b], 'ICN-Z')).toBeUndefined();
    expect(findClaimResponseByPayerICN(undefined, 'ICN-A')).toBeUndefined();
    expect(findClaimResponseByPayerICN([a], '')).toBeUndefined();
  });
});

describe('x12.helpers — Task lifecycle helpers', () => {
  it('stediClaimTaskStatusCoding builds a Coding with the correct system and code', () => {
    expect(stediClaimTaskStatusCoding(STEDI_CLAIM_TASK_STATUS_CODE.awaiting999)).toEqual({
      system: STEDI_CLAIM_TASK_STATUS_SYSTEM,
      code: 'awaiting-999',
    });
    expect(stediClaimTaskStatusCoding(STEDI_CLAIM_TASK_STATUS_CODE.paid)).toEqual({
      system: STEDI_CLAIM_TASK_STATUS_SYSTEM,
      code: 'paid',
    });
  });
});
