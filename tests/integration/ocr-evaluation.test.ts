import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scoreFields,percentile} from '../../scripts/ocr-evaluation-metrics.js';
import {fixtures} from '../../apps/api/src/modules/verification/fixtures.js';

test('OCR evaluation scores missing and plausible wrong fields without counting fixed currency',()=>{
  const scored=scoreFields(fixtures.normal,{...fixtures.normal,bank_transaction_ref:'DEMO-BANK-129',amount_sen:null});
  assert.equal(scored.total_fields,7);assert.equal(scored.correct_fields,5);assert.equal(scored.exact,false);
  assert.deepEqual(scored.mismatches,['amount_sen','bank_transaction_ref']);
  assert.equal(scoreFields(fixtures.normal,fixtures.normal).correct_fields,7);
});
test('OCR latency nearest-rank percentile sorts numerically and retains cold outliers',()=>{
  const values=[10000,5,100,20];
  assert.equal(percentile(values,.5),20);assert.equal(percentile(values,.95),10000);
  assert.deepEqual(values,[10000,5,100,20]);assert.equal(percentile([], .5),null);
});
