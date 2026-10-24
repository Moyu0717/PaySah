import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseSen} from '../../apps/web/src/copy.js';
test('browser monetary input preserves exact sen and the Owner threshold',()=>{
  for(const [text,sen]of [['0.01',1],['500',50000],['500.01',50001],[' 128.5 ',12850],['21474836.47',2147483647]] as const)assert.equal(parseSen(text),sen);
  for(const value of ['0','-1','1.001','1e2','RM 10','1,000.00','21474836.48',''])assert.throws(()=>parseSen(value));
});
