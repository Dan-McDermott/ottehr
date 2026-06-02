// cSpell:ignore CLM, CLP, ICN, DCN, ISA, GS, ST, TRN, REF, PCCN, PCN
import { ottehrCodeSystemUrl, ottehrIdentifierSystem } from '../../../fhir/systemUrls';

/**
 * Identifier system URLs for X12/EDI control numbers exchanged with Stedi.
 *
 * These constants are pure namespaces — they do not prescribe which FHIR resource
 * the identifier must live on. See ./README.md for the conventional placement
 * (Claim, ClaimResponse, PaymentReconciliation, Task).
 */

// Envelope-level control numbers (X12 envelope segments).
export const STEDI_X12_ISA13_INTERCHANGE_CONTROL_NUMBER_SYSTEM = ottehrIdentifierSystem(
  'stedi-x12-isa13-interchange-control-number'
);
export const STEDI_X12_GS06_GROUP_CONTROL_NUMBER_SYSTEM = ottehrIdentifierSystem('stedi-x12-gs06-group-control-number');

// Transaction-set control numbers (ST02), one per transaction kind.
export const STEDI_X12_ST02_837P_TRANSACTION_CONTROL_NUMBER_SYSTEM = ottehrIdentifierSystem(
  'stedi-x12-st02-837p-transaction-control-number'
);
export const STEDI_X12_ST02_999_TRANSACTION_CONTROL_NUMBER_SYSTEM = ottehrIdentifierSystem(
  'stedi-x12-st02-999-transaction-control-number'
);
export const STEDI_X12_ST02_277_TRANSACTION_CONTROL_NUMBER_SYSTEM = ottehrIdentifierSystem(
  'stedi-x12-st02-277-transaction-control-number'
);
export const STEDI_X12_ST02_835_TRANSACTION_CONTROL_NUMBER_SYSTEM = ottehrIdentifierSystem(
  'stedi-x12-st02-835-transaction-control-number'
);
export const STEDI_X12_ST02_270_TRANSACTION_CONTROL_NUMBER_SYSTEM = ottehrIdentifierSystem(
  'stedi-x12-st02-270-transaction-control-number'
);
export const STEDI_X12_ST02_271_TRANSACTION_CONTROL_NUMBER_SYSTEM = ottehrIdentifierSystem(
  'stedi-x12-st02-271-transaction-control-number'
);

/**
 * CLM01 — the submitter-assigned Patient Control Number on an 837 claim.
 * This is the value used to correlate the original claim with downstream 277/835 responses.
 * Lives on Claim.identifier.
 */
export const STEDI_X12_CLM01_PATIENT_CONTROL_NUMBER_SYSTEM = ottehrIdentifierSystem(
  'stedi-x12-clm01-patient-control-number'
);

/**
 * Payer Claim Control Number (a.k.a. payer ICN/DCN). Returned in:
 * - 277CA   Loop 2200D REF02 where REF01=1K (`tradingPartnerClaimNumber`)
 * - 835     CLP07 (`payerClaimControlNumber`)
 * Lives on ClaimResponse.identifier.
 */
export const STEDI_X12_PAYER_CLAIM_CONTROL_NUMBER_SYSTEM = ottehrIdentifierSystem(
  'stedi-x12-payer-claim-control-number'
);

/**
 * 270/271 Trace Number (TRN02). Used to correlate an eligibility request with its response.
 */
export const STEDI_X12_TRN_TRACE_NUMBER_SYSTEM = ottehrIdentifierSystem('stedi-x12-trn-trace-number');

/**
 * Stedi-assigned correlation id (`claimReference.correlationId`) returned by the
 * professional-claims submission API. Useful for cross-referencing with the Stedi portal.
 */
export const STEDI_CORRELATION_ID_SYSTEM = ottehrIdentifierSystem('stedi-correlation-id');

/**
 * Ordered list of every Stedi/X12 identifier-system URL defined above. Useful for
 * iterating, validating, or building search-param expressions.
 */
export const STEDI_X12_IDENTIFIER_SYSTEMS = [
  STEDI_X12_ISA13_INTERCHANGE_CONTROL_NUMBER_SYSTEM,
  STEDI_X12_GS06_GROUP_CONTROL_NUMBER_SYSTEM,
  STEDI_X12_ST02_837P_TRANSACTION_CONTROL_NUMBER_SYSTEM,
  STEDI_X12_ST02_999_TRANSACTION_CONTROL_NUMBER_SYSTEM,
  STEDI_X12_ST02_277_TRANSACTION_CONTROL_NUMBER_SYSTEM,
  STEDI_X12_ST02_835_TRANSACTION_CONTROL_NUMBER_SYSTEM,
  STEDI_X12_ST02_270_TRANSACTION_CONTROL_NUMBER_SYSTEM,
  STEDI_X12_ST02_271_TRANSACTION_CONTROL_NUMBER_SYSTEM,
  STEDI_X12_CLM01_PATIENT_CONTROL_NUMBER_SYSTEM,
  STEDI_X12_PAYER_CLAIM_CONTROL_NUMBER_SYSTEM,
  STEDI_X12_TRN_TRACE_NUMBER_SYSTEM,
  STEDI_CORRELATION_ID_SYSTEM,
] as const;

/**
 * Code system URL for the Stedi-claim Task lifecycle, used as
 * `Task.businessStatus.coding[].system`.
 */
export const STEDI_CLAIM_TASK_STATUS_SYSTEM = ottehrCodeSystemUrl('stedi-claim-task-status');

/**
 * Lifecycle codes for the Stedi-claim Task `businessStatus`.
 *
 * Happy-path flow:
 *   awaiting-999  →  awaiting-277  →  awaiting-835  →  paid
 *
 * Non-happy terminal states:
 *   denied    — payer adjudicated and denied the claim (835 with zero payment).
 *   rejected  — claim never reached adjudication (failed 999 or 277CA reject).
 */
export const STEDI_CLAIM_TASK_STATUS_CODE = {
  awaiting999: 'awaiting-999',
  awaiting277: 'awaiting-277',
  awaiting835: 'awaiting-835',
  paid: 'paid',
  denied: 'denied',
  rejected: 'rejected',
} as const;

export type StediClaimTaskStatusCode = (typeof STEDI_CLAIM_TASK_STATUS_CODE)[keyof typeof STEDI_CLAIM_TASK_STATUS_CODE];

export const STEDI_CLAIM_TASK_STATUS_CODES: readonly StediClaimTaskStatusCode[] =
  Object.values(STEDI_CLAIM_TASK_STATUS_CODE);
