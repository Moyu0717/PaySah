import {createStudyEnvironment} from './study-environment.js';
const task=process.argv.find(a=>a.startsWith('--task='))?.slice(7)??'U01';
const port=Number(process.env.STUDY_PORT??43210);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid STUDY_PORT');
const environment=await createStudyEnvironment(task,port);
process.send?.({type:'ready',url:environment.url,task});
console.log(`Study ${task}, fixture fields (not OCR), role ${environment.task.role}. ${environment.url}`);
console.log('Use a fresh browser context, choose the named Demo A role. Timing starts only when the task and evidence are visible. No participant data is recorded by this server.');
console.log(`After sign-in, open the task link again: ${environment.url}`);
console.log('Stop with Ctrl+C. Only this study schema/private directory will be removed.');
let stopping=false;
async function stop(){if(stopping)return;stopping=true;try{await environment.close();}catch{process.exitCode=1;console.error('Study cleanup failed; inspect the dedicated test environment.');}finally{if(process.connected)process.disconnect();}}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
process.on('message',(value:unknown)=>{if((value as {type?:string})?.type==='shutdown')void stop();});
