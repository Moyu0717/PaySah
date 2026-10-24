// Read-only RunPod endpoint check: worker health and the model name the vLLM worker serves.
// Sends no image and no generation request. Never prints the API key.
const key=process.env.RUNPOD_API_KEY,endpoint=process.env.RUNPOD_ENDPOINT_ID;
if(!key||!endpoint)throw Error('Set RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID in .env');
const clean=(s:string)=>s.replaceAll(key,'[REDACTED]').slice(0,600);
for(const path of ['/health','/openai/v1/models']){
  try{
    const r=await fetch(`https://api.runpod.ai/v2/${encodeURIComponent(endpoint)}${path}`,{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(30000)});
    console.log(`${path}: HTTP ${r.status}\n${clean(await r.text())}\n`);
  }catch(e){console.log(`${path}: ${(e as Error).name}`);}
}
console.log(`Configured RUNPOD_MODEL: ${process.env.RUNPOD_MODEL??'(default) Qwen/Qwen2.5-VL-7B-Instruct'}`);
