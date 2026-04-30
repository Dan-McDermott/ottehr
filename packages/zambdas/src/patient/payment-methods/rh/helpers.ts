import Oystehr from '@oystehr/sdk';
import { Operation } from 'fast-json-patch';
import { Account, Identifier, Organization, Patient } from 'fhir/r4b';
import { getSecret, Secrets, SecretsKeys } from 'utils';
import { RH_PAYMENT_TOKEN_ID_SYSTEM, RHClinicEntity } from '../../../shared/rectangleHealth';

// ---------------------------------------------------------------------------
// Extension URLs used to stash card metadata returned by RH alongside the
// opaque payment_token. RH v3 responses surface card_brand / last_four-style
// fields when the SDK includes them; we store whatever we get so the list
// endpoint can render the saved-card UI without a round-trip to RH.
// ---------------------------------------------------------------------------

export const RH_PAYMENT_TOKEN_BRAND_EXTENSION_URL = 'https://afterours.com/extensions/rh-payment-token-brand';
export const RH_PAYMENT_TOKEN_LAST4_EXTENSION_URL = 'https://afterours.com/extensions/rh-payment-token-last4';

// ---------------------------------------------------------------------------
// FHIR identifier-system helpers for RH Card-on-File payment tokens
// ---------------------------------------------------------------------------

export const RH_PAYMENT_TOKEN_USE_DEFAULT: Identifier['use'] = 'official';
export const RH_PAYMENT_TOKEN_USE_NON_DEFAULT: Identifier['use'] = 'secondary';

export const isRectangleHealthPaymentTokenIdentifier = (identifier: Identifier): boolean =>
  identifier.system === RH_PAYMENT_TOKEN_ID_SYSTEM;

export const getRectangleHealthPaymentTokenIdentifiers = (account: Account | undefined): Identifier[] =>
  (account?.identifier ?? []).filter(isRectangleHealthPaymentTokenIdentifier);

export const isDefaultRectangleHealthPaymentTokenIdentifier = (identifier: Identifier): boolean =>
  identifier.use === RH_PAYMENT_TOKEN_USE_DEFAULT;

export const getBrandFromIdentifier = (identifier: Identifier): string | undefined =>
  identifier.extension?.find((e) => e.url === RH_PAYMENT_TOKEN_BRAND_EXTENSION_URL)?.valueString;

export const getLast4FromIdentifier = (identifier: Identifier): string | undefined =>
  identifier.extension?.find((e) => e.url === RH_PAYMENT_TOKEN_LAST4_EXTENSION_URL)?.valueString;

export const buildRectangleHealthPaymentTokenIdentifier = (params: {
  paymentToken: string;
  isDefault: boolean;
  brand?: string;
  last4?: string;
}): Identifier => {
  const extension = [
    params.brand ? { url: RH_PAYMENT_TOKEN_BRAND_EXTENSION_URL, valueString: params.brand } : undefined,
    params.last4 ? { url: RH_PAYMENT_TOKEN_LAST4_EXTENSION_URL, valueString: params.last4 } : undefined,
  ].filter((e): e is { url: string; valueString: string } => e !== undefined);
  const identifier: Identifier = {
    system: RH_PAYMENT_TOKEN_ID_SYSTEM,
    value: params.paymentToken,
    use: params.isDefault ? RH_PAYMENT_TOKEN_USE_DEFAULT : RH_PAYMENT_TOKEN_USE_NON_DEFAULT,
  };
  if (extension.length > 0) identifier.extension = extension;
  return identifier;
};

// ---------------------------------------------------------------------------
// Patient -> Organization -> RHClinicEntity resolver (TEMPORARY)
//
// The canonical resolver for this lives in W1.4 (Merchant routing). Until
// that lands we use a minimal inline resolver that:
//   1. Looks up the Patient.
//   2. Reads Patient.managingOrganization (if any) and resolves the
//      Organization.
//   3. Picks the entity from the RH MAC code on the Organization (extension
//      below) or by matching the MAC against the configured per-entity MACs.
//   4. Falls back to "afterours" with a console warning if nothing else
//      resolves (single-entity sandbox default).
//
// TODO(W1.4): replace this with the shared Encounter/Location/Organization
// helpers that the merchant-routing track will introduce.
// ---------------------------------------------------------------------------

export const RH_MERCHANT_ACCOUNT_CODE_EXTENSION_URL = 'https://afterours.com/extensions/rh-merchant-account-code';

export const getMerchantAccountCodeFromOrganization = (organization: Organization | undefined): string | undefined => {
  const ext = organization?.extension?.find((e) => e.url === RH_MERCHANT_ACCOUNT_CODE_EXTENSION_URL);
  return ext?.valueString ?? ext?.valueCode;
};

export const resolveRHClinicEntityFromMerchantAccountCode = (
  mac: string | undefined,
  secrets: Secrets | null
): RHClinicEntity | undefined => {
  if (!mac) return undefined;
  const afterours = getSecret(SecretsKeys.RH_MAC_AFTEROURS, secrets);
  const spire = getSecret(SecretsKeys.RH_MAC_SPIRE, secrets);
  if (mac === afterours) return 'afterours';
  if (mac === spire) return 'spire';
  return undefined;
};

export const resolveRHClinicEntityForPatient = async (
  patientId: string,
  oystehr: Oystehr,
  secrets: Secrets | null
): Promise<RHClinicEntity> => {
  let patient: Patient | undefined;
  try {
    patient = await oystehr.fhir.get<Patient>({ resourceType: 'Patient', id: patientId });
  } catch (error) {
    console.warn('Failed to read Patient ' + patientId + ' for RH entity resolution', error);
  }

  const orgRef = patient?.managingOrganization?.reference;
  if (orgRef && orgRef.startsWith('Organization/')) {
    const orgId = orgRef.split('/')[1];
    try {
      const organization = await oystehr.fhir.get<Organization>({ resourceType: 'Organization', id: orgId });
      const mac = getMerchantAccountCodeFromOrganization(organization);
      const entity = resolveRHClinicEntityFromMerchantAccountCode(mac, secrets);
      if (entity) return entity;
      console.warn(
        'Organization/' +
          orgId +
          ' did not resolve to a known RH entity (mac=' +
          (mac ?? 'none') +
          '); defaulting to afterours.'
      );
    } catch (error) {
      console.warn('Failed to read Organization/' + orgId + ' for RH entity resolution', error);
    }
  } else {
    console.warn('Patient/' + patientId + ' has no managingOrganization; defaulting RH entity to afterours.');
  }
  return 'afterours';
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

export const setDefaultPaymentTokenIdentifiers = (
  identifiers: Identifier[],
  defaultPaymentMethodId: string | undefined
): Identifier[] =>
  identifiers.map((identifier) => {
    if (!isRectangleHealthPaymentTokenIdentifier(identifier)) return identifier;
    if (defaultPaymentMethodId && identifier.value === defaultPaymentMethodId) {
      return { ...identifier, use: RH_PAYMENT_TOKEN_USE_DEFAULT };
    }
    return { ...identifier, use: RH_PAYMENT_TOKEN_USE_NON_DEFAULT };
  });
