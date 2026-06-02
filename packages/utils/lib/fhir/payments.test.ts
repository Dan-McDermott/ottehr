import { Encounter, Location, Organization, Patient } from 'fhir/r4b';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FINIX_MERCHANT_ENTITY_SYSTEM,
  getEntityCodeForOrganization,
  getEntityForLocation,
  getEntityForOrganization,
  getEntityForPatient,
  PatientEntityUnresolvableError,
} from './payments';

const orgWithEntity = (id: string, entity: string): Organization => ({
  resourceType: 'Organization',
  id,
  name: id,
  identifier: [{ system: FINIX_MERCHANT_ENTITY_SYSTEM, value: entity }],
});

const orgWithoutEntity = (id: string): Organization => ({
  resourceType: 'Organization',
  id,
  name: id,
});

const locationWithOrg = (id: string, orgId: string | undefined): Location => ({
  resourceType: 'Location',
  id,
  managingOrganization: orgId ? { reference: `Organization/${orgId}` } : undefined,
});

const makeBundle = (resources: (Encounter | Location)[]): { unbundle: () => (Encounter | Location)[] } => ({
  unbundle: () => resources,
});

const makeOystehr = (
  searchHandler: (params: unknown) => unknown,
  getHandler: (params: { resourceType: string; id: string }) => unknown
): { oystehr: unknown; getMock: ReturnType<typeof vi.fn>; searchMock: ReturnType<typeof vi.fn> } => {
  const searchMock = vi.fn(searchHandler);
  const getMock = vi.fn(getHandler);
  return { oystehr: { fhir: { search: searchMock, get: getMock } }, getMock, searchMock };
};

describe('getEntityCodeForOrganization', () => {
  it('returns the entity slug when an identifier with the Finix system is present', () => {
    expect(getEntityCodeForOrganization(orgWithEntity('o1', 'afterours'))).toBe('afterours');
  });

  it('returns undefined when no Finix-system identifier is present', () => {
    expect(getEntityCodeForOrganization(orgWithoutEntity('o1'))).toBeUndefined();
  });

  it('returns undefined when only an unrelated identifier system is present', () => {
    expect(
      getEntityCodeForOrganization({
        resourceType: 'Organization',
        id: 'o1',
        identifier: [{ system: 'https://example.com/other', value: 'X' }],
      })
    ).toBeUndefined();
  });
});

describe('getEntityForOrganization', () => {
  it('maps the "afterours" slug to "afterours"', () => {
    expect(getEntityForOrganization(orgWithEntity('o1', 'afterours'))).toBe('afterours');
  });

  it('maps the "spire" slug to "spire"', () => {
    expect(getEntityForOrganization(orgWithEntity('o2', 'spire'))).toBe('spire');
  });

  it('returns undefined for an unknown slug', () => {
    expect(getEntityForOrganization(orgWithEntity('o3', 'someone-else'))).toBeUndefined();
  });

  it('returns undefined when no entity identifier is present', () => {
    expect(getEntityForOrganization(orgWithoutEntity('o4'))).toBeUndefined();
  });
});

describe('getEntityForLocation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves entity via managingOrganization', async () => {
    const { oystehr, getMock } = makeOystehr(
      () => makeBundle([]),
      ({ id }) => orgWithEntity(id, 'afterours')
    );
    expect(await getEntityForLocation(locationWithOrg('loc1', 'org-ao'), oystehr as never)).toBe('afterours');
    expect(getMock).toHaveBeenCalledWith({ resourceType: 'Organization', id: 'org-ao' });
  });

  it('throws when Location has no managingOrganization', async () => {
    const { oystehr } = makeOystehr(
      () => makeBundle([]),
      () => undefined
    );
    await expect(getEntityForLocation(locationWithOrg('loc1', undefined), oystehr as never)).rejects.toThrow(
      /missing managingOrganization/
    );
  });

  it('throws when the managingOrganization is missing the entity identifier', async () => {
    const { oystehr } = makeOystehr(
      () => makeBundle([]),
      ({ id }) => orgWithoutEntity(id)
    );
    await expect(getEntityForLocation(locationWithOrg('loc1', 'org-x'), oystehr as never)).rejects.toThrow(
      /no entity identifier/
    );
  });
});

describe('getEntityForPatient', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves via the most-recent Encounter Location managingOrganization', async () => {
    const encounter: Encounter = {
      resourceType: 'Encounter',
      id: 'enc1',
      status: 'finished',
      class: { code: 'AMB' },
      subject: { reference: 'Patient/pat1' },
      location: [{ location: { reference: 'Location/loc-ao' } }],
    };
    const location = locationWithOrg('loc-ao', 'org-ao');
    const { oystehr, searchMock, getMock } = makeOystehr(
      () => makeBundle([encounter, location]),
      ({ id }) => orgWithEntity(id, 'afterours')
    );
    const patient: Patient = { resourceType: 'Patient', id: 'pat1' };
    expect(await getEntityForPatient(patient, oystehr as never)).toBe('afterours');
    expect(searchMock).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'Encounter' }));
    expect(getMock).toHaveBeenCalledWith({ resourceType: 'Organization', id: 'org-ao' });
  });

  it('falls back to managingOrganization when no Encounter has a Location', async () => {
    const { oystehr } = makeOystehr(
      () => makeBundle([]),
      ({ id }) => orgWithEntity(id, 'spire')
    );
    const patient: Patient = {
      resourceType: 'Patient',
      id: 'pat1',
      managingOrganization: { reference: 'Organization/org-spire' },
    };
    expect(await getEntityForPatient(patient, oystehr as never)).toBe('spire');
  });
});

describe('getEntityForPatient — additional scenarios', () => {
  beforeEach(() => vi.clearAllMocks());

  it('falls back to generalPractitioner Organization when no Encounter and no managingOrganization', async () => {
    const { oystehr } = makeOystehr(
      () => makeBundle([]),
      ({ id }) => orgWithEntity(id, 'afterours')
    );
    const patient: Patient = {
      resourceType: 'Patient',
      id: 'pat1',
      generalPractitioner: [{ reference: 'Practitioner/p1' }, { reference: 'Organization/org-ao' }],
    };
    expect(await getEntityForPatient(patient, oystehr as never)).toBe('afterours');
  });

  it('throws PatientEntityUnresolvableError when no candidates exist', async () => {
    const { oystehr } = makeOystehr(
      () => makeBundle([]),
      () => undefined
    );
    const patient: Patient = { resourceType: 'Patient', id: 'pat1' };
    await expect(getEntityForPatient(patient, oystehr as never)).rejects.toBeInstanceOf(PatientEntityUnresolvableError);
  });

  it('throws PatientEntityUnresolvableError when candidates exist but none carry an entity slug', async () => {
    const { oystehr } = makeOystehr(
      () => makeBundle([]),
      ({ id }) => orgWithoutEntity(id)
    );
    const patient: Patient = {
      resourceType: 'Patient',
      id: 'pat1',
      managingOrganization: { reference: 'Organization/org-x' },
    };
    await expect(getEntityForPatient(patient, oystehr as never)).rejects.toBeInstanceOf(PatientEntityUnresolvableError);
  });

  it('prefers the recent Encounter Location org over managingOrganization', async () => {
    const encounter: Encounter = {
      resourceType: 'Encounter',
      id: 'enc1',
      status: 'finished',
      class: { code: 'AMB' },
      subject: { reference: 'Patient/pat1' },
      location: [{ location: { reference: 'Location/loc-spire' } }],
    };
    const location = locationWithOrg('loc-spire', 'org-spire');
    const orgs: Record<string, Organization> = {
      'org-spire': orgWithEntity('org-spire', 'spire'),
      'org-ao': orgWithEntity('org-ao', 'afterours'),
    };
    const { oystehr } = makeOystehr(
      () => makeBundle([encounter, location]),
      ({ id }) => orgs[id]
    );
    const patient: Patient = {
      resourceType: 'Patient',
      id: 'pat1',
      managingOrganization: { reference: 'Organization/org-ao' },
    };
    expect(await getEntityForPatient(patient, oystehr as never)).toBe('spire');
  });
});
