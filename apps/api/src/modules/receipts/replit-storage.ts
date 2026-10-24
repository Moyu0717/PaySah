import {Client} from '@replit/object-storage';
import {randomUUID} from 'node:crypto';
import {uuid,type CleanableReceiptStorage} from './storage.js';

export type ObjectClient=Pick<Client,'uploadFromBytes'|'downloadAsBytes'|'delete'|'list'>;
// SDK 1.0.0 returns [Buffer], despite the website describing a bare Buffer.
// No public URL, user-supplied object name, or fallback to ephemeral disk.
export class ReplitReceiptStorage implements CleanableReceiptStorage {
  private readonly pattern=new RegExp(`^(${uuid})/([0-9]{13})-(${uuid})\\.bin$`);
  constructor(private readonly client:ObjectClient,private readonly prefix:string){
    if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(prefix))throw Error('Invalid storage prefix');
  }
  private objectName(key:string){
    if(!this.pattern.test(key))throw Error('Invalid storage key');
    return `${this.prefix}/${key}`;
  }
  async put(tenant:string,bytes:Buffer){
    const key=`${tenant}/${Date.now()}-${randomUUID()}.bin`;
    const result=await this.client.uploadFromBytes(this.objectName(key),bytes,{compress:false});
    if(!result.ok)throw Error('Private storage write failed');
    return key;
  }
  async read(key:string){
    const result=await this.client.downloadAsBytes(this.objectName(key),{decompress:false});
    if(!result.ok||!Array.isArray(result.value)||!Buffer.isBuffer(result.value[0]))throw Error('Private storage read failed');
    return result.value[0];
  }
  async remove(key:string){
    const result=await this.client.delete(this.objectName(key),{ignoreNotFound:true});
    if(!result.ok)throw Error('Private storage delete failed');
  }
  async candidates(cutoff:number){
    const result=await this.client.list({prefix:`${this.prefix}/`});
    if(!result.ok)throw Error('Private storage listing failed');
    // SDK listing has no creation metadata. Generated keys carry creation time;
    // cleanup still checks committed receipt references under the tenant lock.
    return result.value.flatMap(item=>{
      if(!item.name.startsWith(`${this.prefix}/`))return [];
      const key=item.name.slice(this.prefix.length+1),match=this.pattern.exec(key);
      return match&&Number(match[2])<cutoff?[key]:[];
    });
  }
}
export const replitReceiptStorage=(bucketId:string,prefix:string)=>new ReplitReceiptStorage(new Client({bucketId}),prefix);
