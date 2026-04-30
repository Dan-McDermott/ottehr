import { describe, expect, test } from 'vitest';
import {
  RectangleHealthClient,
  RectangleHealthEnvironment,
  RH_CIPHERPAY_API_KEY_PLACEHOLDER,
} from '../../src/shared/rectangleHealth';

// Integration coverage against the Rectangle Health CipherPay sandbox.
// Skipped entirely when the per-MAC API key has not been provisioned (the
// W0.3 placeholder is the default in `local.template.json`). Populate
// RH_CIPHERPAY_API_KEY_AFTEROURS in your local secrets file to run these.

const apiKey = process.env.RH_CIPHERPAY_API_KEY_AFTEROURS;
const shouldRun = Boolean(apiKey && apiKey !== RH_CIPHERPAY_API_KEY_PLACEHOLDER);

const env = (): RectangleHealthEnvironment => ({
  entity: 'afterours',
  baseUrl: process.env.RH_BASE_URL ?? '',
  cipherpayBaseUrl: process.env.RH_CIPHERPAY_BASE_URL ?? '',
  username: process.env.RH_API_USERNAME ?? '',
  password: process.env.RH_API_PASSWORD ?? '',
  merchantGroupCode: process.env.RH_MERCHANT_GROUP_CODE ?? '',
  merchantAccountCode: process.env.RH_MAC_AFTEROURS ?? '',
  cipherpayApiKey: apiKey ?? '',
});

describe.skipIf(!shouldRun)('Rectangle Health CipherPay sandbox', () => {
  test('saleViaToken charges a stored payment_token (afterours)', async () => {
    const paymentToken = process.env.RH_TEST_PAYMENT_TOKEN;
    if (!paymentToken) return; // operator must provision a token to exercise the round-trip
    const client = new RectangleHealthClient(env());
    const res = await client.saleViaToken({
      payment_token: paymentToken,
      amount: '1.00',
      inv_num: `vitest-${Date.now()}`,
    });
    expect(res.transaction_id).toBeTruthy();
  });
});
