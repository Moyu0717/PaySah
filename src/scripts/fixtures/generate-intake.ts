import sharp from 'sharp';
import {mkdir,writeFile} from 'node:fs/promises';
import {imageHash} from '../../apps/api/src/modules/receipts/storage.js';
import type {ReceiptFields} from '../../packages/contracts/src/index.js';
// Same 1100x720 team-authored labelled format as generate-receipts.ts. Existing fixtures are not regenerated.
const inputs=[['DEMO-A-TG1',4500,'DEMO-BANK-450','101'],['DEMO-A-TG2',6250,'DEMO-BANK-625','102'],['DEMO-A-GF1',8800,'DEMO-BANK-880','103']] as const;
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const directory='fixtures/receipts/images';await mkdir(directory,{recursive:true});const rows=[];
for(const [external_id,amount_sen,bank_transaction_ref,suffix] of inputs){
 const fields:ReceiptFields={amount_sen,currency:'MYR',bank_transaction_ref,customer_reference:external_id,recipient_account:'DEMO-ACCOUNT-A',occurred_at:'2026-10-23T16:00:00Z',status:'SUCCESS',document_type:'TRANSFER_RECEIPT'};
 const lines=['PAYSAH SYNTHETIC RECEIPT','Bank: DEMO BANK',`Amount: RM ${(amount_sen/100).toFixed(2)}`,`Bank transaction ref: ${fields.bank_transaction_ref}`,`Customer reference: ${external_id}`,`Recipient account: ${fields.recipient_account}`,`Occurred at: ${fields.occurred_at}`,`Status: ${fields.status}`,`Document type: ${fields.document_type}`,'Synthetic example only'];
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="720"><rect width="100%" height="100%" fill="white"/>${lines.map((line,i)=>`<text x="50" y="${60+i*62}" font-family="Arial" font-size="30" fill="black">${escape(line)}</text>`).join('')}</svg>`;
 const bytes=await sharp(Buffer.from(svg)).png().toBuffer(),file=external_id+'.png';await writeFile(directory+'/'+file,bytes);
 rows.push({external_id,order_id:'40000000-0000-4000-8000-000000000'+suffix,bank_transaction_id:'60000000-0000-4000-8000-000000000'+suffix,file,sha256:imageHash(bytes),fields,expected_eligible:true,required_role:'CASHIER'});
}
await writeFile(directory+'/expected.json',JSON.stringify({kind:'team synthetic channel demonstration; one confirmation per order',rows},null,2)+'\n');
console.log('Generated 3 channel-only synthetic receipt PNGs and expected.json; existing receipts unchanged.');
