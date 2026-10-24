import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {RunpodEvaluationClient,PROTOCOL,PROMPT_VERSION,redact} from './runpod/client.js';
import {loadEvaluationInputs,checkReview,checkSmokeReport,evaluateSample,summarize} from './runpod/evaluation.js';

const live=process.argv.includes('--live'),limitArg=process.argv.find(a=>a.startsWith('--limit=')),limit=Number(limitArg?.slice(8)??1);
const dataset=await loadEvaluationInputs(limit);
const timestamp=new Date().toISOString(),dir=resolve('evaluation/runpod',`${live?'live':'plan'}-${timestamp.replaceAll(':','-').replaceAll('.','-')}`);
if(!live){
  await mkdir(dir,{recursive:true});
  await writeFile(resolve(dir,'plan.json'),JSON.stringify({checked_at:timestamp,mode:'PLAN_ONLY',actual_runpod_usage:false,protocol:PROTOCOL,prompt_version:PROMPT_VERSION,manifest_sha256:dataset.manifest_sha256,samples:dataset.samples.map(s=>({id:s.id,sha256:s.sha256})),limits:{concurrency:1,submissions:limit,automatic_submission_retries:0},pending:['actual endpoint and model/license/compatibility check','RunPod balance and quote, budget review file','live one-image contract check, then explicit paired 36-image run','actual Usage evidence and masked GPU/endpoint screenshots']},null,2)+'\n');
  console.log(`Plan only: ${limit} synthetic image(s), no network or GPU calls. ${dir}`);
}else{
  const key=process.env.RUNPOD_API_KEY,endpoint=process.env.RUNPOD_ENDPOINT_ID,reviewFile=process.env.RUNPOD_EVAL_REVIEW_FILE;
  if(!key||!endpoint||!reviewFile)throw Error('Set private RunPod credentials and RUNPOD_EVAL_REVIEW_FILE; never paste keys into reports.');
  const review=checkReview(JSON.parse(await readFile(reviewFile,'utf8')),limit,endpoint);
  if(limit>1){
    const smokeFile=process.env.RUNPOD_EVAL_SMOKE_REPORT;
    if(!smokeFile)throw Error('Run a single-image live contract check first, then set RUNPOD_EVAL_SMOKE_REPORT.');
    checkSmokeReport(JSON.parse(await readFile(smokeFile,'utf8')),review,dataset.manifest_sha256);
  }
  await mkdir(dir,{recursive:true});
  const client=new RunpodEvaluationClient({apiKey:key,endpointId:endpoint,timeoutMs:review.per_job_total_seconds*1000});
  const controller=new AbortController(),stop=()=>controller.abort();process.on('SIGINT',stop);process.on('SIGTERM',stop);
  const rows:ReturnType<typeof evaluateSample>[]=[];let status='RUNNING';
  const save=async()=>{
    await writeFile(resolve(dir,'results.json'),JSON.stringify(redact({checked_at:timestamp,status,runpod_usage_evidence:rows.some(r=>r.job_id)?'JOB_ID_OBSERVED':rows.length?'REQUEST_ATTEMPTED_UNCONFIRMED':'NOT_RUN',gpu_execution_evidence:'REQUIRES_PLATFORM_PROOF',manifest_sha256:dataset.manifest_sha256,cpu_checked_at:dataset.cpu_checked_at,protocol:PROTOCOL,prompt_version:PROMPT_VERSION,review,summary:summarize(rows,limit),rows,limitations:'Existing correlated synthetic diagnostic set, not a holdout. CPU/GPU run on different hosts; no application/database writes, approval or release. Reviewed rate-based job bound is not a platform hard spending cap; record actual billing/idle/startup costs separately.',usage_and_screenshots:'NOT PROVIDED'},key),null,2)+'\n');
  };
  await save();
  try{
    for(const sample of dataset.samples){
      if(controller.signal.aborted)break;
      const started=Date.now();
      const result=await client.extract({bytes:sample.bytes,mime_type:sample.mime_type,sha256:sample.sha256},review,controller.signal,async event=>{await appendFile(resolve(dir,'jobs.jsonl'),JSON.stringify({sample_id:sample.id,...event})+'\n');});
      rows.push(evaluateSample(sample,result,Date.now()-started));
      await save();
      // Unknown submission/cancellation must be inspected before risking another job.
      if(result.state==='SUBMISSION_UNKNOWN'||result.cancellation==='FAILED'||result.cancellation==='REQUESTED_NOT_CONFIRMED'||result.error?.startsWith('HTTP_'))break;
    }
    status=controller.signal.aborted?'INTERRUPTED':rows.length===limit?'FINISHED':'STOPPED_EARLY';
  }catch{status='FAILED';process.exitCode=1;}
  finally{await save();process.off('SIGINT',stop);process.off('SIGTERM',stop);}
  console.log(`RunPod evaluation ${status}; retained ${rows.length}/${limit} rows. ${dir}`);
  if(status!=='FINISHED')process.exitCode=1;
}
