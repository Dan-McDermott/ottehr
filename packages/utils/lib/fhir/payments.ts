import Oystehr from '@oystehr/sdk';
import { Encounter, Location, Organization, Patient, Reference } from 'fhir/r4b';

// ---------------------------------------------------------------------------
// Finix — merchant routing (Organization → entity)
// ---------------------------------------------------------------------------
//
// Topology (locked):
//   AfterOurs, Inc.       → entity "afterours" → 4 urgent-care clinics
//   Spire Health Pathways → entity "spire"     → 1 functional-medicine clinic
//
// Each legal-entity Organization carries a single Identifier with the system
// below whose value is the stable, environment-independent entity slug; each
// clinic Location's `managingOrganization` references its parent. The slug then
// maps to the per-entity Finix Application/Merchant secrets (see finix.ts).
//
// The slug is deliberately NOT the Finix Merchant ID: Merchant IDs differ
// between Sandbox and Live, so storing the slug keeps FHIR data portable across
// environments.

export type ClinicEntity = 'afterours' | 'spire';

export const CLINIC_ENTITIES: ClinicEntity[] = ['afterours', 'spire'];

export const isClinicEntity = (value: string | undefined): value is ClinicEntity =>
  value === 'afterours' || value === 'spire';

export const FINIX_MERCHANT_ENTITY_SYSTEM = 'https://fhir.oystehr.com/PaymentIdSystem/finix/merchant-entity';

export class PatientEntityUnresolvableError extends Error {
  patientId: string | undefined;
  reason: string;

  constructor(patientId: string | undefined, reason: string) {
    super(`Cannot resolve Finix entity for Patient/${patientId ?? '<unknown>'}: ${reason}`);
    this.name = 'PatientEntityUnresolvableError';
    this.patientId = patientId;
    this.reason = reason;
  }
}

export const getEntityCodeForOrganization = (org: Organization): string | undefined => {
  return org.identifier?.find((ident) => ident.system === FINIX_MERCHANT_ENTITY_SYSTEM)?.value;
};

export const getEntityForOrganization = (org: Organization): ClinicEntity | undefined => {
  const code = getEntityCodeForOrganization(org);
  return isClinicEntity(code) ? code : undefined;
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

export const getEntityForLocation = async (loc: Location, oystehr: Oystehr): Promise<ClinicEntity> => {
  const orgId = referenceId(loc.managingOrganization, 'Organization');
  if (!orgId) {
    throw new Error(`Cannot resolve Finix entity for Location/${loc.id ?? '<unknown>'}: missing managingOrganization`);
  }
  const org = await fetchOrganization(orgId, oystehr);
  if (!org) {
    throw new Error(
      `Cannot resolve Finix entity for Location/${
        loc.id ?? '<unknown>'
      }: managingOrganization Organization/${orgId} not found`
    );
  }
  const entity = getEntityForOrganization(org);
  if (!entity) {
    throw new Error(
      `Cannot resolve Finix entity for Location/${
        loc.id ?? '<unknown>'
      }: managingOrganization Organization/${orgId} has no entity identifier (system=${FINIX_MERCHANT_ENTITY_SYSTEM})`
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

export const getEntityForPatient = async (pat: Patient, oystehr: Oystehr): Promise<ClinicEntity> => {
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
    )}] carry an entity identifier (system=${FINIX_MERCHANT_ENTITY_SYSTEM})`
  );
};
