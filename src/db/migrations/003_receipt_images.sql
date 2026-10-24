ALTER TABLE receipts DROP CONSTRAINT receipts_source_check;
ALTER TABLE receipts ADD CONSTRAINT receipts_source_check CHECK(source IN ('FIXTURE','MANUAL','IMAGE'));
ALTER TABLE receipts ADD COLUMN image_sha256 text CHECK(image_sha256 ~ '^[a-f0-9]{64}$');
ALTER TABLE receipts ADD COLUMN storage_key text;
ALTER TABLE receipts ADD COLUMN storage_state text NOT NULL DEFAULT 'NONE' CHECK(storage_state IN ('NONE','READY'));
ALTER TABLE receipts ADD COLUMN mime_type text CHECK(mime_type IN ('image/png','image/jpeg','image/webp'));
ALTER TABLE receipts ADD COLUMN byte_size integer CHECK(byte_size BETWEEN 1 AND 10485760);
ALTER TABLE receipts ADD COLUMN fields_provider text NOT NULL DEFAULT 'FIXTURE' CHECK(fields_provider IN ('FIXTURE','MANUAL','CPU_OCR'));
UPDATE receipts SET fields_provider='MANUAL' WHERE source='MANUAL';
ALTER TABLE receipts ADD COLUMN extraction_state text NOT NULL DEFAULT 'COMPLETED' CHECK(extraction_state IN ('PENDING','RUNNING','COMPLETED','NEEDS_REVIEW','ERROR'));
ALTER TABLE receipts ADD CONSTRAINT receipt_image_metadata CHECK(
 (source='IMAGE' AND storage_state='READY' AND storage_key IS NOT NULL AND image_sha256 IS NOT NULL AND mime_type IS NOT NULL AND byte_size IS NOT NULL)
 OR (source<>'IMAGE' AND storage_state='NONE' AND storage_key IS NULL AND image_sha256 IS NULL)
);
CREATE UNIQUE INDEX receipt_order_image_unique ON receipts(tenant_id,order_id,image_sha256) WHERE image_sha256 IS NOT NULL;
CREATE UNIQUE INDEX receipt_storage_unique ON receipts(storage_key) WHERE storage_key IS NOT NULL;
CREATE INDEX receipt_tenant_image ON receipts(tenant_id,image_sha256);
CREATE TABLE extraction_runs (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, receipt_id uuid NOT NULL, revision integer NOT NULL,
 provider text NOT NULL CHECK(provider='CPU_OCR'), engine_version text NOT NULL,
 parser_version text NOT NULL, preprocessing_version text NOT NULL, language text NOT NULL,
 raw_text text NOT NULL, fields jsonb NOT NULL, missing_fields jsonb NOT NULL,
 field_candidates jsonb NOT NULL, preprocessed_sha256 text,
 status text NOT NULL CHECK(status IN ('COMPLETED','NEEDS_REVIEW','ERROR')),
 duration_ms integer NOT NULL, error_code text, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,receipt_id) REFERENCES receipts(tenant_id,id)
);
CREATE TABLE receipt_jobs (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, receipt_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RUNNING','COMPLETED','CANCELLED','ERROR')),
 attempts integer NOT NULL DEFAULT 0, lease_token uuid, lease_until timestamptz,
 expected_revision integer NOT NULL, last_error text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,receipt_id), FOREIGN KEY(tenant_id,receipt_id) REFERENCES receipts(tenant_id,id)
);
CREATE INDEX receipt_job_queue ON receipt_jobs(status,lease_until,created_at);
