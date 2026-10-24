import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {cpus,totalmem,release} from 'node:os';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {receiptFieldsSchema,type ReceiptFields} from '../packages/contracts/src/index.js';
import {CpuExtractor,OCR_ENGINE_VERSION,PREPROCESSING_VERSION} from '../apps/api/src/modules/receipts/ocr.js';
import {parseReceiptText,PARSER_VERSION} from '../apps/api/src/modules/receipts/parser.js';
import {emptyFields} from '../apps/api/src/modules/receipts/router.js';
import {verify,RULE_VERSION,type BankRow} from '../apps/api/src/modules/verification/rules.js';
import {imageHash} from '../apps/api/src/modules/receipts/storage.js';
import {DATASET_VERSION,layouts,type Manifest,type Sample} from './ocr-dataset.js';
import {scoreFields,percentile} from './ocr-evaluation-metrics.js';

const root=resolve('fixtures/ocr-expanded'),manifestBytes=await readFile(resolve(root,'manifest.json'));
const manifest=JSON.parse(manifestBytes.toString('utf8')) as Manifest;
assert.equal(manifest.version,DATASET_VERSION);assert.equal(manifest.samples.length,36);
assert.equal(new Set(manifest.samples.map(s=>s.id)).size,36);
for(const layout of layouts)assert.equal(manifest.samples.filter(s=>s.layout===layout).length,12);
const transactions:BankRow[]=[{id:'synthetic-credit-128',account_identifier:'DEMO-ACCOUNT-A',active:true,version:1,bank_transaction_ref:'DEMO-BANK-128',amount_sen:12800,currency:'MYR',direction:'CREDIT',status:'BOOKED',booked_at:'2026-10-22T06:00:00Z',allocated:false},{id:'synthetic-credit-780',account_identifier:'DEMO-ACCOUNT-A',active:true,version:1,bank_transaction_ref:'DEMO-BANK-780',amount_sen:78000,currency:'MYR',direction:'CREDIT',status:'BOOKED',booked_at:'2026-10-22T06:00:00Z',allocated:false}];
type EvaluationRow=Pick<Sample,'id'|'layout'|'scenario'|'condition'|'sha256'|'bytes'|'expected'|'expected_eligible'|'expected_role'>&ReturnType<typeof scoreFields>&{
  actual:ReceiptFields;missing_fields:string[];candidates:Record<string,string[]>;raw_text:string;preprocessed_sha256:string|null;error:string|null;
  duration_ms:number;cpu_ms:number;sampled_peak_rss_bytes:number;rule_result:ReturnType<typeof verify>;false_eligible:boolean;role_downgrade:boolean;ocr_review_required:boolean;unflagged_field_error:boolean;human_review_or_block:boolean;
};
const extractor=new CpuExtractor(),rows:EvaluationRow[]=[];
const rssStart=process.memoryUsage.rss(),cpuStart=process.cpuUsage(),start=performance.now();
let peakRss=rssStart,memorySamples=0;
const sampleMemory=()=>{peakRss=Math.max(peakRss,process.memoryUsage.rss());memorySamples++;};
const sampler=setInterval(sampleMemory,25);
try{
  for(const sample of manifest.samples){
    receiptFieldsSchema.parse(sample.expected);
    assert.ok(/^[a-z0-9_-]+$/.test(sample.id));
    assert.ok(/^images\/[a-z0-9_-]+\.(png|jpg)$/.test(sample.file));
    const file=resolve(root,sample.file);assert.ok(file.startsWith(root+sep));
    const bytes=await readFile(file);assert.equal(imageHash(bytes),sample.sha256,`${sample.id}: manifest hash mismatch`);
    const metadata=await sharp(bytes).metadata();assert.equal(metadata.width,sample.width);assert.equal(metadata.height,sample.height);
    const rowStart=performance.now(),rowCpu=process.cpuUsage();
    let localPeak=process.memoryUsage.rss();
    const rowSampler=setInterval(()=>{localPeak=Math.max(localPeak,process.memoryUsage.rss());},25);
    let output:{text:string;preprocessed_sha256:string}|undefined,error:string|null=null;
    try{output=await extractor.extract(bytes);}
    catch(e){error=(e as Error).message==='OCR_TIMEOUT'?'OCR_TIMEOUT':'EXTRACTION_FAILED';}
    finally{clearInterval(rowSampler);sampleMemory();localPeak=Math.max(localPeak,process.memoryUsage.rss());}
    const parsed=output?parseReceiptText(output.text):{fields:{...emptyFields},missing_fields:['extraction'],candidates:{}};
    const duration_ms=Math.round(performance.now()-rowStart),cpu=process.cpuUsage(rowCpu);
    const result=verify({total_sen:sample.total_sen,fields:parsed.fields,accounts:['DEMO-ACCOUNT-A'],transactions,duplicate_evidence:false,duplicate_reference:false,manual:false});
    const score=scoreFields(sample.expected,parsed.fields);
    const row={id:sample.id,layout:sample.layout,scenario:sample.scenario,condition:sample.condition,sha256:sample.sha256,bytes:bytes.length,expected:sample.expected,actual:parsed.fields,...score,missing_fields:parsed.missing_fields,candidates:parsed.candidates,raw_text:output?.text??'',preprocessed_sha256:output?.preprocessed_sha256??null,error,duration_ms,cpu_ms:Math.round((cpu.user+cpu.system)/1000),sampled_peak_rss_bytes:localPeak,expected_eligible:sample.expected_eligible,expected_role:sample.expected_role,rule_result:result,false_eligible:!sample.expected_eligible&&result.eligible,role_downgrade:sample.expected_role==='OWNER'&&result.eligible&&result.required_role==='CASHIER',ocr_review_required:parsed.missing_fields.length>0,unflagged_field_error:!score.exact&&parsed.missing_fields.length===0,human_review_or_block:!result.eligible||result.required_role==='OWNER'};
    rows.push(row);
    console.log(`${row.id}: ${score.correct_fields}/7; ${duration_ms}ms; eligible=${result.eligible}; missing=${parsed.missing_fields.join(',')||'none'}; wrong=${score.mismatches.join(',')||'none'}`);
  }
}finally{clearInterval(sampler);sampleMemory();await extractor.close();}
const totalCpu=process.cpuUsage(cpuStart);
const group=(subset:typeof rows)=>({samples:subset.length,correct_fields:subset.reduce((n,r)=>n+r.correct_fields,0),total_fields:subset.length*7,exact_samples:subset.filter(r=>r.exact).length,ocr_review_required:subset.filter(r=>r.ocr_review_required).length,unflagged_field_errors:subset.filter(r=>r.unflagged_field_error).length,human_review_or_block:subset.filter(r=>r.human_review_or_block).length,expected_blocked:subset.filter(r=>!r.expected_eligible).length,expected_valid:subset.filter(r=>r.expected_eligible).length,valid_but_blocked:subset.filter(r=>r.expected_eligible&&!r.rule_result.eligible).length,eligible_with_field_errors:subset.filter(r=>r.rule_result.eligible&&!r.exact).length,false_eligible:subset.filter(r=>r.false_eligible).length,role_downgrades:subset.filter(r=>r.role_downgrade).length,extraction_errors:subset.filter(r=>r.error).length,p50_ms:percentile(subset.map(r=>r.duration_ms),.5),p95_ms:percentile(subset.map(r=>r.duration_ms),.95)});
const summary=group(rows),byLayout=Object.fromEntries(layouts.map(layout=>[layout,group(rows.filter(r=>r.layout===layout))]));
const byCondition=Object.fromEntries([...new Set(rows.map(r=>r.condition))].map(condition=>[condition,group(rows.filter(r=>r.condition===condition))]));
const byField=Object.fromEntries((Object.keys(rows[0].expected) as Array<keyof typeof rows[0]['expected']>).filter(k=>k!=='currency').map(key=>[key,{correct:rows.filter(r=>r.expected[key]===r.actual[key]).length,total:rows.length}]));
const report={checked_at:new Date().toISOString(),dataset_version:DATASET_VERSION,manifest_sha256:imageHash(manifestBytes),engine:OCR_ENGINE_VERSION,parser:PARSER_VERSION,preprocessing:PREPROCESSING_VERSION,rules:RULE_VERSION,environment:{node:process.version,platform:process.platform,arch:process.arch,os_release:release(),cpu_model:cpus()[0]?.model,logical_cpus:cpus().length,host_memory_bytes:totalmem(),sharp_versions:sharp.versions},method:{data:manifest.provenance,limitations:manifest.limitations,scored_fields:7,currency_excluded:true,ground_truth:'Expected full source fields; multi-amount amount_sen=null is the ambiguity target. Cropped fields remain in denominator.',rule_check:'Pure verify() with two independently defined synthetic booked credits; each image is an isolated scenario. No database write, human decision or automatic payment.',memory:'process.memoryUsage.rss sampled every requested 25ms plus boundaries; whole Node process including worker thread, sampled lower bound; excludes API, PostgreSQL, OS and other processes.',cpu:'process.cpuUsage user+system microseconds converted to milliseconds; not machine utilization or cloud cost.',latency:'One pass in manifest order. First sample includes OCR worker initialization; remaining samples reuse worker unless it errors. Excludes image read/hash/decode before extraction.'},summary,by_layout:byLayout,by_condition:byCondition,by_field:byField,resources:{wall_ms:Math.round(performance.now()-start),cpu_ms:Math.round((totalCpu.user+totalCpu.system)/1000),rss_start_bytes:rssStart,sampled_peak_rss_bytes:peakRss,memory_samples:memorySamples,first_sample_ms:rows[0].duration_ms,excluding_first_p50_ms:percentile(rows.slice(1).map(r=>r.duration_ms),.5),excluding_first_p95_ms:percentile(rows.slice(1).map(r=>r.duration_ms),.95)},rows};
await mkdir('evaluation/ocr-expanded',{recursive:true});
await writeFile('evaluation/ocr-expanded/results.json',JSON.stringify(report,null,2)+'\n');
const pct=(n:number,d:number)=>`${(100*n/d).toFixed(1)}%`,mib=(bytes:number)=>(bytes/1048576).toFixed(1);
await writeFile('evaluation/ocr-expanded/README.md',`# CPU OCR 扩展合成评估\n\n运行时间 ${report.checked_at}；${OCR_ENGINE_VERSION} / ${PARSER_VERSION} / ${PREPROCESSING_VERSION}。这是真实本地 CPU OCR，没有 GPU 或外部图片 API。原始文本、字段、候选、哈希、规则结果和环境见 [results.json](results.json)，逐图预期与图片见 [manifest](../../fixtures/ocr-expanded/manifest.json)，[布局对照图](contact-sheet.jpg)。\n\n## 范围与计分\n\n36张，3布局×12案例／条件（7种原始案例，加正常单的模糊1.2、旋转4度、430px宽JPEG质量45、多金额、裁掉状态）。数据由团队代码生成，复用了相同虚构标识和固定英文标签；是相关的诊断集，未作独立留出或真实银行评估。字体依赖生成机器，现有PNG/JPEG与manifest哈希锁定本轮输入。图片仅供评估，不加入公开应用catalog，也不读取用户反馈。\n\n每张计7字段，currency固定MYR不计分。多金额预期amount_sen=null，要求保留歧义；裁掉状态仍用完整原始字段计分，缺失会计错并应转复核。字段不一致不等于欺诈。\n\n字段精确 ${summary.correct_fields}/${summary.total_fields}（${pct(summary.correct_fields,summary.total_fields)}）；整张7字段一致 ${summary.exact_samples}/36（${pct(summary.exact_samples,36)}）。OCR缺字段提示 ${summary.ocr_review_required}/36（${pct(summary.ocr_review_required,36)}）；存在字段错误但没有缺字段提示 ${summary.unflagged_field_errors}/36。规则需要Owner或阻断 ${summary.human_review_or_block}/36（${pct(summary.human_review_or_block,36)}），不是实际人工处理耗时。提取异常 ${summary.extraction_errors}。\n\n规则错误准入 ${summary.false_eligible}，Owner降为Cashier ${summary.role_downgrades}。该检查使用独立定义的两笔合成入账调用纯verify；每张场景独立、不累计分配，不写数据库，不执行批准或放货。“eligible”仍要求人员确认，不是到账事实或自动付款。0次错误准入也不能证明真实收据安全。\n\n## 按布局\n\n| 布局 | 精确字段 | 整张一致 | OCR复核提示 | 错误未提示 | 规则错误准入 | p50/p95 ms |\n| --- | --- | --- | --- | --- | --- | --- |\n${Object.entries(byLayout).map(([name,g])=>`| ${name} | ${g.correct_fields}/${g.total_fields} | ${g.exact_samples}/${g.samples} | ${g.ocr_review_required}/${g.samples} | ${g.unflagged_field_errors} | ${g.false_eligible} | ${g.p50_ms}/${g.p95_ms} |`).join('\n')}\n\n## 按条件\n\n| 条件 | 样本 | 精确字段 | OCR复核提示 | 错误未提示 | 规则错误准入 |\n| --- | --- | --- | --- | --- | --- |\n${Object.entries(byCondition).map(([name,g])=>`| ${name} | ${g.samples} | ${g.correct_fields}/${g.total_fields} | ${g.ocr_review_required} | ${g.unflagged_field_errors} | ${g.false_eligible} |`).join('\n')}\n\n## 按字段\n\n| 字段 | 精确数 |\n| --- | --- |\n${Object.entries(byField).map(([name,g])=>`| ${name} | ${g.correct}/${g.total} |`).join('\n')}\n\n## 本机资源观测\n\n${report.environment.platform}/${report.environment.arch}，Node ${process.version}，CPU ${report.environment.cpu_model}，逻辑CPU ${report.environment.logical_cpus}。首张含初始化 ${report.resources.first_sample_ms}ms；排除首张p50/p95 ${report.resources.excluding_first_p50_ms}/${report.resources.excluding_first_p95_ms}ms。整次wall ${report.resources.wall_ms}ms，进程CPU ${report.resources.cpu_ms}ms。采样进程RSS起始 ${mib(rssStart)}MiB，峰值 ${mib(peakRss)}MiB（${memorySamples}次采样，请求间隔25ms，可能漏过瞬时峰值；含本进程OCR线程，不含API／数据库／整机）。这些数字不能推导Replit最低规格、价格或持续并发性能；Linux云端同机API+worker资源验收仍NOT RUN。[Node指标定义](https://nodejs.org/docs/latest-v24.x/api/process.html#processmemoryusage)\n\n## 逐图结果\n\n| 图片 | 字段 | ms | OCR待复核 | 规则准入 | 错误字段 |\n| --- | --- | --- | --- | --- | --- |\n${rows.map(r=>`| ${r.id} | ${r.correct_fields}/7 | ${r.duration_ms} | ${r.missing_fields.join(', ')||'无'} | ${r.rule_result.eligible} | ${r.mismatches.join(', ')||'无'} |`).join('\n')}\n\n复现：在Node24安装锁定依赖后执行 npm run fixtures:ocr-expanded（可选，会按本机字体重生成）与 npm run eval:ocr-expanded。不重生成即可按已保存图片／哈希重跑。普通 npm test 不重跑36图资源评估。低准确率如实报告；脚本仅在输入／执行异常或规则错误准入／角色降级时非零退出，不以观察到低准确率删除样本或改写预期。真实商家收益、真实截图、并发、云端和跨平台评估仍未运行。\n`);
await writeFile('evaluation/ocr-expanded/README.md',`\n数据版本 ${manifest.version}。预期应阻断 ${summary.expected_blocked} 张，错误准入 ${summary.false_eligible}；预期可核实 ${summary.expected_valid} 张，其中被阻断 ${summary.valid_but_blocked} 张；准入但字段不一致 ${summary.eligible_with_field_errors} 张。本轮判断与首轮保留记录见 [ANALYSIS.md](ANALYSIS.md)。\n`,{flag:'a'});
if(summary.false_eligible||summary.role_downgrades)process.exitCode=1;
console.log(JSON.stringify({summary,resources:report.resources}));
