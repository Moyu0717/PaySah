import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const base = fileURLToPath(new URL('../../../', import.meta.url));
// Source: <root>/apps/api/src. Compiled: <root>/dist/apps/api/src.
export const projectRoot = existsSync(join(base, 'package.json')) ? base : fileURLToPath(new URL('../', new URL('../../../', import.meta.url)));
export const webRoot = join(projectRoot, 'dist', 'web');
