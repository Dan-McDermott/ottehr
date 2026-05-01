import react from '@vitejs/plugin-react';
import dotenv from 'dotenv';
import path from 'path';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

const envName = process.env.ENV || 'local';
dotenv.config({ path: path.resolve(__dirname, `env/.env.${envName}`) });

// Provide deterministic defaults for VITE_APP_* values that EHR source modules
// read at import time. This keeps component tests self-contained and avoids
// requiring a terraform-generated env file just to load modules under test.
const componentTestEnvDefaults: Record<string, string> = {
  VITE_APP_IS_LOCAL: 'true',
  VITE_APP_ORGANIZATION_NAME_LONG: 'Ottehr Test Organization',
  VITE_APP_ORGANIZATION_NAME_SHORT: 'Ottehr',
  VITE_APP_NAME: 'EHR',
  VITE_APP_ENV: envName,
  VITE_APP_PROJECT_ID: 'test-project',
  VITE_APP_PROJECT_API_URL: 'https://project-api.zapehr.com/v1',
  VITE_APP_FHIR_API_URL: 'https://fhir-api.zapehr.com',
  VITE_APP_OYSTEHR_APPLICATION_DOMAIN: 'https://auth.zapehr.com',
  VITE_APP_OYSTEHR_APPLICATION_AUDIENCE: 'https://api.zapehr.com',
  VITE_APP_OYSTEHR_APPLICATION_CLIENT_ID: 'test-client-id',
  VITE_APP_OYSTEHR_APPLICATION_REDIRECT_URL: 'http://localhost:4002',
  VITE_APP_OYSTEHR_CONNECTION_NAME: 'test-connection',
  VITE_APP_OYSTEHR_APPLICATION_ID: 'test-app-id',
  VITE_APP_PATIENT_APP_URL: 'http://localhost:3002',
  VITE_APP_PROJECT_API_ZAMBDA_URL: 'https://project-api.zapehr.com/v1/zambda',
  VITE_APP_MUI_X_LICENSE_KEY: '',
  VITE_APP_DYNAMSOFT_LICENSE_KEY: '',
  VITE_APP_SENTRY_DSN: '',
  VITE_APP_SENTRY_ENV: envName,
  VITE_APP_SENTRY_TAGS: '',
};
for (const [key, value] of Object.entries(componentTestEnvDefaults)) {
  if (process.env[key] == null || process.env[key] === '') {
    process.env[key] = value;
  }
}

export default defineConfig({
  test: {
    // Disable globals to avoid conflicts with Playwright's expect during test execution
    globals: false,
    include: ['**/*.test.tsx'],
    setupFiles: ['./tests/component/setup.ts'],
    environment: 'jsdom',
    testTimeout: 30_000, // 30 seconds
  },
  plugins: [tsconfigPaths(), react()],
});
