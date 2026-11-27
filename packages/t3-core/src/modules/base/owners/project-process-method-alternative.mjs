// W06: independent alternatives inside the same original Workspace.
// All source writes use the existing Project/Work materialization path.
// No alternative Store, execution owner, Result copy or automatic grant.
import { createHash } from 'node:crypto';
import { canonicalClone,canonicalStringify } from '../../../persistence/canonical-codec.mjs';
import { CanonicalInstant } from '../../../foundation/time.mjs';
import { describeWorkspaceMethodSourceInputs,inspectWorkspaceMethodMaterials } from '../features/workspace/workspace-project-method.mjs';
import { hasProjectProcessSourceIdentity } from './project-process-source-owner.mjs';
import { readHistoricalWorkspaceMethod,readWorkspaceMethodFromSourceOwner } from './project-process-method-readback.mjs';
import { createWorkspaceMethodThroughSourceOwner } from './project-process-method-materialization.mjs';

const projectIdentity=/^[A-Za-z0-9_-]{1,63}$/u;
function fail(code,message){throw Object.assign(new Error(message),{code});}
function captureSelection(selected){
  if(!selected?.projectRef||!Array.isArray(selected.workRefs)||!selected.workRefs.length||selected.workRefs.length>64){
    fail('METHOD_ALTERNATIVE_SELECTION_INVALID','Complete historical revision selection required');
  }
  const ref=row=>({family:row?.family,objectId:row?.objectId,recordId:row?.recordId,revision:row?.revision});
  return {projectRef:ref(selected.projectRef),workRefs:Array.from(selected.workRefs,ref)};
}
async function prepare({owner,workspaceId,projectId,targetProjectId,selected,objects,operationId,knowledgeAt}={}){
  if(typeof workspaceId!=='string'||!workspaceId||workspaceId.trim()!==workspaceId
      ||typeof projectId!=='string'||!projectIdentity.test(projectId)||typeof targetProjectId!=='string'
      ||!projectIdentity.test(targetProjectId)||targetProjectId===projectId
      ||typeof operationId!=='string'||!operationId||operationId.length>128||operationId.trim()!==operationId
      ||/[\u0000-\u001f]/u.test(operationId)){
    fail('METHOD_ALTERNATIVE_IDENTITY_INVALID','Independent Project and exact alternative operation identity required');
  }
  if(!Array.isArray(objects))fail('METHOD_ALTERNATIVE_CATALOG_INVALID','Original admitted material catalog required');
  const selection=captureSelection(selected);
  const catalog=objects.filter(row=>row?.deleted!==true&&row?.deleted_at==null)
    .map(row=>row==null?null:{workspace_id:row.workspace_id,object_id:row.object_id,revision:row.revision,
      schema_id:row.schema_id,schemaId:row.schemaId,family:row.family});
  const instant=knowledgeAt instanceof CanonicalInstant?knowledgeAt:CanonicalInstant.parse(knowledgeAt);
  const original=await readHistoricalWorkspaceMethod({owner,workspaceId,projectId,expected:selection});
  const draft=canonicalClone({...original.draft,projectId:targetProjectId});
  const origin=Object.freeze({version:1,workspaceId,projectId,projectRef:original.projectRef,
    workRefs:Object.freeze([...original.workRefs].sort((a,b)=>a.objectId<b.objectId?-1:a.objectId>b.objectId?1:0))});
  const plan=describeWorkspaceMethodSourceInputs({workspaceId,draft});
  const materials=inspectWorkspaceMethodMaterials({workspaceId,objects:catalog,materials:draft.materials});
  const digest=createHash('sha256').update(canonicalStringify({
    schema:'IWXA_T2_WORKSPACE_METHOD_ALTERNATIVE_INTENT_V1',workspaceId,targetProjectId,operationId,
    knowledgeAt:instant,origin,draft,
  })).digest('hex');
  const recordIds=Object.freeze({project:'method-alternative:'+digest+':project',
    works:Object.freeze(Object.fromEntries(plan.writeOrder.map((id,index)=>[id,'method-alternative:'+digest+':work-'+index])))});
  return {request:{owner,workspaceId,objects:catalog,draft,recordIds,knowledgeAt:instant,alternativeOrigin:origin},
    plan,origin,digest,materials};
}
export async function previewWorkspaceMethodAlternative(input){
  const value=await prepare(input);
  const {request,plan,origin,digest,materials}=value;
  const base={workspaceId:request.workspaceId,projectId:request.draft.projectId,draft:request.draft,origin,materials,
    writeAuthorized:false,executionAuthority:false,resultReuseProven:false,atomicSnapshot:false};
  if(materials.some(row=>row.state!=='CURRENT')){
    return Object.freeze({...base,state:'MATERIAL_REVIEW_REQUIRED',confirmationDigest:null,reservedIds:Object.freeze([])});
  }
  const ids=[['project',request.draft.projectId],...plan.writeOrder.map(id=>['work',id])];
  const reserved=[];
  for(const [kind,id] of ids)if(await hasProjectProcessSourceIdentity(request.owner,kind,request.workspaceId,id))reserved.push(id);
  return Object.freeze({...base,state:reserved.length?'TARGET_ID_RESERVED':'ALTERNATIVE_READY',
    confirmationDigest:reserved.length?null:digest,reservedIds:Object.freeze(reserved)});
}
export async function createWorkspaceMethodAlternativeThroughSourceOwner(input){
  const confirmation=input?.confirmationDigest;
  const value=await prepare(input);
  if(typeof confirmation!=='string'||confirmation!==value.digest){
    fail('METHOD_ALTERNATIVE_CONFIRMATION_MISMATCH','Confirm the exact original selection and independent Project');
  }
  if(value.materials.some(row=>row.state!=='CURRENT')){
    fail('METHOD_MATERIAL_REVIEW_REQUIRED','Exact alternative material revisions require current admission');
  }
  const result=await createWorkspaceMethodThroughSourceOwner(value.request);
  return Object.freeze({...result,alternativeDigest:value.digest,origin:value.origin,
    independentProject:true,sourceHistoryPreserved:true,resultReuseProven:false});
}
/** Explicit addressed lineage read. Ordinary opening of the alternative
 * does not load its original history. The source may have newer revisions;
 * only the exact recorded origin is returned. */
export async function readWorkspaceMethodAlternativeOrigin({owner,workspaceId,projectId,expected}={}){
  const alternative=expected===undefined?await readWorkspaceMethodFromSourceOwner({owner,workspaceId,projectId})
    :await readHistoricalWorkspaceMethod({owner,workspaceId,projectId,expected});
  const origin=alternative.originalCreation?.origin;
  if(!origin)return Object.freeze({state:'NO_ALTERNATIVE_ORIGIN',origin:null,source:null,executionAuthority:false,writeAuthorized:false});
  if(origin.workspaceId!==workspaceId||origin.projectId===projectId){
    fail('METHOD_ALTERNATIVE_ORIGIN_MISMATCH','Recorded origin does not belong to this Workspace');
  }
  const source=await readHistoricalWorkspaceMethod({owner,workspaceId,projectId:origin.projectId,expected:origin});
  return Object.freeze({state:'ORIGIN_VERIFIED',origin,source,originCurrentHeadVerified:false,
    writeAuthorized:false,executionAuthority:false,resultReuseProven:false});
}
