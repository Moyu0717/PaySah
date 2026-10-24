import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, unlink, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

// Development-only PostgreSQL; no system service and no recursive delete/reset.
const run = promisify(execFile);
const root = resolve('.local');
const dataDir = resolve(root, 'postgres17');
const port = 55432;
const action = process.argv[2] ?? 'start';
if (!['start', 'stop', 'status'].includes(action)) throw new Error('Use start, stop or status.');
const binaryPackage = `@embedded-postgres/${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
const { initdb, pg_ctl } = await import(binaryPackage) as { initdb: string; pg_ctl: string };
const execute = (file: string, args: string[]) => run(file, args, { windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 });
// A PostgreSQL daemon can inherit pg_ctl's pipe handles on Windows. No pipes for start.
const startDaemon = (args: string[]) => new Promise<void>((resolveStart, reject) => {
  const child = spawn(pg_ctl, args, { windowsHide: true, stdio: 'ignore' });
  const timer = setTimeout(() => { child.kill(); reject(new Error('PostgreSQL start timed out; check .local/postgres.log.')); }, 60000);
  child.once('error', e => { clearTimeout(timer); reject(e); });
  child.once('exit', code => { clearTimeout(timer); code === 0 ? resolveStart() : reject(new Error('PostgreSQL start failed; check .local/postgres.log.')); });
});
async function exists(path: string) { try { await access(path); return true; } catch { return false; } }

try {
  if (action === 'stop' || action === 'status') {
    const result = await execute(pg_ctl, [action, '-D', dataDir, ...(action === 'stop' ? ['-m', 'fast', '-w'] : [])]);
    console.log(result.stdout.trim());
  } else {
    await mkdir(root, { recursive: true });
    if (!await exists(resolve(dataDir, 'PG_VERSION'))) {
      const passwordPath = resolve(root, 'init-password.tmp');
      await writeFile(passwordPath, 'paysah_local_only\n', { mode: 0o600, flag: 'wx' });
      try {
        await execute(initdb, ['-D', dataDir, '-U', 'paysah', '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C', `--pwfile=${passwordPath}`]);
      } finally { await unlink(passwordPath); }
    }
    if ((await readFile(resolve(dataDir, 'PG_VERSION'), 'utf8')).trim() !== '17') throw new Error('Local cluster major version mismatch.');
    let running = false;
    try { await execute(pg_ctl, ['status', '-D', dataDir]); running = true; } catch { /* Start this project cluster only. */ }
    if (!running) await startDaemon(['start', '-D', dataDir, '-l', resolve(root, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w']);
    const client = new pg.Client({ host: '127.0.0.1', port, user: 'paysah', password: 'paysah_local_only', database: 'postgres', connectionTimeoutMillis: 3000 });
    await client.connect();
    try {
      for (const database of ['paysah', 'paysah_test']) {
        if (!(await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount) {
          await client.query(`CREATE DATABASE "${database}"`);
        }
      }
      console.log(`Local PostgreSQL ready on 127.0.0.1:${port}. Databases: paysah, paysah_test. Data: .local/postgres17`);
    } finally { await client.end(); }
  }
} catch (error) {
  const detail = error as { stderr?: string; message?: string };
  console.error(detail.stderr || detail.message || 'Local PostgreSQL command failed.');
  process.exitCode = 1;
}
