// Read-only projection of the existing corporate Object/Event contract.
// This is not a Store, second Result, signature verifier or delivery receipt.
// The selected signed KernelFacade remains the only data authority.
const RECORD_SCHEMA='IWXA_T3_ORIGINAL_COMPANY_WORK_RECORD/1';
export const COMPANY_WORK_SCHEMA='iwxa.t3.company-work-record';
const ACCEPTED_SCHEMA='iwxa.agent.accepted-result';
const KINDS=new Set(['TASK','DRAFT','DOCUMENT','RESULT','HISTORY']);
const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const SHA=/^[a-f0-9]{64}$/;
const id=v=>typeof v==='string'&&ID.test(v);
const hex=v=>typeof v==='string'&&SHA.test(v);
const requireThat=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};
export function companyWorkRecordKeyParts(data){
  return [data.organizationId,data.workspaceId,data.taskId,
    data.taskRevisionId,data.kind,data.artifactId];
}
export function companyWorkEventPayload(data,objectId){
  return {schema:data.schema,kind:data.kind,artifactId:data.artifactId,
    operationId:data.operationId,organizationId:data.organizationId,
    workspaceId:data.workspaceId,executorId:data.executorId,
    taskId:data.taskId,taskRevisionId:data.taskRevisionId,
    taskPackageSha256:data.taskPackageSha256,
    artifactSha256:data.sha256,sourceKind:data.sourceKind,objectId};
}
export function isInstalledCompanyExchange(kernel,signedWorkspaceScope){
  return signedWorkspaceScope===true&&
    ['iwxa.admin-center.workspace','iwxa.personal-agent.workspace']
      .includes(kernel?.sessionInfo?.service_id);
}
async function sha256Text(text){
  requireThat(typeof globalThis.crypto?.subtle?.digest==='function',
    'T3_COMPANY_READBACK_DIGEST_UNAVAILABLE');
  const digest=new Uint8Array(await globalThis.crypto.subtle.digest(
    'SHA-256',new TextEncoder().encode(text)));
  return [...digest].map(x=>x.toString(16).padStart(2,'0')).join('');
}
const equalFields=(a,b)=>a&&typeof a==='object'&&!Array.isArray(a)&&
  Object.keys(a).length===Object.keys(b).length&&
  Object.keys(b).every(key=>a[key]===b[key]);

// Complete expectedRows come only from the ORIGINAL Kernel import preview.
// A cold read uses null expectedRows; it does not assert receipt of a
// particular archive. It returns current readback, not a delivery ACK.
export async function readOriginalCompanyWorkspace({
  kernel,workspaceId,expectedRows=null,organizationId=null,
}={}){
  requireThat(id(workspaceId)&&!workspaceId.startsWith('workspace:registry:')&&
    (organizationId===null||id(organizationId))&&
    kernel?.sessionInfo?.contract_version==='1.3.0'&&
    typeof kernel.hasOperation==='function'&&
    ['getWorkspace','listObjects','listEventsSince'].every(method=>
      typeof kernel[method]==='function'&&kernel.hasOperation('t1.'+method)),
    'T3_COMPANY_READBACK_ORIGINAL_KERNEL_REQUIRED');
  const before=await kernel.getWorkspace(workspaceId);
  requireThat(before?.workspace_id===workspaceId&&before.deleted_at==null,
    'T3_COMPANY_READBACK_WORKSPACE_MISSING');
  const rows=await kernel.listObjects({workspace_id:workspaceId,include_deleted:true});
  const events=await kernel.listEventsSince(workspaceId);
  requireThat(Array.isArray(rows)&&Array.isArray(events)&&
    rows.every(row=>row?.workspace_id===workspaceId&&id(row.object_id))&&
    events.every(event=>event?.workspace_id===workspaceId),
    'T3_COMPANY_READBACK_SCOPE_CHANGED');
  const byId=new Map(rows.map(row=>[row.object_id,row]));
  requireThat(byId.size===rows.length,'T3_COMPANY_READBACK_DUPLICATE_OBJECT');
  if(expectedRows!==null){
    requireThat(Array.isArray(expectedRows)&&
      new Set(expectedRows.map(row=>row.object_id)).size===expectedRows.length,
      'T3_COMPANY_READBACK_EXPECTED_OBJECTS_INVALID');
    for(const incoming of expectedRows){
      const local=byId.get(incoming?.object_id);
      requireThat(incoming?.workspace_id===workspaceId&&
        [COMPANY_WORK_SCHEMA,ACCEPTED_SCHEMA].includes(incoming.schema_id)&&
        Number.isSafeInteger(incoming.incoming_revision)&&incoming.incoming_revision>=1&&
        local?.schema_id===incoming.schema_id&&local.schema_version===incoming.schema_version&&
        local.revision===incoming.incoming_revision&&
        local.deleted!==true&&local.deleted_at==null,
        'T3_COMPANY_READBACK_IMPORTED_OBJECT_MISMATCH');
    }
  }
  // Index the existing event history once. No per-record Store calls and
  // no quadratic scan when a company has thousands of work records.
  const eventIndex=new Map();
  for(const event of events){
    if(event.event_type!=='iwxa.company.work-record.committed')continue;
    const matches=eventIndex.get(event.object_id)??[];
    matches.push(event);eventIndex.set(event.object_id,matches);
  }
  const records=rows.filter(row=>row.schema_id===COMPANY_WORK_SCHEMA);
  const orgs=new Set();
  const result=[];
  for(let i=0;i<records.length;i+=16){
    const batch=await Promise.all(records.slice(i,i+16).map(async row=>{
      const d=row.data;
      requireThat(row.schema_version==='1.0.0'&&row.revision===1&&
        row.deleted!==true&&row.deleted_at==null&&d?.schema===RECORD_SCHEMA&&
        d.workspaceId===workspaceId&&
        ['organizationId','executorId','taskId','artifactId','operationId'].every(k=>id(d[k]))&&
        (organizationId===null||d.organizationId===organizationId)&&
        KINDS.has(d.kind)&&hex(d.taskRevisionId)&&hex(d.taskPackageSha256)&&
        hex(d.sha256)&&typeof d.text==='string'&&d.text.length>0&&d.text.length<=2000000&&
        ['text/plain','text/markdown','application/json'].includes(d.mimeType)&&
        (d.kind==='RESULT'?d.sourceKind==='ORIGINAL_AGENT_HUMAN_ACCEPTED':
          d.sourceKind==='ORIGINAL_COMPANY_WORKAREA'||
          d.kind==='TASK'&&d.sourceKind==='ORIGINAL_SIGNED_TASK'),
        'T3_COMPANY_READBACK_RECORD_INVALID');
      const token=await sha256Text(JSON.stringify(companyWorkRecordKeyParts(d)));
      requireThat(row.object_id==='company:work:'+token&&
        await sha256Text(d.text)===d.sha256,
        'T3_COMPANY_READBACK_CONTENT_MISMATCH');
      const matches=eventIndex.get(row.object_id)??[];
      requireThat(matches.length===1&&id(matches[0].event_id)&&
        matches[0].revision===row.revision&&matches[0].idempotency_key===token&&
        equalFields(matches[0].payload,companyWorkEventPayload(d,row.object_id)),
        'T3_COMPANY_READBACK_EVENT_MISMATCH');
      return Object.freeze({objectId:row.object_id,eventId:matches[0].event_id,
        organizationId:d.organizationId,workspaceId,executorId:d.executorId,
        taskId:d.taskId,taskRevisionId:d.taskRevisionId,
        taskPackageSha256:d.taskPackageSha256,artifactId:d.artifactId,
        kind:d.kind,mimeType:d.mimeType,sha256:d.sha256,text:d.text});
    }));
    for(const row of batch){orgs.add(row.organizationId);result.push(row);}
  }
  requireThat(orgs.size<=1,'T3_COMPANY_READBACK_ORGANIZATION_MISMATCH');
  const after=await kernel.getWorkspace(workspaceId);
  // Never display a successful mixed snapshot if another operation updated
  // the original Workspace while we were reading its Object/Event data.
  requireThat(after?.workspace_id===workspaceId&&after.deleted_at==null&&
    typeof before.updated_at==='string'&&after.updated_at===before.updated_at,
    'T3_COMPANY_READBACK_WORKSPACE_CHANGED');
  result.sort((a,b)=>a.taskId.localeCompare(b.taskId)||
    a.taskRevisionId.localeCompare(b.taskRevisionId)||
    a.kind.localeCompare(b.kind)||a.artifactId.localeCompare(b.artifactId));
  return Object.freeze({workspaceId,originalKernelReadback:true,
    checkedImportedObjects:expectedRows===null?null:expectedRows.length,
    records:Object.freeze(result),signedReceiptVerified:false});
}
