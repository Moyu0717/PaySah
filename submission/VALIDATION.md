# Source release validation

Checked on 24 October 2026 using a separate source export on Windows and Node.js 24.

- `npm ci --no-audit --no-fund`: passed, 249 packages installed from the lockfile.
- `npm run build`: passed, including TypeScript checks, Vite production build and API compilation.
- `npm test`: passed, 127 tests, zero failures and zero skips, using a dedicated local PostgreSQL test database and isolated schemas.
- Export integrity and private-value scans: passed before publication. Concurrent UI edits in the development workspace are excluded; this release retains the tested V3 snapshot. Scanning is a preventive check, not a guarantee against every possible secret format.

Initial offline installation failed because the npm cache was incomplete. Initial database checks were blocked by sandbox networking, then found PostgreSQL stopped; tests passed after starting the existing portable database and allowing local connections.

Browser smoke tests, Linux execution, cloud redeployment and live channel acceptance were not rerun for this export. Earlier project checks do not establish those checks for this published snapshot. No real payment data was used.

