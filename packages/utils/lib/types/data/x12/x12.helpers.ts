// cSpell:ignore CLM, ICN
import { Claim, ClaimResponse, Coding, Identifier } from 'fhir/r4b';
import {
  STEDI_CLAIM_TASK_STATUS_CODE,
  STEDI_CLAIM_TASK_STATUS_SYSTEM,
  STEDI_X12_CLM01_PATIENT_CONTROL_NUMBER_SYSTEM,
  STEDI_X12_IDENTIFIER_SYSTEMS,
  STEDI_X12_PAYER_CLAIM_CONTROL_NUMBER_SYSTEM,
  StediClaimTaskStatusCode,
} from './x12.constants';
import {
  STEDI_X12_KIND_TO_SYSTEM,
  STEDI_X12_TRANSACTION_KIND,
  StediTransactionId,
  StediX12IdentifierSystem,
  StediX12TransactionKind,
} from './x12.types';

/** Minimal shape we mutate/read — every FHIR resource that may carry these ids. */
export interface ResourceWithIdentifiers {
  identifier?: Identifier[];
}

const SYSTEM_TO_KIND: Record<string, StediX12TransactionKind> = Object.fromEntries(
  (Object.entries(STEDI_X12_KIND_TO_SYSTEM) as [StediX12TransactionKind, string][]).map(([k, sys]) => [sys, k])
);

/** Returns the logical kind for a given identifier system URL, or undefined if unknown. */
export const kindForSystem = (system: string | undefined): StediX12TransactionKind | undefined => {
  if (!system) return undefined;
  return SYSTEM_TO_KIND[system];
};

/** Type guard: identifier whose system is one of the Stedi/X12 identifier-system URLs. */
export const isStediTransactionIdentifier = (identifier: Identifier | undefined): boolean => {
  if (!identifier?.system || !identifier.value) return false;
  return (STEDI_X12_IDENTIFIER_SYSTEMS as readonly string[]).includes(identifier.system);
};

/** Type guard: a string is a known StediX12TransactionKind. */
export const isStediX12TransactionKind = (value: unknown): value is StediX12TransactionKind => {
  if (typeof value !== 'string') return false;
  return Object.values(STEDI_X12_TRANSACTION_KIND).includes(value as StediX12TransactionKind);
};

/** Type guard: a string is a known Stedi/X12 identifier system URL. */
export const isStediX12IdentifierSystem = (value: unknown): value is StediX12IdentifierSystem => {
  if (typeof value !== 'string') return false;
  return (STEDI_X12_IDENTIFIER_SYSTEMS as readonly string[]).includes(value);
};

/**
 * Read all Stedi/X12 transaction identifiers from a FHIR resource. Optionally filter
 * to a single kind. Identifiers with missing system or value are skipped.
 */
export const getStediTransactionIds = (
  resource: ResourceWithIdentifiers | undefined,
  kind?: StediX12TransactionKind
): StediTransactionId[] => {
  if (!resource?.identifier?.length) return [];
  const out: StediTransactionId[] = [];
  for (const id of resource.identifier) {
    if (!isStediTransactionIdentifier(id)) continue;
    const idKind = kindForSystem(id.system);
    if (!idKind) continue;
    if (kind && idKind !== kind) continue;
    out.push({ kind: idKind, system: id.system as string, value: id.value as string });
  }
  return out;
};

/**
 * Append a Stedi/X12 transaction identifier to a resource, mutably. If an identifier
 * with the same (system, value) already exists, this is a no-op.
 *
 * Returns the resource for chaining.
 */
export const addStediTransactionId = <T extends ResourceWithIdentifiers>(
  resource: T,
  kind: StediX12TransactionKind,
  value: string
): T => {
  if (!value) throw new Error('addStediTransactionId: value is required');
  const system = STEDI_X12_KIND_TO_SYSTEM[kind];
  if (!system) throw new Error(`addStediTransactionId: unknown kind "${kind}"`);
  if (!resource.identifier) resource.identifier = [];
  const exists = resource.identifier.some((i) => i.system === system && i.value === value);
  if (!exists) resource.identifier.push({ system, value });
  return resource;
};

/** Find the first Claim whose CLM01 (patient control number) identifier matches. */
export const findClaimByCLM01 = <T extends Claim>(claims: readonly T[] | undefined, clm01: string): T | undefined => {
  if (!claims?.length || !clm01) return undefined;
  return claims.find(
    (c) => c.identifier?.some((i) => i.system === STEDI_X12_CLM01_PATIENT_CONTROL_NUMBER_SYSTEM && i.value === clm01)
  );
};

/** Find the first ClaimResponse whose payer-claim-control-number (ICN/DCN) identifier matches. */
export const findClaimResponseByPayerICN = <T extends ClaimResponse>(
  claimResponses: readonly T[] | undefined,
  payerIcn: string
): T | undefined => {
  if (!claimResponses?.length || !payerIcn) return undefined;
  return claimResponses.find(
    (r) => r.identifier?.some((i) => i.system === STEDI_X12_PAYER_CLAIM_CONTROL_NUMBER_SYSTEM && i.value === payerIcn)
  );
};

/** Build a Coding for the Stedi-claim Task lifecycle (Task.businessStatus.coding[]). */
export const stediClaimTaskStatusCoding = (code: StediClaimTaskStatusCode): Coding => ({
  system: STEDI_CLAIM_TASK_STATUS_SYSTEM,
  code,
});

/** Type guard: string is a valid Stedi-claim Task lifecycle code. */
export const isStediClaimTaskStatusCode = (value: unknown): value is StediClaimTaskStatusCode => {
  if (typeof value !== 'string') return false;
  return Object.values(STEDI_CLAIM_TASK_STATUS_CODE).includes(value as StediClaimTaskStatusCode);
};
