import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {projectRoot} from '../../paths.js';
import {fixtures} from '../verification/fixtures.js';

export async function catalogImage(id:string){
  if(!Object.hasOwn(fixtures,id))return null;
  return readFile(join(projectRoot,'fixtures','receipts',`${id}.png`));
}
