CREATE TABLE tenants (
  id uuid PRIMARY KEY, name text NOT NULL, currency text NOT NULL DEFAULT 'MYR' CHECK (currency = 'MYR'),
  is_demo boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('OWNER', 'CASHIER')), active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id, id)
);
CREATE TABLE customers (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id, id)
);
CREATE TABLE orders (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), external_id text NOT NULL,
  customer_id uuid, total_sen integer NOT NULL CHECK (total_sen > 0),
  currency text NOT NULL DEFAULT 'MYR' CHECK (currency = 'MYR'),
  payment_state text NOT NULL DEFAULT 'UNPAID' CHECK (payment_state IN ('UNPAID','PARTIALLY_PAID','PAID','MANUALLY_CONFIRMED','RECONCILIATION_REQUIRED')),
  fulfillment_state text NOT NULL DEFAULT 'ON_HOLD' CHECK (fulfillment_state IN ('ON_HOLD','RELEASED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, external_id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id)
);
CREATE INDEX orders_tenant_created ON orders(tenant_id, created_at DESC, id);
CREATE TABLE demo_sessions (
  token_hash text PRIMARY KEY, tenant_id uuid NOT NULL, user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id)
);
CREATE TABLE idempotency_keys (
  tenant_id uuid NOT NULL, user_id uuid NOT NULL, route text NOT NULL, key text NOT NULL,
  request_hash text NOT NULL, response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, route, key),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id)
);
CREATE TABLE activity_events (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, actor_id uuid NOT NULL,
  action text NOT NULL, entity_id uuid NOT NULL, payload jsonb NOT NULL,
  correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES users(tenant_id, id),
  FOREIGN KEY (tenant_id, entity_id) REFERENCES orders(tenant_id, id)
);
