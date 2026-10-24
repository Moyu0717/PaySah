import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type pg from 'pg';

// Shared by the npm db:migrate / db:seed commands and the optional start-up step of the deployment launcher.
// SQL files are read from `root` (the project root), so this works from any working directory.
export async function migrate(pool: pg.Pool, root = process.cwd()) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(7215001)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const name of (await readdir(join(root, 'db/migrations'))).filter(n => n.endsWith('.sql')).sort()) {
      const sql = await readFile(join(root, 'db/migrations', name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const prior = await client.query('SELECT checksum FROM schema_migrations WHERE name=$1', [name]);
      if (prior.rowCount) {
        if (prior.rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name,checksum) VALUES ($1,$2)', [name, checksum]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function seed(pool: pg.Pool, root = process.cwd()) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const name of (await readdir(join(root, 'db/seeds'))).filter(n => n.endsWith('.sql')).sort()) {
      await client.query(await readFile(join(root, 'db/seeds', name), 'utf8'));
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
