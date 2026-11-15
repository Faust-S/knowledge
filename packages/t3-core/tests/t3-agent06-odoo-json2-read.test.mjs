import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOdooSaleOrderRead}
  from '../src/t3/external-odoo-source.mjs';
import {createTrustedAgentErpOrderOwner}
  from '../src/t3/index.mjs';

const ownerId='odoo:shop1:database1';
function linesFor(response){
  const ids=Array.isArray(response)?response[0]?.order_line:null;
  return Array.isArray(ids)?ids.map(id=>({
    id,order_id:[42,'S00042'],write_date:'2026-11-15 16:07:12',
    sequence:id,display_type:false,product_uom_qty:2,price_unit:100,
    discount:0,tax_ids:[1],price_subtotal:200,price_total:220,
    note:'Private line data',
  })):[];
}
const read=(response,expectedRecordId='42',linesResponse=linesFor(response))=>
  normalizeOdooSaleOrderRead({ownerId,expectedRecordId,response,linesResponse});
function source(){
  return [{id:42,name:'S00042',write_date:'2026-11-15 16:07:12',
    state:'sale',amount_total:2500.5,order_line:[77,78],
    partner_id:[456,'Confidential customer'],note:'Private commercial note',
    currency_id:[1,'EUR']}];
}
test('Odoo JSON-2 read() exact sale.order becomes existing reported source only',async()=>{
  const input=source();
  const saved=JSON.stringify(input);
  const obj=await read(input);
  assert.deepEqual(Object.keys(obj).sort(),[
    'source_owner','record_kind','record_id','source_revision','source_digest',
    'source_receipt','source_state','epistemic_status','record_authority'].sort());
  assert.equal(obj.record_kind,'sale.order');
  assert.equal(obj.record_id,'42'); // Odoo DB id, not display number S00042
  assert.equal(obj.source_owner,ownerId);
  assert.equal(obj.source_revision,'2026-11-15 16:07:12');
  assert.equal(obj.source_state,'sale');
  assert.equal(obj.epistemic_status,'reported');
  assert.equal(obj.record_authority,'EXTERNAL_OWNER');
  assert.equal(obj.source_receipt,null);
  assert.match(obj.source_digest,/^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(input),saved);
  assert.equal(JSON.stringify(obj).includes('Confidential customer'),false);
  assert.equal(JSON.stringify(obj).includes('Private commercial note'),false);
  assert.equal(Object.isFrozen(obj),true);
});
test('Odoo canonical digest stable under JSON field order and sensitive to changes',async()=>{
  const v=source();
  const shuffled=[{note:v[0].note,currency_id:v[0].currency_id,
    partner_id:v[0].partner_id,order_line:v[0].order_line,
    amount_total:v[0].amount_total,state:v[0].state,
    write_date:v[0].write_date,name:v[0].name,id:v[0].id}];
  assert.equal((await read(v)).source_digest,(await read(shuffled)).source_digest);
  const changed=source();changed[0].order_line=[77,79];
  assert.equal((await read(changed)).source_revision,(await read(v)).source_revision);
  assert.notEqual((await read(changed)).source_digest,(await read(v)).source_digest);
  const cancelled=source();cancelled[0].state='cancel';
  assert.equal((await read(cancelled)).source_state,'cancel');
  assert.notEqual((await read(cancelled)).source_digest,(await read(v)).source_digest);
});
test('Odoo rejects extra rows and mismatched numeric database IDs',async()=>{
  await assert.rejects(read([]),{code:'T3_ODOO_EXACT_READ_REQUIRED'});
  await assert.rejects(read([source()[0],source()[0]]),
    {code:'T3_ODOO_EXACT_READ_REQUIRED'});
  await assert.rejects(read({data:source()}),{code:'T3_ODOO_EXACT_READ_REQUIRED'});
  await assert.rejects(read([{...source()[0],id:41}]),
    {code:'T3_ODOO_READ_EXACT_IDENTITY_MISMATCH'});
  await assert.rejects(read(source(),'S00042'),{code:'T3_ODOO_RECORD_ID_REQUIRED'});
  await assert.rejects(read(source(),'00042'),{code:'T3_ODOO_RECORD_ID_REQUIRED'});
});
test('Odoo requires version, state and meaningful order fields',async()=>{
  const missingDate=source();delete missingDate[0].write_date;
  await assert.rejects(read(missingDate),{code:'T3_ODOO_REVISION_REQUIRED'});
  const missingState=source();missingState[0].state=null;
  await assert.rejects(read(missingState),{code:'T3_ODOO_STATE_REQUIRED'});
  for(const field of ['name','amount_total','order_line']){
    const truncated=source();delete truncated[0][field];
    await assert.rejects(read(truncated),{code:'T3_ODOO_ORDER_FIELDS_REQUIRED'});
  }
  const invalidLines=source();invalidLines[0].order_line=[77,'78'];
  await assert.rejects(read(invalidLines),{code:'T3_ODOO_ORDER_FIELDS_REQUIRED'});
  const invalidTotal=source();invalidTotal[0].amount_total=Number.POSITIVE_INFINITY;
  await assert.rejects(read(invalidTotal),{code:'T3_ODOO_ORDER_FIELDS_REQUIRED'});
});
test('Odoo does not accept cyclic, unsafe or oversized untrusted records',async()=>{
  const cyclic=source();cyclic[0].cycle=cyclic[0];
  await assert.rejects(read(cyclic),{code:'T3_ERP_SNAPSHOT_NON_JSON'});
  const dangerous=source();
  dangerous[0]=JSON.parse(JSON.stringify(dangerous[0]).slice(0,-1)+
    ',"__proto__":"evil"}');
  await assert.rejects(read(dangerous),{code:'T3_ERP_SNAPSHOT_UNSAFE_KEY'});
  const huge=source();huge[0].note='X'.repeat(2*1024*1024);
  await assert.rejects(read(huge),{code:'T3_ERP_SNAPSHOT_TOO_LARGE'});
});
test('Odoo source is read-only: its status never implies a signed workflow receipt',async()=>{
  const data=source();
  for(const state of ['draft','sent','sale','done','cancel']){
    data[0].state=state;
    const obj=await read(data);
    assert.equal(obj.source_state,state);
    assert.equal(obj.source_receipt,null);
    assert.equal(obj.epistemic_status,'reported');
    assert.equal(obj.record_authority,'EXTERNAL_OWNER');
  }
});

test('Odoo quantity/price changes alter digest even with unchanged parent write_date',async()=>{
  const before=source(),stable=await read(before);
  const changedQty=linesFor(before);changedQty[0].product_uom_qty=3;
  const newQty=await read(before,'42',changedQty);
  assert.equal(newQty.source_revision,stable.source_revision);
  assert.notEqual(newQty.source_digest,stable.source_digest);
  const changedPrice=linesFor(before);changedPrice[1].price_unit=150;
  const newPrice=await read(before,'42',changedPrice);
  assert.equal(newPrice.source_revision,stable.source_revision);
  assert.notEqual(newPrice.source_digest,stable.source_digest);
  assert.equal((await read(before,'42',linesFor(before).reverse())).source_digest,
    stable.source_digest);
  assert.equal(JSON.stringify(newPrice).includes('Private line data'),false);
});
test('Odoo rejects missing/duplicate/foreign/partial child rows',async()=>{
  const order=source(),lines=linesFor(order);
  await assert.rejects(read(order,'42',null),
    {code:'T3_ODOO_EXACT_LINES_REQUIRED'});
  await assert.rejects(read(order,'42',lines.slice(0,1)),
    {code:'T3_ODOO_EXACT_LINES_REQUIRED'});
  await assert.rejects(read(order,'42',[lines[0],lines[0]]),
    {code:'T3_ODOO_LINE_IDENTITY_MISMATCH'});
  await assert.rejects(read(order,'42',[lines[0],{...lines[1],id:100}]),
    {code:'T3_ODOO_LINE_IDENTITY_MISMATCH'});
  await assert.rejects(read(order,'42',[lines[0],{...lines[1],order_id:[43,'Wrong']}]),
    {code:'T3_ODOO_LINE_IDENTITY_MISMATCH'});
  await assert.rejects(read(order,'42',[lines[0],{...lines[1],write_date:null}]),
    {code:'T3_ODOO_LINE_REVISION_REQUIRED'});
  for(const field of ['product_uom_qty','price_unit','discount',
                      'price_subtotal','price_total','tax_ids','sequence','display_type']){
    const invalid={...lines[1]};delete invalid[field];
    await assert.rejects(read(order,'42',[lines[0],invalid]),
      {code:'T3_ODOO_LINE_FIELDS_REQUIRED'});
  }
  const repeated=source();repeated[0].order_line=[77,77];
  await assert.rejects(read(repeated,'42',lines),
    {code:'T3_ODOO_ORDER_FIELDS_REQUIRED'});
});
test('Odoo rejects dangerous oversized child JSON; zero-line draft is valid',async()=>{
  const order=source(),lines=linesFor(order);
  const huge={...lines[1],note:'X'.repeat(2*1024*1024)};
  await assert.rejects(read(order,'42',[lines[0],huge]),
    {code:'T3_ERP_SNAPSHOT_TOO_LARGE'});
  const proto=JSON.parse('{"__proto__":"private"}');
  await assert.rejects(read(order,'42',[lines[0],{...lines[1],...proto}]),
    {code:'T3_ERP_SNAPSHOT_UNSAFE_KEY'});
  const empty=source();empty[0].order_line=[];
  assert.equal((await read(empty,'42',[])).source_receipt,null);
});

const agentBridgeSelection=Object.freeze({
  sourceFormat:'ODOO_JSON2_V1',providerId:'ODOO_JSON2_SALES_V1',
  ownerId:'odoo:'+'c'.repeat(64),providerBindingDigest:'d'.repeat(64),
});
function agentReceipt(data,sourceFormat='ODOO_JSON2_V1'){
  return {profile:'IWXA_PERSONAL_TOOL_PROVIDER_0.12',
    input_required:false,
    receipt:{status:'SUCCEEDED',tool_id:'erp.order.read',
      provider_slot:'erp_orders',provider_id:'ODOO_JSON2_SALES_V1',
      provider_binding_digest:'d'.repeat(64),
      receipt_id:'TRR-'+'a'.repeat(18),output_digest:'e'.repeat(64)},
    data:{source_format:sourceFormat,source_owner:agentBridgeSelection.ownerId,
      record_kind:'sale.order',record_id:'42',response:source(),
      linesResponse:linesFor(source()),...data},
  };
}
test('trusted Agent ToolRuntime receipt -> original T3 reported Odoo source',async()=>{
  let calls=0,result=agentReceipt();
  const readTool=async(operation,args)=>{
    assert.equal(operation,'erp.order.read');assert.deepEqual(args,{record_id:'42'});
    calls++;return result;
  };
  const owner=createTrustedAgentErpOrderOwner({
    selectedAccount:agentBridgeSelection,readTool,isHostActive:()=>true,
  });
  const first=await owner.readExact({record_kind:'sale.order',record_id:'42'});
  assert.equal(first.source_owner,agentBridgeSelection.ownerId);
  assert.equal(first.source_receipt,null);
  assert.equal(first.epistemic_status,'reported');
  assert.equal(JSON.stringify(first).includes('Confidential customer'),false);
  assert.equal(JSON.stringify(first).includes('Private line data'),false);
  const changed=linesFor(source());changed[0].product_uom_qty=3;
  result=agentReceipt({linesResponse:changed});
  const updated=await owner.readExact({record_kind:'sale.order',record_id:'42'});
  assert.equal(first.source_revision,updated.source_revision);
  assert.notEqual(first.source_digest,updated.source_digest);
  assert.equal(calls,2);
});
test('trusted Agent bridge rejects receipt/account mismatch and inactive Host',async()=>{
  let active=true;
  let result=agentReceipt();
  const owner=createTrustedAgentErpOrderOwner({
    selectedAccount:agentBridgeSelection,readTool:async()=>result,
    isHostActive:()=>active,
  });
  const reference={record_kind:'sale.order',record_id:'42'};
  result={...agentReceipt(),receipt:{...agentReceipt().receipt,
    provider_binding_digest:'f'.repeat(64)}};
  await assert.rejects(owner.readExact(reference),
    {code:'T3_AGENT_ERP_RECEIPT_OR_ACCOUNT_MISMATCH'});
  result={...agentReceipt(),data:{...agentReceipt().data,
    source_owner:'odoo:'+'f'.repeat(64)}};
  await assert.rejects(owner.readExact(reference),
    {code:'T3_AGENT_ERP_RECEIPT_OR_ACCOUNT_MISMATCH'});
  result=agentReceipt();active=false;
  await assert.rejects(owner.readExact(reference),{code:'T3_HOST_DISPOSED'});
  active=true;
  await assert.rejects(owner.readExact({record_kind:'sale.order',record_id:'43'}),
    {code:'T3_AGENT_ERP_RECEIPT_OR_ACCOUNT_MISMATCH'});
  await assert.rejects(owner.readExact({record_kind:'Sales Order',record_id:'42'}),
    {code:'T3_AGENT_ERP_REFERENCE_INVALID'});
});
test('trusted Agent bridge maps ERPNext through original pure source converter',async()=>{
  const ownerId='erpnext:'+'e'.repeat(64);
  const selection={sourceFormat:'ERPNEXT_REST_V1',
    providerId:'ERPNEXT_ACCOUNT_2',ownerId,providerBindingDigest:'d'.repeat(64)};
  const owner=createTrustedAgentErpOrderOwner({
    selectedAccount:selection,isHostActive:()=>true,
    readTool:async()=>({
      profile:'IWXA_PERSONAL_TOOL_PROVIDER_0.12',input_required:false,
      receipt:{status:'SUCCEEDED',tool_id:'erp.order.read',
        provider_slot:'erp_orders',provider_id:'ERPNEXT_ACCOUNT_2',
        provider_binding_digest:'d'.repeat(64),
        receipt_id:'TRR-'+'b'.repeat(18),output_digest:'f'.repeat(64)},
      data:{source_format:'ERPNEXT_REST_V1',source_owner:ownerId,
        record_kind:'Sales Order',record_id:'SO-0042',
        response:{data:{doctype:'Sales Order',name:'SO-0042',
          modified:'2026-11-15 16:10:00',status:'Submitted',docstatus:1,
          customer:'Private buyer',items:[{qty:3,rate:55}]}}},
    }),
  });
  const mapped=await owner.readExact({record_kind:'Sales Order',record_id:'SO-0042'});
  assert.equal(mapped.source_owner,ownerId);
  assert.equal(mapped.record_kind,'Sales Order');
  assert.equal(mapped.source_state,'Submitted');
  assert.equal(mapped.epistemic_status,'reported');
  assert.equal(mapped.source_receipt,null);
  assert.equal(JSON.stringify(mapped).includes('Private buyer'),false);
});
