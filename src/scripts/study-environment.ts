import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {readFile,rm,access} from 'node:fs/promises';
import {resolve,sep,basename} from 'node:path';
import type {Server} from 'node:http';
import {z} from 'zod';
import assert from 'node:assert/strict';
import {migrate,seed} from './database.js';
import {createApp} from '../apps/api/src/app.js';
import {readConfig} from '../apps/api/src/config.js';
import {webRoot} from '../apps/api/src/paths.js';
import {LocalReceiptStorage} from '../apps/api/src/modules/receipts/storage.js';

const inputSchema=z.object({id:z.string().regex(/^U(?:0[1-9]|10)$/),role:z.enum(['OWNER','CASHIER']),total_sen:z.number().int().positive(),context:z.enum(['SALES_ORDER','DEPOSIT']),fixture:z.string(),history:z.string().optional()});
export async function createStudyEnvironment(taskId:string,port=0){
  assert.ok(process.env.TEST_DATABASE_URL,'Dedicated TEST_DATABASE_URL required; never production');
  const inputs=JSON.parse(await readFile('fixtures/study/scenarios.json','utf8'));
  const task=inputSchema.parse(inputs.scenarios.find((s:{id:string})=>s.id===taskId));
  // Only study inputs are loaded here. Observer answers/feedback never enter app setup.
  await access(resolve(webRoot,'index.html'));
  const schema=`study_${randomUUID().replaceAll('-','')}`,root=resolve('.local',`study_images_${randomUUID()}`);
  const url=new URL(process.env.TEST_DATABASE_URL);url.searchParams.set('options',`-c search_path=${schema}`);
  const admin=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,connectionTimeoutMillis:3000});
  let pool:pg.Pool|undefined,server:Server|undefined,closed=false;
  async function close(){
    if(closed)return;closed=true;
    try{if(server)await new Promise<void>((done,reject)=>server!.close(error=>error?reject(error):done()));}
    finally{
      await pool?.end();
      try{await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);}finally{await admin.end();}
      assert.ok(root.startsWith(resolve('.local')+sep)&&/^study_images_[a-f0-9-]+$/.test(basename(root)));
      await rm(root,{recursive:true,force:true});
    }
  }
  try{
    await admin.query(`CREATE SCHEMA "${schema}"`);pool=new pg.Pool({connectionString:url.toString(),connectionTimeoutMillis:3000});await migrate(pool);await seed(pool);
    const storage=new LocalReceiptStorage(root);
    const config=readConfig({DATABASE_URL:url.toString(),EXTRACTOR_MODE:'fixture',STORAGE_DRIVER:'local'});
    server=createApp(config,webRoot,pool,storage).listen(port,'127.0.0.1');
    await new Promise<void>((done,reject)=>{server!.once('listening',done);server!.once('error',reject);});
    const address=server.address();assert.ok(address&&typeof address!=='string');
    const base=`http://127.0.0.1:${address.port}/api/v1`,tokens:{owner:string;cashier:string}={owner:'',cashier:''};
    async function call(path:string,body?:unknown,actor:'owner'|'cashier'='owner'){
      return fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${tokens[actor]}`,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:body===undefined?undefined:JSON.stringify(body)});
    }
    async function ok(path:string,body?:unknown,actor:'owner'|'cashier'='owner'){
      const response=await call(path,body,actor);assert.ok(response.ok,`Study setup ${path}: HTTP ${response.status}`);return response.json();
    }
    tokens.owner=(await ok('/demo/sessions',{account_id:'20000000-0000-4000-8000-000000000001'})).token;
    tokens.cashier=(await ok('/demo/sessions',{account_id:'20000000-0000-4000-8000-000000000002'})).token;
    const create=async(reference:string,total_sen:number)=>(await ok('/orders',{external_id:reference,total_sen})).order;
    const image=async(orderId:string)=>(await ok(`/orders/${orderId}/demo-receipt-images`,{fixture_id:task.fixture,expected_version:1})).receipt;
    if(task.id==='U08'){const prior=await create('STUDY-U08-PRIOR',12800);await image(prior.id);}
    const order=await create(`STUDY-${task.id}-${task.context}`,task.total_sen),receipt=await image(order.id);
    const verification=(await ok(`/orders/${order.id}/verifications`,{receipt_id:receipt.id,expected_version:1})).verification;
    let oldApprovalId:string|undefined;
    if(task.id==='U09'){
      oldApprovalId=(await ok(`/verifications/${verification.id}/approval-requests`,{expected_version:1},'cashier')).approval.id;
      await ok(`/receipts/${receipt.id}/corrections`,{expected_revision:1,expected_version:1,fields:{...receipt.fields,customer_reference:'STUDY-CORRECTED-NOTE'},reason:'Correct synthetic customer note before the study'});
    }
    return {task,orderId:order.id,receiptId:receipt.id,verificationId:verification.id,oldApprovalId,base,url:`http://127.0.0.1:${address.port}/#orders/${order.id}`,schema,call,ok,close};
  }catch(error){await close();throw error;}
}
