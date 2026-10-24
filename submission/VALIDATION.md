# V4 source validation

Checked on 24 October 2026 on Windows, Node.js 24, local PostgreSQL and installed Chrome. This release matches 138 SHA-256-verified source/configuration files (the fixture README is separately adapted for public documentation) from the final clean-source run: a new allowlisted copy installed dependencies with npm ci and passed build, 127 tests with zero skips, the local CPU deployment/restart smoke test, and 11 business browser scenarios. The final workspace also passed 5 intake browser scenarios and 8 V4 layout/story checks with zero page errors.

The V4 checks cover desktop and 360/390/768px reflow, keyboard focus/Enter, human confirmation and separate release, blocked Owner exceptions, four story cases, live reduced-motion preference, unavailable WebGL/context loss, slow/failed scene import, and repeated scene cleanup. Workspace navigation does not load the story/Three.js chunk. The intake suite preserves link generation/revocation, automatic refresh, editing drafts and old-evidence behavior. All data is synthetic and database work uses disposable schemas.

Final selected palette pairs measure 4.64 to 6.57:1. This is not a complete accessibility certification. Physical phones/keyboards, full screen-reader and multi-browser checks, actual 200% browser zoom (720px reflow was used), Linux/Replit and hardware frame-rate targets were not tested. No-blur fallback was simulated with the test switch. No real Telegram/Form messages, live channel acceptance or cloud deployment are established by these local checks.

The scene chunk is about 129 kB gzip and loads only in the story. Its minified size is above Vite's default 500 kB warning threshold; that warning remains visible. npm audit reports 6 moderate and 3 high findings in existing unchanged dependency packages, with no finding attributed to the new Three.js dependency. No unrelated dependency fixes are included.

Initial browser attempts included sandbox database denial and corrected expectations for preserved sessions and accessible link names. The skip-link focus and disabled-button contrast issues found during review were fixed before the final passing run. Raw local logs and private evidence are intentionally excluded from this public source release.

The public export itself also completed npm ci --no-audit --no-fund (256 packages) and npm run build successfully before publication. Package deprecation and the existing Vite chunk-size warning remain visible; no raw local installation/build logs are published.
