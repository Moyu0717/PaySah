import {mkdir,open,readFile,unlink,readdir,stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve,sep} from 'node:path';

export interface ReceiptStorage {
  put(tenant:string,bytes:Buffer):Promise<string>;
  read(key:string):Promise<Buffer>;
  remove(key:string):Promise<void>;
}
export interface CleanableReceiptStorage extends ReceiptStorage { candidates(cutoff:number):Promise<string[]>; }
export const imageHash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const keyPattern=new RegExp(`^${uuid}/${uuid}\\.bin$`);
export class LocalReceiptStorage implements ReceiptStorage {
  readonly root:string;
  constructor(root:string){this.root=resolve(root);}
  path(key:string){
    if(!keyPattern.test(key))throw new Error('Invalid storage key');
    const path=resolve(this.root,...key.split('/'));
    if(!path.startsWith(this.root+sep))throw new Error('Storage path escaped root');
    return path;
  }
  async put(tenant:string,bytes:Buffer){
    const key=`${tenant}/${randomUUID()}.bin`,path=this.path(key);
    await mkdir(join(this.root,tenant),{recursive:true,mode:0o700});
    const file=await open(path,'wx',0o600);
    try{await file.writeFile(bytes);await file.sync();}catch(e){await file.close();await this.remove(key);throw e;}
    await file.close();return key;
  }
  read(key:string){return readFile(this.path(key));}
  async remove(key:string){try{await unlink(this.path(key));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
  // Only generated filenames, older than cutoff. Never recurse into arbitrary paths.
  async candidates(cutoff:number){
    const keys:string[]=[];
    let tenants;try{tenants=await readdir(this.root,{withFileTypes:true});}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return keys;throw e;}
    for(const tenant of tenants){
      if(!tenant.isDirectory()||!new RegExp(`^${uuid}$`).test(tenant.name))continue;
      for(const item of await readdir(join(this.root,tenant.name),{withFileTypes:true})){
        const key=`${tenant.name}/${item.name}`;
        if(item.isFile()&&keyPattern.test(key)&&(await stat(this.path(key))).mtimeMs<cutoff)keys.push(key);
      }
    }
    return keys;
  }
}
