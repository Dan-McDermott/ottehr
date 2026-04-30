import { Encounter, Location, Organization, Patient } from 'fhir/r4b';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getEntityForLocation,
  getEntityForOrganization,
  getEntityForPatient,
  getMacForOrganization,
  PatientEntityUnresolvableError,
  RH_MAC_AFTEROURS,
  RH_MAC_SPIRE,
  RH_MERCHANT_ACCOUNT_CODE_SYSTEM,
} from './payments';

const orgWithMac = (id: string, mac: string): Organization => ({
  resourceType: 'Organization',
  id,
  name: id,
  identifier: [{ system: RH_MERCHANT_ACCOUNT_CODE_SYSTEM, value: mac }],
});

const orgWithoutMac = (id: string): Organization => ({
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

describe('getMacForOrganization', () => {
  it('returns the MAC value when an identifier with the RH system is present', () => {
    expect(getMacForOrganization(orgWithMac('o1', RH_MAC_AFTEROURS))).toBe(RH_MAC_AFTEROURS);
  });

  it('returns undefined when no RH-system identifier is present', () => {
    expect(getMacForOrganization(orgWithoutMac('o1'))).toBeUndefined();
  });

  it('returns undefined when only an unrelated identifier system is present', () => {
    expect(
      getMacForOrganization({
        resourceType: 'Organization',
        id: 'o1',
        identifier: [{ system: 'https://example.com/other', value: 'X' }],
      })
    ).toBeUndefined();
  });
});

describe('getEntityForOrganization', () => {
  it('maps the AfterOurs MAC to "afterours"', () => {
    expect(getEntityForOrganization(orgWithMac('o1', RH_MAC_AFTEROURS))).toBe('afterours');
  });

  it('maps the Spire MAC to "spire"', () => {
    expect(getEntityForOrganization(orgWithMac('o2', RH_MAC_SPIRE))).toBe('spire');
  });

  it('returns undefined for an unknown MAC', () => {
    expect(getEntityForOrganization(orgWithMac('o3', '99999999'))).toBeUndefined();
  });

  it('returns undefined when no MAC identifier is present', () => {
    expect(getEntityForOrganization(orgWithoutMac('o4'))).toBeUndefined();
  });
});

describe('getEntityForLocation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves entity via managingOrganization', async () => {
    const { oystehr, getMock } = makeOystehr(
      () => makeBundle([]),
      ({ id }) => orgWithMac(id, RH_MAC_AFTEROURS)
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

  it('throws when the managingOrganization is missing the MAC identifier', async () => {
    const { oystehr } = makeOystehr(
      () => makeBundle([]),
      ({ id }) => orgWithoutMac(id)
    );
    await expect(getEntityForLocation(locationWithOrg('loc1', 'org-x'), oystehr as never)).rejects.toThrow(
      /no MAC identifier/
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
      ({ id }) => orgWithMac(id, RH_MAC_AFTEROURS)
    );
    const patient: Patient = { resourceType: 'Patient', id: 'pat1' };
    expect(await getEntityForPatient(patient, oystehr as never)).toBe('afterours');
    expect(searchMock).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'Encounter' }));
    expect(getMock).toHaveBeenCalledWith({ resourceType: 'Organization', id: 'org-ao' });
  });

  it('falls back to managingOrganization when no Encounter has a Location', async () => {
    const { oystehr } = makeOystehr(
      () => makeBundle([]),
      ({ id }) => orgWithMac(id, RH_MAC_SPIRE)
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
      ({ id }) => orgWithMac(id, RH_MAC_AFTEROURS)
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

  it('throws PatientEntityUnresolvableError when candidates exist but none carry a MAC', async () => {
    const { oystehr } = makeOystehr(
      () => makeBundle([]),
      ({ id }) => orgWithoutMac(id)
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
      'org-spire': orgWithMac('org-spire', RH_MAC_SPIRE),
      'org-ao': orgWithMac('org-ao', RH_MAC_AFTEROURS),
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
