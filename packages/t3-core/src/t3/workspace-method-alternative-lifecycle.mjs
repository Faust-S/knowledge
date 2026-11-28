// Trusted Host composition for original C3 independent alternatives. The
// existing source owner alone writes Project/Work and owns all permissions.
// No new persistence, Task/Result owner, permission grant or automatic retry.
import {randomUUID} from 'node:crypto';
import {canonicalStringify} from '../persistence/canonical-codec.mjs';
import {readWorkspaceMethodFromSourceOwner} from '../modules/base/owners/project-process-method-readback.mjs';
import {previewWorkspaceMethodAlternative,createWorkspaceMethodAlternativeThroughSourceOwner}
  from '../modules/base/owners/project-process-method-alternative.mjs';
import {readWorkspaceMethodCreationIntent,inspectWorkspaceMethodCreation,resumeWorkspaceMethodThroughSourceOwner}
  from '../modules/base/owners/project-process-method-materialization.mjs';
import {hasProjectProcessSourceIdentity} from '../modules/base/owners/project-process-source-owner.mjs';

const eq=(a,b)=>canonicalStringify(a)===canonicalStringify(b);
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,63}$/u.test(value);
function check(ok,code){if(!ok)throw Object.assign(Error(code),{code});}
function selection(value){return {projectRef:value.projectRef,workRefs:[...value.workRefs].sort((a,b)=>a.objectId<b.objectId?-1:a.objectId>b.objectId?1:0)};}
const matches=(a,b)=>eq(selection(a),selection(b));
function baseReceipt(workspaceId,sourceProjectId,targetProjectId,state,method=null){
  return Object.freeze({state,workspaceId,sourceProjectId,targetProjectId,selection:method?Object.freeze(selection(method)):null,
    executionAuthority:false,newAuthorityGranted:false,resultReuseProven:false,sourceModified:false});
}
async function catalog(draft,workspaceId,readObject){
  // Read only materials declared in the actual original method, never a
  // caller-provided catalog or full workspace scan.
  const rows=await Promise.all(draft.materials.map(async pin=>{
    const value=(await readObject(workspaceId,pin.object_id))?.object;
    if(!value)return null;
    check(value.workspace_id===workspaceId&&value.object_id===pin.object_id,'METHOD_ALTERNATIVE_MATERIAL_IDENTITY_MISMATCH');
    return {workspace_id:value.workspace_id,object_id:value.object_id,revision:value.revision,
      schema_id:value.schema_id,schemaId:value.schemaId,family:value.family,
      deleted:value.deleted===true,deleted_at:value.deleted_at??null};
  }));
  return rows.filter(Boolean);
}
async function selectedCurrent({owner,workspaceId,projectId,expected}){
  const value=await readWorkspaceMethodFromSourceOwner({owner,workspaceId,projectId});
  check(matches(value,expected),'METHOD_ALTERNATIVE_SELECTION_CHANGED');return value;
}
function verifyOrigin(origin,workspaceId,projectId,expected){
  check(origin?.workspaceId===workspaceId&&origin.projectId===projectId&&matches(origin,expected),
    'METHOD_ALTERNATIVE_ORIGIN_MISMATCH');
}
function confirmedMethod(method,workspaceId,projectId,target,expected){
  check(method.workspaceId===workspaceId&&method.projectId===target&&method.revisionSetVerified===true,
    'METHOD_ALTERNATIVE_SOURCE_READBACK_INVALID');
  verifyOrigin(method.originalCreation?.origin,workspaceId,projectId,expected);
  return method;
}

/** Explicit create or recovery in the already selected original Workspace.
 * The trusted reader fences every owner call and provides the original
 * native confirmation. This helper does not register or activate a C3 owner.
 */
export async function runOriginalWorkspaceMethodAlternative({owner,workspaceId,projectId,expected,readObject,confirm,targetProjectId}={}){
  check(id(projectId)&&typeof workspaceId==='string'&&typeof readObject==='function'&&typeof confirm==='function'
    &&typeof owner?.create==='function'&&typeof owner?.history==='function'&&typeof owner?.historyThrough==='function',
    'METHOD_ALTERNATIVE_ORIGINAL_OWNER_REQUIRED');
  const selected=selection(expected);
  const recovery=targetProjectId!==undefined;
  const target=recovery?targetProjectId:'project-'+randomUUID().replaceAll('-','');
  check(id(target)&&target!==projectId,'METHOD_ALTERNATIVE_IDENTITY_INVALID');
  const receipt=(state,method)=>baseReceipt(workspaceId,projectId,target,state,method);
  const observe=async()=>{
    const intent=await readWorkspaceMethodCreationIntent({owner,workspaceId,projectId:target});
    verifyOrigin(intent.alternativeOrigin,workspaceId,projectId,selected);
    const objects=await catalog(intent.draft,workspaceId,readObject);
    const state=await inspectWorkspaceMethodCreation({owner,workspaceId,projectId:target,objects});
    return {intent,objects,state};
  };
  let invoked=false;
  // Mark any actual attempt at an original write. Read failures before a
  // write remain ordinary errors. Uncertain writes are never resubmitted.
  const writer={...owner,create:(...args)=>{invoked=true;return owner.create(...args);}};
  if(recovery){
    const existing=await owner.load('project',workspaceId,target);
    if(!existing){
      if(await hasProjectProcessSourceIdentity(owner,'project',workspaceId,target))return receipt('CONFLICT');
      return receipt('NOT_FOUND');
    }
    if(existing.revision!==1)return receipt('CONFLICT');
    const first=await observe();
    const finish=async()=>{
      const method=confirmedMethod(await readWorkspaceMethodFromSourceOwner({owner,workspaceId,projectId:target}),
        workspaceId,projectId,target,selected);
      return receipt('RECOVERED',method);
    };
    if(first.state.state==='COMPLETE')return finish();
    if(first.state.state==='CONFLICT')return receipt('CONFLICT');
    if(!first.state.resumeCandidate)return receipt('MATERIAL_REVIEW_REQUIRED');
    const accepted=await confirm(Object.freeze({kind:'RESUME_ALTERNATIVE',workspaceId,projectId,targetProjectId:target,
      sourceSelection:selected,name:first.intent.draft.name,workCount:first.intent.draft.steps.length,
      missingCount:first.state.missingCount,sourceModified:false,resultReuseProven:false}));
    if(accepted!==true)return receipt('RECOVERY_REQUIRED');
    const fresh=await observe();
    if(fresh.state.state==='COMPLETE')return finish();
    if(fresh.state.state==='CONFLICT')return receipt('CONFLICT');
    if(!fresh.state.resumeCandidate)return receipt('MATERIAL_REVIEW_REQUIRED');
    if(!eq(first.state.records,fresh.state.records)||!eq(first.state.materials,fresh.state.materials)
        ||!eq(first.intent.recordIds,fresh.intent.recordIds))return receipt('RECOVERY_REQUIRED');
    try{
      const result=await resumeWorkspaceMethodThroughSourceOwner({owner:writer,workspaceId,projectId:target,objects:fresh.objects});
      return receipt('RECOVERED',confirmedMethod(result.method,workspaceId,projectId,target,selected));
    }catch(error){if(!invoked)throw error;return receipt('OUTCOME_UNKNOWN');}
  }
  const operationId='alternative-'+randomUUID(),knowledgeAt=new Date().toISOString();
  const prepare=async()=>{
    const source=await selectedCurrent({owner,workspaceId,projectId,expected:selected});
    const objects=await catalog(source.draft,workspaceId,readObject);
    const request={owner,workspaceId,projectId,targetProjectId:target,selected,objects,operationId,knowledgeAt};
    return {request,preview:await previewWorkspaceMethodAlternative(request)};
  };
  const first=await prepare();
  if(first.preview.state==='MATERIAL_REVIEW_REQUIRED')return receipt('MATERIAL_REVIEW_REQUIRED');
  check(first.preview.state==='ALTERNATIVE_READY','METHOD_ALTERNATIVE_TARGET_RESERVED');
  if(await confirm(Object.freeze({kind:'CREATE_ALTERNATIVE',workspaceId,projectId,targetProjectId:target,
    sourceSelection:selected,name:first.preview.draft.name,workCount:first.preview.draft.steps.length,
    confirmationDigest:first.preview.confirmationDigest,sourceModified:false,resultReuseProven:false}))!==true)
    return receipt('USER_CANCELLED');
  const fresh=await prepare();
  if(fresh.preview.state==='MATERIAL_REVIEW_REQUIRED')return receipt('MATERIAL_REVIEW_REQUIRED');
  check(fresh.preview.state==='ALTERNATIVE_READY'&&fresh.preview.confirmationDigest===first.preview.confirmationDigest,
    'METHOD_ALTERNATIVE_SELECTION_CHANGED');
  // Do not substitute a different source selection or issue a second ID.
  try{
    const result=await createWorkspaceMethodAlternativeThroughSourceOwner({...fresh.request,owner:writer,
      confirmationDigest:fresh.preview.confirmationDigest});
    return receipt('CREATED',confirmedMethod(result.method,workspaceId,projectId,target,selected));
  }catch(error){if(!invoked)throw error;return receipt('OUTCOME_UNKNOWN');}
}
