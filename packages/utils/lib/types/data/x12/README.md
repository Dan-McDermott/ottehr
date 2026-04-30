# Stedi X12 identifier model

This module defines the FHIR identifier-system URLs and Task-lifecycle code system that
Ottehr uses to persist X12/EDI control numbers exchanged with the Stedi healthcare APIs.

It is **pure additive metadata** — only constants, types, and small helpers. No FHIR
resources are read or written from here; callers attach these identifiers to their own
`Claim`, `ClaimResponse`, `PaymentReconciliation`, and `Task` resources.

## Identifier systems

| Constant                                                  | X12 segment                | Conventional FHIR home                                       |
| --------------------------------------------------------- | -------------------------- | ------------------------------------------------------------ |
| `STEDI_X12_ISA13_INTERCHANGE_CONTROL_NUMBER_SYSTEM`       | ISA13 envelope             | Whichever resource records the submission (Claim or Task)   |
| `STEDI_X12_GS06_GROUP_CONTROL_NUMBER_SYSTEM`              | GS06 functional group      | Same as ISA13                                                |
| `STEDI_X12_ST02_837P_TRANSACTION_CONTROL_NUMBER_SYSTEM`   | ST02 of an 837P submission | `Claim.identifier`                                           |
| `STEDI_X12_ST02_999_TRANSACTION_CONTROL_NUMBER_SYSTEM`    | ST02 of a 999 ack          | `Task.identifier` for the awaiting-999 step                  |
| `STEDI_X12_ST02_277_TRANSACTION_CONTROL_NUMBER_SYSTEM`    | ST02 of a 277CA            | `ClaimResponse.identifier` (one ClaimResponse per 277)       |
| `STEDI_X12_ST02_835_TRANSACTION_CONTROL_NUMBER_SYSTEM`    | ST02 of an 835 ERA         | Both `ClaimResponse.identifier` and `PaymentReconciliation.identifier` are reasonable; this module is agnostic |
| `STEDI_X12_ST02_270_TRANSACTION_CONTROL_NUMBER_SYSTEM`    | ST02 of a 270 inquiry      | `CoverageEligibilityRequest.identifier`                      |
| `STEDI_X12_ST02_271_TRANSACTION_CONTROL_NUMBER_SYSTEM`    | ST02 of a 271 response     | `CoverageEligibilityResponse.identifier`                     |
| `STEDI_X12_CLM01_PATIENT_CONTROL_NUMBER_SYSTEM`           | CLM01 patient control no.  | `Claim.identifier` (the primary correlation key)             |
| `STEDI_X12_PAYER_CLAIM_CONTROL_NUMBER_SYSTEM`             | 277CA REF02 (1K) / 835 CLP07 — payer ICN/DCN | `ClaimResponse.identifier`                |
| `STEDI_X12_TRN_TRACE_NUMBER_SYSTEM`                       | TRN02 (270/271)            | `CoverageEligibilityRequest`/`Response.identifier`           |
| `STEDI_CORRELATION_ID_SYSTEM`                             | `claimReference.correlationId` returned by Stedi | `Claim.identifier`                  |

`STEDI_X12_IDENTIFIER_SYSTEMS` is a frozen tuple of every URL above.

`STEDI_X12_KIND_TO_SYSTEM` (in `x12.types.ts`) maps the logical kind (`STEDI_X12_TRANSACTION_KIND.clm01`,
etc.) to its system URL. `kindForSystem` does the reverse lookup.

## Task lifecycle code system

`STEDI_CLAIM_TASK_STATUS_SYSTEM` is the system URL for `Task.businessStatus.coding[].system`.
Codes (see `STEDI_CLAIM_TASK_STATUS_CODE`):

```
awaiting-999  →  awaiting-277  →  awaiting-835  →  paid
                                                   denied      (terminal, payer adjudicated and denied)
                                                   rejected    (terminal, never reached adjudication — failed 999 or 277CA reject)
```

Use `stediClaimTaskStatusCoding(code)` to build the `Coding` value object.

## Helpers

All in `x12.helpers.ts`:

- `getStediTransactionIds(resource, kind?)` — read all (or one kind of) Stedi/X12 ids from a resource.
- `addStediTransactionId(resource, kind, value)` — append an identifier idempotently.
- `findClaimByCLM01(claims, clm01)` — locate the Claim whose CLM01 matches.
- `findClaimResponseByPayerICN(claimResponses, icn)` — locate the ClaimResponse by payer ICN/DCN.
- `kindForSystem(system)` — map a system URL back to its logical kind.
- `stediClaimTaskStatusCoding(code)` — build a Task.businessStatus Coding.
- Type guards: `isStediTransactionIdentifier`, `isStediX12TransactionKind`, `isStediX12IdentifierSystem`,
  `isStediClaimTaskStatusCode`.

## Modeling notes

- **Multiple 277s per claim.** Each 277CA arrives as its own ClaimResponse; the linkage to the
  original claim is the CLM01 (`Claim.request.identifier` →
  `ClaimResponse.request.identifier` plus the matching CLM01 identifier on each).
- **835 ID placement.** The 835 ST02 transaction control number can reasonably live on either
  `ClaimResponse.identifier` or `PaymentReconciliation.identifier` (or both). This module is
  agnostic: `addStediTransactionId` accepts any resource with an `identifier[]` array.
- **No new dependencies.** This module re-uses `ottehrIdentifierSystem` /
  `ottehrCodeSystemUrl` from `lib/fhir/systemUrls.ts` so the URL prefix is consistent with the
  rest of the codebase (`https://fhir.ottehr.com/Identifier/…`).
