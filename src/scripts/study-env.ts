import {spawn,type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,rm,writeFile} from 'node:fs/promises';
import {resolve,sep,basename} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import pg from 'pg';
import {migrate,seed} from './database.js';
import {loadTasks,systemDecision,accounts,type StudyTask} from './study-tasks.js';

// Usage: study:rehearse runs all ten tasks once each in fresh schemas and removes them.
//        study:prepare -- U03 keeps one fresh task environment open for one participant session.
assert.ok(process.env.TEST_DATABASE_URL,'Dedicated TEST_DATABASE_URL required');
const [mode,taskId]=process.argv.slice(2);
assert.ok(mode==='rehearse'||(mode==='prepare'&&/^U\d\d$/.test(taskId??'')),'Use: rehearse | prepare U01..U10');
const port=process.env.STUDY_PORT??'43140',base=`http://127.0.0.1:${port}/api/v1`;
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
type Env={schema:string;storageRoot:string;admin:pg.Pool;pool:pg.Pool;server:ChildProcess};
type Reply={status:number;body:any};

async function open():Promise<Env>{
  const schema=`study_${randomUUID().replaceAll('-','')}`,storageRoot=resolve('.local',`study_images_${randomUUID()}`);
  const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options',`-c search_path=${schema}`);
  const admin=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,connectionTimeoutMillis:3000});
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool=new pg.Pool({connectionString:url.toString(),connectionTimeoutMillis:3000});await migrate(pool);await seed(pool);
  // Fixture mode: fields are predefined and labelled as such in the UI; never reported as OCR.
  const env={...process.env,DATABASE_URL:url.toString(),RECEIPT_STORAGE_DIR:storageRoot,EXTRACTOR_MODE:'fixture',HOST:'127.0.0.1',PORT:port};
  const server=spawn(process.execPath,[resolve('dist/apps/api/src/server.js')],{cwd:tmpdir(),env,windowsHide:true,stdio:['ignore','ignore','pipe']});
  server.stderr?.on('data',()=>{});
  for(let n=0;n<100;n++){
    if(server.exitCode!==null)throw Error('API exited; run npm run build first');
    try{if((await fetch(base+'/ready')).ok)return {schema,storageRoot,admin,pool,server};}catch{}await pause(100);
  }
  throw Error('API ready timeout');
}
// Removes only this run's own random schema and its validated private image folder.
async function close(e:Env){
  if(e.server.exitCode===null){const ended=new Promise<void>(r=>e.server.once('exit',()=>r()));e.server.kill();await ended;}
  await e.pool.end();
  assert.ok(/^study_[a-f0-9]{32}$/.test(e.schema));await e.admin.query(`DROP SCHEMA IF EXISTS "${e.schema}" CASCADE`);await e.admin.end();
  assert.ok(e.storageRoot.startsWith(resolve('.local')+sep)&&/^study_images_[a-f0-9-]+$/.test(basename(e.storageRoot)));
  await rm(e.storageRoot,{recursive:true,force:true});
}
async function login(role:keyof typeof accounts){
  const r=await fetch(base+'/demo/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account_id:accounts[role]})});
  assert.equal(r.status,201);return (await r.json()).token as string;
}
async function call(token:string,path:string,body?:unknown):Promise<Reply>{
  const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,body:r.status===204?null:await r.json()};
}
async function ok(token:string,path:string,body?:unknown){const r=await call(token,path,body);assert.ok(r.status<300,`${path} ${r.status} ${r.body?.code}`);return r.body;}

// Builds the task state a participant starts from. Only U08/U09 carry history (PROTOCOL.md).
async function prepare(t:StudyTask){
  const owner=await login('OWNER'),token=t.role==='OWNER'?owner:await login('CASHIER');
  if(t.id==='U08'){
    const prior=(await ok(owner,'/orders',{external_id:'STUDY-U08-PRIOR',total_sen:t.total_sen})).order;
    await ok(owner,`/orders/${prior.id}/demo-receipt-images`,{fixture_id:t.fixture,expected_version:1});
  }
  const reference=t.source==='DEPOSIT'?`STUDY-${t.id}-DEPOSIT`:`STUDY-${t.id}`;
  const order=(await ok(token,'/orders',{external_id:reference,total_sen:t.total_sen})).order;
  const receipt=(await ok(token,`/orders/${order.id}/demo-receipt-images`,{fixture_id:t.fixture,expected_version:1})).receipt;
  let oldApproval:any;
  if(t.id==='U09'){
    const v=(await ok(token,`/orders/${order.id}/verifications`,{receipt_id:receipt.id,expected_version:1})).verification;
    oldApproval=(await ok(token,`/verifications/${v.id}/approval-requests`,{expected_version:1})).approval;
    await ok(token,`/receipts/${receipt.id}/corrections`,{fields:{...receipt.fields,customer_reference:'DEMO-ORDER-U09'},reason:'Customer reference corrected by customer',expected_revision:1,expected_version:1});
  }
  return {token,order,receipt,reference,oldApproval};
}

async function rehearse(t:StudyTask){
  const env=await open();
  try{
    const s=await prepare(t),guards:Record<string,string>={};
    let decision:string,flags:string[]=[];
    if(t.id==='U09'){
      const current=(await ok(s.token,'/approvals')).approvals.find((a:any)=>a.id===s.oldApproval.id);
      const old=await call(s.token,`/approvals/${current.id}/decision`,{decision:'APPROVE',reason:'Rehearsal: attempt to reuse old approval',expected_version:current.version});
      guards.old_approval=`${current.status} -> ${old.status} ${old.body.code}`;
      assert.equal(old.status,409);decision=old.body.code==='STALE_APPROVAL'?'RERUN_REVIEW':'UNEXPECTED';
      const rerun=(await ok(s.token,`/orders/${s.order.id}/verifications`,{receipt_id:s.receipt.id,expected_version:1})).verification;
      flags=rerun.result.flags;guards.new_review=`revision ${rerun.evidence_revision}: ${systemDecision(rerun.result,t.role)}`;
    }else{
      const v=(await ok(s.token,`/orders/${s.order.id}/verifications`,{receipt_id:s.receipt.id,expected_version:1})).verification;
      flags=v.result.flags;decision=systemDecision(v.result,t.role);
      // Exercise the most permissive action the role has, then check what the server actually allowed.
      if(decision==='CONFIRM_WITH_PERMISSION'){
        const r=await call(s.token,`/verifications/${v.id}/confirm`,{expected_version:1});guards.confirm=`${r.status}`;
      }else if(t.role==='CASHIER'){
        const r=await call(s.token,`/verifications/${v.id}/confirm`,{expected_version:1});guards.confirm=`${r.status} ${r.body.code}`;
        const rel=await call(s.token,`/orders/${s.order.id}/release`,{expected_version:1});guards.release=`${rel.status} ${rel.body.code}`;
      }else{
        const a=await call(s.token,`/verifications/${v.id}/approval-requests`,{expected_version:1});
        const d=a.status===201?await call(s.token,`/approvals/${a.body.approval.id}/decision`,{decision:'APPROVE',reason:'Rehearsal: owner override attempt',expected_version:1}):a;
        guards.owner_approve=`${d.status} ${d.body.code??d.body.status}`;
      }
    }
    const order=(await ok(s.token,`/orders/${s.order.id}`)).order;
    const paid=order.payment_state==='PAID';
    // A confirm task must reach PAID but stay ON_HOLD (release is separate); every other task must stay UNPAID.
    const stateOk=decision==='CONFIRM_WITH_PERMISSION'?paid&&order.fulfillment_state==='ON_HOLD':order.payment_state==='UNPAID'&&order.fulfillment_state==='ON_HOLD';
    const allocations=Number((await env.pool.query('SELECT count(*) FROM payment_allocations WHERE order_id=$1',[s.order.id])).rows[0].count);
    return {id:t.id,role:t.role,reference:s.reference,extractor_mode:'fixture',expected_decision:t.expected_decision,system_decision:decision,
      match:decision===t.expected_decision&&stateOk&&allocations===(paid?1:0),flags,guards,final_state:{payment:order.payment_state,fulfillment:order.fulfillment_state,allocations}};
  }finally{await close(env);}
}

const tasks=await loadTasks();
if(mode==='rehearse'){
  const started=new Date(),rows=[];
  for(const t of tasks){const row=await rehearse(t);rows.push(row);console.log(`${row.match?'PASS':'FAIL'}: ${t.id} expected ${t.expected_decision}, system ${row.system_decision}`);}
  const dir=resolve('evaluation/study/rehearsal');await mkdir(dir,{recursive:true});
  const report={kind:'automated system rehearsal; no participants',task_version:'synthetic-decision-tasks.v1',started_at:started.toISOString(),finished_at:new Date().toISOString(),
    node:process.version,platform:`${process.platform}-${process.arch}`,passed:rows.filter(r=>r.match).length,total:rows.length,rows};
  await writeFile(resolve(dir,`rehearsal-${started.toISOString().replaceAll(':','-').replace('.','-')}.json`),JSON.stringify(report,null,2)+'\n');
  await writeFile(resolve(dir,'latest.json'),JSON.stringify(report,null,2)+'\n');
  console.log(`${report.passed}/${report.total} tasks matched the observer key; report in evaluation/study/rehearsal/latest.json`);
  if(report.passed!==report.total)process.exitCode=1;
}else{
  const t=tasks.find(x=>x.id===taskId);assert.ok(t,'Unknown task');
  const env=await open();
  let closing=false;const stop=async()=>{if(closing)return;closing=true;await close(env);console.log('Environment removed.');process.exit(0);};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  try{
    const s=await prepare(t);
    console.log(`Task ${t.id} ready at http://127.0.0.1:${port}`);
    console.log(`Sign in as: Demo A ${t.role==='OWNER'?'Owner':'Cashier'}; open order ${s.reference}. Mode: fixture (predefined fields, not OCR).`);
    console.log('Do not show the observer answer key. Press Enter (or Ctrl+C) after the task to remove this environment.');
    // Enter works the same on Windows and Linux terminals, where signal delivery through npm differs.
    process.stdin.once('data',()=>void stop());process.stdin.once('end',()=>void stop());
  }catch(e){await stop();throw e;}
}
