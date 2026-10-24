import {z} from 'zod';
import {readFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {imageHash} from '../../apps/api/src/modules/receipts/storage.js';
import {scoreFields,percentile} from '../ocr-evaluation-metrics.js';
import {receiptFieldsSchema} from '../../packages/contracts/src/index.js';
import {verify,RULE_VERSION,type BankRow} from '../../apps/api/src/modules/verification/rules.js';
import type {JobResult} from './client.js';

const sampleSchema=z.object({id:z.string().regex(/^[a-z0-9_-]+$/),file:z.string().regex(/^images\/[a-z0-9_-]+\.(png|jpg)$/),sha256:z.string().regex(/^[a-f0-9]{64}$/),expected:receiptFieldsSchema,layout:z.string(),condition:z.string(),total_sen:z.number().int().positive(),expected_eligible:z.boolean(),expected_role:z.enum(['OWNER','CASHIER'])}).passthrough();
export async function loadEvaluationInputs(limit:number){
  if(!Number.isInteger(limit)||limit<1||limit>36)throw Error('Limit must be 1..36');
  const root=resolve('fixtures/ocr-expanded'),manifestBytes=await readFile(resolve(root,'manifest.json'));
  const manifest=z.object({version:z.literal('synthetic-layouts.v2'),samples:z.array(sampleSchema).length(36)}).passthrough().parse(JSON.parse(manifestBytes.toString('utf8')));
  if(new Set(manifest.samples.map(s=>s.id)).size!==36)throw Error('Duplicate sample IDs');
  const cpu=JSON.parse(await readFile('evaluation/ocr-expanded/results.json','utf8'));
  if(cpu.manifest_sha256!==imageHash(manifestBytes))throw Error('CPU baseline manifest mismatch');
  if(cpu.rules!==RULE_VERSION)throw Error('CPU baseline rule version mismatch');
  const samples=[];
  for(const sample of manifest.samples.slice(0,limit)){
    const path=resolve(root,sample.file);if(!path.startsWith(root+sep))throw Error('Image escaped dataset');
    const bytes=await readFile(path);if(imageHash(bytes)!==sample.sha256)throw Error('Image hash mismatch');
    const baseline=cpu.rows.find((r:{id:string;sha256:string})=>r.id===sample.id&&r.sha256===sample.sha256);
    if(!baseline)throw Error('CPU baseline sample mismatch');
    samples.push({...sample,bytes,mime_type:sample.file.endsWith('.jpg')?'image/jpeg':'image/png',cpu:{actual:receiptFieldsSchema.parse(baseline.actual),duration_ms:baseline.duration_ms,correct_fields:baseline.correct_fields}});
  }
  return {samples,manifest_sha256:imageHash(manifestBytes),cpu_checked_at:cpu.checked_at};
}
export const reviewSchema=z.object({
  model_id:z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),model_revision:z.string().regex(/^[a-f0-9]{40,64}$/),
  endpoint_id:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),license_url:z.url().refine(s=>s.startsWith('https://')),
  license_and_compatibility_checked:z.literal(true),balance_and_quote_checked:z.literal(true),
  checked_at:z.iso.datetime({offset:true}),budget_usd:z.number().positive(),max_rate_usd_per_second:z.number().positive(),
  max_jobs:z.number().int().min(1).max(36),per_job_total_seconds:z.number().int().min(10).max(300),
  idle_workers_zero_and_spend_controls_checked:z.literal(true),
}).strict();
export function checkReview(value:unknown,limit:number,endpoint:string,now=Date.now()){
  const review=reviewSchema.parse(value);
  const age=now-Date.parse(review.checked_at);
  if(age<0||age>86400000)throw Error('Budget/model review must be checked within the last 24h');
  if(review.endpoint_id!==endpoint||limit>review.max_jobs)throw Error('Endpoint or job allowance mismatch');
  if(limit*review.per_job_total_seconds*review.max_rate_usd_per_second>review.budget_usd)throw Error('Planned worst-case job charge exceeds the reviewed budget');
  return review;
}
export function scoreJob(expected:z.infer<typeof receiptFieldsSchema>,result:JobResult){
  // Failures stay in the denominator; a null prediction is not a successful extraction.
  return result.output?scoreFields(expected,result.output.fields):{correct_fields:0,total_fields:7,mismatches:null,exact:false};
}
export function checkSmokeReport(value:unknown,review:ReturnType<typeof checkReview>,manifestHash:string,now=Date.now()){
  const smoke=z.object({checked_at:z.iso.datetime({offset:true}),status:z.literal('FINISHED'),runpod_usage_evidence:z.literal('JOB_ID_OBSERVED'),manifest_sha256:z.literal(manifestHash),review:z.object({endpoint_id:z.literal(review.endpoint_id),model_id:z.literal(review.model_id),model_revision:z.literal(review.model_revision)}),summary:z.object({planned:z.literal(1),completed_valid:z.literal(1)}),rows:z.array(z.object({job_id:z.string().min(1),state:z.literal('COMPLETED')})).length(1)}).parse(value);
  const age=now-Date.parse(smoke.checked_at);if(age<0||age>86400000)throw Error('Single-image contract check must be within the last 24h');
  return smoke;
}
type Sample=Awaited<ReturnType<typeof loadEvaluationInputs>>['samples'][number];
// Same independent two-credit diagnostic feed used in the CPU benchmark. No DB writes.
const credits:BankRow[]=[12800,78000].map(amount=>({id:`diagnostic-${amount}`,account_identifier:'DEMO-ACCOUNT-A',active:true,version:1,bank_transaction_ref:`DEMO-BANK-${amount===12800?'128':'780'}`,amount_sen:amount,currency:'MYR',direction:'CREDIT',status:'BOOKED',booked_at:'2026-10-22T06:00:00Z',allocated:false}));
export function evaluateSample(sample:Sample,result:JobResult,wallMs:number){
  const rule=result.output?verify({total_sen:sample.total_sen,fields:result.output.fields,accounts:['DEMO-ACCOUNT-A'],transactions:credits,duplicate_evidence:false,duplicate_reference:false,manual:false}):null;
  return {id:sample.id,sha256:sample.sha256,layout:sample.layout,condition:sample.condition,expected:sample.expected,...result,...scoreJob(sample.expected,result),wall_ms:wallMs,cpu_baseline:sample.cpu,rule_result:rule,false_eligible:!sample.expected_eligible&&!!rule?.eligible,role_downgrade:sample.expected_role==='OWNER'&&!!rule?.eligible&&rule.required_role==='CASHIER'};
}
export function summarize(rows:ReturnType<typeof evaluateSample>[],planned:number){
  return {planned,attempted:rows.length,not_attempted:planned-rows.length,completed_valid:rows.filter(r=>r.output).length,failed_or_invalid:rows.filter(r=>!r.output).length,correct_fields:rows.reduce((n,r)=>n+r.correct_fields,0),total_fields:rows.length*7,cpu_paired_correct_fields:rows.reduce((n,r)=>n+r.cpu_baseline.correct_fields,0),exact_samples:rows.filter(r=>r.exact).length,false_eligible:rows.filter(r=>r.false_eligible).length,role_downgrades:rows.filter(r=>r.role_downgrade).length,wall_p50_ms:percentile(rows.map(r=>r.wall_ms),.5),wall_p95_ms:percentile(rows.map(r=>r.wall_ms),.95)};
}
