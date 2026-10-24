import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {supervise} from '../../apps/api/src/process-group.js';
import {runWorkerLoop} from '../../apps/api/src/modules/receipts/worker-loop.js';
import {ReplitReceiptStorage,type ObjectClient} from '../../apps/api/src/modules/receipts/replit-storage.js';
import {readConfig} from '../../apps/api/src/config.js';

const tenant='10000000-0000-4000-8000-000000000001';
function memoryClient(){
  const objects=new Map<string,Buffer>();let failed=false;
  const fail={ok:false as const,error:{message:'provider detail must not escape'}};
  const client:ObjectClient={
    async uploadFromBytes(key,bytes){if(failed)return fail;objects.set(key,Buffer.from(bytes));return {ok:true,value:null};},
    async downloadAsBytes(key){return objects.has(key)&&!failed?{ok:true,value:[objects.get(key)!]}:fail;},
    async delete(key){if(failed)return fail;objects.delete(key);return {ok:true,value:null};},
    async list(){return failed?fail:{ok:true,value:[...objects.keys()].map(name=>({name}))};},
  };
  return {client,objects,setFailed:()=>{failed=true;}};
}
test('private Replit adapter preserves binary bytes, isolates prefix and rejects arbitrary keys',async()=>{
  const mock=memoryClient(),storage=new ReplitReceiptStorage(mock.client,'demo-v1');
  const bytes=Buffer.from([0,255,128,1,42]),key=await storage.put(tenant,bytes);
  assert.deepEqual(await storage.read(key),bytes);
  assert.ok(mock.objects.has(`demo-v1/${key}`));
  for(const invalid of ['../secret',`${tenant}/../../secret`,key+'?url=public']){
    await assert.rejects(storage.read(invalid),/Invalid storage key/);
    await assert.rejects(storage.remove(invalid),/Invalid storage key/);
  }
  await assert.rejects(storage.put('../escape',bytes),/Invalid storage key/);
  await storage.remove(key);await storage.remove(key);assert.equal(mock.objects.size,0);
});
test('cloud orphan candidates include only old generated objects in the configured namespace',async()=>{
  const mock=memoryClient(),storage=new ReplitReceiptStorage(mock.client,'demo-v1');
  const key=await storage.put(tenant,Buffer.from('synthetic'));
  mock.objects.set('other/'+key,Buffer.alloc(1));mock.objects.set('demo-v1/../../danger',Buffer.alloc(1));
  assert.deepEqual(await storage.candidates(Date.now()-86400000),[]);
  assert.deepEqual(await storage.candidates(Date.now()+1000),[key]);
  mock.setFailed();
  for(const work of [()=>storage.put(tenant,Buffer.alloc(1)),()=>storage.read(key),()=>storage.remove(key),()=>storage.candidates(Date.now())]){
    await assert.rejects(work(),error=>error instanceof Error&&!error.message.includes('provider detail'));
  }
});
test('cloud configuration requires explicit bucket and safe prefix; invalid backoff fails closed',()=>{
  assert.throws(()=>readConfig({STORAGE_DRIVER:'replit'}));
  assert.throws(()=>readConfig({STORAGE_DRIVER:'replit',REPLIT_STORAGE_BUCKET_ID:'dedicated',REPLIT_STORAGE_PREFIX:'../public'}));
  assert.throws(()=>readConfig({WORKER_IDLE_MAX_MS:'0'}));
  assert.equal(readConfig({STORAGE_DRIVER:'replit',REPLIT_STORAGE_BUCKET_ID:'dedicated'}).STORAGE_DRIVER,'replit');
});
test('worker empty queue backs off to cap, resets after work and once processes a single attempt',async()=>{
  const controller=new AbortController(),waits:number[]=[],outcomes=[false,false,false,false,true,false];let calls=0;
  await runWorkerLoop(async()=>outcomes[calls++]??false,controller.signal,4000,false,async ms=>{waits.push(ms);if(waits.length===5)controller.abort();});
  assert.deepEqual(waits,[1000,2000,4000,4000,1000]);assert.equal(calls,6);
  calls=0;await runWorkerLoop(async()=>{calls++;return false;},new AbortController().signal,30000,true);
  assert.equal(calls,1);
});
test('worker shutdown interrupts an empty queue sleep immediately',async()=>{
  const controller=new AbortController(),start=Date.now();
  const timer=setTimeout(()=>controller.abort(),25);
  try{await runWorkerLoop(async()=>false,controller.signal);assert.ok(Date.now()-start<750);}
  finally{clearTimeout(timer);}
});
const entry=resolve('tests/fixtures/process-child.cjs');
test('supervisor stops sibling after a child unexpectedly exits',async()=>{
  let children:ReadonlyMap<string,import('node:child_process').ChildProcess>|undefined;
  const code=await supervise([{role:'api',entry},{role:'worker',entry}],{startupMs:3000,shutdownMs:1000,onReady:group=>{children=group;group.get('worker')!.kill('SIGKILL');}});
  assert.equal(code,1);assert.ok(children);for(const child of children.values())assert.ok(child.exitCode!==null||child.signalCode!==null);
});
test('supervisor times out child startup and force-stops an unresponsive child',async()=>{
  const start=Date.now();
  assert.equal(await supervise([{role:'stubborn',entry}],{env:{...process.env,CHILD_MODE:'stubborn'},startupMs:250,shutdownMs:100,onReady:()=>{}}),1);
  assert.ok(Date.now()-start<3000);
});
test('supervisor handles immediate startup failure and graceful group shutdown',async()=>{
  assert.equal(await supervise([{role:'crash',entry}],{env:{...process.env,CHILD_MODE:'crash'},startupMs:3000,shutdownMs:1000}),1);
  let ready=false;
  const code=await supervise([{role:'api',entry},{role:'worker',entry}],{startupMs:3000,shutdownMs:1000,onReady:()=>{
    ready=true;process.emit('message',{type:'shutdown'},undefined);
  }});
  assert.equal(code,0);assert.equal(ready,true);
});
