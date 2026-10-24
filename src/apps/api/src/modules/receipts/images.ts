import sharp from 'sharp';
import {ApiError} from '../../business.js';
export const MAX_IMAGE_BYTES=10*1024*1024;
export const MAX_IMAGE_PIXELS=16000000;
export async function validateImage(bytes:Buffer){
  if(!bytes.length||bytes.length>MAX_IMAGE_BYTES)throw new ApiError(413,'IMAGE_TOO_LARGE','Image must be at most 10 MB');
  const kind=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':
    bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'jpeg':
    bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'webp':null;
  if(!kind)throw new ApiError(422,'INVALID_IMAGE','Only JPEG, PNG and WebP images are accepted');
  try{
    const image=sharp(bytes,{limitInputPixels:MAX_IMAGE_PIXELS,failOn:'warning'});
    const info=await image.metadata();
    if(info.format!==kind||!info.width||!info.height||(info.pages??1)!==1||info.width*info.height>MAX_IMAGE_PIXELS)throw Error('Invalid dimensions');
    // Decode the complete image, not just headers. Reject truncated/corrupt payloads.
    await image.raw().toBuffer();
    return {mime_type:`image/${kind}`,width:info.width,height:info.height};
  }catch{throw new ApiError(422,'INVALID_IMAGE','Image could not be decoded safely');}
}
