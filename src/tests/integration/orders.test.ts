import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import pg from 'pg';
import { migrate, seed } from '../../scripts/database.js';
import { createApp } from '../../apps/api/src/app.js';
import { readConfig } from '../../apps/api/src/config.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
test('PostgreSQL identity, orders, isolation and persistence', { skip: !databaseUrl && process.env.npm_lifecycle_event !== 'test:db' }, async t => {
  assert.ok(databaseUrl, 'Set TEST_DATABASE_URL to a dedicated test database before running test:db.');
  // Only this newly generated schema is removed; existing databases and schemas are untouched.
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
  let pool: pg.Pool | undefined;
  let server: Server | undefined;
  let base = '';
  async function start() {
    server = createApp(readConfig({ DATABASE_URL: databaseUrl }), undefined, pool).listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server!.once('listening', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    base = `http://127.0.0.1:${address.port}/api/v1`;
  }
  async function stop() {
    if (server) await new Promise<void>((resolve, reject) => server!.close(e => e ? reject(e) : resolve()));
    server = undefined;
  }
  const call = (path: string, token?: string, body?: unknown, key?: string, method?: string) => fetch(base + path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { 'Idempotency-Key': key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, connectionTimeoutMillis: 3000 });
    await migrate(pool); await seed(pool);
    await migrate(pool); await seed(pool);
    await start();
    let a = '', b = '', cashier = '', createdId = '';
    await t.test('repeatable migration and synthetic seed; unknown identity fields rejected', async () => {
      assert.equal((await pool!.query('SELECT count(*) FROM orders')).rows[0].count, '6');
      const accounts = await (await call('/demo/accounts')).json(); assert.equal(accounts.accounts.length, 4);
      assert.equal((await call('/demo/sessions', undefined, { account_id: accounts.accounts[0].id, role: 'OWNER' })).status, 422);
      a = (await (await call('/demo/sessions', undefined, { account_id: accounts.accounts[0].id })).json()).token;
      cashier = (await (await call('/demo/sessions', undefined, { account_id: accounts.accounts[1].id })).json()).token;
      b = (await (await call('/demo/sessions', undefined, { account_id: accounts.accounts[2].id })).json()).token;
      assert.equal((await (await call('/session', cashier)).json()).actor.role, 'CASHIER');
      const hashes = await pool!.query('SELECT token_hash FROM demo_sessions');
      assert.ok(hashes.rows.every(row => row.token_hash.length === 64 && row.token_hash !== a));
    });
    await t.test('authentication and tenant-scoped reads', async () => {
      assert.equal((await call('/orders')).status, 401);
      assert.equal((await call('/orders', 'invalid')).status, 401);
      assert.equal((await (await call('/orders', a)).json()).orders.length, 5);
      assert.equal((await (await call('/orders', b)).json()).orders.length, 1);
      assert.equal((await call('/orders/40000000-0000-4000-8000-000000000001', b)).status, 404);
      assert.equal((await call('/orders?tenant_id=10000000-0000-4000-8000-000000000002', a)).status, 422);
      assert.equal((await call('/orders?limit=-1', a)).status, 422);
    });
    const body = { external_id: 'TEST-ORDER', total_sen: 12800 };
    await t.test('create enforces amount, tenant and immutable initial states', async () => {
      for (const extra of [{ payment_state: 'PAID' }, { tenant_id: '10000000-0000-4000-8000-000000000002' }, { total_sen: 1.5 }, { total_sen: -1 }]) {
        assert.equal((await call('/orders', a, { ...body, ...extra }, 'invalid-key')).status, 422);
      }
      assert.equal((await call('/orders', a, body)).status, 422);
      assert.equal((await call('/orders', a, { ...body, customer_id: '30000000-0000-4000-8000-000000000002' }, 'wrong-customer')).status, 404);
      const response = await call('/orders', cashier, body, 'create-order'); assert.equal(response.status, 201);
      const result = await response.json(); createdId = result.order.id;
      assert.equal(result.order.payment_state, 'UNPAID'); assert.equal(result.order.fulfillment_state, 'ON_HOLD'); assert.equal(result.order.version, 1);
      assert.equal((await call(`/orders/${createdId}`, b)).status, 404);
      assert.equal((await call(`/orders/${createdId}`, cashier, { payment_state: 'PAID' }, 'modify-state', 'PATCH')).status, 404);
    });
    await t.test('idempotent retries and concurrent creates produce one order and event', async () => {
      const replay = await call('/orders', cashier, body, 'create-order'); assert.equal(replay.status, 200);
      assert.equal((await replay.json()).order.id, createdId);
      assert.equal((await call('/orders', cashier, { ...body, total_sen: 1 }, 'create-order')).status, 409);
      const results = await Promise.all(Array.from({ length: 5 }, () => call('/orders', a, { external_id: 'CONCURRENT', total_sen: 78000 }, 'concurrent-key')));
      assert.equal(results.filter(r => r.status === 201).length, 1);
      assert.equal(results.filter(r => r.status === 200).length, 4);
      assert.equal((await pool!.query("SELECT count(*) FROM activity_events WHERE payload->>'total_sen'='78000'")).rows[0].count, '1');
      assert.equal((await call('/orders', a, { external_id: 'CONCURRENT', total_sen: 78000 }, 'different-key')).status, 409);
      assert.equal((await call('/orders', b, body, 'create-order')).status, 201);
      const eventsB = await (await call('/activity', b)).json();
      assert.equal(eventsB.events.length, 1); assert.notEqual(eventsB.events[0].entity_id, createdId);
    });
    await t.test('database foreign key rejects cross-tenant linkage', async () => {
      await assert.rejects(pool!.query('INSERT INTO orders(id,tenant_id,external_id,customer_id,total_sen) VALUES ($1,$2,$3,$4,100)', [randomUUID(), '10000000-0000-4000-8000-000000000001', 'FK-TEST', '30000000-0000-4000-8000-000000000002']), (e: unknown) => (e as { code: string }).code === '23503');
    });
    await t.test('audit failure rolls back order and idempotency result', async () => {
      await pool!.query("ALTER TABLE activity_events ADD CONSTRAINT test_reject CHECK (action <> 'order.created') NOT VALID");
      assert.equal((await call('/orders', a, { external_id: 'ROLLBACK', total_sen: 100 }, 'rollback-key')).status, 500);
      assert.equal((await pool!.query("SELECT count(*) FROM orders WHERE external_id='ROLLBACK'")).rows[0].count, '0');
      assert.equal((await pool!.query("SELECT count(*) FROM idempotency_keys WHERE key='rollback-key'")).rows[0].count, '0');
      await pool!.query('ALTER TABLE activity_events DROP CONSTRAINT test_reject');
      assert.equal((await call('/orders', a, { external_id: 'ROLLBACK', total_sen: 100 }, 'rollback-key')).status, 201);
    });
    await t.test('API and database pool restart preserves session, order and replay', async () => {
      await stop(); await pool!.end();
      pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, connectionTimeoutMillis: 3000 });
      await start();
      assert.equal((await call(`/orders/${createdId}`, cashier)).status, 200);
      assert.equal((await call('/orders', cashier, body, 'create-order')).status, 200);
    });
    await t.test('logout, expiry and deactivation invalidate sessions', async () => {
      assert.equal((await call('/session', b, undefined, undefined, 'DELETE')).status, 204);
      assert.equal((await call('/orders', b)).status, 401);
      await pool!.query("UPDATE users SET active=false WHERE id='20000000-0000-4000-8000-000000000002'");
      assert.equal((await call('/orders', cashier)).status, 401);
      await pool!.query("UPDATE demo_sessions SET expires_at=now()-interval '1 minute'");
      assert.equal((await call('/orders', a)).status, 401);
    });
  } finally {
    await stop(); await pool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
