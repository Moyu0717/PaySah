import pg from 'pg';
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required. See .env.example.'); process.exit(1); }
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
try {
  const result = await pool.query('SELECT version() AS version');
  console.log('PostgreSQL connection OK:', result.rows[0].version);
} catch { console.error('PostgreSQL connection failed. Check DATABASE_URL and database availability.'); process.exitCode = 1; }
finally { await pool.end(); }
