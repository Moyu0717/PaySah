CREATE INDEX demo_sessions_expiry ON demo_sessions(expires_at);
CREATE TABLE merchant_accounts (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
  account_identifier text NOT NULL, active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,account_identifier)
);
CREATE TABLE bank_transactions (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, account_id uuid NOT NULL,
  provider_tx_id text NOT NULL, bank_transaction_ref text NOT NULL,
  customer_reference text, amount_sen integer NOT NULL CHECK(amount_sen>0),
  currency text NOT NULL CHECK(currency='MYR'), direction text NOT NULL CHECK(direction IN ('CREDIT','DEBIT')),
  status text NOT NULL CHECK(status IN ('BOOKED','PENDING','REVERSED')), booked_at timestamptz NOT NULL,
  source_kind text NOT NULL CHECK(source_kind='SYNTHETIC_FEED'), created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_provider_unique UNIQUE(tenant_id,account_id,provider_tx_id), UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,account_id) REFERENCES merchant_accounts(tenant_id,id)
);
CREATE TABLE receipts (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, order_id uuid NOT NULL,
  content_fingerprint text NOT NULL CHECK(content_fingerprint ~ '^[a-f0-9]{64}$'), source text NOT NULL CHECK(source IN ('FIXTURE','MANUAL')),
  fixture_id text, fields jsonb NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,order_id,id),
  UNIQUE(tenant_id,order_id,content_fingerprint), FOREIGN KEY(tenant_id,order_id) REFERENCES orders(tenant_id,id)
);
CREATE INDEX receipts_tenant_hash ON receipts(tenant_id,content_fingerprint);
CREATE TABLE receipt_corrections (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, receipt_id uuid NOT NULL, actor_id uuid NOT NULL,
  previous_revision integer NOT NULL, new_revision integer NOT NULL,
  before_fields jsonb NOT NULL, after_fields jsonb NOT NULL, reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,receipt_id,new_revision),
  FOREIGN KEY(tenant_id,receipt_id) REFERENCES receipts(tenant_id,id),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES users(tenant_id,id)
);
CREATE TABLE verifications (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, order_id uuid NOT NULL, receipt_id uuid NOT NULL,
  order_version integer NOT NULL, evidence_revision integer NOT NULL, rule_version text NOT NULL,
  evidence_hash text NOT NULL, result jsonb NOT NULL, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,order_id,id),
  FOREIGN KEY(tenant_id,order_id,receipt_id) REFERENCES receipts(tenant_id,order_id,id)
);
CREATE TABLE approvals (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, order_id uuid NOT NULL, verification_id uuid NOT NULL,
  requested_by uuid NOT NULL, decided_by uuid, reason text,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','SUPERSEDED')),
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz,
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,verification_id),
  FOREIGN KEY(tenant_id,order_id,verification_id) REFERENCES verifications(tenant_id,order_id,id),
  FOREIGN KEY(tenant_id,requested_by) REFERENCES users(tenant_id,id),
  FOREIGN KEY(tenant_id,decided_by) REFERENCES users(tenant_id,id)
);
CREATE TABLE payment_allocations (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, order_id uuid NOT NULL,
  bank_transaction_id uuid NOT NULL, verification_id uuid NOT NULL,
  amount_sen integer NOT NULL CHECK(amount_sen>0), created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT allocation_transaction_unique UNIQUE(tenant_id,bank_transaction_id),
  CONSTRAINT allocation_order_unique UNIQUE(tenant_id,order_id),
  FOREIGN KEY(tenant_id,order_id,verification_id) REFERENCES verifications(tenant_id,order_id,id),
  FOREIGN KEY(tenant_id,bank_transaction_id) REFERENCES bank_transactions(tenant_id,id)
);
ALTER TABLE activity_events ADD COLUMN order_id uuid;
UPDATE activity_events SET order_id=entity_id;
ALTER TABLE activity_events DROP CONSTRAINT activity_events_tenant_id_entity_id_fkey;
ALTER TABLE activity_events ADD FOREIGN KEY(tenant_id,order_id) REFERENCES orders(tenant_id,id);
ALTER TABLE activity_events ADD COLUMN entity_type text NOT NULL DEFAULT 'order'
  CHECK(entity_type IN ('order','receipt','verification','approval','bank_transaction'));
ALTER TABLE activity_events ADD COLUMN seq bigserial UNIQUE;
CREATE INDEX activity_tenant_seq ON activity_events(tenant_id,seq DESC);
-- Polymorphic entity IDs still require same-tenant association at the database boundary.
CREATE FUNCTION validate_activity_entity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE linked_order uuid; valid boolean;
BEGIN
  IF NEW.entity_type='order' THEN
    NEW.order_id := NEW.entity_id;
    SELECT EXISTS(SELECT 1 FROM orders WHERE tenant_id=NEW.tenant_id AND id=NEW.entity_id) INTO valid;
  ELSIF NEW.entity_type='bank_transaction' THEN
    SELECT EXISTS(SELECT 1 FROM bank_transactions WHERE tenant_id=NEW.tenant_id AND id=NEW.entity_id) INTO valid;
    IF NEW.order_id IS NOT NULL THEN RAISE EXCEPTION 'Invalid activity order' USING ERRCODE='23503'; END IF;
  ELSE
    IF NEW.entity_type='receipt' THEN SELECT order_id INTO linked_order FROM receipts WHERE tenant_id=NEW.tenant_id AND id=NEW.entity_id;
    ELSIF NEW.entity_type='verification' THEN SELECT order_id INTO linked_order FROM verifications WHERE tenant_id=NEW.tenant_id AND id=NEW.entity_id;
    ELSE SELECT order_id INTO linked_order FROM approvals WHERE tenant_id=NEW.tenant_id AND id=NEW.entity_id; END IF;
    valid := linked_order IS NOT NULL AND NEW.order_id IS NOT NULL AND NEW.order_id=linked_order;
  END IF;
  IF valid IS DISTINCT FROM true THEN RAISE EXCEPTION 'Invalid activity entity' USING ERRCODE='23503'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER activity_entity_check BEFORE INSERT OR UPDATE ON activity_events FOR EACH ROW EXECUTE FUNCTION validate_activity_entity();
