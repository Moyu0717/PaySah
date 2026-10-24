import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {imageHash} from '../../apps/api/src/modules/receipts/storage.js';
import {validateImage} from '../../apps/api/src/modules/receipts/images.js';
import {receiptFieldsSchema} from '../../packages/contracts/src/index.js';
import {CpuExtractor} from '../../apps/api/src/modules/receipts/ocr.js';
import {parseReceiptText} from '../../apps/api/src/modules/receipts/parser.js';
const data=JSON.parse(await readFile('fixtures/receipts/images/expected.json','utf8')),extractor=new CpuExtractor();
assert.deepEqual(data.rows.map((r:any)=>r.external_id),['DEMO-A-TG1','DEMO-A-TG2','DEMO-A-GF1']);
try{
 for(const row of data.rows){
  assert.equal(row.file,row.external_id+'.png');const bytes=await readFile('fixtures/receipts/images/'+row.file);assert.equal(imageHash(bytes),row.sha256);
  assert.equal((await validateImage(bytes)).mime_type,'image/png');const expected=receiptFieldsSchema.parse(row.fields),output=await extractor.extract(bytes);
  const actual=parseReceiptText(output.text).fields;assert.deepEqual(actual,expected,`${row.external_id} CPU fields`);console.log('PASS: '+row.external_id+' PNG/hash/schema/actual CPU reading');
 }
}finally{await extractor.close();}
