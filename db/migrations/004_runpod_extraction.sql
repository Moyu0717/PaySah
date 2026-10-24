-- RunPod GPU vision extraction as a second provider. Fields stay untrusted input; rules and approvals are unchanged.
ALTER TABLE receipts DROP CONSTRAINT receipts_fields_provider_check;
ALTER TABLE receipts ADD CONSTRAINT receipts_fields_provider_check CHECK(fields_provider IN ('FIXTURE','MANUAL','CPU_OCR','RUNPOD_VLM'));
ALTER TABLE extraction_runs DROP CONSTRAINT extraction_runs_provider_check;
ALTER TABLE extraction_runs ADD CONSTRAINT extraction_runs_provider_check CHECK(provider IN ('CPU_OCR','RUNPOD_VLM'));
-- Provider request id (RunPod/OpenAI completion id) and why a GPU attempt fell back to CPU, if it did.
ALTER TABLE extraction_runs ADD COLUMN provider_request_id text CHECK(length(provider_request_id)<=200);
ALTER TABLE extraction_runs ADD COLUMN fallback_reason text CHECK(fallback_reason IN ('RUNPOD_TIMEOUT','RUNPOD_HTTP_ERROR','RUNPOD_INVALID_OUTPUT','RUNPOD_UNAVAILABLE'));
