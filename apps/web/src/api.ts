export class ApiError extends Error{
  constructor(public status:number,public code:string,message:string,public correlation?:string){super(message);}
}
const messages:Record<string,string>={
  UNAUTHENTICATED:'Your demo session expired. Choose an account to continue.',
  STALE_VERSION:'This order changed. Refresh the evidence before trying again.',
  STALE_APPROVAL:'The evidence or approval changed. Run the checks again.',
  STALE_REVISION:'These fields changed while you were editing. Reload the receipt and review your changes.',
  EVIDENCE_BLOCKED:'The evidence cannot establish full payment. Request new evidence.',
  OWNER_APPROVAL_REQUIRED:'Send this payment to the Owner for review.',
  PAYMENT_STATE_CONFLICT:'This order can no longer be changed by this action.',
  IMAGE_UNAVAILABLE:'The original receipt image is unavailable. Payment confirmation is blocked.',
  EXTRACTION_NOT_READY:'Receipt reading is not ready. Wait or enter checked fields manually.',
  FORBIDDEN:'Your account does not have permission for this action.',
  NOT_FOUND:'This record is unavailable for your shop.',
  INVALID_INPUT:'Check the fields and try again.',
  RATE_LIMITED:'Too many sign-in attempts. Please try again in a minute.',
  DATABASE_REQUIRED:'The synthetic demo is not ready yet. Please try again later.',
  DATABASE_UNAVAILABLE:'The demo data is temporarily unavailable. Try again shortly.',
  CONFLICT:'This record already exists. Refresh before trying again.',
};
export function errorMessage(error:unknown){return error instanceof Error?error.message:'Something went wrong. Please try again.';}
export class ApiClient{
  private keys=new Map<string,string>();
  constructor(readonly token:string,private expired:()=>void=()=>{}){}
  private async send(path:string,init:RequestInit={},signal?:AbortSignal){
    const controller=new AbortController(),abort=()=>controller.abort();
    if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch('/api/v1'+path,{...init,signal:controller.signal,headers:{...(this.token?{Authorization:`Bearer ${this.token}`} : {}),...init.headers}});
      if(!response.ok){
        const data=await response.json().catch(()=>({}));
        if(response.status===401&&this.token)this.expired();
        throw new ApiError(response.status,data.code??'REQUEST_FAILED',messages[data.code]??(response.status>=500?'Service unavailable. Please try again.':'The request could not be completed.'),data.correlation_id);
      }
      return response;
    }catch(e){if(e instanceof ApiError)throw e;if(signal?.aborted)throw e;throw new ApiError(0,'CONNECTION_LOST','Connection interrupted. Retry the action to safely resume.');}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  async get<T>(path:string,signal?:AbortSignal):Promise<T>{return (await this.send(path,{},signal)).json();}
  async write<T>(path:string,body:unknown):Promise<T>{
    const signature=JSON.stringify([path,body]),key=this.keys.get(signature)??crypto.randomUUID();this.keys.set(signature,key);
    try{const response=await this.send(path,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});const result=await response.json();this.keys.delete(signature);return result;}
    catch(e){if(e instanceof ApiError&&e.status>=400&&e.status<500)this.keys.delete(signature);throw e;}
  }
  async image(id:string,signal:AbortSignal){return (await this.send(`/receipts/${id}/image`,{},signal)).blob();}
  async logout(){await this.send('/session',{method:'DELETE'});}
}
