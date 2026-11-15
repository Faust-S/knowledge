import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeErpNextSalesOrderRead}
  from '../src/t3/external-erpnext-source.mjs';

function response(){
  return {data:{doctype:'Sales Order',name:'SO-0042',
    modified:'2026-11-15 13:05:00.3000',status:'To Deliver and Bill',
    docstatus:1,customer:'Confidential Customer',
    items:[{item_code:'SKU-001',qty:2,rate:1250.25}],
    grand_total:2500.5}};
}
const read=r=>normalizeErpNextSalesOrderRead({
  ownerId:'erpnext:shop1',expectedRecordId:'SO-0042',response:r,
});
test('Frappe Sales Order GET maps to exact non-PII reported original link source',async()=>{
  const original=response(),snapshot=JSON.stringify(original);
  const s=await read(original);
  assert.deepEqual(Object.keys(s).sort(),[
    'epistemic_status','record_authority','record_id','record_kind',
    'source_digest','source_owner','source_receipt',
    'source_revision','source_state'].sort());
  assert.equal(s.source_owner,'erpnext:shop1');
  assert.equal(s.record_kind,'Sales Order');
  assert.equal(s.record_id,'SO-0042');
  assert.equal(s.source_revision,'2026-11-15 13:05:00.3000');
  assert.equal(s.source_state,'To Deliver and Bill');
  assert.equal(s.source_receipt,null);
  assert.equal(s.epistemic_status,'reported');
  assert.equal(s.record_authority,'EXTERNAL_OWNER');
  assert.match(s.source_digest,/^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(s).includes('Confidential Customer'),false);
  assert.equal(JSON.stringify(s).includes('SKU-001'),false);
  assert.equal(JSON.stringify(original),snapshot);
  assert.equal(Object.isFrozen(s),true);
});
test('same ERP JSON fields in any object key order produce the same digest',async()=>{
  const a=response();
  const reordered={data:{
    grand_total:a.data.grand_total,
    items:[{rate:1250.25,qty:2,item_code:'SKU-001'}],
    customer:a.data.customer,
    status:a.data.status,
    name:a.data.name,
    docstatus:a.data.docstatus,
    modified:a.data.modified,
    doctype:a.data.doctype,
  }};
  assert.equal((await read(a)).source_digest,(await read(reordered)).source_digest);
});
test('same modified with changed ERP line item/total or cancelled order changes digest',async()=>{
  const base=response(),baseline=await read(base);
  const changed=response();changed.data.items[0].qty=3;
  assert.notEqual((await read(changed)).source_digest,baseline.source_digest);
  assert.equal((await read(changed)).source_revision,baseline.source_revision);
  const cancelled=response();cancelled.data.docstatus=2;
  cancelled.data.status='Cancelled';
  const c=await read(cancelled);
  assert.notEqual(c.source_digest,baseline.source_digest);
  assert.equal(c.source_state,'Cancelled');
  // These are REPORTED records. Native Agent/ERP owner enforces whether
  // the cancelled order permits any action; the adapter grants no write.
});
test('different order, doctype, malformed source revision or status fails closed',async()=>{
  const wrong=response();wrong.data.name='SO-0043';
  await assert.rejects(read(wrong),{code:'T3_ERP_READ_EXACT_IDENTITY_MISMATCH'});
  const notOrder=response();notOrder.data.doctype='Purchase Order';
  await assert.rejects(read(notOrder),{code:'T3_ERP_READ_EXACT_IDENTITY_MISMATCH'});
  const absent=response();delete absent.data.modified;
  await assert.rejects(read(absent),{code:'T3_ERP_REVISION_REQUIRED'});
  const invalidStatus=response();invalidStatus.data.status=null;
  await assert.rejects(read(invalidStatus),{code:'T3_ERP_STATUS_REQUIRED'});
  const badDocstatus=response();badDocstatus.data.docstatus=3;
  await assert.rejects(read(badDocstatus),{code:'T3_ERP_DOCSTATUS_INVALID'});
  await assert.rejects(read({message:'Unauthorized'}),
    {code:'T3_ERP_READ_EXACT_RESPONSE_REQUIRED'});
});
test('corrupted, cyclic, unsafe or oversized ERP response is rejected',async()=>{
  const cyclic=response();cyclic.data.loop=cyclic.data;
  await assert.rejects(read(cyclic),{code:'T3_ERP_SNAPSHOT_NON_JSON'});
  const dangerous=response();dangerous.data=JSON.parse(
    '{"doctype":"Sales Order","name":"SO-0042",'+
    '"modified":"2026-11-15 13:05:00.3000",'+
    '"status":"To Deliver","docstatus":1,"__proto__":"x"}');
  await assert.rejects(read(dangerous),{code:'T3_ERP_SNAPSHOT_UNSAFE_KEY'});
  const large=response();large.data.comments='A'.repeat(2*1024*1024);
  await assert.rejects(read(large),{code:'T3_ERP_SNAPSHOT_TOO_LARGE'});
});
