import type { APIGatewayProxyResult } from 'aws-lambda';
import { Organization } from 'fhir/r4b';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ZambdaInput } from '../../src/shared/types/common';

function makeInput(body: Record<string, unknown>): ZambdaInput {
  return { headers: null, body: JSON.stringify(body), secrets: null };
}

const mockOystehrClient = {
  fhir: {
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    search: vi.fn(),
  },
};

vi.mock('../../src/shared', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    checkOrCreateM2MClientToken: vi.fn().mockResolvedValue('mock-token'),
    createOystehrClient: vi.fn(() => mockOystehrClient),
    wrapHandler: (_name: string, fn: (...args: unknown[]) => unknown) => fn,
  };
});

type ZambdaHandler = (input: ZambdaInput) => Promise<APIGatewayProxyResult>;

let createEmployerHandler!: ZambdaHandler;
let updateEmployerHandler!: ZambdaHandler;
let listEmployersHandler!: ZambdaHandler;

const employerType = [
  {
    text: 'Occupational Medicine',
    coding: [
      {
        system: 'http://terminology.hl7.org/CodeSystem/organization-type',
        code: 'occupational-medicine-employer',
      },
    ],
  },
];

const EMPLOYER_ID = '00000000-0000-0000-0000-000000000001';

function makeEmployer(overrides?: Partial<Organization>): Organization {
  return {
    resourceType: 'Organization',
    id: EMPLOYER_ID,
    name: 'Wayne Enterprises',
    active: true,
    type: employerType,
    address: [{ line: ['100 Main'], city: 'Gotham', state: 'NY', postalCode: '10001' }],
    ...overrides,
  };
}

describe('RCM employer zambdas', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    ({ index: createEmployerHandler } = (await import('../../src/rcm/employers/create-employer/index')) as {
      index: ZambdaHandler;
    });
    ({ index: updateEmployerHandler } = (await import('../../src/rcm/employers/update-employer/index')) as {
      index: ZambdaHandler;
    });
    ({ index: listEmployersHandler } = (await import('../../src/rcm/employers/list-employers/index')) as {
      index: ZambdaHandler;
    });
  });

  it('create-employer creates the FHIR Organization and returns it', async () => {
    const created = makeEmployer({ identifier: undefined });
    mockOystehrClient.fhir.create.mockResolvedValue(created);

    const result = await createEmployerHandler(makeInput({ name: 'Wayne Enterprises' }));

    expect(result.statusCode).toBe(200);
    expect(mockOystehrClient.fhir.create).toHaveBeenCalledTimes(1);
    expect(mockOystehrClient.fhir.update).not.toHaveBeenCalled();
    expect(JSON.parse(result.body).name).toBe('Wayne Enterprises');
  });

  it('update-employer updates the FHIR Organization with the supplied fields', async () => {
    const existing = makeEmployer({ meta: { versionId: '3' } });
    const updated = makeEmployer({
      name: 'Wayne Ent',
      type: [{ ...employerType[0], text: 'Occupational Medicine' }],
    });

    mockOystehrClient.fhir.get.mockResolvedValue(existing);
    mockOystehrClient.fhir.update.mockResolvedValue(updated);

    const result = await updateEmployerHandler(
      makeInput({ employerId: EMPLOYER_ID, name: 'Wayne Ent', category: 'Occupational Medicine' })
    );

    expect(result.statusCode).toBe(200);
    expect(mockOystehrClient.fhir.update).toHaveBeenCalledTimes(1);
    expect(mockOystehrClient.fhir.update).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Wayne Ent' }),
      expect.objectContaining({ optimisticLockingVersionId: '3' })
    );
  });

  it('update-employer toggles active true on the FHIR Organization', async () => {
    const existing = makeEmployer({ active: false, meta: { versionId: '7' } });
    const updated = makeEmployer({ active: true });

    mockOystehrClient.fhir.get.mockResolvedValue(existing);
    mockOystehrClient.fhir.update.mockResolvedValue(updated);

    const result = await updateEmployerHandler(makeInput({ employerId: EMPLOYER_ID, active: true }));

    expect(result.statusCode).toBe(200);
    expect(mockOystehrClient.fhir.update).toHaveBeenCalledWith(
      expect.objectContaining({ active: true }),
      expect.objectContaining({ optimisticLockingVersionId: '7' })
    );
  });

  it('update-employer toggles active false on the FHIR Organization', async () => {
    const existing = makeEmployer({ active: true, meta: { versionId: '8' } });
    const updated = makeEmployer({ active: false });

    mockOystehrClient.fhir.get.mockResolvedValue(existing);
    mockOystehrClient.fhir.update.mockResolvedValue(updated);

    const result = await updateEmployerHandler(makeInput({ employerId: EMPLOYER_ID, active: false }));

    expect(result.statusCode).toBe(200);
    expect(mockOystehrClient.fhir.update).toHaveBeenCalledWith(
      expect.objectContaining({ active: false }),
      expect.objectContaining({ optimisticLockingVersionId: '8' })
    );
  });

  it('list-employers returns all organizations from search results', async () => {
    mockOystehrClient.fhir.search.mockResolvedValue({
      unbundle: () => [makeEmployer()],
    });

    const result = await listEmployersHandler({ headers: null, body: JSON.stringify({}), secrets: null });
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('Wayne Enterprises');
  });
});
