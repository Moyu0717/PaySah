import type pg from 'pg';
import type {CleanableReceiptStorage} from './storage.js';

export async function cleanupReceiptObjects(pool:pg.Pool,storage:CleanableReceiptStorage,cutoff=Date.now()-86400000){
  let removed=0;
  for(const key of await storage.candidates(cutoff)){
    const tenant=key.split('/')[0],client=await pool.connect();
    try{
      await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`m2:${tenant}`]);
      if(!(await client.query('SELECT 1 FROM receipts WHERE storage_key=$1',[key])).rowCount){await storage.remove(key);removed++;}
      await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
  return removed;
}
