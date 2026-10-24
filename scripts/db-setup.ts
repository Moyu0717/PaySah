import pg from 'pg';
import { migrate, seed } from './database.js';

const action = process.argv[2];
if (!process.env.DATABASE_URL || !['migrate', 'seed'].includes(action)) {
  console.error('DATABASE_URL and action migrate/seed are required.'); process.exit(1);
}
if (action === 'seed' && process.env.DEMO_MODE !== 'true') {
  console.error('Seeding requires explicit DEMO_MODE=true and a dedicated demo database.'); process.exit(1);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
try {
  await (action === 'migrate' ? migrate(pool) : seed(pool));
  console.log(`Database ${action} complete.`);
} catch (error) {
  console.error(error instanceof Error && error.message.startsWith('Applied migration changed:') ? error.message : `Database ${action} failed; check database availability and schema.`);
  process.exitCode = 1;
} finally { await pool.end(); }
