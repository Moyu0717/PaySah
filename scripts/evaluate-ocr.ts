import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {CpuExtractor,OCR_ENGINE_VERSION,PREPROCESSING_VERSION} from '../apps/api/src/modules/receipts/ocr.js';
import {parseReceiptText,PARSER_VERSION} from '../apps/api/src/modules/receipts/parser.js';
import {fixtures} from '../apps/api/src/modules/verification/fixtures.js';
import {imageHash} from '../apps/api/src/modules/receipts/storage.js';
const extractor=new CpuExtractor(),rows=[];
try{
  for(const[id,expected]of Object.entries(fixtures)){
    const bytes=await readFile(`fixtures/receipts/${id}.png`),start=performance.now();
    const output=await extractor.extract(bytes);const parsed=parseReceiptText(output.text);
    const fields=Object.keys(expected) as Array<keyof typeof expected>;
    const correct=fields.filter(k=>parsed.fields[k]===expected[k]).length;
    rows.push({id,sha256:imageHash(bytes),duration_ms:Math.round(performance.now()-start),correct_fields:correct,total_fields:fields.length,expected,actual:parsed.fields,missing_fields:parsed.missing_fields,raw_text:output.text,preprocessed_sha256:output.preprocessed_sha256});
    console.log(`${id}: ${correct}/${fields.length} fields; missing=${parsed.missing_fields.join(',')||'none'}`);
  }
}finally{await extractor.close();}
await mkdir('evaluation',{recursive:true});
const correct=rows.reduce((n,r)=>n+r.correct_fields,0),total=rows.reduce((n,r)=>n+r.total_fields,0);
await writeFile('evaluation/ocr-smoke.json',JSON.stringify({checked_at:new Date().toISOString(),engine:OCR_ENGINE_VERSION,parser:PARSER_VERSION,preprocessing:PREPROCESSING_VERSION,node:process.version,platform:process.platform,samples:rows.length,correct_fields:correct,total_fields:total,duplicate_case:'normal.png reused byte-for-byte in storage integration tests; excluded from OCR accuracy denominator',limitations:'One synthetic font and layout, seven clear images. Does not establish accuracy on real bank receipts or safety of payment confirmation.',rows},null,2)+'\n');
await writeFile('evaluation/ocr-smoke.md',`# CPU OCR 初步实测\n\n七张团队生成的合成 PNG，同一种字体与布局，非真实银行截图。引擎 ${OCR_ENGINE_VERSION}；parser ${PARSER_VERSION}；预处理 ${PREPROCESSING_VERSION}。运行环境 ${process.platform}、${process.version}。详细字段与原始 OCR 文字见 [ocr-smoke.json](ocr-smoke.json)。\n\n| 样例 | 精确字段 | 耗时 ms | 待修正字段 |\n| --- | --- | --- | --- |\n${rows.map(r=>`| ${r.id} | ${r.correct_fields}/${r.total_fields} | ${r.duration_ms} | ${r.missing_fields.join(', ')||'无'} |`).join('\n')}\n\n字段精确比较 ${correct}/${total}。重复收据用同一 normal.png 测试原图哈希，未重复计入识别准确率分母。首张耗时包括 worker 初始化。currency 固定为 MYR，是当前契约默认值，不作为多币种识别能力证据。这里只证明本机可执行 CPU OCR，不代表真实收据准确率、资源费用或商家收益；扩展布局、模糊图片和至少 30 张样本仍待 M4。没有 GPU 或外部图像 API。核实与人工确认由独立规则／审批流程完成，OCR 不执行付款。\n`);
console.log(`Wrote evaluation/ocr-smoke.json and .md (${correct}/${total} exact fields).`);
