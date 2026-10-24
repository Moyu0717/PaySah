# Latest source validation

Checked on 24 October 2026, Windows, Node.js 24, local PostgreSQL and installed Chrome. This source snapshot includes the V4 interface, Owner demo reset, 180-second receipt-worker lease, English Telegram acknowledgements and the reset regression test.

- npm run verify:local from src/: PASS (final run 2026-10-24T13:37:27.679Z).
- Build and TypeScript checks: PASS. The separately loaded 3D scene retains the existing Vite warning above 500 kB.
- Integration tests: 128 passed, zero failures and zero skips.
- Local CPU deployment/startup/restart checks: PASS.
- Browser business checks: 11 passed, including confirmation, separate release, Owner approval, blocked evidence, session isolation and OCR provenance.
- npm run smoke:intake: 5/5 PASS, simulated channels only; no external messages.

An earlier run passed each functional check but failed its final source-integrity guard because a receipt README was edited during verification. The final run used stable files and passed the guard. This was not silently counted as a successful first run.

Root Replit commands enter src/ before installation, build and startup. This GitHub update was not redeployed to Replit; exact parity with the currently deployed source was not independently established. Prior V4 visual checks are historical, documented in src/submission/VALIDATION.md. Physical devices, fresh Linux deployment and real channel replay behavior were not retested in this update.

Formal PDFs, proof-of-use PDFs, public pitch video and slide link remain pending. Public visibility and designated collaborator access are separate submission requirements; collaborator access has not been verified here.
