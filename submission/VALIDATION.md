# Submission layout validation

24 October 2026, Windows and Node.js 24.

- Existing GitHub source from a16fc0e relocated into src/ without changing application logic.
- npm ci --no-audit --no-fund: passed, 256 packages installed.
- npm run build from src/: passed. Vite retained its existing warning about the separately loaded 3D scene chunk exceeding 500 kB.
- npm test from src/ with a dedicated local PostgreSQL test database: 127 passed, zero failed, zero skipped.
- Root Replit commands now enter src/ before installing, building or starting. This layout has not been redeployed to Replit; the existing live deployment is unchanged.

This update organizes the published V4 source. Later demo-reset and English-bot changes in the development workspace are not included in this restructuring commit. Prior source validation details are retained in src/submission/VALIDATION.md.

Formal PDFs, proof-of-use PDFs and public pitch video are pending. Screenshots are reviewed historical evidence, not proof that these remaining deliverables are complete.
