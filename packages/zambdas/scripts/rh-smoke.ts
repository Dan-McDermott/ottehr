import * as fs from 'fs';
import * as path from 'path';
import { Secrets } from 'utils';
import { createRectangleHealthClient, RectangleHealthApiError, RHClinicEntity } from '../src/shared/rectangleHealth';

// W0.3 smoke script — exercises Rectangle Health reporting.getByInvoice against
// the configured environment to verify secrets + base URL wiring.
//
// Usage:
//   npx tsx packages/zambdas/scripts/rh-smoke.ts <env> <entity> <invNum>
//   # e.g. npx tsx packages/zambdas/scripts/rh-smoke.ts local afterours INV-0001
//
// Env JSON is loaded from config/.env/<env>.json — populate the
// RH_* keys before running. <entity> is "afterours" or "spire".

async function main(): Promise<void> {
  const envName = process.argv[2];
  const entityArg = process.argv[3];
  const invNum = process.argv[4];

  if (!envName || !entityArg || !invNum) {
    console.error('Usage: tsx scripts/rh-smoke.ts <env> <entity> <invNum>');
    process.exit(2);
  }

  if (entityArg !== 'afterours' && entityArg !== 'spire') {
    console.error(`Invalid entity "${entityArg}". Expected "afterours" or "spire".`);
    process.exit(2);
  }
  const entity: RHClinicEntity = entityArg;

  const repoRoot = path.resolve(__dirname, '../../..');
  const envPath = path.join(repoRoot, 'config/.env', `${envName}.json`);
  if (!fs.existsSync(envPath)) {
    console.error(`Env file not found: ${envPath}`);
    process.exit(2);
  }

  const secrets: Secrets = JSON.parse(fs.readFileSync(envPath, 'utf8'));
  const client = createRectangleHealthClient(secrets, entity);

  console.log(`[rh-smoke] entity=${client.env.entity} baseUrl=${client.env.baseUrl}`);
  console.log(`[rh-smoke] cipherpayBaseUrl=${client.env.cipherpayBaseUrl}`);
  console.log(`[rh-smoke] merchant_account_code=${client.env.merchantAccountCode}`);
  console.log(`[rh-smoke] calling reporting.getByInvoice for inv_num=${invNum}`);

  try {
    const result = await client.getTransactionsByInvoice(invNum);
    console.log('[rh-smoke] success:');
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    if (err instanceof RectangleHealthApiError) {
      console.error(`[rh-smoke] RH API error ${err.status} on ${err.endpoint}:`);
      console.error(JSON.stringify(err.responseBody, null, 2));
    } else {
      console.error('[rh-smoke] unexpected error:', err);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[rh-smoke] fatal:', err);
  process.exit(1);
});
