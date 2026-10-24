import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verify,type RuleInput} from '../../apps/api/src/modules/verification/rules.js';
import {fixtures} from '../../apps/api/src/modules/verification/fixtures.js';

const base:RuleInput={
  total_sen:12800,fields:fixtures.normal,accounts:['DEMO-ACCOUNT-A'],duplicate_evidence:false,duplicate_reference:false,manual:false,
  transactions:[{id:'tx',account_identifier:'DEMO-ACCOUNT-A',active:true,version:1,bank_transaction_ref:'DEMO-BANK-128',amount_sen:12800,currency:'MYR',direction:'CREDIT',status:'BOOKED',booked_at:'2026-10-22T06:00:00Z',allocated:false}],
};
test('bank matching requires full account, booked credit, reliable bank reference and explicit time',()=>{
  assert.equal(verify(base).eligible,true);
  for(const change of [{direction:'DEBIT'},{status:'PENDING'},{status:'REVERSED'},{active:false},{booked_at:'2026-10-24T06:00:01Z'},{currency:'USD'}]){
    assert.equal(verify({...base,transactions:[{...base.transactions[0],...change}]}).eligible,false);
  }
  for(const change of [{recipient_account:'****1234'},{recipient_account:'OTHER'},{occurred_at:null},{bank_transaction_ref:null,customer_reference:'DEMO-BANK-128'}]){
    assert.equal(verify({...base,fields:{...base.fields,...change}}).eligible,false);
  }
});
test('all anomalies are retained; partial, overpaid, pending, failed and ambiguous evidence block Owner as well',()=>{
  for(const status of ['PENDING','SCHEDULED','FAILED','UNKNOWN'] as const)assert.equal(verify({...base,fields:{...base.fields,status}}).eligible,false);
  for(const amount of [5000,20000])assert.equal(verify({...base,fields:{...base.fields,amount_sen:amount}}).eligible,false);
  const result=verify({...base,total_sen:78000,duplicate_evidence:true,fields:{...base.fields,status:'SCHEDULED',recipient_account:'OTHER'}});
  for(const flag of ['HIGH_VALUE','DUPLICATE_EVIDENCE','TRANSFER_NOT_COMPLETE','WRONG_RECIPIENT','PARTIAL_PAYMENT','BANK_NOT_FOUND'])assert.ok(result.flags.includes(flag));
  assert.equal(verify({...base,transactions:[base.transactions[0],{...base.transactions[0],id:'second'}]}).eligible,false);
});
test('RM500 uses normal role and RM500.01 requires Owner; manual/corrected fields never upgrade evidence',()=>{
  for(const amount of [50000,50001]){
    const result=verify({...base,total_sen:amount,fields:{...base.fields,amount_sen:amount},transactions:[{...base.transactions[0],amount_sen:amount}]});
    assert.equal(result.eligible,true);assert.equal(result.required_role,amount>50000?'OWNER':'CASHIER');
  }
  assert.equal(verify({...base,manual:true}).required_role,'OWNER');
  assert.equal(verify({...base,manual:true,transactions:[]}).eligible,false);
});
