import type {ReceiptFields} from '../packages/contracts/src/index.js';
export const scoredFields=['amount_sen','bank_transaction_ref','customer_reference','recipient_account','occurred_at','status','document_type'] as const;
export function scoreFields(expected:ReceiptFields,actual:ReceiptFields){
  const mismatches=scoredFields.filter(key=>actual[key]!==expected[key]);
  return {correct_fields:scoredFields.length-mismatches.length,total_fields:scoredFields.length,mismatches,exact:mismatches.length===0};
}
export function percentile(values:number[],fraction:number){
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.max(0,Math.ceil(fraction*sorted.length)-1)];
}
