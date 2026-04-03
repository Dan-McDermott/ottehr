import { describe, expect, test } from 'vitest';
import { validateRequestParameters } from '../../../src/ehr/get-appointments/validateRequestParameters';
import { createMockZambdaInput } from './helpers';

describe('get-appointments - validateRequestParameters', () => {
  const validBody = {
    searchDate: '2024-01-15',
    locationID: 'loc-123',
    visitType: ['in-person'],
  };

  test('should return validated params with locationID', () => {
    const input = createMockZambdaInput(validBody);
    const result = validateRequestParameters(input);

    expect(result.searchDate).toBe('2024-01-15');
    expect(result.locationID).toBe('loc-123');
    expect(result.visitType).toEqual(['in-person']);
    expect(result.supervisorApprovalEnabled).toBe(false);
    expect(result.secrets).toBeNull();
  });

  test('should accept providerIDs instead of locationID', () => {
    const input = createMockZambdaInput({
      searchDate: '2024-01-15',
      providerIDs: ['prov-1', 'prov-2'],
      visitType: ['telemed'],
    });
    const result = validateRequestParameters(input);

    expect(result.providerIDs).toEqual(['prov-1', 'prov-2']);
    expect(result.locationID).toBeUndefined();
  });

  test('should accept serviceCategories instead of locationID', () => {
    const input = createMockZambdaInput({
      searchDate: '2024-01-15',
      serviceCategories: ['urgent-care'],
      visitType: ['in-person'],
    });
    const result = validateRequestParameters(input);

    expect(result.serviceCategories).toEqual(['urgent-care']);
  });

  test('should accept supervisorApprovalEnabled as true', () => {
    const input = createMockZambdaInput({ ...validBody, supervisorApprovalEnabled: true });
    const result = validateRequestParameters(input);

    expect(result.supervisorApprovalEnabled).toBe(true);
  });

  test('should default supervisorApprovalEnabled to false when not boolean', () => {
    const input = createMockZambdaInput({ ...validBody, supervisorApprovalEnabled: 'yes' });
    const result = validateRequestParameters(input);

    expect(result.supervisorApprovalEnabled).toBe(false);
  });

  test('should throw when body is missing', () => {
    const input = createMockZambdaInput(null, { body: '' });
    expect(() => validateRequestParameters(input)).toThrow();
  });

  test('should throw when body is invalid JSON', () => {
    const input = createMockZambdaInput(null, { body: 'not-json' });
    expect(() => validateRequestParameters(input)).toThrow();
  });

  test('should throw when searchDate is missing', () => {
    const { searchDate: _searchDate, ...rest } = validBody;
    const input = createMockZambdaInput(rest);
    expect(() => validateRequestParameters(input)).toThrow('searchDate');
  });

  test('should throw when searchDate is not a string', () => {
    const input = createMockZambdaInput({ ...validBody, searchDate: 12345 });
    expect(() => validateRequestParameters(input)).toThrow('searchDate');
  });

  test('should throw when visitType is missing', () => {
    const { visitType: _visitType, ...rest } = validBody;
    const input = createMockZambdaInput(rest);
    expect(() => validateRequestParameters(input)).toThrow('visitType');
  });

  test('should throw when visitType is not an array', () => {
    const input = createMockZambdaInput({ ...validBody, visitType: 'in-person' });
    expect(() => validateRequestParameters(input)).toThrow('visitType');
  });

  test('should throw when visitType contains non-strings', () => {
    const input = createMockZambdaInput({ ...validBody, visitType: [123] });
    expect(() => validateRequestParameters(input)).toThrow('visitType');
  });

  test('should throw when none of locationID, providerIDs, or serviceCategories is provided', () => {
    const input = createMockZambdaInput({
      searchDate: '2024-01-15',
      visitType: ['in-person'],
    });
    expect(() => validateRequestParameters(input)).toThrow();
  });

  test('should throw when locationID is not a string', () => {
    const input = createMockZambdaInput({ ...validBody, locationID: 123 });
    expect(() => validateRequestParameters(input)).toThrow('locationID');
  });

  test('should throw when providerIDs is not an array', () => {
    const input = createMockZambdaInput({
      searchDate: '2024-01-15',
      providerIDs: 'prov-1',
      visitType: ['in-person'],
    });
    expect(() => validateRequestParameters(input)).toThrow('providerIDs');
  });

  test('should throw when providerIDs contains non-strings', () => {
    const input = createMockZambdaInput({
      searchDate: '2024-01-15',
      providerIDs: [123],
      visitType: ['in-person'],
    });
    expect(() => validateRequestParameters(input)).toThrow('providerIDs');
  });

  test('should throw when serviceCategories is not an array', () => {
    const input = createMockZambdaInput({
      searchDate: '2024-01-15',
      serviceCategories: 'urgent',
      visitType: ['in-person'],
    });
    expect(() => validateRequestParameters(input)).toThrow('serviceCategories');
  });
});
