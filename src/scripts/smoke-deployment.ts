import {spawn,type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {rm} from 'node:fs/promises';
import {resolve,sep,basename} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import pg from 'pg';
import {migrate,seed} from './database.js';

assert.ok(process.env.TEST_DATABASE_URL,'Dedicated TEST_DATABASE_URL required');
const schema=`deploy_${randomUUID().replaceAll('-','')}`,storageRoot=resolve('.local',`deploy_images_${randomUUID()}`);
const url=new URL(process.env.TEST_DATABASE_URL);url.searchParams.set('options',`-c search_path=${schema}`);
const admin=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,connectionTimeoutMillis:3000});
let pool:pg.Pool|undefined,group:ChildProcess|undefined;
const env={...process.env,DATABASE_URL:url.toString(),RECEIPT_STORAGE_DIR:storageRoot,STORAGE_DRIVER:'local',EXTRACTOR_MODE:'cpu_ocr',WORKER_IDLE_MAX_MS:'1000',HOST:'127.0.0.1',PORT:'43131',REPL_ID:'',REPLIT_DEPLOYMENT:''};
const base='http://127.0.0.1:43131/api/v1';
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function start(mode='cpu_ocr'){
  group=spawn(process.execPath,[resolve('dist/apps/api/src/deployment.js')],{cwd:tmpdir(),env:{...env,EXTRACTOR_MODE:mode},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  group.stdout?.on('data',()=>{});group.stderr?.on('data',()=>{});
  let ready=false;group.on('message',value=>{if((value as {type?:string}).type==='ready')ready=true;});
  for(let n=0;n<150;n++){
    if(group.exitCode!==null)throw Error('Deployment exited before readiness');
    if(ready){const response=await fetch(base+'/ready');if(response.ok)return;}
    await pause(100);
  }
  throw Error('Deployment ready timeout');
}
async function stop(){
  const child=group;group=undefined;if(!child||child.exitCode!==null)return;
  const ended=new Promise<void>((resolveExit,reject)=>{child.once('exit',code=>code===0?resolveExit():reject(Error(`Deployment shutdown ${code}`)));});
  const timeout=setTimeout(()=>child.kill('SIGKILL'),45000);
  child.send({type:'shutdown'});
  try{await ended;}finally{clearTimeout(timeout);}
}
let token='';
async function api(path:string,body?:unknown){
  const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:body===undefined?undefined:JSON.stringify(body)});
  assert.ok(response.ok,`${path} status ${response.status}`);return response.json();
}
try{
  await admin.query(`CREATE SCHEMA "${schema}"`);pool=new pg.Pool({connectionString:url.toString(),connectionTimeoutMillis:3000});await migrate(pool);await seed(pool);
  await start();token=(await api('/demo/sessions',{account_id:'20000000-0000-4000-8000-000000000001'})).token;
  const orderId='40000000-0000-4000-8000-000000000002';
  const receipt=(await api(`/orders/${orderId}/demo-receipt-images`,{fixture_id:'high_value',expected_version:1})).receipt;
  assert.equal(receipt.extraction_state,'PENDING');
  let run:any;
  for(let n=0;n<200;n++){
    run=(await api(`/receipts/${receipt.id}/extractions`)).runs[0];
    if(run&&run.status!=='RUNNING')break;await pause(200);
  }
  assert.equal(run?.status,'COMPLETED');assert.equal(run.fields.amount_sen,78000);
  const verification=(await api(`/orders/${orderId}/verifications`,{receipt_id:receipt.id,expected_version:1})).verification;
  assert.equal(verification.result.required_role,'OWNER');assert.equal(verification.result.eligible,true);
  const approval=(await api(`/verifications/${verification.id}/approval-requests`,{expected_version:1})).approval;
  await api(`/approvals/${approval.id}/decision`,{decision:'APPROVE',reason:'Deployment smoke independent synthetic credit',expected_version:1});
  await api(`/orders/${orderId}/release`,{expected_version:2});
  await stop();await start();
  const order=(await api(`/orders/${orderId}`)).order;assert.equal(order.payment_state,'PAID');assert.equal(order.fulfillment_state,'RELEASED');
  assert.equal((await fetch(base+`/receipts/${receipt.id}/image`,{headers:{Authorization:`Bearer ${token}`}})).status,200);
  await stop();await start('fixture');assert.equal((await api('/health')).extractor_mode,'fixture');await stop();
  await start('manual');assert.equal((await api('/health')).extractor_mode,'manual');await stop();
  console.log('PASS: compiled supervisor from non-project cwd; automatic CPU worker; actual OCR → Owner approval → release; graceful group restart retains private image and state; fixture/manual start without worker or GPU keys. LOCAL STORAGE ONLY; Replit NOT RUN.');
}finally{
  await stop();await pool?.end();await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.end();
  assert.ok(storageRoot.startsWith(resolve('.local')+sep)&&/^deploy_images_[a-f0-9-]+$/.test(basename(storageRoot)));await rm(storageRoot,{recursive:true,force:true});
}
