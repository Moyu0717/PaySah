import {readFile} from 'node:fs/promises';

// Observer answer key only. Never sent to OCR, models or the business database.
export type StudyTask={id:string;role:'OWNER'|'CASHIER';total_sen:number;source:string;fixture:string;history?:string;question:string;expected_decision:string;reason:string};
export type Decision='CONFIRM_WITH_PERMISSION'|'REFER_OWNER'|'APPROVE_AS_OWNER'|'BLOCK_PENDING_EVIDENCE'|'RERUN_REVIEW';
export async function loadTasks(path='evaluation/study/tasks.json'):Promise<StudyTask[]>{
  const data=JSON.parse(await readFile(path,'utf8'));
  if(data.version!=='synthetic-decision-tasks.v1'||!Array.isArray(data.tasks))throw Error('Unexpected study task file');
  return data.tasks;
}
// Maps the system's own rule result to the next permitted action for the signed-in role.
// A stale approval is handled separately: the only permitted action is a new review.
export function systemDecision(result:{eligible:boolean;required_role:string},role:string):Decision{
  if(!result.eligible)return 'BLOCK_PENDING_EVIDENCE';
  if(result.required_role==='CASHIER')return 'CONFIRM_WITH_PERMISSION';
  return role==='OWNER'?'APPROVE_AS_OWNER':'REFER_OWNER';
}
export const accounts={OWNER:'20000000-0000-4000-8000-000000000001',CASHIER:'20000000-0000-4000-8000-000000000002'} as const;
