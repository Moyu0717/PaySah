import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrderSchema, demoLoginSchema } from '../../packages/contracts/src/index.js';

test('orders reject forged server fields and invalid monetary values', () => {
  const valid = { external_id: ' DEMO-1 ', total_sen: 50001 };
  assert.deepEqual(createOrderSchema.parse(valid), { external_id: 'DEMO-1', total_sen: 50001, currency: 'MYR' });
  for (const extra of [{ total_sen: 0 }, { total_sen: -1 }, { total_sen: 1.1 }, { total_sen: 2147483648 }, { currency: 'USD' }, { payment_state: 'PAID' }, { fulfillment_state: 'RELEASED' }, { version: 10 }, { role: 'OWNER' }, { tenant_id: 'other-tenant' }]) {
    assert.equal(createOrderSchema.safeParse({ ...valid, ...extra }).success, false);
  }
});
test('demo login accepts only a server-resolved account identifier', () => {
  const account = { account_id: '20000000-0000-4000-8000-000000000002' };
  assert.equal(demoLoginSchema.safeParse(account).success, true);
  for (const extra of [{ role: 'OWNER' }, { tenant_id: 'other-tenant' }, { account_id: 'bad' }]) {
    assert.equal(demoLoginSchema.safeParse({ ...account, ...extra }).success, false);
  }
});
