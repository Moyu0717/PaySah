import {createRequire} from 'node:module';
import {createWorker,OEM,PSM,type Worker} from 'tesseract.js';
import sharp from 'sharp';
import {MAX_IMAGE_PIXELS} from './images.js';
import {imageHash} from './storage.js';

const require=createRequire(import.meta.url);
const {langPath}=require('@tesseract.js-data/eng') as {langPath:string};
export const OCR_ENGINE_VERSION='tesseract.js@7.0.0';
export const PREPROCESSING_VERSION='sharp-rotate-grey-2000.v1';
export class CpuExtractor{
  private worker?:Promise<Worker>;
  private busy=false;
  async extract(bytes:Buffer,timeoutMs=30000){
    if(this.busy)throw Error('OCR_BUSY');this.busy=true;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const task=(async()=>{
      // Only bundled traineddata, WASM and local bytes. No image URLs or CDN resources.
      this.worker??=createWorker('eng',OEM.LSTM_ONLY,{langPath,gzip:true,cacheMethod:'none',errorHandler:()=>{}});
      const worker=await this.worker;
      await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_BLOCK,preserve_interword_spaces:'1'});
      const preprocessed=await sharp(bytes,{limitInputPixels:MAX_IMAGE_PIXELS,failOn:'warning'}).rotate().resize({width:2000,withoutEnlargement:true}).greyscale().png().toBuffer();
      return {text:(await worker.recognize(preprocessed,{}, {text:true})).data.text,preprocessed_sha256:imageHash(preprocessed)};
    })();
    try{return await Promise.race([task,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('OCR_TIMEOUT')),timeoutMs);})]);}
    catch(e){await this.close();throw e;}
    finally{clearTimeout(timer);this.busy=false;}
  }
  async close(){const current=this.worker;this.worker=undefined;if(current)void current.then(w=>w.terminate()).catch(()=>{});}
}
