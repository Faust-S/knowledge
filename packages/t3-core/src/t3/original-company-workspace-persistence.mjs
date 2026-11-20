// Corporate Task/Document/Draft/Result/History material is an ORIGINAL T2
// Object/Event in the company's signed Workspace, never an Agent WorkArea
// authority. No Store, IAM, Task Engine, signer, Exchange or new Result here.
// The installed native owner provides the ORIGINAL signed Task and reads the
// unmodified company artifact from its own installed Core; the web UI cannot
// supply content, an Access port, Kernel or a recipient.
import {createHash} from 'node:crypto';
import {createSubjectKernelBinding} from './subject-access-binding.mjs';

export const ORIGINAL_COMPANY_RECORD_SCHEMA='iwxa.t3.company-work-record';
const RECORD_SCHEMA='IWXA_T3_ORIGINAL_COMPANY_WORK_RECORD/1';
const KINDS=new Set(['TASK','DRAFT','DOCUMENT','RESULT','HISTORY']);
const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const SHA=/^[a-f0-9]{64}$/;
const id=s=>typeof s==='string'&&ID.test(s);
const hex=s=>typeof s==='string'&&SHA.test(s);
const digest=s=>createHash('sha256').update(s,'utf8').digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const requireThat=(ok,code)=>{if(!ok)fail(code);};
const readOnlyAbsent=error=>error?.code==='OBJECT_NOT_FOUND';
function scope(task){
  requireThat(task&&typeof task==='object'&&!Array.isArray(task)&&
    ['organizationId','workspaceId','executorId','taskId'].every(k=>id(task[k]))&&
    hex(task.taskRevisionId)&&hex(task.packageSha256),
    'T3_COMPANY_ORIGINAL_SIGNED_TASK_REQUIRED');
  return Object.freeze(Object.fromEntries(
    ['organizationId','workspaceId','executorId','taskId',
      'taskRevisionId','packageSha256'].map(k=>[k,task[k]])));
}
const eq=(a,b,keys)=>keys.every(k=>a?.[k]===b?.[k]);
function freezeSource(source,task,kind,artifactId){
  requireThat(source&&typeof source==='object'&&!Array.isArray(source)&&
    Object.keys(source).sort().join(',')===
      ['kind','artifactId','operationId','organizationId','workspaceId',
        'executorId','taskId','taskRevisionId','taskPackageSha256',
        'mimeType','text','sha256','sourceKind'].sort().join(',')&&
    source.kind===kind&&source.artifactId===artifactId&&
    eq(source,{organizationId:task.organizationId,workspaceId:task.workspaceId,
      executorId:task.executorId,taskId:task.taskId,
      taskRevisionId:task.taskRevisionId,
      taskPackageSha256:task.packageSha256},
      ['organizationId','workspaceId','executorId','taskId','taskRevisionId',
        'taskPackageSha256'])&&
    id(source.operationId)&&typeof source.text==='string'&&
    source.text.length>0&&source.text.length<=2000000&&
    hex(source.sha256)&&digest(source.text)===source.sha256&&
    typeof source.mimeType==='string'&&
    /^(?:text\/plain|text\/markdown|application\/json)$/.test(source.mimeType)&&
    (kind==='RESULT'
      ?source.sourceKind==='ORIGINAL_AGENT_HUMAN_ACCEPTED'
      :source.sourceKind==='ORIGINAL_COMPANY_WORKAREA'||
       kind==='TASK'&&source.sourceKind==='ORIGINAL_SIGNED_TASK'),
    'T3_COMPANY_TRUSTED_ARTIFACT_REQUIRED');
  return Object.freeze({...source});
}
function locator(task,kind,artifactId){
  requireThat(KINDS.has(kind)&&id(artifactId),
    'T3_COMPANY_ARTIFACT_ID_INVALID');
  const token=digest(JSON.stringify([
    task.organizationId,task.workspaceId,task.taskId,
    task.taskRevisionId,kind,artifactId]));
  return Object.freeze({
    workspace_id:task.workspaceId,
    object_id:'company:work:'+token,
    idempotency_key:token,
  });
}
function eventFor(data,locator){
  return {event_type:'iwxa.company.work-record.committed',
    payload:{schema:data.schema,kind:data.kind,artifactId:data.artifactId,
      operationId:data.operationId,organizationId:data.organizationId,
      workspaceId:data.workspaceId,executorId:data.executorId,
      taskId:data.taskId,taskRevisionId:data.taskRevisionId,
      taskPackageSha256:data.taskPackageSha256,
      artifactSha256:data.sha256,sourceKind:data.sourceKind,
      objectId:locator.object_id}};
}
function prepared(task,source,where){
  const data={schema:RECORD_SCHEMA,...source};
  const event=eventFor(data,where);
  return {workspace_id:where.workspace_id,
    idempotency_key:where.idempotency_key,
    object:{object_id:where.object_id,schema_id:ORIGINAL_COMPANY_RECORD_SCHEMA,
      schema_version:'1.0.0',base_revision:0,data},
    relation_puts:[],relation_deletes:[],event};
}
export function createTrustedOriginalCompanyWorkspacePersistence({
  kernel,selectSignedAccess,readOriginalSignedTask,
  readInstalledCompanyArtifact,isHostActive,
}={}){
  requireThat(kernel?.sessionInfo?.contract_version==='1.3.0'&&
    typeof kernel.hasOperation==='function'&&
    ['t1.getWorkspace','t1.getObject','t1.listEventsSince',
      't1.commitObjectGraph'].every(op=>kernel.hasOperation(op))&&
    typeof selectSignedAccess==='function'&&
    typeof readOriginalSignedTask==='function'&&
    typeof readInstalledCompanyArtifact==='function'&&
    typeof isHostActive==='function',
    'T3_COMPANY_ORIGINAL_T2_SIGNED_HOST_REQUIRED');
  let inFlight=false,unknown=false;
  const active=()=>requireThat(isHostActive()===true,
    'T3_COMPANY_ORIGINAL_HOST_NOT_ATTACHED');
  const current=async()=>{
    active();
    const task=scope(await readOriginalSignedTask());
    active();
    return task;
  };
  const signed=op=>{
    active();
    const access=selectSignedAccess(op);
    requireThat(access&&typeof access.currentContext==='function',
      'T3_COMPANY_SIGNED_JIT_REQUIRED');
    return createSubjectKernelBinding({kernel,access,isHostActive});
  };
  const unchanged=async original=>{
    const recent=await current();
    requireThat(eq(recent,original,Object.keys(original)),
      'T3_COMPANY_SIGNED_TASK_CHANGED');
  };
  async function recorded(task,kind,artifactId){
    const where=locator(task,kind,artifactId);
    await unchanged(task);
    const ws=await signed('getWorkspace').getWorkspace(where.workspace_id);
    requireThat(ws?.workspace_id===where.workspace_id&&
      ws.deleted_at==null,'T3_COMPANY_ORIGINAL_WORKSPACE_NOT_READY');
    let read;
    try{read=await signed('getObject').getObject(where.workspace_id,where.object_id);}
    catch(error){
      if(readOnlyAbsent(error))return {where,record:null};
      throw error;
    }
    if(read==null)return {where,record:null};
    const record=read.object;
    requireThat(record?.workspace_id===where.workspace_id&&
      record.object_id===where.object_id&&
      record.schema_id===ORIGINAL_COMPANY_RECORD_SCHEMA&&
      record.schema_version==='1.0.0'&&
      record.revision===1&&record.deleted!==true&&record.deleted_at==null,
      'T3_COMPANY_ORIGINAL_OBJECT_READBACK_CHANGED');
    const data=record.data;
    requireThat(data?.schema===RECORD_SCHEMA&&
      data.kind===kind&&data.artifactId===artifactId&&
      data.organizationId===task.organizationId&&
      data.workspaceId===task.workspaceId&&
      data.executorId===task.executorId&&
      data.taskId===task.taskId&&
      data.taskRevisionId===task.taskRevisionId&&
      data.taskPackageSha256===task.packageSha256&&
      typeof data.text==='string'&&data.text.length>0&&
      data.text.length<=2000000&&
      hex(data.sha256)&&digest(data.text)===data.sha256,
      'T3_COMPANY_ORIGINAL_CONTENT_READBACK_CHANGED');
    const events=await signed('listEventsSince').listEventsSince(where.workspace_id);
    const expected=eventFor(data,where).payload;
    const matches=events.filter(e=>
      e.workspace_id===where.workspace_id&&
      e.object_id===where.object_id&&
      e.revision===1&&e.idempotency_key===where.idempotency_key&&
      e.event_type==='iwxa.company.work-record.committed'&&
      eq(e.payload,expected,Object.keys(expected))&&
      Object.keys(e.payload??{}).length===Object.keys(expected).length);
    requireThat(matches.length===1,
      'T3_COMPANY_ORIGINAL_EVENT_READBACK_CHANGED');
    await unchanged(task);
    return {where,record};
  }
  async function read(kind,artifactId){
    const task=await current(),seen=await recorded(task,kind,artifactId);
    return Object.freeze({state:seen.record?'COMPANY_ORIGINAL_COMMITTED':'NOT_FOUND',
      workspaceId:task.workspaceId,organizationId:task.organizationId,
      artifactId,kind,originalKernelReadback:seen.record!==null,
      ...(seen.record?{originalObject:structuredClone(seen.record)}:{})});
  }
  async function recover(kind,artifactId){
    const seen=await read(kind,artifactId);
    // The absence of an Object after a lost ACK is not proof that the
    // previous command did not dispatch. No automatic second write.
    return Object.freeze({...seen,state:seen.originalKernelReadback
      ?'COMPANY_ORIGINAL_COMMITTED':'OUTCOME_UNKNOWN',retrySafe:false});
  }
  async function commit(kind,artifactId){
    requireThat(!inFlight&&!unknown,
      'T3_COMPANY_ORIGINAL_PREVIOUS_OUTCOME_UNKNOWN');
    inFlight=true;
    let dispatched=false;
    try{
      const task=await current();
      const where=locator(task,kind,artifactId);
      // Exact content comes from the installed company scope or the HUMAN
      // ACCEPTED result, never from request JSON / personal Agent memory.
      const source=freezeSource(await readInstalledCompanyArtifact({
        kind,artifactId,task:structuredClone(task)}),task,kind,artifactId);
      await unchanged(task);
      const existing=await recorded(task,kind,artifactId);
      if(existing.record){
        requireThat(eq(existing.record.data,source,
          ['kind','artifactId','operationId','organizationId','workspaceId',
            'executorId','taskId','taskRevisionId','taskPackageSha256',
            'mimeType','text','sha256','sourceKind']),
          'T3_COMPANY_ORIGINAL_ARTIFACT_ALREADY_CHANGED');
        return Object.freeze({state:'COMPANY_ORIGINAL_COMMITTED',
          alreadyCommitted:true,originalKernelReadback:true,
          originalObjectId:where.object_id,workspaceId:task.workspaceId,
          organizationId:task.organizationId,artifactSha256:source.sha256});
      }
      const command=prepared(task,source,where);
      await unchanged(task);
      // Write only through original Kernel's signed JIT. No local journal,
      // alternative Store or second export/Result. Mark uncertain before
      // the native dispatch; a lost ACK never causes automatic retry.
      dispatched=true;
      const receipt=await signed('commitObjectGraph').commitObjectGraph(command);
      requireThat(receipt?.object?.object_id===where.object_id&&
        receipt.object.workspace_id===where.workspace_id,
        'T3_COMPANY_ORIGINAL_WRITE_RECEIPT_CHANGED');
      const readback=await recorded(task,kind,artifactId);
      requireThat(readback.record&&
        eq(readback.record.data,source,
          ['kind','artifactId','operationId','organizationId','workspaceId',
            'executorId','taskId','taskRevisionId','taskPackageSha256',
            'mimeType','text','sha256','sourceKind']),
        'T3_COMPANY_ORIGINAL_COMMITTED_DATA_CHANGED');
      return Object.freeze({state:'COMPANY_ORIGINAL_COMMITTED',
        alreadyCommitted:false,originalKernelReadback:true,
        originalObjectId:where.object_id,workspaceId:task.workspaceId,
        organizationId:task.organizationId,artifactSha256:source.sha256});
    }catch(error){
      if(dispatched)unknown=true;
      else if(error&&typeof error==='object'){
        // No commitObjectGraph dispatch occurred. Missing Workspace,
        // revoked JIT and changed accepted source are original pre-write
        // refusals, not uncertain writes. Never freeze a legitimate future
        // company operation merely because a read-only preflight failed.
        error.outcome='DENIED';
      }
      throw error;
    }finally{inFlight=false;}
  }
  return Object.freeze({commit,read,recover,
    get outcomeUnknown(){return unknown;}});
}
