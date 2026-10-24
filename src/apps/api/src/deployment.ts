import {fileURLToPath} from 'node:url';
import {readConfig} from './config.js';
import {supervise,type ProcessSpec} from './process-group.js';
import pg from 'pg';
import {checkReady} from './ready.js';
import {migrate,seed} from './database-setup.js';
import {projectRoot} from './paths.js';

try{
  const config=readConfig(process.env);
  if(!config.DATABASE_URL)throw Error('Deployment requires database');
  if((process.env.REPL_ID||process.env.REPLIT_DEPLOYMENT)&&config.STORAGE_DRIVER!=='replit')throw Error('Replit requires private App Storage');
  const pool=new pg.Pool({connectionString:config.DATABASE_URL,connectionTimeoutMillis:3000});
  try{
    // A published Replit app gets its own empty production database; this prepares it (checksummed, locked, idempotent).
    if(config.AUTO_MIGRATE==='true'){await migrate(pool,projectRoot);await seed(pool,projectRoot);console.log('Database migrations and synthetic seed applied.');}
    await checkReady(pool);
  }finally{await pool.end();}
  const specs:ProcessSpec[]=[{role:'api',entry:fileURLToPath(new URL('./server.js',import.meta.url))}];
  if(config.EXTRACTOR_MODE==='cpu_ocr'||config.EXTRACTOR_MODE==='runpod'||config.TELEGRAM_ENABLED==='true'||config.GOOGLE_FORM_ENABLED==='true')specs.push({role:'worker',entry:fileURLToPath(new URL('./receipt-worker.js',import.meta.url))});
  process.exitCode=await supervise(specs,{onReady:()=>{
    console.log(`Deployment processes ready (${specs.map(s=>s.role).join(', ')}); perform an OCR end-to-end check before acceptance.`);
    process.send?.({type:'ready'});
  }});
}catch{console.error('Deployment failed. Check database, private storage and extractor configuration.');process.exitCode=1;}
if(process.connected)process.disconnect();
