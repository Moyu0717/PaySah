import type {ReceiptFields} from '../packages/contracts/src/index.js';
import {fixtures} from '../apps/api/src/modules/verification/fixtures.js';

export const DATASET_VERSION='synthetic-layouts.v2';
export const layouts=['ledger','portrait','compact'] as const;
export type Layout=typeof layouts[number];
export type Condition='clear'|'blur'|'rotation'|'low_resolution'|'multiple_amounts'|'cropped_status';
export type Sample={id:string;layout:Layout;scenario:string;condition:Condition;file:string;sha256:string;width:number;height:number;bytes:number;expected:ReceiptFields;total_sen:number;expected_eligible:boolean;expected_role:'CASHIER'|'OWNER'};
export type Manifest={version:string;provenance:string;limitations:string;samples:Sample[]};
export function cases(){
  return [
    ...Object.entries(fixtures).map(([scenario,fields])=>({scenario,condition:'clear' as Condition,fields:{...fields}})),
    ...(['blur','rotation','low_resolution','multiple_amounts','cropped_status'] as Condition[]).map(condition=>({scenario:`normal_${condition}`,condition,fields:{...fixtures.normal}})),
  ];
}
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export function renderReceipt(layout:Layout,fields:ReceiptFields,multiple=false){
  const values=[['Amount',`RM ${((fields.amount_sen??0)/100).toFixed(2)}`],['Bank transaction ref',fields.bank_transaction_ref],['Customer reference',fields.customer_reference],['Recipient account',fields.recipient_account],['Occurred at',fields.occurred_at],['Status',fields.status],['Document type',fields.document_type]];
  const settings={ledger:{width:1160,height:760,x:55,y:150,gap:66,size:30,font:'Arial'},portrait:{width:1050,height:1100,x:75,y:240,gap:95,size:29,font:'Arial'},compact:{width:1250,height:660,x:35,y:155,gap:55,size:27,font:'Courier New'}}[layout];
  const {width,height,x,y,gap,size,font}=settings;
  const decorations=layout==='portrait'?`<rect x="35" y="30" width="980" height="1030" rx="18" fill="#f8fafc" stroke="#94a3b8"/><rect x="35" y="30" width="980" height="125" rx="18" fill="#e2e8f0"/>`:'';
  const rows=values.map(([label,value],index)=>{
    const rowY=y+gap*index;
    const text=layout==='compact'?`<text x="${x}" y="${rowY}">${escape(label!)}:</text><text x="430" y="${rowY}">${escape(value??'')}</text>`:`<text x="${x}" y="${rowY}">${escape(label!)}: ${escape(value??'')}</text>`;
    return `${layout==='ledger'?`<line x1="45" y1="${rowY+20}" x2="1110" y2="${rowY+20}" stroke="#cbd5e1"/>`:''}${text}`;
  }).join('');
  const extra=multiple?`<text x="${x}" y="${y+gap*7}">Service fee: RM 1.00</text>`:'';
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/>${decorations}<g font-family="${font}" font-size="${size}" fill="#111827"><text x="${x}" y="65">SYNTHETIC TRANSFER EXAMPLE</text><text x="${x}" y="105">Demo Bank - no actual payment</text>${rows}${extra}</g></svg>`;
  // Cropping removes status/document rows while retaining the earlier fields.
  return {svg,width,height,cropHeight:y+gap*4+25};
}
