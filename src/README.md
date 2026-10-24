# PaySah

Payment receipt verification for Malaysian small businesses. Staff compare receipt details with independent bank credits, review explainable flags, and record payment and release decisions.

This is a synthetic-data hackathon demonstration. A receipt image alone never proves payment. No real bank connection or payment processing is included.

## Run locally

Requirements: Node.js 24, npm, and PostgreSQL 17. A portable PostgreSQL helper is included and has been exercised on Windows without Docker.

```powershell
npm ci
Copy-Item .env.example .env
npm run db:local:start
npm run db:migrate
npm run db:seed
npm run dev
```

Copy the environment template only for a fresh checkout; keep existing credentials private. The web app is at http://127.0.0.1:5173 and API at http://127.0.0.1:3000. For a managed PostgreSQL database, configure DATABASE_URL and omit db:local:start. The example database password is for local development only.

Default EXTRACTOR_MODE=fixture uses synthetic fields. Set EXTRACTOR_MODE=cpu_ocr to read actual image pixels and run npm run worker in a separate terminal. Stop the portable database with npm run db:local:stop.

## Workflow

1. Choose a seeded demo staff account and an unpaid order.
2. Attach a synthetic receipt from the catalog or use a configured intake channel.
3. Inspect extracted fields, independent bank-credit matches, and reasons for flags.
4. Resolve missing or conflicting evidence. Partial payment cannot be treated as fully paid; amounts above RM500 require Owner approval.
5. Confirm eligible payment and record release as separate operations. Activity records preserve the decisions.

Tenant boundaries, permissions, versions, and idempotency are enforced server-side. Synthetic labels on receipt images intentionally identify test data.

## Build and verify

```sh
npm run build
npm run start:deployment
```

The deployment entry starts the API and receipt worker. Configure TEST_DATABASE_URL to a dedicated test database before running npm test. Integration tests create isolated schemas; missing database configuration can skip database tests. Browser checks use installed Chrome: npm run smoke:m3, npm run smoke:intake and npm run smoke:ui-v4. npm run verify:clean installs dependencies into a fresh copy and runs local verification. These checks do not establish live Telegram, Google Form, Replit or GPU readiness.

## Replit and RunPod

The included .replit file builds with npm ci and npm run build, then runs the deployment entry. Configure DATABASE_URL and other credentials in Replit Secrets, migrate and seed the dedicated demo database, and set HOST=0.0.0.0. Set STORAGE_DRIVER=replit with a private App Storage bucket for persistent images. Local storage is a development option.

For GPU extraction, set EXTRACTOR_MODE=runpod, RUNPOD_API_KEY, RUNPOD_ENDPOINT_ID and RUNPOD_MODEL on the server. The application adapter uses a RunPod Serverless vLLM endpoint with Qwen/Qwen2.5-VL-7B-Instruct and falls back to CPU OCR on failure while recording the source. Fixture and CPU paths run independently of GPU credits. npm run runpod:check sends one synthetic image and may incur provider charges.

The separate eval:runpod experiment uses a different custom-handler contract; run eval:ocr-expanded to generate its CPU baseline before use. It is not the application adapter.

## Receipt intake

Telegram and Google Form intake are disabled by default. See .env.example and [intake contract](docs/INTAKE_CONTRACT.md). Google Apps Script source is in integrations/google-form. Configure dedicated test accounts and private server secrets before enabling external integrations. A receipt acknowledgement means received, not paid. WhatsApp replies are templates; a live WhatsApp integration is not included.

## Repository contents

- apps/web: React/Vite staff interface.
- apps/api: Express API, verification rules, storage and worker.
- packages/contracts: shared validation contracts.
- db: PostgreSQL migrations and synthetic seed data.
- fixtures, tests, scripts: reproducible datasets and checks.
- submission: tool declaration and outstanding submission requirements.

The current interface is V4 Lavender glass, with a desktop sidebar and dedicated mobile card layouts for orders, receipt review, Owner decisions and activity. The existing tenant, version, approval and intake rules remain in force. Use the root URL or #orders to enter the workspace directly. The public #story page illustrates four synthetic cases without business writes or RunPod calls; Three.js loads only on that page and has a static fallback. Evidence matched is not paid, and payment confirmation and release remain separate actions. Local validation and its limits are recorded in submission/VALIDATION.md; these historical checks do not establish the state of a new cloud deployment. Current operations and reset behavior are documented in docs/DEMO_OPERATIONS.md.

Project license: [Apache-2.0](LICENSE). Third-party software retains its respective licenses; see [Three.js MIT notice](apps/web/THIRD_PARTY_NOTICES.md). See [tool declaration](submission/TOOLS_DECLARATION.md).
