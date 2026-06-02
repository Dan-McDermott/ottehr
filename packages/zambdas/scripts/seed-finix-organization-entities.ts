import Oystehr from '@oystehr/sdk';
import { Identifier, Organization } from 'fhir/r4b';
import * as fs from 'fs';
import * as path from 'path';
import { ClinicEntity, FINIX_MERCHANT_ENTITY_SYSTEM } from 'utils';

// One-shot, idempotent seed: upserts the Finix clinic-entity identifier on the
// AfterOurs and Spire legal-entity Organization resources. The entity slug is
// what the payment routing (utils/lib/fhir/payments.ts) maps to the per-entity
// Finix Application/Merchant secrets. The slug is environment-independent
// (unlike Finix Merchant IDs), so the same seed works for Sandbox and Live.
//
// Usage:
//   npx tsx packages/zambdas/scripts/seed-finix-organization-entities.ts <env> [--dry-run]
//   # e.g. npx tsx packages/zambdas/scripts/seed-finix-organization-entities.ts local
//
// Env JSON is loaded from config/.env/<env>.json and must contain:
//   AUTH0_ENDPOINT, AUTH0_CLIENT, AUTH0_SECRET, AUTH0_AUDIENCE,
//   FHIR_API, PROJECT_API, PROJECT_ID

interface EntityTarget {
  entity: ClinicEntity;
  name: string;
}

const TARGETS: EntityTarget[] = [
  { entity: 'afterours', name: 'AfterOurs, Inc.' },
  { entity: 'spire', name: 'Spire Health Pathways' },
];

function loadEnv(envName: string): void {
  const repoRoot = path.resolve(__dirname, '../../..');
  const envPath = path.join(repoRoot, 'config/.env', `${envName}.json`);
  if (!fs.existsSync(envPath)) throw new Error(`Env file not found: ${envPath}`);
  const cfg = JSON.parse(fs.readFileSync(envPath, 'utf8')) as Record<string, string>;
  for (const [k, v] of Object.entries(cfg)) {
    if (process.env[k] === undefined) process.env[k] = String(v);
  }
  console.log(`[seed-finix-entities] loaded env from ${envPath}`);
}

async function getAccessToken(): Promise<string> {
  const { AUTH0_ENDPOINT, AUTH0_CLIENT, AUTH0_SECRET, AUTH0_AUDIENCE } = process.env;
  if (!AUTH0_ENDPOINT || !AUTH0_CLIENT || !AUTH0_SECRET || !AUTH0_AUDIENCE) {
    throw new Error('Missing AUTH0_ENDPOINT / AUTH0_CLIENT / AUTH0_SECRET / AUTH0_AUDIENCE');
  }
  const res = await fetch(AUTH0_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: AUTH0_CLIENT,
      client_secret: AUTH0_SECRET,
      audience: AUTH0_AUDIENCE,
    }),
  });
  if (!res.ok) throw new Error(`Auth0 token request failed: HTTP ${res.status}`);
  return (await res.json()).access_token;
}

async function findOrganizationByName(oystehr: Oystehr, name: string): Promise<Organization | undefined> {
  const bundle = await oystehr.fhir.search<Organization>({
    resourceType: 'Organization',
    params: [
      { name: 'name:exact', value: name },
      { name: '_count', value: 10 },
    ],
  });
  const matches = bundle.unbundle().filter((o) => o.name === name);
  if (matches.length > 1) {
    throw new Error(`Multiple Organization resources with name="${name}" — refusing to seed; resolve manually.`);
  }
  return matches[0];
}

function upsertEntityIdentifier(org: Organization, entity: ClinicEntity): { changed: boolean; org: Organization } {
  const existing = org.identifier ?? [];
  const matchIdx = existing.findIndex((i) => i.system === FINIX_MERCHANT_ENTITY_SYSTEM);
  const desired: Identifier = { system: FINIX_MERCHANT_ENTITY_SYSTEM, value: entity };

  if (matchIdx === -1) {
    return { changed: true, org: { ...org, identifier: [...existing, desired] } };
  }
  if (existing[matchIdx].value === entity) {
    return { changed: false, org };
  }
  const next = existing.slice();
  next[matchIdx] = desired;
  return { changed: true, org: { ...org, identifier: next } };
}

async function seed(): Promise<void> {
  const args = process.argv.slice(2);
  const envName = args[0] && !args[0].startsWith('--') ? args[0] : undefined;
  if (!envName) {
    console.error('Usage: tsx packages/zambdas/scripts/seed-finix-organization-entities.ts <env> [--dry-run]');
    process.exit(2);
  }
  const dryRun = args.includes('--dry-run') || process.env.DRY_RUN === 'true';

  loadEnv(envName);

  const { FHIR_API, PROJECT_API } = process.env;
  const token = await getAccessToken();
  const oystehr = new Oystehr({ accessToken: token, fhirApiUrl: FHIR_API, projectApiUrl: PROJECT_API });

  console.log(`[seed-finix-entities] mode=${dryRun ? 'DRY-RUN' : 'LIVE'} system=${FINIX_MERCHANT_ENTITY_SYSTEM}`);

  let updated = 0;
  let unchanged = 0;
  let missing = 0;

  for (const target of TARGETS) {
    const org = await findOrganizationByName(oystehr, target.name);
    if (!org || !org.id) {
      console.warn(`[seed-finix-entities] MISSING — no Organization named "${target.name}" (${target.entity})`);
      missing += 1;
      continue;
    }

    const { changed, org: nextOrg } = upsertEntityIdentifier(org, target.entity);
    if (!changed) {
      console.log(
        `[seed-finix-entities] OK — Organization/${org.id} "${target.name}" already tagged entity=${target.entity}`
      );
      unchanged += 1;
      continue;
    }
    if (dryRun) {
      console.log(
        `[seed-finix-entities] WOULD-UPDATE — Organization/${org.id} "${target.name}" → entity=${target.entity}`
      );
      updated += 1;
      continue;
    }
    await oystehr.fhir.update<Organization>(nextOrg as Organization & { id: string });
    console.log(`[seed-finix-entities] UPDATED — Organization/${org.id} "${target.name}" → entity=${target.entity}`);
    updated += 1;
  }

  console.log(`[seed-finix-entities] done. updated=${updated} unchanged=${unchanged} missing=${missing}`);
  if (missing > 0) process.exit(1);
}

seed().catch((err) => {
  console.error('[seed-finix-entities] fatal:', err);
  process.exit(1);
});
