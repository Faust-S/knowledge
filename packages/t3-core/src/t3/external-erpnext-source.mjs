// Pure browser-safe mapping of an ERPNext/Frappe Sales Order GET response
// to the EXISTING external-process-link.readExact source contract.
// The authenticated HTTP request is made by Agent Account/ToolRuntime,
// never here. ERPNext remains owner of its records, state and revisions.
const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const REVISION=/^[A-Za-z0-9][A-Za-z0-9 ._:/@+-]{0,159}$/;
const MAX_BYTES=2*1024*1024;
function denied(code){throw Object.assign(new Error(code),{code});}
function textField(value,pattern,code){
  if(typeof value!=='string'||!pattern.test(value))denied(code);
  return value;
}
function stable(value,stack=new Set(),depth=0){
  if(depth>32)denied('T3_ERP_SNAPSHOT_TOO_DEEP');
  if(value===null)return 'null';
  if(typeof value==='string')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(typeof value==='boolean')return value?'true':'false';
  if(typeof value!=='object'||stack.has(value))
    denied('T3_ERP_SNAPSHOT_NON_JSON');
  const prototype=Object.getPrototypeOf(value);
  if(!Array.isArray(value)&&prototype!==null&&prototype!==Object.prototype)
    denied('T3_ERP_SNAPSHOT_NON_JSON');
  stack.add(value);
  let result;
  if(Array.isArray(value)){
    if(value.length>10000)denied('T3_ERP_SNAPSHOT_TOO_LARGE');
    result='['+value.map(item=>stable(item,stack,depth+1)).join(',')+']';
  }else{
    const keys=Object.keys(value).sort();
    if(keys.length>10000)denied('T3_ERP_SNAPSHOT_TOO_LARGE');
    result='{'+keys.map(key=>{
      if(key==='__proto__'||key==='prototype'||key==='constructor')
        denied('T3_ERP_SNAPSHOT_UNSAFE_KEY');
      return JSON.stringify(key)+':'+stable(value[key],stack,depth+1);
    }).join(',')+'}';
  }
  stack.delete(value);
  return result;
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
  // Full document digest detects changes to line items and other relevant
  // fields. A matching modified timestamp alone is not sufficient.
  const canonical=stable(data);
  const encoded=new TextEncoder().encode(canonical);
  if(encoded.byteLength>MAX_BYTES)denied('T3_ERP_SNAPSHOT_TOO_LARGE');
  if(typeof globalThis.crypto?.subtle?.digest!=='function')
    denied('T3_ERP_SHA256_UNAVAILABLE');
  const hash=new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',encoded));
  const digest=[...hash].map(x=>x.toString(16).padStart(2,'0')).join('');
  return Object.freeze({
    source_owner:owner,record_kind:'Sales Order',record_id:name,
    source_revision:modified,source_digest:digest,source_receipt:null,
    source_state:status,epistemic_status:'reported',
    record_authority:'EXTERNAL_OWNER',
  });
}
