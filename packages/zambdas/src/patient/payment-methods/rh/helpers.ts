import Oystehr from '@oystehr/sdk';
import { Operation } from 'fast-json-patch';
import { Account, Identifier, Patient } from 'fhir/r4b';
import { ClinicEntity, getEntityForPatient, PatientEntityUnresolvableError } from 'utils';
import {
  FINIX_BUYER_IDENTITY_ID_SYSTEM,
  FINIX_PAYMENT_INSTRUMENT_ID_SYSTEM,
  FinixClient,
  makeBusinessIdentifierForFinixBuyerIdentity,
} from '../../../shared/finix';

// ---------------------------------------------------------------------------
// Extension URLs used to stash card metadata returned by Finix alongside the
// Payment Instrument ID, so the list endpoint can render the saved-card UI
// without a round-trip to Finix.
// ---------------------------------------------------------------------------

export const FINIX_PAYMENT_INSTRUMENT_BRAND_EXTENSION_URL =
  'https://afterours.com/extensions/finix-payment-instrument-brand';
export const FINIX_PAYMENT_INSTRUMENT_LAST4_EXTENSION_URL =
  'https://afterours.com/extensions/finix-payment-instrument-last4';

// ---------------------------------------------------------------------------
// FHIR identifier-system helpers for Finix Payment Instruments (saved cards)
// ---------------------------------------------------------------------------

export const FINIX_PAYMENT_INSTRUMENT_USE_DEFAULT: Identifier['use'] = 'official';
export const FINIX_PAYMENT_INSTRUMENT_USE_NON_DEFAULT: Identifier['use'] = 'secondary';

export const isFinixPaymentInstrumentIdentifier = (identifier: Identifier): boolean =>
  identifier.system === FINIX_PAYMENT_INSTRUMENT_ID_SYSTEM;

export const getFinixPaymentInstrumentIdentifiers = (account: Account | undefined): Identifier[] =>
  (account?.identifier ?? []).filter(isFinixPaymentInstrumentIdentifier);

export const isDefaultFinixPaymentInstrumentIdentifier = (identifier: Identifier): boolean =>
  identifier.use === FINIX_PAYMENT_INSTRUMENT_USE_DEFAULT;

export const getBrandFromIdentifier = (identifier: Identifier): string | undefined =>
  identifier.extension?.find((e) => e.url === FINIX_PAYMENT_INSTRUMENT_BRAND_EXTENSION_URL)?.valueString;

export const getLast4FromIdentifier = (identifier: Identifier): string | undefined =>
  identifier.extension?.find((e) => e.url === FINIX_PAYMENT_INSTRUMENT_LAST4_EXTENSION_URL)?.valueString;

export const buildFinixPaymentInstrumentIdentifier = (params: {
  paymentInstrumentId: string;
  isDefault: boolean;
  brand?: string;
  last4?: string;
}): Identifier => {
  const extension = [
    params.brand ? { url: FINIX_PAYMENT_INSTRUMENT_BRAND_EXTENSION_URL, valueString: params.brand } : undefined,
    params.last4 ? { url: FINIX_PAYMENT_INSTRUMENT_LAST4_EXTENSION_URL, valueString: params.last4 } : undefined,
  ].filter((e): e is { url: string; valueString: string } => e !== undefined);
  const identifier: Identifier = {
    system: FINIX_PAYMENT_INSTRUMENT_ID_SYSTEM,
    value: params.paymentInstrumentId,
    use: params.isDefault ? FINIX_PAYMENT_INSTRUMENT_USE_DEFAULT : FINIX_PAYMENT_INSTRUMENT_USE_NON_DEFAULT,
  };
  if (extension.length > 0) identifier.extension = extension;
  return identifier;
};

// ---------------------------------------------------------------------------
// Clinic-entity resolution for a Patient
// ---------------------------------------------------------------------------
// Uses the canonical Encounter/Location/Organization resolver from `utils`,
// falling back to "afterours" with a warning when the patient's Organizations
// are not yet tagged with an entity slug (single-entity sandbox default).

export const resolveClinicEntityForPatient = async (patientId: string, oystehr: Oystehr): Promise<ClinicEntity> => {
  let patient: Patient | undefined;
  try {
    patient = await oystehr.fhir.get<Patient>({ resourceType: 'Patient', id: patientId });
  } catch (error) {
    console.warn(`Failed to read Patient/${patientId} for Finix entity resolution`, error);
  }
  if (patient) {
    try {
      return await getEntityForPatient(patient, oystehr);
    } catch (error) {
      if (error instanceof PatientEntityUnresolvableError) {
        console.warn(`${error.message}; defaulting Finix entity to afterours.`);
      } else {
        console.warn(
          `Unexpected error resolving Finix entity for Patient/${patientId}; defaulting to afterours.`,
          error
        );
      }
    }
  }
  return 'afterours';
};

// ---------------------------------------------------------------------------
// Finix buyer Identity (one per patient, reused across cards and charges)
// ---------------------------------------------------------------------------

export const getStoredBuyerIdentityId = (account: Account | undefined): string | undefined =>
  (account?.identifier ?? []).find((id) => id.system === FINIX_BUYER_IDENTITY_ID_SYSTEM)?.value;

/**
 * Returns the patient's Finix buyer Identity ID, creating (and persisting on the
 * Account) one if none exists yet. The Identity owns the patient's Payment
 * Instruments and is reused for one-time and saved-card charges.
 */
export const getOrCreateBuyerIdentityId = async (params: {
  account: Account;
  patient: Patient | undefined;
  finixClient: FinixClient;
  oystehr: Oystehr;
}): Promise<string> => {
  const { account, patient, finixClient, oystehr } = params;
  const existing = getStoredBuyerIdentityId(account);
  if (existing) return existing;

  const created = await finixClient.createBuyerIdentity({
    firstName: patient?.name?.[0]?.given?.[0],
    lastName: patient?.name?.[0]?.family,
    email: patient?.telecom?.find((t) => t.system === 'email')?.value,
    phone: patient?.telecom?.find((t) => t.system === 'phone')?.value,
  });
  if (!created.id) {
    throw new Error('Finix did not return an Identity id when creating buyer Identity');
  }

  if (!account.id) throw new Error('Account id is required to persist buyer Identity');
  const nextIdentifiers = [...(account.identifier ?? []), makeBusinessIdentifierForFinixBuyerIdentity(created.id)];
  await oystehr.fhir.patch<Account>({
    id: account.id,
    resourceType: 'Account',
    operations: buildAccountIdentifierPatchOperations(account, nextIdentifiers),
  });
  return created.id;
};

// ---------------------------------------------------------------------------
// Patch-operation builders for Account.identifier shuffles
// ---------------------------------------------------------------------------

export const buildAccountIdentifierPatchOperations = (account: Account, identifiers: Identifier[]): Operation[] => {
  if (account.identifier === undefined) {
    return [{ op: 'add', path: '/identifier', value: identifiers }];
  }
  return [{ op: 'replace', path: '/identifier', value: identifiers }];
};

export const setDefaultPaymentInstrumentIdentifiers = (
  identifiers: Identifier[],
  defaultPaymentMethodId: string | undefined
): Identifier[] =>
  identifiers.map((identifier) => {
    if (!isFinixPaymentInstrumentIdentifier(identifier)) return identifier;
    if (defaultPaymentMethodId && identifier.value === defaultPaymentMethodId) {
      return { ...identifier, use: FINIX_PAYMENT_INSTRUMENT_USE_DEFAULT };
    }
    return { ...identifier, use: FINIX_PAYMENT_INSTRUMENT_USE_NON_DEFAULT };
  });
