import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTasks,systemDecision} from '../../scripts/study-tasks.js';

test('study answer key has ten unique tasks with known decisions',async()=>{
  const tasks=await loadTasks();
  assert.deepEqual(tasks.map(t=>t.id),['U01','U02','U03','U04','U05','U06','U07','U08','U09','U10']);
  const known=['CONFIRM_WITH_PERMISSION','REFER_OWNER','BLOCK_PENDING_EVIDENCE','RERUN_REVIEW'];
  for(const t of tasks){assert.ok(known.includes(t.expected_decision),t.id);assert.ok(['OWNER','CASHIER'].includes(t.role),t.id);}
});

test('system decision never lets a Cashier act on Owner-only or blocked evidence',()=>{
  assert.equal(systemDecision({eligible:false,required_role:'OWNER'},'OWNER'),'BLOCK_PENDING_EVIDENCE');
  assert.equal(systemDecision({eligible:false,required_role:'CASHIER'},'CASHIER'),'BLOCK_PENDING_EVIDENCE');
  assert.equal(systemDecision({eligible:true,required_role:'OWNER'},'CASHIER'),'REFER_OWNER');
  assert.equal(systemDecision({eligible:true,required_role:'OWNER'},'OWNER'),'APPROVE_AS_OWNER');
  assert.equal(systemDecision({eligible:true,required_role:'CASHIER'},'CASHIER'),'CONFIRM_WITH_PERMISSION');
});
