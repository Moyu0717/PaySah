import pg from 'pg';
import {readConfig} from '../apps/api/src/config.js';
import {createReceiptStorage} from '../apps/api/src/modules/receipts/storage-factory.js';
import {cleanupReceiptObjects} from '../apps/api/src/modules/receipts/cleanup.js';
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000});
const storage=createReceiptStorage(readConfig(process.env));
try{
  const removed=await cleanupReceiptObjects(pool,storage);
  console.log(`Removed ${removed} unreferenced objects older than 24h.`);
}finally{await pool.end();}
