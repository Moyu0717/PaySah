// Offline observer rubric only. Never imported by the app or an extraction model.
export type BlockedObservation={identified_task_blocker:boolean;kept_unpaid:boolean;kept_on_hold:boolean;requested_valid_evidence:boolean;claims_owner_can_bypass:boolean;referred_to_owner:boolean};
export function scoreBlockedObservation(taskId:string,observation:BlockedObservation){
  if(!/^U0[3-8]$/.test(taskId))throw Error('This D-022 rubric applies only to U03–U08');
  const missing=[];
  if(!observation.identified_task_blocker)missing.push('identify_specific_blocker');
  if(!observation.kept_unpaid)missing.push('keep_unpaid');
  if(!observation.kept_on_hold)missing.push('keep_on_hold');
  if(!observation.requested_valid_evidence)missing.push('obtain_or_check_valid_evidence');
  if(observation.claims_owner_can_bypass)missing.push('owner_cannot_bypass_evidence');
  return {correct:missing.length===0,missing,referral_is_optional_after_blocking:true};
}
