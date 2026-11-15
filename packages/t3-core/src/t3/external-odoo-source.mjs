// Odoo 19+/20+ JSON-2 read() results -> EXISTING T3 externalOwner.readExact.
// Authenticated sale.order/read and sale.order.line/read, account, revision
// checks and durable execution receipts remain at installed Agent/Odoo.
// These separate JSON-2 calls are NOT one atomic Odoo transaction.
import {digestExternalOwnerSnapshot} from './external-owner-snapshot.mjs';

const OWNER_ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const VERSION=/^[A-Za-z0-9][A-Za-z0-9 ._:/@+-]{0,159}$/;
const RECORD_ID=/^[1-9][0-9]{0,14}$/;
const MONEY=['product_uom_qty','price_unit','discount','price_subtotal','price_total'];
function reject(code){throw Object.assign(new Error(code),{code});}
function safeText(value,re,code){
  if(typeof value!=='string'||!re.test(value))reject(code);
  return value;
}

function exactLineIds(order,lines){
  if(!Array.isArray(lines)||lines.length!==order.order_line.length)
    reject('T3_ODOO_EXACT_LINES_REQUIRED');
  const expected=new Set(order.order_line);
  if(expected.size!==order.order_line.length)
    reject('T3_ODOO_ORDER_FIELDS_REQUIRED');
  const found=new Set();
  for(const line of lines){
    if(!line||typeof line!=='object'||Array.isArray(line)||
       !Number.isSafeInteger(line.id)||!expected.has(line.id)||
       found.has(line.id))reject('T3_ODOO_LINE_IDENTITY_MISMATCH');
    const parent=Array.isArray(line.order_id)&&line.order_id.length===2&&
      typeof line.order_id[1]==='string' ? line.order_id[0]:line.order_id;
    if(parent!==order.id)reject('T3_ODOO_LINE_IDENTITY_MISMATCH');
    safeText(line.write_date,VERSION,'T3_ODOO_LINE_REVISION_REQUIRED');
    if(MONEY.some(field=>typeof line[field]!=='number'||
      !Number.isFinite(line[field]))||!Array.isArray(line.tax_ids)||
      line.tax_ids.some(id=>!Number.isSafeInteger(id)||id<=0)||
      !Number.isSafeInteger(line.sequence)||
      (line.display_type!==false&&
       (typeof line.display_type!=='string'||!line.display_type.trim())))
      reject('T3_ODOO_LINE_FIELDS_REQUIRED');
    found.add(line.id);
  }
  return [...lines].sort((a,b)=>a.id-b.id);
}
/** Read selected Odoo sale.order.id, never the displayed number (S00042).
 * Agent MUST obtain order fields id,write_date,state,name,amount_total,
 * order_line and a second exact sale.order.line/read with at least id,
 * order_id,write_date,sequence,display_type,product_uom_qty,price_unit,
 * discount,tax_ids,price_subtotal,price_total. Missing child rows fail.
 * A multi-call read is NOT atomic; native Odoo execution must enforce
 * transactional parent/line CAS and return its independent receipt.
 */
export async function normalizeOdooSaleOrderRead({
  ownerId,expectedRecordId,response,linesResponse,
}={}){
  const owner=safeText(ownerId,OWNER_ID,'T3_ODOO_OWNER_REQUIRED');
  const expected=safeText(expectedRecordId,RECORD_ID,
    'T3_ODOO_RECORD_ID_REQUIRED');
  if(!Number.isSafeInteger(Number(expected)))
    reject('T3_ODOO_RECORD_ID_REQUIRED');
  // JSON-2 read() returns an array of rows, not a Frappe "data" envelope.
  if(!Array.isArray(response)||response.length!==1)
    reject('T3_ODOO_EXACT_READ_REQUIRED');
  const row=response[0];
  if(!row||typeof row!=='object'||Array.isArray(row)||
     !Number.isSafeInteger(row.id)||row.id<=0||String(row.id)!==expected)
    reject('T3_ODOO_READ_EXACT_IDENTITY_MISMATCH');
  const version=safeText(row.write_date,VERSION,'T3_ODOO_REVISION_REQUIRED');
  const state=safeText(row.state,VERSION,'T3_ODOO_STATE_REQUIRED');
  // The ORM might return only requested fields. Reject a truncated read
  // lacking even minimal order content; it cannot support a stable source.
  if(typeof row.name!=='string'||!row.name.trim()||
     typeof row.amount_total!=='number'||!Number.isFinite(row.amount_total)||
     !Array.isArray(row.order_line)||row.order_line.length>10000||
     row.order_line.some(id=>!Number.isSafeInteger(id)||id<=0))
    reject('T3_ODOO_ORDER_FIELDS_REQUIRED');
  const lines=exactLineIds(row,linesResponse);
  // Hash child data, so changed quantity/price cannot look identical when
  // the parent order.write_date is unchanged.
  const digest=await digestExternalOwnerSnapshot({order:row,lines});
  return Object.freeze({
    source_owner:owner,record_kind:'sale.order',record_id:expected,
    source_revision:version,source_digest:digest,source_receipt:null,
    source_state:state,epistemic_status:'reported',
    record_authority:'EXTERNAL_OWNER',
  });
}
