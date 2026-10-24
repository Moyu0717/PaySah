import {ingestReceiptImage,prepareReceiptImage,discardUnusedImage,type PreparedImage} from './ingest.js';
import type {Router} from 'express';
import multer from 'multer';
import {timingSafeEqual,randomUUID} from 'node:crypto';
import type pg from 'pg';
import {z} from 'zod';
import type {Config} from '../../config.js';
import {ApiError} from '../../business.js';
import {event,supersede,type Context,type Write} from '../verification/router.js';
import {fixtures,fingerprint} from '../verification/fixtures.js';
import {versionSchema,type ReceiptFields} from '../../../../../packages/contracts/src/index.js';
import {catalogImage} from './catalog.js';
import {validateImage,MAX_IMAGE_BYTES} from './images.js';
import {imageHash,type ReceiptStorage} from './storage.js';

export {emptyFields} from './fields.js';
const uploadBody=z.object({expected_version:z.coerce.number().int().positive()}).strict();
const demoBody=z.object({fixture_id:z.string().min(1).max(100),expected_version:versionSchema}).strict();

export function installImageRoutes(router:Router,pool:pg.Pool,write:Write,config:Config,storage:ReceiptStorage){
  let inFlight=0;
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_IMAGE_BYTES,files:1,fields:1,fieldSize:100,parts:2}}).single('image');
  router.post('/orders/:id/demo-receipt-images',async(req,res)=>{
    let image:PreparedImage|undefined;
    try{
      const body=demoBody.parse(req.body),bytes=await catalogImage(body.fixture_id);
      if(!bytes)throw new ApiError(404,'NOT_FOUND','Synthetic image not found');
      image=await prepareReceiptImage(storage,res.locals.actor.tenant_id,bytes);
      await write(demoBody,async(c,b)=>ingestReceiptImage(c,config,storage,String(req.params.id),b.expected_version,image!,b.fixture_id),201)(req,res);
    }finally{await discardUnusedImage(storage,image);}
  });
  router.post('/orders/:id/receipt-images',(req,res,next)=>{
    const supplied=Buffer.from(req.get('X-Upload-Key')??''),expected=Buffer.from(config.UPLOAD_ACCESS_KEY??'');
    if(!expected.length||supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){next(new ApiError(403,'UPLOAD_DISABLED','Controlled synthetic upload credential required'));return;}
    if(inFlight>=2){next(new ApiError(429,'UPLOAD_BUSY','Try again after current uploads finish'));return;}
    inFlight++;let released=false;const release=()=>{if(!released){released=true;inFlight--;}};res.once('close',release);res.once('finish',release);
    upload(req,res,(err:unknown)=>{
      if(err){release();next(new ApiError(err instanceof multer.MulterError&&err.code==='LIMIT_FILE_SIZE'?413:422,'INVALID_UPLOAD','Invalid multipart image upload'));return;}
      if(!req.file){next(new ApiError(422,'IMAGE_REQUIRED','Provide one image file'));return;}
      next();
    });
  },async(req,res,next)=>{
    let image:PreparedImage|undefined;
    try{
      // Include the actual byte hash in idempotency input; never trust a client hash.
      const body=uploadBody.parse(req.body),bytes=req.file!.buffer;
      req.body={...body,image_sha256:imageHash(bytes)};
      image=await prepareReceiptImage(storage,res.locals.actor.tenant_id,bytes);
      await write(uploadBody.extend({image_sha256:z.string().length(64)}),async(c,b)=>ingestReceiptImage(c,config,storage,String(req.params.id),b.expected_version,image!),201)(req,res);
    }catch(e){next(e);}
    finally{await discardUnusedImage(storage,image);}
  });
  router.get('/receipts/:id/image',async(req,res)=>{
    const row=(await pool.query("SELECT storage_key,image_sha256,mime_type,byte_size FROM receipts WHERE tenant_id=$1 AND id=$2 AND storage_state='READY'",[res.locals.actor.tenant_id,z.uuid().parse(req.params.id)])).rows[0];
    if(!row)throw new ApiError(404,'NOT_FOUND','Image not found');
    let bytes;try{bytes=await storage.read(row.storage_key);}catch{throw new ApiError(503,'IMAGE_UNAVAILABLE','Image unavailable');}
    if(bytes.length!==row.byte_size||imageHash(bytes)!==row.image_sha256)throw new ApiError(503,'IMAGE_UNAVAILABLE','Image integrity check failed');
    res.set({'Content-Type':row.mime_type,'X-Content-Type-Options':'nosniff','Content-Disposition':'inline; filename="synthetic-receipt"','Cache-Control':'no-store'}).send(bytes);
  });
  router.get('/receipts/:id/extractions',async(req,res)=>{
    const id=z.uuid().parse(req.params.id);
    if(!(await pool.query('SELECT 1 FROM receipts WHERE tenant_id=$1 AND id=$2',[res.locals.actor.tenant_id,id])).rowCount)throw new ApiError(404,'NOT_FOUND','Receipt not found');
    const runs=await pool.query('SELECT id,revision,provider,engine_version,parser_version,preprocessing_version,language,raw_text,fields,missing_fields,field_candidates,preprocessed_sha256,status,duration_ms,error_code,provider_request_id,fallback_reason,created_at FROM extraction_runs WHERE tenant_id=$1 AND receipt_id=$2 ORDER BY created_at,id LIMIT 20',[res.locals.actor.tenant_id,id]);
    res.json({runs:runs.rows});
  });
}
export function publicReceipt(row:Record<string,unknown>){const {storage_key,...rest}=row;return row.source==='MANUAL'?{...rest,fields_provider:'MANUAL'}:rest;}
