// I3: integrations/google-form/Code.gs runs in a vm sandbox with Apps Script fakes.
// Nothing here contacts Google; HTTP checks use a loopback double and, when
// TEST_DATABASE_URL is set, the real local intake route in a temporary schema.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {createServer,type Server} from 'node:http';
import {resolve,sep} from 'node:path';
import vm from 'node:vm';
import {Worker} from 'node:worker_threads';
import pg from 'pg';
import sharp from 'sharp';
import {googleFormIntakeSchema} from '../../packages/contracts/src/index.js';
import {migrate,seed} from '../../scripts/database.js';
import {createApp} from '../../apps/api/src/app.js';
import {readConfig} from '../../apps/api/src/config.js';
import {LocalReceiptStorage} from '../../apps/api/src/modules/receipts/storage.js';

const SCRIPT=readFileSync(resolve('integrations/google-form/Code.gs'),'utf8');
const KEY='synthetic-form-key-0123456789abcdefghij';
const TOKEN='S'.repeat(43);
const START=Date.UTC(2026,9,24,1,0,0);

// Plain JS so the same fakes run in the main thread and inside a worker.
const ENV_SRC=String.raw`(function buildEnv(state, deps) {
  let held = false;
  class FakeDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(state.now); }
    static now() { return state.now; }
  }
  const props = {
    getProperty: k => Object.prototype.hasOwnProperty.call(state.props, k) ? state.props[k] : null,
    setProperty: (k, v) => { state.props[k] = String(v); return props; },
    deleteProperty: k => { delete state.props[k]; return props; },
    getProperties: () => Object.assign({}, state.props)
  };
  const responseOf = raw => {
    const r = state.responses[raw];
    if (!r) return null;
    return {
      getId: () => raw,
      getItemResponses: () => r.items.map(it => ({getItem: () => ({getId: () => it.id}), getResponse: () => it.response}))
    };
  };
  const form = {
    getResponse: raw => { if (state.formReadFails) throw new Error('Service unavailable: Forms'); return responseOf(raw); },
    getItems: () => [{getId: () => 111, getType: () => 'TEXT', getTitle: () => 'Submission code'}, {getId: () => 222, getType: () => 'FILE_UPLOAD', getTitle: () => 'Receipt'}],
    getResponses: since => Object.keys(state.responses).filter(raw => (state.responses[raw].at || 0) >= since.getTime()).map(responseOf)
  };
  return {
    Date: FakeDate,
    console: {log: (...a) => state.logs.push(a.join(' '))},
    PropertiesService: {getScriptProperties: () => props},
    LockService: {getScriptLock: () => ({
      tryLock: () => { if (held) throw new Error('nested lock'); if (state.lockBusy) return false; held = true; return true; },
      releaseLock: () => { held = false; }
    })},
    FormApp: {getActiveForm: () => form, openById: () => form},
    DriveApp: {getFileById: id => {
      const f = state.files[id];
      if (!f || state.driveFails) throw new Error('No item with the given ID could be found');
      return {getBlob: () => ({
        getContentType: () => f.mime,
        getBytes: () => f.size ? new Int8Array(f.size) : new Int8Array(Buffer.from(f.base64, 'base64'))
      })};
    }},
    Utilities: {
      DigestAlgorithm: {SHA_256: 'SHA_256'}, Charset: {UTF_8: 'UTF_8'},
      computeDigest: (_alg, value) => Array.from(deps.createHash('sha256').update(String(value), 'utf8').digest()).map(b => b > 127 ? b - 256 : b),
      base64Encode: bytes => Buffer.from(bytes instanceof Int8Array ? bytes.buffer : Int8Array.from(bytes).buffer).toString('base64'),
      getUuid: () => deps.uuid()
    },
    UrlFetchApp: {fetch: (url, params) => {
      state.fetches.push({url: url, method: params.method, contentType: params.contentType, headers: JSON.parse(JSON.stringify(params.headers)), followRedirects: params.followRedirects, muteHttpExceptions: params.muteHttpExceptions, body: JSON.parse(params.payload)});
      const r = deps.fetchSync(url, params);
      if (r.error) throw new Error('Exception: Address unavailable');
      return {getResponseCode: () => r.status, getContentText: () => r.text, getHeaders: () => r.headers || {}};
    }},
    ScriptApp: {
      getProjectTriggers: () => state.triggers.map(n => ({getHandlerFunction: () => n})),
      newTrigger: name => {
        const done = {create: () => { state.triggers.push(name); }};
        return {forForm: () => ({onFormSubmit: () => done}), timeBased: () => ({everyMinutes: n => { state.everyMinutes = n; return done; }})};
      }
    }
  };
})`;
const buildEnv=vm.runInThisContext(ENV_SRC) as (state:any,deps:any)=>Record<string,unknown>;

type Reply={status:number;body?:unknown;headers?:Record<string,string>}|{error:true};
function pngBytes(seed=1){return Buffer.from(`\x89PNG synthetic ${seed}`);}
function makeState(over:Record<string,unknown>={}):any{
 return {now:START,logs:[],fetches:[],triggers:[],lockBusy:false,formReadFails:false,driveFails:false,
  props:{PAYSAH_INTAKE_URL:'https://paysah.example.test/api/v1/intake/google-form',PAYSAH_INTAKE_KEY:KEY,PAYSAH_TOKEN_ITEM_ID:'111',PAYSAH_RECEIPT_ITEM_ID:'222',PAYSAH_MAX_ATTEMPTS:'3'},
  responses:{},files:{},...over};
}
function addResponse(state:any,raw:string,opts:{token?:unknown;files?:string[];mime?:string;bytes?:Buffer;size?:number;at?:number}={}){
 const fileIds=opts.files??['file_'+raw];
 for(const id of fileIds)state.files[id]={mime:opts.mime??'image/png',base64:(opts.bytes??pngBytes(raw.length)).toString('base64'),size:opts.size};
 // Decoy items and reversed order prove lookup is by item ID, not title or position.
 state.responses[raw]={at:opts.at??START,items:[{id:222,response:fileIds},{id:999,response:'Your order code (display only)'},{id:111,response:opts.token===undefined?TOKEN:opts.token}]};
}
function sandbox(state:any,replies:Reply[]|((req:any)=>Reply)){
 const queue=Array.isArray(replies)?[...replies]:null;
 const fetchSync=(url:string,params:any)=>{
  const r=queue?queue.shift():(replies as (req:any)=>Reply)({url,params});
  if(!r)throw new Error('unexpected fetch');
  return 'error' in r?r:{status:r.status,text:JSON.stringify(r.body??{}),headers:r.headers};
 };
 const ctx=vm.createContext(buildEnv(state,{createHash,uuid:randomUUID,fetchSync}));
 vm.runInContext(SCRIPT,ctx,{filename:'Code.gs'});
 return {
  call:(fn:string,...args:unknown[])=>(ctx[fn] as (...a:unknown[])=>unknown)(...args),
  submit:(raw:string)=>(ctx.onFormSubmit as (e:unknown)=>void)({response:{getId:()=>raw}}),
  pending:()=>Object.fromEntries(Object.entries(state.props as Record<string,string>).filter(([k])=>k.startsWith('paysah.pending.')).map(([k,v])=>[k.slice(15),JSON.parse(v)]))
 };
}
const accepted:Reply={status:200,body:{status:'ACCEPTED',reason:null,replayed:false}};
const busy:Reply={status:503,body:{code:'INTAKE_RETRY',message:'retry',correlation_id:'c'}};
function assertNoSecrets(state:any,extra:string[]=[]){
 const logs=state.logs.join('\n'),pending=JSON.stringify(Object.entries(state.props).filter(([k])=>String(k).startsWith('paysah.pending.')));
 for(const secret of [KEY,TOKEN,...extra]){assert.ok(!logs.includes(secret),'log leaked a secret');assert.ok(!pending.includes(secret),'pending state leaked a secret');}
 for(const f of Object.values(state.files) as any[])if(f.base64&&f.base64.length>8){assert.ok(!logs.includes(f.base64));assert.ok(!pending.includes(f.base64));}
}

test('configuration comes only from Script Properties and the key is only sent to the HTTPS intake route',()=>{
 for(const [name,value,pattern] of [
  ['PAYSAH_INTAKE_KEY',undefined,/PAYSAH_INTAKE_KEY/],['PAYSAH_RECEIPT_ITEM_ID',undefined,/PAYSAH_RECEIPT_ITEM_ID/],
  ['PAYSAH_INTAKE_URL','http://paysah.example.test/api/v1/intake/google-form',/https/],['PAYSAH_INTAKE_URL','https://paysah.example.test/collect',/https/],
  ['PAYSAH_INTAKE_URL','https://user@evil.test/api/v1/intake/google-form',/https/],['PAYSAH_TOKEN_ITEM_ID','Order token',/numeric/],
  ['PAYSAH_INTAKE_KEY','short',/32-256/],['PAYSAH_MAX_ATTEMPTS','50',/1-10/]
 ] as const){
  const state=makeState();if(value===undefined)delete state.props[name];else state.props[name]=value;addResponse(state,'r1');
  assert.throws(()=>sandbox(state,[]).submit('r1'),pattern);assert.equal(state.fetches.length,0);
 }
});

test('submission reads fields by item ID and sends exactly the locked contract fields',()=>{
 const state=makeState(),bytes=pngBytes(7);addResponse(state,'2_ABaOn-ud_1',{bytes});const s=sandbox(state,[accepted]);
 s.submit('2_ABaOn-ud_1');
 assert.equal(state.fetches.length,1);const f=state.fetches[0];
 assert.equal(f.url,state.props.PAYSAH_INTAKE_URL);assert.equal(f.method,'post');assert.equal(f.contentType,'application/json');
 assert.deepEqual(f.headers,{'X-Intake-Key':KEY});assert.equal(f.muteHttpExceptions,true);assert.equal(f.followRedirects,false);
 assert.deepEqual(Object.keys(f.body).sort(),['image_base64','mime_type','response_id','submission_token']);
 assert.deepEqual(f.body,{response_id:'2_ABaOn-ud_1',submission_token:TOKEN,mime_type:'image/png',image_base64:bytes.toString('base64')});
 googleFormIntakeSchema.parse(f.body);
 assert.deepEqual(s.pending(),{});assert.match(state.logs.join('\n'),/done 2_ABaOn-ud_1 attempt=1 result=ACCEPTED/);assertNoSecrets(state);
});

test('IDs outside the contract alphabet map to a stable hashed response_id',()=>{
 const state=makeState(),raw='odd id/with+chars';addResponse(state,raw);const s=sandbox(state,[accepted,accepted]);
 s.submit(raw);s.call('enqueueResponsesSince','2026-10-24T00:00:00Z');s.call('retryPendingReceipts');
 const expected='h_'+createHash('sha256').update(raw).digest('hex');
 assert.deepEqual(state.fetches.map((f:any)=>f.body.response_id),[expected,expected]);googleFormIntakeSchema.parse(state.fetches[0].body);
});

test('temporary 429/503/network errors retry the identical payload with bounded backoff',()=>{
 const state=makeState();addResponse(state,'r1');
 const s=sandbox(state,[{status:429,body:{code:'INTAKE_BUSY'},headers:{'Retry-After':'300'}},{error:true},busy,accepted]);
 s.submit('r1');let item=s.pending().r1;assert.equal(item.state,'PENDING');assert.equal(item.attempts,1);assert.equal(item.last,'HTTP_429:INTAKE_BUSY');
 assert.equal(item.next_at,START+300000,'Retry-After above the base delay is honoured');
 state.now+=299000;assert.equal((s.call('retryPendingReceipts') as unknown[]).length,0);assert.equal(state.fetches.length,1,'not due yet');
 state.now+=1000;s.call('retryPendingReceipts');item=s.pending().r1;assert.equal(item.last,'NETWORK');assert.equal(item.attempts,2);assert.equal(item.next_at,state.now+120000);
 state.now+=120000;s.call('retryPendingReceipts');
 // Third attempt hit 503 with PAYSAH_MAX_ATTEMPTS=3, so it stops for a person instead of looping.
 item=s.pending().r1;assert.equal(item.state,'MANUAL');assert.equal(item.last,'RETRY_EXHAUSTED:HTTP_503:INTAKE_RETRY');
 state.now+=86400000;s.call('retryPendingReceipts');assert.equal(state.fetches.length,3);
 assert.ok(state.fetches.every((f:any)=>JSON.stringify(f.body)===JSON.stringify(state.fetches[0].body)),'same response_id and identical payload');
 assert.equal(s.call('requeueReceipt','r1'),true);s.call('retryPendingReceipts');assert.deepEqual(s.pending(),{});assert.equal(state.fetches.length,4);
 assertNoSecrets(state);
});

test('REJECTED and non-retryable HTTP errors stop after one send and wait for a person',()=>{
 const cases:[Reply,string][]=[
  [{status:200,body:{status:'REJECTED',reason:'LINK_INVALID',replayed:false}},'REJECTED:LINK_INVALID'],
  [{status:200,body:{status:'REJECTED',reason:'IMAGE_INVALID',replayed:true}},'REJECTED:IMAGE_INVALID:REPLAYED'],
  [{status:200,body:{unexpected:true}},'HTTP_200_UNEXPECTED'],
  [{status:401,body:{code:'UNAUTHENTICATED'}},'HTTP_401:UNAUTHENTICATED'],[{status:404,body:{code:'NOT_FOUND'}},'HTTP_404:NOT_FOUND'],
  [{status:409,body:{code:'IDEMPOTENCY_CONFLICT'}},'HTTP_409:IDEMPOTENCY_CONFLICT'],[{status:413,body:{code:'PAYLOAD_TOO_LARGE'}},'HTTP_413:PAYLOAD_TOO_LARGE'],
  [{status:422,body:{code:'INVALID_INPUT'}},'HTTP_422:INVALID_INPUT'],[{status:500,body:{code:'<script>'}},'HTTP_500:UNKNOWN']
 ];
 for(const [reply,last] of cases){
  const state=makeState();addResponse(state,'r1');const s=sandbox(state,[reply]);s.submit('r1');
  assert.deepEqual({state:s.pending().r1.state,last:s.pending().r1.last},{state:'MANUAL',last});
  state.now+=86400000;s.call('retryPendingReceipts');assert.equal(state.fetches.length,1);
  assert.equal(Array.isArray(s.call('listPendingReceipts')),true);assert.equal(s.call('dismissReceipt','r1'),true);assert.deepEqual(s.pending(),{});
 }
});

test('local content checks never send invalid submissions; Google read failures retry',()=>{
 const cases:[Parameters<typeof addResponse>[2],string,string][]=[
  [{token:''},'MANUAL','LOCAL_TOKEN_INVALID'],[{token:'short'},'MANUAL','LOCAL_TOKEN_INVALID'],[{token:['x']},'MANUAL','LOCAL_TOKEN_INVALID'],
  [{files:[]},'MANUAL','LOCAL_FILE_COUNT'],[{files:['a','b']},'MANUAL','LOCAL_FILE_COUNT'],
  [{mime:'image/gif'},'MANUAL','LOCAL_MIME_UNSUPPORTED'],[{mime:'application/pdf'},'MANUAL','LOCAL_MIME_UNSUPPORTED'],
  [{size:10485761},'MANUAL','LOCAL_IMAGE_SIZE']
 ];
 for(const [opts,state_,last] of cases){
  const state=makeState();addResponse(state,'r1',opts);const s=sandbox(state,[]);s.submit('r1');
  assert.deepEqual({state:s.pending().r1.state,last:s.pending().r1.last},{state:state_,last});assert.equal(state.fetches.length,0);
 }
 const edge=makeState();addResponse(edge,'r1',{size:10485760,mime:'image/JPG'});const e=sandbox(edge,[accepted]);e.submit('r1');
 assert.equal(edge.fetches[0].body.mime_type,'image/jpeg');assert.equal(Buffer.from(edge.fetches[0].body.image_base64,'base64').length,10485760);
 for(const flag of ['formReadFails','driveFails']){
  const state=makeState({[flag]:true});addResponse(state,'r1');const s=sandbox(state,[accepted]);s.submit('r1');
  assert.equal(s.pending().r1.state,'PENDING');assert.equal(s.pending().r1.last,'LOCAL_READ_FAILED');
  state[flag]=false;state.now+=60000;s.call('retryPendingReceipts');assert.deepEqual(s.pending(),{});assert.equal(state.fetches.length,1);
 }
 const missing=makeState();const m=sandbox(missing,[]);m.submit('gone');assert.equal(m.pending().gone.last,'LOCAL_RESPONSE_MISSING');
});

test('Script Lock: busy lock writes nothing; leases stop duplicate trigger fires from double sending',()=>{
 const busyLock=makeState({lockBusy:true});addResponse(busyLock,'r1');
 assert.throws(()=>sandbox(busyLock,[]).submit('r1'),/lock busy/);assert.deepEqual(Object.keys(busyLock.props).filter(k=>k.startsWith('paysah.')),[]);
 // A run that was claimed and then died: the lease blocks a second sender until it expires.
 const state=makeState();addResponse(state,'r1');const s=sandbox(state,[accepted]);
 state.props['paysah.pending.r1']=JSON.stringify({raw:'r1',state:'PENDING',attempts:1,next_at:0,lease_until:START+600000,lease:'other-run'});
 s.submit('r1');s.call('retryPendingReceipts');assert.equal(state.fetches.length,0);assert.equal(s.pending().r1.attempts,1,'re-registration keeps the counter');
 state.now+=600001;s.call('retryPendingReceipts');assert.equal(state.fetches.length,1);assert.deepEqual(s.pending(),{});
 // Expired lease at the attempt limit becomes manual without another send.
 const last=makeState();addResponse(last,'r2');const l=sandbox(last,[]);
 last.props['paysah.pending.r2']=JSON.stringify({raw:'r2',state:'PENDING',attempts:3,next_at:0,lease_until:START-1,lease:'dead-run'});
 l.call('retryPendingReceipts');assert.equal(l.pending().r2.state,'MANUAL');assert.equal(l.pending().r2.last,'RETRY_EXHAUSTED:LEASE_EXPIRED');assert.equal(last.fetches.length,0);
});

test('backfill re-reads responses, sends at most five per run and the server replay is harmless',()=>{
 const state=makeState();for(let i=0;i<7;i++)addResponse(state,'r'+i,{at:START+i});addResponse(state,'old',{at:START-86400000});
 const s=sandbox(state,()=>({status:200,body:{status:'ACCEPTED',reason:null,replayed:true}}));
 assert.equal(s.call('enqueueResponsesSince','2026-10-24T01:00:00Z'),7);s.call('retryPendingReceipts');
 assert.equal(state.fetches.length,5);assert.equal(Object.keys(s.pending()).length,2);s.call('retryPendingReceipts');
 assert.equal(state.fetches.length,7);assert.deepEqual(s.pending(),{});assert.ok(!state.fetches.some((f:any)=>f.body.response_id==='old'));
 assert.throws(()=>s.call('enqueueResponsesSince','not a date'),/ISO date/);
 assert.match(state.logs.join('\n'),/ACCEPTED:REPLAYED/);
});

test('trigger installer and item-ID helper are explicit, idempotent and never run on load',()=>{
 const state=makeState();const s=sandbox(state,[]);assert.deepEqual(state.triggers,[]);
 s.call('installPaysahTriggers');s.call('installPaysahTriggers');
 assert.deepEqual(state.triggers,['onFormSubmit','retryPendingReceipts']);assert.equal(state.everyMinutes,5);
 assert.throws(()=>s.call('onFormSubmit',{}),/without a response/);
 assert.deepEqual(JSON.parse(JSON.stringify(s.call('logPaysahItems'))),[{id:'111',type:'TEXT',title:'Submission code'},{id:'222',type:'FILE_UPLOAD',title:'Receipt'}]);
});

// Runs Code.gs in a worker so UrlFetchApp.fetch can block while this thread serves real HTTP.
const WORKER_SRC=String.raw`
const {parentPort, workerData} = require('node:worker_threads');
const vm = require('node:vm'), crypto = require('node:crypto');
const buildEnv = vm.runInThisContext(workerData.envSrc);
const ctl = new Int32Array(workerData.sab, 0, 2), data = new Uint8Array(workerData.sab, 8);
function fetchSync(url, params) {
  Atomics.store(ctl, 0, 0);
  parentPort.postMessage({type: 'fetch', url, params});
  Atomics.wait(ctl, 0, 0);
  return JSON.parse(Buffer.from(data.slice(0, ctl[1])).toString());
}
const state = workerData.state, ctx = vm.createContext(buildEnv(state, {createHash: crypto.createHash, uuid: crypto.randomUUID, fetchSync}));
vm.runInContext(workerData.script, ctx, {filename: 'Code.gs'});
const results = [];
for (const [fn, ...args] of workerData.calls) {
  try {
    if (fn === 'advance') { state.now += args[0]; results.push(null); }
    else if (fn === 'submit') results.push(ctx.onFormSubmit({response: {getId: () => args[0]}}) ?? null);
    else results.push(ctx[fn](...args) ?? null);
  } catch (e) { results.push({error: String(e && e.message)}); }
}
parentPort.postMessage({type: 'done', state, results: JSON.parse(JSON.stringify(results))});
`;
async function runScript(state:any,calls:unknown[][]):Promise<{state:any;results:any[]}>{
 const sab=new SharedArrayBuffer(8+65536),ctl=new Int32Array(sab,0,2),data=new Uint8Array(sab,8);
 const worker=new Worker(WORKER_SRC,{eval:true,workerData:{envSrc:ENV_SRC,script:SCRIPT,state,calls,sab}});
 return await new Promise((resolve_,reject)=>{
  worker.on('error',reject);
  worker.on('message',async msg=>{
   if(msg.type==='done'){resolve_(msg);await worker.terminate();return;}
   let reply:unknown;
   try{
    const p=msg.params,r=await fetch(msg.url,{method:'POST',headers:{'Content-Type':p.contentType,...p.headers},body:p.payload,redirect:p.followRedirects===false?'manual':'follow'});
    const headers:Record<string,string>={};r.headers.forEach((v,k)=>{headers[k]=v;});reply={status:r.status,text:await r.text(),headers};
   }catch{reply={error:true};}
   const bytes=Buffer.from(JSON.stringify(reply));assert.ok(bytes.length<=data.length);data.set(bytes);ctl[1]=bytes.length;Atomics.store(ctl,0,1);Atomics.notify(ctl,0);
  });
 });
}
async function listen(server:Server){server.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const a=server.address();assert.ok(a&&typeof a!=='string');return a.port;}

test('real HTTP to a loopback contract double: headers, JSON body and 503 retry',async()=>{
 const seen:any[]=[];let calls=0;
 const server=createServer((req,res)=>{
  const chunks:Buffer[]=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
   const raw=Buffer.concat(chunks).toString();seen.push({path:req.url,key:req.headers['x-intake-key'],type:req.headers['content-type'],raw});
   res.setHeader('Content-Type','application/json');
   if(req.headers['x-intake-key']!==KEY){res.statusCode=401;res.end('{"code":"UNAUTHENTICATED"}');return;}
   const parsed=googleFormIntakeSchema.safeParse(JSON.parse(raw));
   if(!parsed.success){res.statusCode=422;res.end('{"code":"INVALID_INPUT"}');return;}
   if(++calls===1){res.statusCode=503;res.end('{"code":"INTAKE_RETRY"}');return;}
   res.end('{"status":"ACCEPTED","reason":null,"replayed":false}');
  });
 });
 const port=await listen(server);
 try{
  const state=makeState();state.props.PAYSAH_INTAKE_URL=`http://127.0.0.1:${port}/api/v1/intake/google-form`;addResponse(state,'loop_1',{bytes:pngBytes(3)});
  const out=await runScript(state,[['submit','loop_1'],['advance',60000],['retryPendingReceipts']]);
  assert.equal(seen.length,2);assert.ok(seen.every(s=>s.path==='/api/v1/intake/google-form'&&s.key===KEY&&String(s.type).startsWith('application/json')));
  assert.equal(seen[0].raw,seen[1].raw,'retry is byte-identical');assert.deepEqual(JSON.parse(seen[0].raw).response_id,'loop_1');
  assert.equal(Object.keys(out.state.props).some(k=>k.startsWith('paysah.pending.')),false);assertNoSecrets(out.state);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});

const url=process.env.TEST_DATABASE_URL,tenant='10000000-0000-4000-8000-000000000001';
test('Code.gs against the real local intake route: accepted once, replayed on backfill, revoked link rejected, no payment',{skip:!url},async()=>{
 assert.ok(url);const schema='test_gform_'+randomUUID().replaceAll('-',''),root=resolve('.local','test_gform_'+randomUUID()),storage=new LocalReceiptStorage(root);
 const config=readConfig({GOOGLE_FORM_ENABLED:'true',GOOGLE_FORM_TENANT_ID:tenant,GOOGLE_FORM_INGEST_KEY:KEY,GOOGLE_FORM_PREFILL_URL:'https://docs.google.com/forms/d/e/synthetic/viewform?entry.111={token}',EXTRACTOR_MODE:'cpu_ocr'});
 const admin=new pg.Pool({connectionString:url,connectionTimeoutMillis:3000});let pool:pg.Pool|undefined,server:Server|undefined;
 try{
  await admin.query(`CREATE SCHEMA "${schema}"`);pool=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`,connectionTimeoutMillis:3000});
  await migrate(pool);await seed(pool);
  server=createApp(config,undefined,pool,storage).listen(0,'127.0.0.1');await new Promise<void>(r=>server!.once('listening',r));
  const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}/api/v1`;
  const call=async(path:string,body:unknown,token=''):Promise<any>=>{const r=await fetch(base+path,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify(body)});const b=await r.json();assert.ok(r.ok,JSON.stringify(b));return b;};
  const owner=(await call('/demo/sessions',{account_id:'20000000-0000-4000-8000-000000000001'})).token;
  const order=async()=>(await call('/orders',{external_id:'GFORM-'+randomUUID(),total_sen:1900},owner)).order;
  const link=async(id:string)=>{const r=await call(`/orders/${id}/intake-links`,{expected_version:1,channel:'GOOGLE_FORM'},owner);return {id:r.link_id as string,token:new URL(r.url).searchParams.get('entry.111')!};};
  const a=await order(),la=await link(a.id),b=await order(),lb=await link(b.id);
  await call(`/orders/${b.id}/intake-links/${lb.id}/revoke`,{expected_version:1},owner);
  const png=await sharp({create:{width:24,height:24,channels:3,background:{r:9,g:80,b:40}}}).png().toBuffer();
  const state=makeState();state.props.PAYSAH_INTAKE_URL=base+'/intake/google-form';
  addResponse(state,'local_ok',{token:la.token,bytes:png,at:START});addResponse(state,'local_revoked',{token:lb.token,bytes:png,at:START+1});
  const out=await runScript(state,[['submit','local_ok'],['submit','local_revoked'],['enqueueResponsesSince','2026-10-24T01:00:00Z'],['retryPendingReceipts'],['listPendingReceipts']]);
  const logs=out.state.logs.join('\n');
  assert.match(logs,/done local_ok attempt=1 result=ACCEPTED\n/);assert.match(logs,/needs attention local_revoked attempt=1 result=REJECTED:LINK_INVALID/);
  assert.match(logs,/done local_ok attempt=1 result=ACCEPTED:REPLAYED/,'backfill replays instead of duplicating');
  assert.deepEqual(out.results[4].map((x:any)=>[x.response,x.state,x.last]),[['local_revoked','MANUAL','REJECTED:LINK_INVALID']]);
  const q=(sql:string,args:unknown[])=>pool!.query(sql,args);
  const receipts=(await q('SELECT intake_channel FROM receipts WHERE order_id=$1',[a.id])).rows;assert.deepEqual(receipts.map(r=>r.intake_channel),['GOOGLE_FORM']);
  assert.equal((await q('SELECT count(*)::int AS n FROM receipts WHERE order_id=$1',[b.id])).rows[0].n,0);
  assert.deepEqual((await q("SELECT external_id,status FROM intake_messages WHERE channel='GOOGLE_FORM' ORDER BY external_id",[])).rows,[{external_id:'local_ok',status:'ACCEPTED'},{external_id:'local_revoked',status:'REJECTED'}]);
  assert.deepEqual((await q('SELECT payment_state FROM orders WHERE id=ANY($1)',[[a.id,b.id]])).rows.map(r=>r.payment_state),['UNPAID','UNPAID']);
  assert.equal((await q('SELECT count(*)::int AS n FROM payment_allocations',[])).rows[0].n,0);
  const stored=JSON.stringify((await q('SELECT * FROM activity_events',[])).rows)+JSON.stringify((await q('SELECT * FROM intake_messages',[])).rows);
  for(const s of [la.token,lb.token,KEY])assert.ok(!stored.includes(s),'token or key persisted');
  assertNoSecrets(out.state,[la.token,lb.token]);
 }finally{
  server?.closeAllConnections();if(server)await new Promise<void>(r=>server!.close(()=>r()));await pool?.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.end();
  assert.ok(root.startsWith(resolve('.local')+sep));await rm(root,{recursive:true,force:true});
 }
});
