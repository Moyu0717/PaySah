import {setTimeout as delay} from 'node:timers/promises';

export async function runWorkerLoop(processOne:()=>Promise<boolean>,signal:AbortSignal,maxIdleMs=30000,once=false,wait:(ms:number,signal:AbortSignal)=>Promise<void>=(ms,signal)=>delay(ms,undefined,{signal})){
  let idleMs=1000;
  while(!signal.aborted){
    const handled=await processOne();
    if(once||signal.aborted)return;
    if(handled){idleMs=1000;continue;}
    try{await wait(idleMs,signal);}
    catch(error){if(signal.aborted)return;throw error;}
    idleMs=Math.min(maxIdleMs,idleMs*2);
  }
}
