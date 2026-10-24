import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resolve,sep} from 'node:path';
import {readFile,mkdir,cp,copyFile,rm} from 'node:fs/promises';
import type {Server} from 'node:http';
import pg from 'pg';
import {migrate,seed} from '../../scripts/database.js';
import {createApp} from '../../apps/api/src/app.js';
import {readConfig} from '../../apps/api/src/config.js';
import {LocalReceiptStorage} from '../../apps/api/src/modules/receipts/storage.js';
import {CpuExtractor} from '../../apps/api/src/modules/receipts/ocr.js';
import {processReceiptJob} from '../../apps/api/src/modules/receipts/worker.js';
import {processVerificationJob} from '../../apps/api/src/modules/verification/worker.js';

const url=process.env.TEST_DATABASE_URL,tenant='10000000-0000-4000-8000-000000000001';
test('P0-3 fresh database: TG1 real CPU image through Form mock reaches human-confirmable match without paying',{skip:!url},async()=>{
 assert.ok(url);const schema='test_demo_'+randomUUID().replaceAll('-',''),root=resolve('.local','demo_images_'+randomUUID()),admin=new pg.Pool({connectionString:url}),pool=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`}),storage=new LocalReceiptStorage(root),extractor=new CpuExtractor();let server:Server|undefined;
 try{
  await admin.query(`CREATE SCHEMA "${schema}"`);await migrate(pool);await seed(pool);await seed(pool);
  const expected=JSON.parse(await readFile('fixtures/receipts/images/expected.json','utf8')).rows[0],key='synthetic-demo-form-key-01234567890123';
  const config=readConfig({EXTRACTOR_MODE:'cpu_ocr',GOOGLE_FORM_ENABLED:'true',GOOGLE_FORM_TENANT_ID:tenant,GOOGLE_FORM_INGEST_KEY:key,GOOGLE_FORM_PREFILL_URL:'https://docs.google.com/forms/d/e/mock/viewform?entry.1={token}'});
  server=createApp(config,undefined,pool,storage).listen(0,'127.0.0.1');await new Promise<void>(r=>server!.once('listening',r));const a=server.address();assert.ok(a&&typeof a!=='string');const base=`http://127.0.0.1:${a.port}/api/v1`;
  async function post(path:string,body:unknown,token=''){const r=await fetch(base+path,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':randomUUID(),'X-Intake-Key':key},body:JSON.stringify(body)});const b=await r.json();assert.ok(r.ok,JSON.stringify(b));return b;}
  const login=await post('/demo/sessions',{account_id:'20000000-0000-4000-8000-000000000001'}),link=await post(`/orders/${expected.order_id}/intake-links`,{expected_version:1,channel:'GOOGLE_FORM'},login.token);
  const bytes=await readFile('fixtures/receipts/images/'+expected.file),token=new URL(link.url).searchParams.get('entry.1');
  assert.equal((await post('/intake/google-form',{response_id:'demo_cpu_tg1',submission_token:token,mime_type:'image/png',image_base64:bytes.toString('base64')})).status,'ACCEPTED');
  assert.equal(await processReceiptJob(pool,storage,extractor),true);assert.equal(await processVerificationJob(pool,storage),true);
  const v=(await pool.query('SELECT result FROM verifications WHERE tenant_id=$1 AND order_id=$2 AND active',[tenant,expected.order_id])).rows[0].result;
  assert.equal(v.eligible,true);assert.equal(v.required_role,'CASHIER');assert.equal(v.matched_transaction_id,expected.bank_transaction_id);
  const orders=(await pool.query('SELECT external_id,payment_state,fulfillment_state FROM orders ORDER BY external_id')).rows;
  assert.equal(orders.length,6);assert.ok(orders.every(o=>o.payment_state==='UNPAID'&&o.fulfillment_state==='ON_HOLD'));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM payment_allocations')).rows[0].n,0);
 }finally{await extractor.close();server?.closeAllConnections();if(server)await new Promise<void>(r=>server!.close(()=>r()));await pool.end();await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.end();assert.ok(root.startsWith(resolve('.local')+sep));await rm(root,{recursive:true,force:true});}
});
test('P0-3 existing 001–003 seeds upgrade idempotently and never reset used demo orders',{skip:!url},async()=>{
 assert.ok(url);const schema='test_demo_upgrade_'+randomUUID().replaceAll('-',''),root=resolve('.local','demo_upgrade_'+randomUUID()),admin=new pg.Pool({connectionString:url}),pool=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`});
 try{
  await admin.query(`CREATE SCHEMA "${schema}"`);await cp('db/migrations',resolve(root,'db/migrations'),{recursive:true});await mkdir(resolve(root,'db/seeds'),{recursive:true});
  for(const file of ['001_demo.sql','002_verification.sql','003_intake_system.sql'])await copyFile('db/seeds/'+file,resolve(root,'db/seeds',file));
  await migrate(pool,root);await seed(pool,root);const before=(await pool.query('SELECT id,payment_state,fulfillment_state,version FROM orders ORDER BY id')).rows;assert.equal(before.length,3);
  await seed(pool);assert.deepEqual((await pool.query('SELECT id,payment_state,fulfillment_state,version FROM orders WHERE id=ANY($1::uuid[]) ORDER BY id',[before.map(r=>r.id)])).rows,before);
  await pool.query("UPDATE orders SET payment_state='PAID',version=version+1 WHERE external_id='DEMO-A-TG2'");const used=(await pool.query('SELECT * FROM orders ORDER BY id')).rows;
  await migrate(pool);await seed(pool);assert.deepEqual((await pool.query('SELECT * FROM orders ORDER BY id')).rows,used);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM bank_transactions')).rows[0].n,6);
 }finally{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.end();assert.ok(root.startsWith(resolve('.local')+sep));await rm(root,{recursive:true,force:true});}
});
