// Odoo 19+/20+ JSON-2 read() result -> EXISTING T3 externalOwner.readExact.
// Transport (POST /json/2/sale.order/read), API key, database selection,
// ERP state transitions, optimistic write checks and durable receipts
// remain at the installed Agent / Odoo owner. Never a second ERP client.
import {digestExternalOwnerSnapshot} from './external-owner-snapshot.mjs';

const OWNER_ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const VERSION=/^[A-Za-z0-9][A-Za-z0-9 ._:/@+-]{0,159}$/;
const RECORD_ID=/^[1-9][0-9]{0,14}$/;
function reject(code){throw Object.assign(new Error(code),{code});}
function safeText(value,re,code){
  if(typeof value!=='string'||!re.test(value))reject(code);
  return value;
}
/** Parse the JSON-2 POST /json/2/sale.order/read result. Odoo's database
 * record ID (integer), NOT its human-readable number (e.g. S00042), is
 * the exact external reference. Require the order-line IDs and total to
 * reject shallow previews mistaken for an authoritative order snapshot.
 * The owner MUST enforce its own remote revision/CAS at native dispatch.
 */
export async function normalizeOdooSaleOrderRead({
  ownerId,expectedRecordId,response,
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
  const digest=await digestExternalOwnerSnapshot(row);
  return Object.freeze({
    source_owner:owner,record_kind:'sale.order',record_id:expected,
    source_revision:version,source_digest:digest,source_receipt:null,
    source_state:state,epistemic_status:'reported',
    record_authority:'EXTERNAL_OWNER',
  });
}
