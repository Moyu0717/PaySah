import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createStudyEnvironment} from './study-environment.js';
const answers=JSON.parse(await readFile('evaluation/study/tasks.json','utf8'));
const checkedAt=new Date().toISOString(),rows:Array<{id:string;status:string;observed_decision:string;expected_decision:string;mode:string;context:string}>=[];
await mkdir('evaluation/study',{recursive:true});
await writeFile('evaluation/study/technical-dry-run.json',JSON.stringify({checked_at:checkedAt,status:'RUNNING',rows},null,2)+'\n');
let status='PASS',error:string|undefined;
try{
for(const answer of answers.tasks){
  const environment=await createStudyEnvironment(answer.id);
  try{
    const review=await environment.ok(`/orders/${environment.orderId}/review`),result=review.verification.result;
    const approval=review.approvals.find((a:{id:string})=>a.id===environment.oldApprovalId);
    const decision=approval?.status==='SUPERSEDED'?'RERUN_REVIEW':!result.eligible?'BLOCK_PENDING_EVIDENCE':environment.task.role==='CASHIER'&&result.required_role==='OWNER'?'REFER_OWNER':'CONFIRM_WITH_PERMISSION';
    assert.equal(decision,answer.expected_decision,answer.id);assert.equal(review.order.payment_state,'UNPAID');assert.equal(review.order.fulfillment_state,'ON_HOLD');assert.equal(review.allocations.length,0);
    const expected={expected_version:1},actor=environment.task.role==='OWNER'?'owner' as const:'cashier' as const;
    if(decision==='CONFIRM_WITH_PERMISSION'){
      await environment.ok(`/verifications/${environment.verificationId}/confirm`,expected,actor);
      await environment.ok(`/orders/${environment.orderId}/release`,{expected_version:2},actor);
      const paid=(await environment.ok(`/orders/${environment.orderId}`)).order;assert.equal(paid.payment_state,'PAID');assert.equal(paid.fulfillment_state,'RELEASED');
    }else if(decision==='RERUN_REVIEW'){
      assert.equal((await environment.call(`/approvals/${environment.oldApprovalId}/decision`,{decision:'APPROVE',reason:'Synthetic preflight of stale approval',expected_version:1})).status,409);
      const receipt=review.receipts.find((r:{id:string})=>r.id===environment.receiptId);assert.equal(receipt.revision,2);
    }else if(decision==='REFER_OWNER'){
      assert.equal((await environment.call(`/verifications/${environment.verificationId}/confirm`,expected,'cashier')).status,403);
      const a=(await environment.ok(`/verifications/${environment.verificationId}/approval-requests`,expected,'cashier')).approval;
      await environment.ok(`/approvals/${a.id}/decision`,{decision:'APPROVE',reason:'Synthetic preflight independent credit',expected_version:1});
      assert.equal((await environment.call(`/orders/${environment.orderId}/release`,{expected_version:2},'cashier')).status,403);
      await environment.ok(`/orders/${environment.orderId}/release`,{expected_version:2});
    }else{
      const a=(await environment.ok(`/verifications/${environment.verificationId}/approval-requests`,expected)).approval;
      assert.equal((await environment.call(`/approvals/${a.id}/decision`,{decision:'APPROVE',reason:'Synthetic preflight must remain blocked',expected_version:1})).status,409);
      assert.equal((await environment.call(`/orders/${environment.orderId}/release`,expected)).status,409);
    }
    rows.push({id:answer.id,status:'PASS',observed_decision:decision,expected_decision:answer.expected_decision,mode:'fixture',context:environment.task.context});
    console.log(`${answer.id}: PASS (${decision})`);
  }finally{await environment.close();}
}
}catch(e){status='FAIL';error=e instanceof Error?e.message:'Study dry-run failed';process.exitCode=1;console.error(error);}
finally{await writeFile('evaluation/study/technical-dry-run.json',JSON.stringify({checked_at:checkedAt,finished_at:new Date().toISOString(),status,error,scope:'Ten isolated synthetic fixture-mode API environments, technical setup/decision/safety preflight only; no participant or timing-benefit measurement',rows,not_run:['human participants','human timings','full per-task browser study rehearsal','actual CPU OCR total-time study','Replit/cloud']},null,2)+'\n');}
