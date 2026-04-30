import Oystehr from '@oystehr/sdk';
import { Identifier, Organization } from 'fhir/r4b';
import * as fs from 'fs';
import * as path from 'path';
import { RH_MAC_AFTEROURS, RH_MAC_SPIRE, RH_MERCHANT_ACCOUNT_CODE_SYSTEM } from 'utils';

// W1.4 — one-shot, idempotent seed: upserts the Rectangle Health MAC
// identifier on the AfterOurs and Spire legal-entity Organization resources.
//
// Usage:
//   npx tsx packages/zambdas/scripts/seed-rh-organization-macs.ts <env> [--dry-run]
//   # e.g. npx tsx packages/zambdas/scripts/seed-rh-organization-macs.ts local
//
// Env JSON is loaded from config/.env/<env>.json and must contain:
//   AUTH0_ENDPOINT, AUTH0_CLIENT, AUTH0_SECRET, AUTH0_AUDIENCE,
//   FHIR_API, PROJECT_API, PROJECT_ID
//
// Re-running the script after a successful run is a no-op (idempotent).

interface EntityTarget {
  entity: 'afterours' | 'spire';
  name: string;
  mac: string;
}

const TARGETS: EntityTarget[] = [
  { entity: 'afterours', name: 'AfterOurs, Inc.', mac: RH_MAC_AFTEROURS },
  { entity: 'spire', name: 'Spire Health Pathways', mac: RH_MAC_SPIRE },
];

function loadEnv(envName: string): void {
  const repoRoot = path.resolve(__dirname, '../../..');
  const envPath = path.join(repoRoot, 'config/.env', `${envName}.json`);
  if (!fs.existsSync(envPath)) throw new Error(`Env file not found: ${envPath}`);
  const cfg = JSON.parse(fs.readFileSync(envPath, 'utf8')) as Record<string, string>;
  for (const [k, v] of Object.entries(cfg)) {
    if (process.env[k] === undefined) process.env[k] = String(v);
  }
  console.log(`[seed-rh-macs] loaded env from ${envPath}`);
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

function upsertMacIdentifier(org: Organization, mac: string): { changed: boolean; org: Organization } {
  const existing = org.identifier ?? [];
  const matchIdx = existing.findIndex((i) => i.system === RH_MERCHANT_ACCOUNT_CODE_SYSTEM);
  const desired: Identifier = { system: RH_MERCHANT_ACCOUNT_CODE_SYSTEM, value: mac };

  if (matchIdx === -1) {
    return { changed: true, org: { ...org, identifier: [...existing, desired] } };
  }
  if (existing[matchIdx].value === mac) {
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
    console.error('Usage: tsx packages/zambdas/scripts/seed-rh-organization-macs.ts <env> [--dry-run]');
    process.exit(2);
  }
  const dryRun = args.includes('--dry-run') || process.env.DRY_RUN === 'true';

  loadEnv(envName);

  const { FHIR_API, PROJECT_API } = process.env;
  const token = await getAccessToken();
  const oystehr = new Oystehr({ accessToken: token, fhirApiUrl: FHIR_API, projectApiUrl: PROJECT_API });

  console.log(`[seed-rh-macs] mode=${dryRun ? 'DRY-RUN' : 'LIVE'} system=${RH_MERCHANT_ACCOUNT_CODE_SYSTEM}`);

  let updated = 0;
  let unchanged = 0;
  let missing = 0;

  for (const target of TARGETS) {
    const org = await findOrganizationByName(oystehr, target.name);
    if (!org || !org.id) {
      console.warn(`[seed-rh-macs] MISSING — no Organization named "${target.name}" (${target.entity})`);
      missing += 1;
      continue;
    }

    const { changed, org: nextOrg } = upsertMacIdentifier(org, target.mac);
    if (!changed) {
      console.log(`[seed-rh-macs] OK — Organization/${org.id} "${target.name}" already has MAC ${target.mac}`);
      unchanged += 1;
      continue;
    }
    if (dryRun) {
      console.log(`[seed-rh-macs] WOULD-UPDATE — Organization/${org.id} "${target.name}" → MAC ${target.mac}`);
      updated += 1;
      continue;
    }
    await oystehr.fhir.update<Organization>(nextOrg as Organization & { id: string });
    console.log(`[seed-rh-macs] UPDATED — Organization/${org.id} "${target.name}" → MAC ${target.mac}`);
    updated += 1;
  }

  console.log(`[seed-rh-macs] done. updated=${updated} unchanged=${unchanged} missing=${missing}`);
  if (missing > 0) process.exit(1);
}

seed().catch((err) => {
  console.error('[seed-rh-macs] fatal:', err);
  process.exit(1);
});
