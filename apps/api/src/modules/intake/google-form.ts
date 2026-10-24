import type pg from 'pg';
import type {Config} from '../../config.js';
import type {ReceiptStorage} from '../receipts/storage.js';
import {ApiError} from '../../business.js';
import {googleFormIntakeSchema} from '../../../../../packages/contracts/src/index.js';
import {fingerprint} from '../verification/fixtures.js';
import {receiveImage,validLink} from './transaction.js';
export async function receiveGoogleForm(pool:pg.Pool,config:Config,storage:ReceiptStorage,body:unknown){
 const b=googleFormIntakeSchema.parse(body),text=b.image_base64;
 if(text.length%4!==0||! /^[A-Za-z0-9+/]*={0,2}$/.test(text))throw new ApiError(422,'INVALID_INPUT','Canonical base64 required');
 const bytes=Buffer.from(text,'base64');
 if(bytes.toString('base64')!==text)throw new ApiError(422,'INVALID_INPUT','Canonical base64 required');
 if(bytes.length>10485760)throw new ApiError(413,'PAYLOAD_TOO_LARGE','Image too large');
 const connector={tenant:config.GOOGLE_FORM_TENANT_ID!,channel:'GOOGLE_FORM' as const,id:config.GOOGLE_FORM_CONNECTOR_ID};
 return receiveImage(pool,config,storage,connector,{externalId:b.response_id,payloadHash:fingerprint(b),mime:b.mime_type,snapshot:async c=>{const link=await validLink(c,connector,b.submission_token);return link?{link_id:link.id,order_id:link.order_id}:null;},download:async()=>bytes});
}
