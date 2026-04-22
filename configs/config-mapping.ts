export interface DirMapping {
  dest: string;
  publicSource?: string;
  secretsSource?: string;
}

export const DIR_MAPPINGS: DirMapping[] = [
  {
    dest: 'config/oystehr',
    publicSource: 'oystehr',
    secretsSource: 'configuration/oystehr',
  },
  {
    dest: 'packages/utils/lib/ottehr-config',
    publicSource: 'ottehr-config',
    secretsSource: 'configuration/ottehr-config',
  },
  {
    dest: 'config/oystehr-core',
    publicSource: 'oystehr-core',
  },
  {
    dest: 'config/.env',
    publicSource: '.env', // readme and template
    secretsSource: 'config/.env',
  },
  {
    dest: 'apps/ehr/public',
    publicSource: 'apps/ehr/public',
    secretsSource: 'apps/ehr/public',
  },
  {
    dest: 'apps/intake/public',
    publicSource: 'apps/intake/public',
    secretsSource: 'apps/intake/public',
  },
  {
    dest: 'apps/ehr/env',
    secretsSource: 'apps/ehr/env',
  },
  {
    dest: 'apps/intake/env',
    secretsSource: 'apps/intake/env',
  },
  {
    dest: 'packages/zambdas/assets',
    publicSource: 'zambdas/assets',
    secretsSource: 'zambdas/assets',
  },
  {
    dest: 'packages/zambdas/src/scripts',
    publicSource: 'zambdas/scripts',
    secretsSource: 'zambdas/scripts',
  },
  {
    dest: 'packages/zambdas/.env',
    secretsSource: 'zambdas/.env',
  },
  {
    dest: 'deploy',
    secretsSource: 'terraform',
  },
];

export const PUBLIC_SOURCE = 'configs/public';
export const SECRETS_SOURCE = 'configs/secrets';
