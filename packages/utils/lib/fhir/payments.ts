import Oystehr from '@oystehr/sdk';
import { Encounter, Location, Organization, Patient, Reference } from 'fhir/r4b';
import {
  SCHEDULE_OWNER_STRIPE_ACCOUNT_EXTENSION_URL,
  SCHEDULE_OWNER_STRIPE_TERMINAL_LOCATION_ID_EXTENSION_URL,
} from './constants';
import { getScheduleOwnerFromAppointmentOrEncounter } from './helpers';
// Returns undefined if there is no stripe account registered on the schedule owner
export const getStripeAccountForAppointmentOrEncounter = async (
  input: { appointmentId?: string; encounterId?: string },
  oystehr: Oystehr
): Promise<string | undefined> => {
  const scheduleOwner = await getScheduleOwnerFromAppointmentOrEncounter(input, oystehr);

  return scheduleOwner.extension?.find((ext) => {
    return ext.url === SCHEDULE_OWNER_STRIPE_ACCOUNT_EXTENSION_URL;
  })?.valueString;
};

// Returns undefined if there is no stripe terminal location id registered on the schedule owner
export const getStripeTerminalLocationIdForAppointmentOrEncounter = async (
  input: { appointmentId?: string; encounterId?: string },
  oystehr: Oystehr
): Promise<string | undefined> => {
  const scheduleOwner = await getScheduleOwnerFromAppointmentOrEncounter(input, oystehr);

  return scheduleOwner.extension?.find((ext) => {
    return ext.url === SCHEDULE_OWNER_STRIPE_TERMINAL_LOCATION_ID_EXTENSION_URL;
  })?.valueString;
};

// ---------------------------------------------------------------------------
// Rectangle Health — merchant routing (Organization → MAC → entity)
// ---------------------------------------------------------------------------
//
// Topology (locked):
//   AfterOurs, Inc.       → MAC 78072001 → 4 urgent-care clinics
//   Spire Health Pathways → MAC 78072002 → 1 functional-medicine clinic
//
// Each legal-entity Organization carries a single Identifier with the system
// below; each clinic Location's `managingOrganization` references its parent.

export type RHClinicEntity = 'afterours' | 'spire';

export const RH_MERCHANT_ACCOUNT_CODE_SYSTEM =
  'https://fhir.oystehr.com/PaymentIdSystem/rectangle-health/merchant-account-code';

export const RH_MAC_AFTEROURS = '78072001';
export const RH_MAC_SPIRE = '78072002';

export class PatientEntityUnresolvableError extends Error {
  patientId: string | undefined;
  reason: string;

  constructor(patientId: string | undefined, reason: string) {
    super(`Cannot resolve Rectangle Health entity for Patient/${patientId ?? '<unknown>'}: ${reason}`);
    this.name = 'PatientEntityUnresolvableError';
    this.patientId = patientId;
    this.reason = reason;
  }
}

export const getMacForOrganization = (org: Organization): string | undefined => {
  return org.identifier?.find((ident) => ident.system === RH_MERCHANT_ACCOUNT_CODE_SYSTEM)?.value;
};

export const getEntityForOrganization = (org: Organization): RHClinicEntity | undefined => {
  const mac = getMacForOrganization(org);
  if (mac === RH_MAC_AFTEROURS) return 'afterours';
  if (mac === RH_MAC_SPIRE) return 'spire';
  return undefined;
};

const referenceId = (ref: Reference | undefined, expectedType: string): string | undefined => {
  const raw = ref?.reference;
  if (!raw) return undefined;
  const prefix = `${expectedType}/`;
  if (raw.startsWith(prefix)) return raw.slice(prefix.length);
  return undefined;
};

const fetchOrganization = async (id: string, oystehr: Oystehr): Promise<Organization | undefined> => {
  try {
    return await oystehr.fhir.get<Organization>({ resourceType: 'Organization', id });
  } catch {
    return undefined;
  }
};

export const getEntityForLocation = async (loc: Location, oystehr: Oystehr): Promise<RHClinicEntity> => {
  const orgId = referenceId(loc.managingOrganization, 'Organization');
  if (!orgId) {
    throw new Error(
      `Cannot resolve Rectangle Health entity for Location/${loc.id ?? '<unknown>'}: missing managingOrganization`
    );
  }
  const org = await fetchOrganization(orgId, oystehr);
  if (!org) {
    throw new Error(
      `Cannot resolve Rectangle Health entity for Location/${
        loc.id ?? '<unknown>'
      }: managingOrganization Organization/${orgId} not found`
    );
  }
  const entity = getEntityForOrganization(org);
  if (!entity) {
    throw new Error(
      `Cannot resolve Rectangle Health entity for Location/${
        loc.id ?? '<unknown>'
      }: managingOrganization Organization/${orgId} has no MAC identifier (system=${RH_MERCHANT_ACCOUNT_CODE_SYSTEM})`
    );
  }
  return entity;
};

const findRecentEncounterLocationOrgId = async (patientId: string, oystehr: Oystehr): Promise<string | undefined> => {
  const bundle = await oystehr.fhir.search<Encounter | Location>({
    resourceType: 'Encounter',
    params: [
      { name: 'patient', value: `Patient/${patientId}` },
      { name: '_sort', value: '-date' },
      { name: '_count', value: 1 },
      { name: '_include', value: 'Encounter:location' },
    ],
  });
  const resources = bundle.unbundle();
  const encounter = resources.find((r): r is Encounter => r.resourceType === 'Encounter');
  if (!encounter) return undefined;
  const locationRef = encounter.location?.[0]?.location;
  const locationId = referenceId(locationRef, 'Location');
  if (!locationId) return undefined;
  const location = resources.find((r): r is Location => r.resourceType === 'Location' && r.id === locationId);
  return referenceId(location?.managingOrganization, 'Organization');
};

export const getEntityForPatient = async (pat: Patient, oystehr: Oystehr): Promise<RHClinicEntity> => {
  const candidates: string[] = [];

  if (pat.id) {
    const recentOrgId = await findRecentEncounterLocationOrgId(pat.id, oystehr);
    if (recentOrgId) candidates.push(recentOrgId);
  }

  const managingOrgId = referenceId(pat.managingOrganization, 'Organization');
  if (managingOrgId && !candidates.includes(managingOrgId)) candidates.push(managingOrgId);

  for (const gp of pat.generalPractitioner ?? []) {
    const gpOrgId = referenceId(gp, 'Organization');
    if (gpOrgId && !candidates.includes(gpOrgId)) candidates.push(gpOrgId);
  }

  if (candidates.length === 0) {
    throw new PatientEntityUnresolvableError(
      pat.id,
      'no recent Encounter Location, no managingOrganization, no Organization generalPractitioner'
    );
  }

  for (const orgId of candidates) {
    const org = await fetchOrganization(orgId, oystehr);
    if (!org) continue;
    const entity = getEntityForOrganization(org);
    if (entity) return entity;
  }

  throw new PatientEntityUnresolvableError(
    pat.id,
    `none of the candidate Organizations [${candidates.join(
      ', '
    )}] carry a MAC identifier (system=${RH_MERCHANT_ACCOUNT_CODE_SYSTEM})`
  );
};
