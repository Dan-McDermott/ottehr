import { Organization } from 'fhir/r4b';
import { describe, expect, it } from 'vitest';

const {
  EMPLOYER_NOTES_EXTENSION_URL,
  buildEmployerType,
  isEmployerOrganization,
  normalizeAddress,
  normalizeEmployerNotesExtension,
  normalizeIdentifier,
  normalizeTelecom,
} = await import('../../src/rcm/employers/helpers');

describe('RCM employer helpers', () => {
  it('detects employer organizations by type code', () => {
    const employerOrg = {
      resourceType: 'Organization',
      type: buildEmployerType('Occupational Medicine'),
    } as Organization;

    const nonEmployerOrg = {
      resourceType: 'Organization',
      type: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/organization-type', code: 'prov' }] }],
    } as Organization;

    expect(isEmployerOrganization(employerOrg)).toBe(true);
    expect(isEmployerOrganization(nonEmployerOrg)).toBe(false);
  });

  it('normalizes identifier/address/telecom and notes extension', () => {
    const identifier = normalizeIdentifier({ value: 'payer-1' });
    const identifierWithSystem = normalizeIdentifier({ system: 'urn:example', value: 'payer-2' });
    const address = normalizeAddress({
      line: [' 100 Main St ', 'Suite 2'],
      city: 'Austin',
      state: 'TX',
      postalCode: '73301',
    });
    const telecom = normalizeTelecom({ phone: '123', fax: '456', email: 'test@example.com' });

    expect(identifier?.[0].value).toBe('payer-1');
    expect(identifier?.[0].system).toBeUndefined();
    expect(identifierWithSystem?.[0].system).toBe('urn:example');
    expect(address?.[0].city).toBe('Austin');
    expect(telecom).toHaveLength(3);

    const extension = normalizeEmployerNotesExtension('new notes', [{ url: 'other-url', valueString: 'keep' }]);
    expect(extension).toContainEqual({ url: 'other-url', valueString: 'keep' });
    expect(extension).toContainEqual({ url: EMPLOYER_NOTES_EXTENSION_URL, valueString: 'new notes' });
  });
});
