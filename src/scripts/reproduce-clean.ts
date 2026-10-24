import {cp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve,join,sep,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

assert.ok(process.env.TEST_DATABASE_URL,'Dedicated TEST_DATABASE_URL required');
assert.ok(process.env.npm_execpath,'Run using npm run verify:clean');
const workspace=process.cwd(),root=resolve('.local',`repro_${randomUUID()}`),source=join(root,'source');
assert.ok(root.startsWith(resolve('.local')+sep)&&/^repro_[a-f0-9-]+$/.test(basename(root)));
const checkedAt=new Date().toISOString(),out=resolve('evaluation/acceptance',`clean-${checkedAt.replaceAll(':','-').replaceAll('.','-')}`);
await mkdir(source,{recursive:true});await mkdir(out,{recursive:true});
const steps:Array<{command:string[];status:string;exit_code:number|null;log:string}>=[];
let status='RUNNING',error:string|undefined,copied=false;
async function run(name:string,args:string[]){
  console.log(`Clean reproduction: ${name}...`);
  const child=spawn(process.execPath,args,{cwd:source,env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const output:Buffer[]=[];child.stdout.on('data',(data:Buffer)=>output.push(data));child.stderr.on('data',(data:Buffer)=>output.push(data));
  const code=await new Promise<number|null>((resolveExit,reject)=>{child.once('error',reject);child.once('exit',resolveExit);});
  const log=`${name}.log`;await writeFile(join(out,log),Buffer.concat(output));
  steps.push({command:['node',...args],status:code===0?'PASS':'FAIL',exit_code:code,log});assert.equal(code,0,`${name} failed; see ${out}/${log}`);
}
try{
  // Explicit allowlist: never copy .env, .local, reference, .git or node_modules.
  for(const directory of ['apps','packages','db','scripts','tests','fixtures','integrations'])await cp(resolve(directory),join(source,directory),{recursive:true,errorOnExist:true,force:false});
  for(const file of ['package.json','package-lock.json','tsconfig.json','.env.example','.replit','README.md','LICENSE'])await cp(resolve(file),join(source,file),{errorOnExist:true,force:false});
  // Synthetic observer key is required by study.test.ts; no participant feedback.
  await mkdir(join(source,'evaluation/study'),{recursive:true});
  await cp(resolve('evaluation/study/tasks.json'),join(source,'evaluation/study/tasks.json'),{errorOnExist:true,force:false});
  await run('install',[process.env.npm_execpath,'ci','--no-audit','--no-fund']);
  await run('verify',[process.env.npm_execpath,'run','verify:local']);
  const latest=JSON.parse(await readFile(join(source,'evaluation/acceptance/latest.json'),'utf8'));assert.equal(latest.status,'PASS');
  assert.ok(/^evaluation\/acceptance\/[0-9TZ.:-]+$/.test(latest.run));
  await cp(join(source,latest.run),join(out,'local-run'),{recursive:true,errorOnExist:true,force:false});
  copied=true;
  status='PASS';
}catch(e){status='FAIL';error=e instanceof Error?e.message:'Clean reproduction failed';process.exitCode=1;console.error(error);}
finally{
  // Preserve nested failure logs before removing the temporary source copy.
  if(!copied){
    try{
      const latest=JSON.parse(await readFile(join(source,'evaluation/acceptance/latest.json'),'utf8'));
      assert.ok(/^evaluation\/acceptance\/[0-9TZ.:-]+$/.test(latest.run));
      await cp(join(source,latest.run),join(out,'local-run'),{recursive:true,errorOnExist:true,force:false});
    }catch{console.error('Nested evidence unavailable; inspect the outer command logs.');}
  }
  const result={checked_at:checkedAt,finished_at:new Date().toISOString(),status,steps,error,scope:'New allowlisted source copy; npm ci from lockfile into empty node_modules; existing Windows host/Node/Chrome/npm cache/PostgreSQL. No .env or existing application data copied. Test scripts create isolated schemas and private directories.',not_run:['new OS or machine','Linux/Replit','new PostgreSQL installation','merchant study']};
  await writeFile(join(out,'results.json'),JSON.stringify(result,null,2)+'\n');
  await writeFile(resolve('evaluation/acceptance/clean-latest.json'),JSON.stringify({run:out.slice(workspace.length+1).replaceAll('\\','/'),status,checked_at:checkedAt},null,2)+'\n');
  // Only the exact directory created above, validated again before deletion.
  assert.ok(root.startsWith(resolve(workspace,'.local')+sep)&&/^repro_[a-f0-9-]+$/.test(basename(root)));
  await rm(root,{recursive:true,force:true});console.log(`Clean evidence: ${out}`);
}
