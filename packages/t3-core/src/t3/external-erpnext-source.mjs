// Pure browser-safe mapping of an ERPNext/Frappe Sales Order GET response
// to the EXISTING external-process-link.readExact source contract.
// The authenticated HTTP request is made by Agent Account/ToolRuntime,
// never here. ERPNext remains owner of its records, state and revisions.
import {digestExternalOwnerSnapshot} from './external-owner-snapshot.mjs';
const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const REVISION=/^[A-Za-z0-9][A-Za-z0-9 ._:/@+-]{0,159}$/;
function denied(code){throw Object.assign(new Error(code),{code});}
function textField(value,pattern,code){
  if(typeof value!=='string'||!pattern.test(value))denied(code);
  return value;
}
/** Convert a single, named Frappe v1 REST GET response:
 *   GET /api/resource/Sales%20Order/{encoded exact name}
 * to the readExact source snapshot expected by external-process-link.
 * Never send these raw ERP fields through the public T3 Object/Event:
 * only the SHA-256 digest and the identity/revision/status survive.
 * This cannot establish an owner-native execution receipt. */
export async function normalizeErpNextSalesOrderRead({
  ownerId,expectedRecordId,response,
}={}){
  const owner=textField(ownerId,ID,'T3_ERP_OWNER_REQUIRED');
  const expected=textField(expectedRecordId,ID,'T3_ERP_RECORD_ID_REQUIRED');
  const data=response?.data;
  if(!data||typeof data!=='object'||Array.isArray(data))
    denied('T3_ERP_READ_EXACT_RESPONSE_REQUIRED');
  const name=textField(data.name,ID,'T3_ERP_RECORD_ID_INVALID');
  if(name!==expected||data.doctype!=='Sales Order')
    denied('T3_ERP_READ_EXACT_IDENTITY_MISMATCH');
  const modified=textField(data.modified,REVISION,'T3_ERP_REVISION_REQUIRED');
  const status=textField(data.status,REVISION,'T3_ERP_STATUS_REQUIRED');
  if(!Number.isInteger(data.docstatus)||![0,1,2].includes(data.docstatus))
    denied('T3_ERP_DOCSTATUS_INVALID');
  // Same snapshot digest shared with Odoo's JSON-2 read() source. Never
  // expose customer records or item lines to T3 Object/Event.
  const digest=await digestExternalOwnerSnapshot(data);
  return Object.freeze({
    source_owner:owner,record_kind:'Sales Order',record_id:name,
    source_revision:modified,source_digest:digest,source_receipt:null,
    source_state:status,epistemic_status:'reported',
    record_authority:'EXTERNAL_OWNER',
  });
}
