import sharp from 'sharp';
import {mkdir,writeFile} from 'node:fs/promises';
import {imageHash} from '../apps/api/src/modules/receipts/storage.js';
import {DATASET_VERSION,layouts,cases,renderReceipt,type Manifest,type Sample} from './ocr-dataset.js';

const root='fixtures/ocr-expanded';
await mkdir(`${root}/images`,{recursive:true});
const samples:Sample[]=[];
for(const layout of layouts)for(const item of cases()){
  const id=`${layout}-${item.scenario}`,drawing=renderReceipt(layout,item.fields,item.condition==='multiple_amounts');
  let bytes=await sharp(Buffer.from(drawing.svg)).png().toBuffer();
  if(item.condition==='blur')bytes=await sharp(bytes).blur(1.2).png().toBuffer();
  if(item.condition==='rotation')bytes=await sharp(bytes).rotate(4,{background:'white'}).png().toBuffer();
  if(item.condition==='low_resolution')bytes=await sharp(bytes).resize({width:430}).jpeg({quality:45}).toBuffer();
  if(item.condition==='cropped_status')bytes=await sharp(bytes).extract({left:0,top:0,width:drawing.width,height:drawing.cropHeight}).png().toBuffer();
  const metadata=await sharp(bytes).metadata(),file=`images/${id}.${item.condition==='low_resolution'?'jpg':'png'}`;
  await writeFile(`${root}/${file}`,bytes);
  const expected={...item.fields,...(item.condition==='multiple_amounts'?{amount_sen:null}:{})};
  const blocked=['partial','wrong_account','scheduled','money_request','no_bank'].includes(item.scenario)||['multiple_amounts','cropped_status'].includes(item.condition);
  samples.push({id,layout,scenario:item.scenario,condition:item.condition,file,sha256:imageHash(bytes),width:metadata.width!,height:metadata.height!,bytes:bytes.length,expected,total_sen:item.scenario==='high_value'?78000:12800,expected_eligible:!blocked,expected_role:blocked||item.scenario==='high_value'?'OWNER':'CASHIER'});
}
const manifest:Manifest={version:DATASET_VERSION,provenance:'Team-authored SVG text and raster transformations using Sharp; fictional bank/identifiers only. No real receipts, external image service or feedback inputs.',limitations:'36 correlated images: 12 scenarios/conditions repeated across 3 layouts. Same English label vocabulary as the fixed parser; Arial/Courier New rendering depends on installed fonts. Not an independent holdout or real-bank benchmark. Currency fixed MYR is excluded from accuracy. Multiple-amount target is null because amount is ambiguous; cropped samples retain full source ground truth to count lost fields.',samples};
await writeFile(`${root}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
await mkdir('evaluation/ocr-expanded',{recursive:true});
const chosen=layouts.flatMap(layout=>['normal','normal_blur','normal_low_resolution','normal_rotation','normal_cropped_status','normal_multiple_amounts'].map(scenario=>samples.find(s=>s.id===`${layout}-${scenario}`)!));
const panels=await Promise.all(chosen.map(async(sample,index)=>({input:await sharp(`${root}/${sample.file}`).resize(310,300,{fit:'contain',background:'white'}).jpeg().toBuffer(),left:index%6*320,top:Math.floor(index/6)*330+25})));
const labels=chosen.map((s,i)=>`<text x="${i%6*320+5}" y="${Math.floor(i/6)*330+18}">${s.id}</text>`).join('');
const labelSvg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="990"><g font-family="Arial" font-size="12">${labels}</g></svg>`);
await sharp({create:{width:1920,height:990,channels:3,background:'#e5e7eb'}}).composite([...panels,{input:labelSvg,left:0,top:0}]).jpeg({quality:85}).toFile('evaluation/ocr-expanded/contact-sheet.jpg');
console.log(`Generated ${samples.length} synthetic images and manifest (${DATASET_VERSION}); public application catalog unchanged.`);
