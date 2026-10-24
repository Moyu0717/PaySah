import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RunpodEvaluationClient,PROTOCOL,redact} from '../../scripts/runpod/client.js';
import {checkReview,checkSmokeReport,scoreJob,evaluateSample,summarize} from '../../scripts/runpod/evaluation.js';
import {fixtures} from '../../apps/api/src/modules/verification/fixtures.js';
const key='unit-only-private-key',model={model_id:'test/synthetic-model',model_revision:'a'.repeat(40)};
const output={protocol_version:PROTOCOL,fields:fixtures.normal,...model,device:'cuda',gpu_name:'Simulated GPU, not real usage'};
const image={bytes:Buffer.from('synthetic test bytes'),mime_type:'image/png',sha256:'b'.repeat(64)};
function fake(replies:unknown[],options:{maxPolls?:number}={}){
  const calls:Array<{url:string;init:RequestInit|undefined}>=[];
  const fetcher=(async(url:unknown,init?:RequestInit)=>{calls.push({url:String(url),init});const reply=replies.shift();if(reply instanceof Error)throw reply;assert.ok(reply,'Unexpected HTTP request');return Response.json(reply);}) as typeof fetch;
  const client=new RunpodEvaluationClient({apiKey:key,endpointId:'unit-endpoint',timeoutMs:10000,pollMs:1,maxPolls:options.maxPolls,fetch:fetcher,sleep:async()=>{}});
  return {client,calls};
}
test('RunPod client async lifecycle sends image only, not expected answers or payment actions',async()=>{
  const f=fake([{id:'job-1',status:'IN_QUEUE'},{id:'job-1',status:'IN_PROGRESS'},{id:'job-1',status:'COMPLETED',output,delayTime:50,executionTime:100}]);
  const journal:unknown[]=[];const result=await f.client.extract(image,model,undefined,async e=>{journal.push(e);});
  assert.equal(result.state,'COMPLETED');assert.deepEqual(result.output?.fields,fixtures.normal);assert.equal(journal.length,4);
  assert.equal(f.calls.length,3);assert.ok(f.calls[0].url.endsWith('/run'));assert.ok(f.calls[1].url.endsWith('/status/job-1'));
  const body=JSON.parse(String(f.calls[0].init?.body));assert.equal(body.input.image_base64,image.bytes.toString('base64'));assert.equal(body.policy.ttl,10000);
  assert.equal(body.input.expected,undefined);assert.equal(body.input.scenario,undefined);assert.equal(body.input.fields,undefined);
  assert.ok(f.calls.every(c=>c.init?.redirect==='error'));
});
test('completed output must have exact field schema, pinned model identity and CUDA provenance',async()=>{
  for(const invalid of [{...output,fields:{...fixtures.normal,amount_sen:'12800'}},{...output,fields:{...fixtures.normal,amount_sen:12800.5}},{...output,fields:{...fixtures.normal,payment_state:'PAID'}},{...output,device:'cpu'},{...output,model_revision:'c'.repeat(40)}]){
    const f=fake([{id:'job-1',status:'COMPLETED',output:invalid}]);const result=await f.client.extract(image,model);assert.equal(result.state,'INVALID_OUTPUT');assert.equal(result.output,null);
    assert.equal(scoreJob(fixtures.normal,result).correct_fields,0);assert.equal(scoreJob(fixtures.normal,result).total_fields,7);
  }
});
test('provider failures remain failures and raw output is redacted, including credential echoes',async()=>{
  const f=fake([{id:'job-1',status:'FAILED',error:`provider echoed ${key}`,authorization:key}]);const result=await f.client.extract(image,model);
  assert.equal(result.state,'FAILED');assert.equal(result.output,null);assert.ok(!JSON.stringify(result).includes(key));
  assert.deepEqual(redact({image_base64:'private bytes',nested:{api_key:key},message:key},key),{image_base64:'[REDACTED]',nested:{api_key:'[REDACTED]'},message:'[REDACTED]'});
});
test('unknown submission is not retried and job IDs cannot redirect credentialed requests',async()=>{
  const f=fake([Error(`transport echo ${key}`)]);const result=await f.client.extract(image,model);
  assert.equal(result.state,'SUBMISSION_UNKNOWN');assert.equal(f.calls.length,1);assert.ok(!JSON.stringify(result).includes(key));
  const bad=fake([{id:'../../outside',status:'IN_QUEUE'}]);assert.equal((await bad.client.extract(image,model)).state,'SUBMISSION_UNKNOWN');assert.equal(bad.calls.length,1);
});
test('poll limit cancels known job once and retains cancellation confirmation',async()=>{
  const f=fake([{id:'job-1',status:'IN_QUEUE'},{id:'job-1',status:'CANCELLED'}],{maxPolls:0});
  const result=await f.client.extract(image,model);assert.equal(result.error,'JOB_TIMEOUT');assert.equal(result.cancellation,'CONFIRMED');assert.ok(f.calls[1].url.endsWith('/cancel/job-1'));
});
test('mismatched status IDs and unknown states cannot be accepted as another completed job',async()=>{
  const f=fake([{id:'job-1',status:'IN_QUEUE'},{id:'job-2',status:'COMPLETED',output},{id:'job-1',status:'CANCELLED'}]);
  const result=await f.client.extract(image,model);assert.equal(result.error,'JOB_ID_MISMATCH');assert.equal(result.output,null);assert.equal(result.cancellation,'CONFIRMED');
  const bad=fake([{id:'job-1',status:key},{id:'job-1',status:'CANCELLED'}]);const hidden=await bad.client.extract(image,model);assert.equal(hidden.error,'UNKNOWN_JOB_STATE');assert.ok(!JSON.stringify(hidden).includes(key));
});
test('abort before submission makes zero requests; cancellation failures remain visible',async()=>{
  const controller=new AbortController();controller.abort();const f=fake([]);assert.equal((await f.client.extract(image,model,controller.signal)).error,'ABORTED');assert.equal(f.calls.length,0);
  const bad=fake([{id:'job-1',status:'IN_PROGRESS'},Error('cancel failed')],{maxPolls:0});assert.equal((await bad.client.extract(image,model)).cancellation,'FAILED');
});
test('HTTP errors and oversized replies fail without re-submitting',async()=>{
  for(const response of [new Response('secret provider detail',{status:429}),new Response('x'.repeat(262145))]){
    let requests=0;const fetcher=(async()=>{requests++;return response;}) as typeof fetch;
    const client=new RunpodEvaluationClient({apiKey:key,endpointId:'unit-endpoint',timeoutMs:10000,fetch:fetcher});
    const result=await client.extract(image,model);assert.equal(result.state,'SUBMISSION_UNKNOWN');assert.equal(requests,1);assert.ok(result.error==='HTTP_429'||result.error==='RESPONSE_TOO_LARGE');
  }
});
test('budget review is recent, endpoint-bound, pinned and cannot exceed the submitted-job bound',()=>{
  const review={...model,endpoint_id:'unit-endpoint',license_url:'https://example.com/model-license',license_and_compatibility_checked:true,balance_and_quote_checked:true,checked_at:new Date().toISOString(),budget_usd:2,max_rate_usd_per_second:0.001,max_jobs:36,per_job_total_seconds:30,idle_workers_zero_and_spend_controls_checked:true};
  assert.equal(checkReview(review,1,'unit-endpoint').max_jobs,36);
  for(const changed of [{budget_usd:0.001},{checked_at:'2020-01-01T00:00:00Z'},{license_and_compatibility_checked:false},{model_revision:'main'}])assert.throws(()=>checkReview({...review,...changed},1,'unit-endpoint'));
  assert.throws(()=>checkReview(review,1,'another-endpoint'));assert.throws(()=>checkReview({...review,max_jobs:1},2,'unit-endpoint'));
});
test('elapsed deadline triggers cancellation even when the poll allowance is not exhausted',async()=>{
  let clock=0;const calls:string[]=[];
  const fetcher=(async(url:unknown)=>{calls.push(String(url));return Response.json(calls.length===1?{id:'job-1',status:'IN_QUEUE'}:{id:'job-1',status:'CANCELLED'});}) as typeof fetch;
  const client=new RunpodEvaluationClient({apiKey:key,endpointId:'unit-endpoint',timeoutMs:10000,fetch:fetcher,now:()=>clock,sleep:async()=>{clock=10001;}});
  const result=await client.extract(image,model);assert.equal(result.error,'JOB_TIMEOUT');assert.equal(result.cancellation,'CONFIRMED');assert.equal(calls.length,2);
});
test('paired summaries retain failed samples, separate not-attempted rows and do not claim payment',async()=>{
  const sample={id:'test',sha256:image.sha256,file:'images/test.png',expected:fixtures.normal,layout:'ledger',condition:'clear',total_sen:12800,expected_eligible:true,expected_role:'CASHIER' as const,bytes:image.bytes,mime_type:'image/png',cpu:{actual:fixtures.normal,duration_ms:10,correct_fields:7}};
  const success=await fake([{id:'job-1',status:'COMPLETED',output}]).client.extract(image,model);
  const failed=await fake([{id:'job-2',status:'FAILED'}]).client.extract(image,model);
  const summary=summarize([evaluateSample(sample,success,20),evaluateSample(sample,failed,30)],3);
  assert.equal(summary.correct_fields,7);assert.equal(summary.total_fields,14);assert.equal(summary.failed_or_invalid,1);assert.equal(summary.not_attempted,1);assert.equal(summary.cpu_paired_correct_fields,14);
});
test('multi-image runs need a recent successful single-image contract check with identical identity',()=>{
  const identity={endpoint_id:'unit-endpoint',...model};
  const report={checked_at:new Date().toISOString(),status:'FINISHED',runpod_usage_evidence:'JOB_ID_OBSERVED',manifest_sha256:'hash',review:identity,summary:{planned:1,completed_valid:1},rows:[{job_id:'job-1',state:'COMPLETED'}]};
  const review={...identity} as ReturnType<typeof checkReview>;
  assert.equal(checkSmokeReport(report,review,'hash').rows.length,1);
  for(const changed of [{status:'PLAN_ONLY'},{manifest_sha256:'another'},{review:{...identity,endpoint_id:'other'}},{summary:{planned:36,completed_valid:36}},{checked_at:'2020-01-01T00:00:00Z'}])assert.throws(()=>checkSmokeReport({...report,...changed},review,'hash'));
});
