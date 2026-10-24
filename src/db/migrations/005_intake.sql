ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('OWNER','CASHIER','SYSTEM'));
CREATE UNIQUE INDEX one_system_per_tenant ON users(tenant_id) WHERE role='SYSTEM';
INSERT INTO users(id,tenant_id,display_name,role) SELECT gen_random_uuid(),id,'Receipt intake system','SYSTEM' FROM tenants WHERE is_demo;
ALTER TABLE receipts ADD COLUMN intake_channel text NOT NULL DEFAULT 'DASHBOARD' CHECK(intake_channel IN ('DASHBOARD','TELEGRAM','GOOGLE_FORM'));
ALTER TABLE receipts ADD COLUMN intake_message_id uuid;
ALTER TABLE orders ADD COLUMN current_receipt_id uuid;
ALTER TABLE orders ADD FOREIGN KEY(tenant_id,id,current_receipt_id) REFERENCES receipts(tenant_id,order_id,id);
UPDATE orders o SET current_receipt_id=(SELECT r.id FROM receipts r WHERE r.tenant_id=o.tenant_id AND r.order_id=o.id ORDER BY created_at DESC,id DESC LIMIT 1);
CREATE TABLE intake_links (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,order_id uuid NOT NULL,channel text NOT NULL CHECK(channel IN ('TELEGRAM','GOOGLE_FORM')),connector_id text NOT NULL,
 token_hash text NOT NULL UNIQUE,expires_at timestamptz NOT NULL,revoked_at timestamptz,created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,order_id) REFERENCES orders(tenant_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES users(tenant_id,id)
);
CREATE TABLE intake_bindings (
 tenant_id uuid NOT NULL,channel text NOT NULL,connector_id text NOT NULL,sender_hash text NOT NULL,link_id uuid NOT NULL,order_id uuid NOT NULL,
 expires_at timestamptz NOT NULL,last_update_id bigint NOT NULL,last_message_id bigint NOT NULL,
 PRIMARY KEY(tenant_id,channel,connector_id,sender_hash),FOREIGN KEY(tenant_id,link_id) REFERENCES intake_links(tenant_id,id),FOREIGN KEY(tenant_id,order_id) REFERENCES orders(tenant_id,id)
);
CREATE TABLE intake_messages (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,channel text NOT NULL CHECK(channel IN ('TELEGRAM','GOOGLE_FORM')),connector_id text NOT NULL,external_id text NOT NULL,
 payload_hash text NOT NULL,sender_hash text,link_id uuid,order_id uuid,receipt_id uuid,
 status text NOT NULL CHECK(status IN ('RECEIVING','ACCEPTED','REJECTED','RETRYABLE')),attempts integer NOT NULL DEFAULT 1,lease_token uuid,lease_until timestamptz,reason text,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,channel,connector_id,external_id),FOREIGN KEY(tenant_id,link_id) REFERENCES intake_links(tenant_id,id),FOREIGN KEY(tenant_id,order_id) REFERENCES orders(tenant_id,id),FOREIGN KEY(tenant_id,receipt_id) REFERENCES receipts(tenant_id,id)
);
ALTER TABLE receipts ADD FOREIGN KEY(tenant_id,intake_message_id) REFERENCES intake_messages(tenant_id,id);
CREATE TABLE verification_jobs (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,order_id uuid NOT NULL,receipt_id uuid NOT NULL,expected_revision integer NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RUNNING','COMPLETED','CANCELLED','ERROR')),attempts integer NOT NULL DEFAULT 0,lease_token uuid,lease_until timestamptz,last_error text,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,receipt_id,expected_revision),FOREIGN KEY(tenant_id,order_id) REFERENCES orders(tenant_id,id),FOREIGN KEY(tenant_id,receipt_id) REFERENCES receipts(tenant_id,id)
);
CREATE INDEX verification_queue ON verification_jobs(status,lease_until,created_at);

ALTER TABLE activity_events DROP CONSTRAINT activity_events_entity_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_entity_type_check CHECK(entity_type IN ('order','receipt','verification','approval','bank_transaction','intake','intake_link'));
ALTER TABLE intake_links ADD UNIQUE(tenant_id,id,order_id);
ALTER TABLE intake_bindings ADD FOREIGN KEY(tenant_id,link_id,order_id) REFERENCES intake_links(tenant_id,id,order_id);
ALTER TABLE intake_messages ADD FOREIGN KEY(tenant_id,link_id,order_id) REFERENCES intake_links(tenant_id,id,order_id);
ALTER TABLE intake_messages ADD FOREIGN KEY(tenant_id,order_id,receipt_id) REFERENCES receipts(tenant_id,order_id,id);
ALTER TABLE verification_jobs ADD FOREIGN KEY(tenant_id,order_id,receipt_id) REFERENCES receipts(tenant_id,order_id,id);
CREATE OR REPLACE FUNCTION validate_activity_entity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE linked_order uuid; valid boolean;
BEGIN
  IF NEW.entity_type='order' THEN
    NEW.order_id := NEW.entity_id;
    SELECT EXISTS(SELECT 1 FROM orders WHERE tenant_id=NEW.tenant_id AND id=NEW.entity_id) INTO valid;
  ELSIF NEW.entity_type='bank_transaction' THEN
    SELECT EXISTS(SELECT 1 FROM bank_transactions WHERE tenant_id=NEW.tenant_id AND id=NEW.entity_id) INTO valid;
    IF NEW.order_id IS NOT NULL THEN RAISE EXCEPTION 'Invalid activity order' USING ERRCODE='23503'; END IF;
  ELSIF NEW.entity_type='intake' THEN
    SELECT EXISTS(SELECT 1 FROM intake_messages WHERE tenant_id=NEW.tenant_id AND id=NEW.entity_id AND order_id IS NOT DISTINCT FROM NEW.order_id) INTO valid;
  ELSIF NEW.entity_type='intake_link' THEN
    SELECT EXISTS(SELECT 1 FROM intake_links WHERE tenant_id=NEW.tenant_id AND id=NEW.entity_id AND order_id=NEW.order_id) INTO valid;
  ELSE
    IF NEW.entity_type='receipt' THEN SELECT order_id INTO linked_order FROM receipts WHERE tenant_id=NEW.tenant_id AND id=NEW.entity_id;
    ELSIF NEW.entity_type='verification' THEN SELECT order_id INTO linked_order FROM verifications WHERE tenant_id=NEW.tenant_id AND id=NEW.entity_id;
    ELSE SELECT order_id INTO linked_order FROM approvals WHERE tenant_id=NEW.tenant_id AND id=NEW.entity_id; END IF;
    valid := linked_order IS NOT NULL AND NEW.order_id IS NOT NULL AND NEW.order_id=linked_order;
  END IF;
  IF valid IS DISTINCT FROM true THEN RAISE EXCEPTION 'Invalid activity entity' USING ERRCODE='23503'; END IF;
  RETURN NEW;
END $$;
