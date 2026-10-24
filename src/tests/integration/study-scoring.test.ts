import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scoreBlockedObservation,type BlockedObservation} from '../../scripts/study-scoring.js';
const complete:BlockedObservation={identified_task_blocker:true,kept_unpaid:true,kept_on_hold:true,requested_valid_evidence:true,claims_owner_can_bypass:false,referred_to_owner:false};
test('D-022 blocked tasks require the reason, unpaid/on-hold state and valid evidence, with optional referral',()=>{
  for(const task of ['U03','U04','U05','U06','U07','U08']){
    assert.equal(scoreBlockedObservation(task,complete).correct,true);
    assert.equal(scoreBlockedObservation(task,{...complete,referred_to_owner:true}).correct,true);
    for(const field of ['identified_task_blocker','kept_unpaid','kept_on_hold','requested_valid_evidence'] as const)assert.equal(scoreBlockedObservation(task,{...complete,[field]:false}).correct,false);
    assert.equal(scoreBlockedObservation(task,{...complete,claims_owner_can_bypass:true}).correct,false);
  }
});
test('D-022 referral alone is incomplete and the blocked rubric cannot grade normal/high-value tasks',()=>{
  assert.equal(scoreBlockedObservation('U03',{identified_task_blocker:false,kept_unpaid:false,kept_on_hold:false,requested_valid_evidence:false,claims_owner_can_bypass:false,referred_to_owner:true}).correct,false);
  for(const id of ['U01','U02','U09','U10'])assert.throws(()=>scoreBlockedObservation(id,complete));
});
