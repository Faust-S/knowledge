// Trusted Agent Account/ToolRuntime read receipt -> EXISTING T3 externalOwner.
// No second ERP client, HTTP transport, credential store or Kernel.
import {normalizeErpNextSalesOrderRead} from './external-erpnext-source.mjs';
import {normalizeOdooSaleOrderRead} from './external-odoo-source.mjs';

const SHA=/^[0-9a-f]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const FORMATS=Object.freeze({
  ERPNEXT_REST_V1:Object.freeze({kind:'Sales Order'}),
  ODOO_JSON2_V1:Object.freeze({kind:'sale.order'}),
});
function deny(code){throw Object.assign(new Error(code),{code});}

/** Construct ONLY inside the trusted original T3 Host, from an Agent provider
 * selection supplied over its private service port. The renderer may choose
 * record_id, never provider, binding or ownerId. readTool invokes existing
 * Agent ToolRuntime.read (TRR), not an HTTP client or new process engine.
 */
export function createTrustedAgentErpOrderOwner({
  selectedAccount,readTool,isHostActive,
}={}){
  const format=selectedAccount?.sourceFormat;
  const contract=FORMATS[format];
  const ownerId=selectedAccount?.ownerId;
  const providerId=selectedAccount?.providerId;
  const binding=selectedAccount?.providerBindingDigest;
  if(!contract||typeof providerId!=='string'||!ID.test(providerId)||providerId==='NONE'||
     typeof ownerId!=='string'||!ID.test(ownerId)||
     typeof binding!=='string'||!SHA.test(binding)||
     typeof readTool!=='function'||typeof isHostActive!=='function')
    deny('T3_AGENT_ERP_TRUSTED_ACCOUNT_REQUIRED');
  const prefix=format==='ODOO_JSON2_V1'?'odoo:':'erpnext:';
  if(!ownerId.startsWith(prefix)||!SHA.test(ownerId.slice(prefix.length)))
    deny('T3_AGENT_ERP_OWNER_IDENTITY_INVALID');

  async function readExact(reference){
    if(isHostActive()!==true)deny('T3_HOST_DISPOSED');
    if(!reference||reference.record_kind!==contract.kind||
       typeof reference.record_id!=='string'||!ID.test(reference.record_id))
      deny('T3_AGENT_ERP_REFERENCE_INVALID');
    const recordId=reference.record_id;
    let result;
    try{
      result=await readTool('erp.order.read',Object.freeze({record_id:recordId}));
    }catch{
      deny('T3_AGENT_ERP_SOURCE_READ_FAILED');
    }
    if(isHostActive()!==true)deny('T3_HOST_DISPOSED');
    const receipt=result?.receipt;
    const data=result?.data;
    if(result?.profile!=='IWXA_PERSONAL_TOOL_PROVIDER_0.12'||
       result.input_required!==false||
       receipt?.status!=='SUCCEEDED'||
       receipt?.tool_id!=='erp.order.read'||
       receipt?.provider_slot!=='erp_orders'||
       receipt?.provider_id!==providerId||
       receipt?.provider_binding_digest!==binding||
       typeof receipt?.receipt_id!=='string'||
       !/^TRR-[a-f0-9]{18}$/.test(receipt.receipt_id)||
       typeof receipt?.output_digest!=='string'||!SHA.test(receipt.output_digest)||
       data?.source_format!==format||data?.source_owner!==ownerId||
       data?.record_kind!==contract.kind||data?.record_id!==recordId)
      deny('T3_AGENT_ERP_RECEIPT_OR_ACCOUNT_MISMATCH');
    const mapped=format==='ODOO_JSON2_V1'?
      await normalizeOdooSaleOrderRead({
        ownerId,expectedRecordId:recordId,
        response:data.response,linesResponse:data.linesResponse,
      }):
      await normalizeErpNextSalesOrderRead({
        ownerId,expectedRecordId:recordId,response:data.response,
      });
    if(isHostActive()!==true)deny('T3_HOST_DISPOSED');
    return mapped;
  }
  return Object.freeze({ownerId,readExact});
}
