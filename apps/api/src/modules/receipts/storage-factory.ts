import {join} from 'node:path';
import type {Config} from '../../config.js';
import {projectRoot} from '../../paths.js';
import {LocalReceiptStorage,type CleanableReceiptStorage} from './storage.js';
import {replitReceiptStorage} from './replit-storage.js';

export function createReceiptStorage(config:Config):CleanableReceiptStorage {
  if(config.STORAGE_DRIVER==='replit'){
    if(!config.REPLIT_STORAGE_BUCKET_ID)throw Error('Explicit private bucket required');
    return replitReceiptStorage(config.REPLIT_STORAGE_BUCKET_ID,config.REPLIT_STORAGE_PREFIX);
  }
  return new LocalReceiptStorage(config.RECEIPT_STORAGE_DIR??join(projectRoot,'.local','receipt-images'));
}
