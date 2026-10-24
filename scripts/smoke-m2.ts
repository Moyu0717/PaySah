import {spawn,type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {rm} from 'node:fs/promises';
import {resolve,sep,basename} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import pg from 'pg';
import {migrate,seed} from './database.js';

assert.ok(process.env.TEST_DATABASE_URL,'Dedicated TEST_DATABASE_URL required');
const schema=`smoke_${randomUUID().replaceAll('-','')}`,storageRoot=resolve('.local',`smoke_images_${randomUUID()}`);
const testUrl=new URL(process.env.TEST_DATABASE_URL);testUrl.searchParams.set('options',`-c search_path=${schema}`);
const admin=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,connectionTimeoutMillis:3000});
let pool:pg.Pool|undefined,server:ChildProcess|undefined;
const env={...process.env,DATABASE_URL:testUrl.toString(),RECEIPT_STORAGE_DIR:storageRoot,EXTRACTOR_MODE:'cpu_ocr',HOST:'127.0.0.1',PORT:'43130'};
const base='http://127.0.0.1:43130/api/v1';
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function start(){
  server=spawn(process.execPath,[resolve('dist/apps/api/src/server.js')],{cwd:tmpdir(),env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  server.stderr?.on('data',()=>{});
  for(let n=0;n<100;n++){
    if(server.exitCode!==null)throw Error('API exited');
    try{const r=await fetch(base+'/ready');if(r.ok)return;}catch{}await pause(100);
  }
  throw Error('API ready timeout');
}
async function stop(){const child=server;server=undefined;if(child&&child.exitCode===null){const ended=new Promise<void>(r=>child.once('exit',()=>r()));child.kill();await ended;}}
let token='';
async function api(path:string,body?:unknown){
  const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:body===undefined?undefined:JSON.stringify(body)});
  assert.ok(r.ok,`${path} status ${r.status}`);return r.json();
}
try{
  await admin.query(`CREATE SCHEMA "${schema}"`);pool=new pg.Pool({connectionString:testUrl.toString(),connectionTimeoutMillis:3000});await migrate(pool);await seed(pool);
  await start();token=(await api('/demo/sessions',{account_id:'20000000-0000-4000-8000-000000000001'})).token;
  const orderId='40000000-0000-4000-8000-000000000002';
  const receipt=(await api(`/orders/${orderId}/demo-receipt-images`,{fixture_id:'high_value',expected_version:1})).receipt;
  assert.equal(receipt.extraction_state,'PENDING');
  const worker=spawn(process.execPath,['--import','tsx',resolve('scripts/receipt-worker.ts'),'--once'],{env,windowsHide:true,stdio:['ignore','ignore','pipe']});
  worker.stderr?.on('data',()=>{});
  const timeout=setTimeout(()=>worker.kill(),45000);
  const exit=await new Promise<number|null>((resolveExit,reject)=>{worker.once('exit',resolveExit);worker.once('error',reject);});clearTimeout(timeout);assert.equal(exit,0,'Worker CLI must succeed');
  const runs=(await api(`/receipts/${receipt.id}/extractions`)).runs;assert.equal(runs[0].fields.amount_sen,78000);assert.equal(runs[0].status,'COMPLETED');
  const verification=(await api(`/orders/${orderId}/verifications`,{receipt_id:receipt.id,expected_version:1})).verification;
  assert.equal(verification.result.required_role,'OWNER');assert.equal(verification.result.eligible,true);
  const approval=(await api(`/verifications/${verification.id}/approval-requests`,{expected_version:1})).approval;
  await api(`/approvals/${approval.id}/decision`,{decision:'APPROVE',reason:'Smoke test independent synthetic credit',expected_version:1});
  await api(`/orders/${orderId}/release`,{expected_version:2});
  await stop();await start();
  const order=(await api(`/orders/${orderId}`)).order;assert.equal(order.payment_state,'PAID');assert.equal(order.fulfillment_state,'RELEASED');
  assert.equal((await fetch(base+`/receipts/${receipt.id}/image`,{headers:{Authorization:`Bearer ${token}`}})).status,200);
  console.log('PASS: compiled API from non-project cwd + separate worker CLI + actual CPU OCR + Owner approval + release + API restart and private image persistence.');
}finally{
  await stop();await pool?.end();await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.end();
  assert.ok(storageRoot.startsWith(resolve('.local')+sep)&&/^smoke_images_[a-f0-9-]+$/.test(basename(storageRoot)));await rm(storageRoot,{recursive:true,force:true});
}
