import {spawn,type ChildProcess} from 'node:child_process';

export type ProcessSpec={role:string;entry:string};
export type GroupOptions={env?:NodeJS.ProcessEnv;startupMs?:number;shutdownMs?:number;onReady?:(children:ReadonlyMap<string,ChildProcess>)=>void};

// A failed child stops the deployment so the platform can restart one unit.
export function supervise(specs:ProcessSpec[],options:GroupOptions={}):Promise<number>{
  if(!specs.length)throw Error('At least one process required');
  return new Promise(resolve=>{
    const children=new Map<string,ChildProcess>(),ready=new Set<string>();
    let stopping=false,exitCode=0,remaining=0;
    let hardTimer:ReturnType<typeof setTimeout>|undefined;
    const startup=setTimeout(()=>{console.error('Deployment process startup timed out.');stop(1);},options.startupMs??15000);
    const signal=()=>stop(0);
    const message=(value:unknown)=>{if((value as {type?:string})?.type==='shutdown')stop(0);};
    function finish(){
      clearTimeout(startup);clearTimeout(hardTimer);
      process.off('SIGINT',signal);process.off('SIGTERM',signal);process.off('message',message);
      resolve(exitCode);
    }
    function stop(code:number){
      exitCode=Math.max(exitCode,code);
      if(stopping)return;stopping=true;clearTimeout(startup);
      for(const child of children.values())if(child.exitCode===null&&child.signalCode===null){
        if(child.connected)child.send({type:'shutdown'},()=>{});
        // Windows SIGTERM is immediate; use IPC for graceful cleanup there.
        if(process.platform!=='win32')child.kill('SIGTERM');
      }
      hardTimer=setTimeout(()=>{
        console.error('Deployment shutdown timed out; stopping remaining children.');
        for(const child of children.values())if(child.exitCode===null&&child.signalCode===null){exitCode=1;child.kill('SIGKILL');}
      },options.shutdownMs??40000);
      if(remaining===0)finish();
    }
    process.on('SIGINT',signal);process.on('SIGTERM',signal);process.on('message',message);
    for(const spec of specs){
      const child=spawn(process.execPath,[spec.entry],{env:options.env??process.env,stdio:['ignore','inherit','inherit','ipc'],windowsHide:true});
      children.set(spec.role,child);remaining++;
      child.on('message',(value:unknown)=>{
        if(stopping||(value as {type?:string})?.type!=='ready')return;
        ready.add(spec.role);
        if(ready.size===specs.length){clearTimeout(startup);options.onReady?.(children);}
      });
      child.once('error',()=>{console.error(`Deployment could not start ${spec.role}.`);stop(1);});
      child.once('close',()=>{remaining--;if(!stopping){console.error(`Deployment child exited unexpectedly: ${spec.role}.`);stop(1);}if(remaining===0)finish();});
    }
  });
}
