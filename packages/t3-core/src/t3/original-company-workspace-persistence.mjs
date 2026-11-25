// Corporate Task/Document/Draft/Result/History material is an ORIGINAL T2
// Object/Event in the company's signed Workspace, never an Agent WorkArea
// authority. No Store, IAM, Task Engine, signer, Exchange or new Result here.
// The installed native owner provides the ORIGINAL signed Task and reads the
// unmodified company artifact from its own installed Core; the web UI cannot
// supply content, an Access port, Kernel or a recipient.
import {createHash} from 'node:crypto';
import {createSubjectKernelBinding} from './subject-access-binding.mjs';
import {companyWorkRecordKeyParts,companyWorkEventPayload} from './company-workspace-readback.mjs';

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
const workspaceAbsent=error=>error?.code==='WORKSPACE_NOT_FOUND';
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
  const token=digest(JSON.stringify(companyWorkRecordKeyParts({...task,kind,artifactId})));
  return Object.freeze({
    workspace_id:task.workspaceId,
    object_id:'company:work:'+token,
    idempotency_key:token,
  });
}
function eventFor(data,locator){
  return {event_type:'iwxa.company.work-record.committed',
    payload:companyWorkEventPayload(data,locator.object_id)};
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
  const signed=(op,{onCommitObjectGraphDispatch=null}={})=>{
    active();
    const access=selectSignedAccess(op);
    requireThat(access&&typeof access.currentContext==='function',
      'T3_COMPANY_SIGNED_JIT_REQUIRED');
    return createSubjectKernelBinding({kernel,access,isHostActive,
      onCommitObjectGraphDispatch});
  };
  const unchanged=async original=>{
    const recent=await current();
    requireThat(eq(recent,original,Object.keys(original)),
      'T3_COMPANY_SIGNED_TASK_CHANGED');
  };
  async function observedWorkspace(task){
    let ws=null;
    try{ws=await signed('getWorkspace').getWorkspace(task.workspaceId);}
    catch(error){if(!workspaceAbsent(error))throw error;}
    if(ws!==null&&ws!==undefined){
      requireThat(ws.workspace_id===task.workspaceId&&ws.deleted_at==null,
        'T3_COMPANY_ORIGINAL_WORKSPACE_NOT_READY');
      return ws;
    }
    return null; // Original T2 says missing, never a permission denial
  }
  async function ensureCompanyWorkspace(task){
    await unchanged(task);
    requireThat(kernel.hasOperation('t1.createWorkspace'),
      'T3_COMPANY_ORIGINAL_CREATE_OPERATION_UNAVAILABLE');
    // A signed company key may include the independent original
    // workspace.create ACTION. Its absence never authorizes fallback
    // creation or a new Store. A lost ACK is checked by original readback.
    const create=signed('createWorkspace');
    let createError=null;
    try{
      await create.createWorkspace({
        workspace_id:task.workspaceId,profile:'generic',
      });
    }catch(error){createError=error;}
    const observed=await observedWorkspace(task);
    if(observed?.workspace_id===task.workspaceId&&observed.profile==='generic'){
      await unchanged(task);
      return;
    }
    if(createError?.outcome==='DENIED')throw createError;
    unknown=true; // No second create after an ambiguous original write
    if(createError)throw createError;
    fail('T3_COMPANY_ORIGINAL_CREATE_READBACK_MISSING');
  }
  async function recorded(task,kind,artifactId){
    const where=locator(task,kind,artifactId);
    await unchanged(task);
    const ws=await observedWorkspace(task);
    if(ws===null)return {where,record:null,workspaceMissing:true};
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
      let existing=await recorded(task,kind,artifactId);
      if(existing.workspaceMissing){
        await ensureCompanyWorkspace(task);
        existing=await recorded(task,kind,artifactId);
        requireThat(!existing.workspaceMissing,
          'T3_COMPANY_ORIGINAL_CREATE_READBACK_MISSING');
      }
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
      // The existing signed Host calls this hook AT the actual original
      // Kernel dispatch, after JIT grant/status/Task/context checks. A
      // definite pre-dispatch denial must not freeze the corporate WorkArea.
      const signedWrite=signed('commitObjectGraph',{
        onCommitObjectGraphDispatch:()=>{dispatched=true;},
      });
      const receipt=await signedWrite.commitObjectGraph(command);
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
      // Unknown includes a possibly dispatched original Workspace create
      // whose ACK/readback could not be verified, not only ObjectGraph.
      if(dispatched||unknown){
        unknown=true;
        if(error&&typeof error==='object')error.outcome='UNKNOWN';
      }else if(error&&typeof error==='object'){
        // JIT denial or missing signing key BEFORE any original write.
        error.outcome='DENIED';
      }
      throw error;
    }finally{inFlight=false;}
  }
  return Object.freeze({commit,read,recover,
    get outcomeUnknown(){return unknown;}});
}
