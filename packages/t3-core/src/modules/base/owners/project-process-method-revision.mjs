import { createHash } from 'node:crypto';
import { canonicalStringify,canonicalClone } from '../../../persistence/canonical-codec.mjs';
import { CanonicalInstant } from '../../../foundation/time.mjs';
import { normalizeProject,normalizeWork } from '../features/project-process/project-process.mjs';
import { describeWorkspaceMethodSourceInputs,prepareWorkspaceMethodSourceInputs,
  reconstructWorkspaceMethodDraft,inspectWorkspaceMethodMaterials } from '../features/workspace/workspace-project-method.mjs';
import { projectProcessSourceObjectId } from './project-process-source-owner.mjs';
import { readWorkspaceMethodFromSourceOwner,readHistoricalWorkspaceMethod } from './project-process-method-readback.mjs';
import { projectProcessSourceBinding } from './project-process-source-contract.mjs';

function fail(code,message){throw Object.assign(new Error(message),{code});}
const equal=(a,b)=>canonicalStringify(a)===canonicalStringify(b);

function sameRef(a,b){
  return !!a&&!!b&&a.family===b.family&&a.objectId===b.objectId
    &&a.recordId===b.recordId&&a.revision===b.revision;
}
function assertExpectedRevisionSet(expected,current){
  if(!sameRef(expected?.projectRef,current.projectRef)||!Array.isArray(expected?.workRefs)
      ||expected.workRefs.length!==current.workRefs.length){
    fail('METHOD_REVISION_BASE_CHANGED','The opened Project/Work revision set is no longer current');
  }
  const map=new Map(expected.workRefs.map(ref=>[ref?.objectId,ref]));
  if(map.size!==expected.workRefs.length||current.workRefs.some(ref=>!sameRef(map.get(ref.objectId),ref))){
    fail('METHOD_REVISION_BASE_CHANGED','The opened Work revision set is no longer current');
  }
}
function refFor(current,workspaceId,id){
  return current.workRefs.find(ref=>ref.objectId===projectProcessSourceObjectId('work',workspaceId,id));
}
function changedWorkFields(before,after){
  const changes=[];
  if(before.name!==after.name)changes.push('NAME');
  if(before.methodology.instruction!==after.methodology.instruction)changes.push('INSTRUCTION');
  if(before.methodology.intendedActor!==after.methodology.intendedActor)changes.push('ACTOR');
  if(!equal(before.methodology.materialRefs,after.methodology.materialRefs))changes.push('MATERIALS');
  if(!equal(before.dependencies,after.dependencies))changes.push('DEPENDENCIES');
  return Object.freeze(changes);
}

// The same deterministic planning function is used for a live preview
// and for re-deriving an exact interrupted operation from historical input.
function planRevision({workspaceId,projectId,current,after}){
  if(after.projectInput.projectId!==projectId||after.projectInput.templateRef.templateId!==current.draft.templateId){
    fail('METHOD_REVISION_ID_CHANGED','Use a new project for a distinct method identity');
  }
  const before=describeWorkspaceMethodSourceInputs({workspaceId,draft:current.draft});
  const oldProject=normalizeProject(before.projectInput);
  const nextProject=normalizeProject(after.projectInput);
  const projectChanged=!equal(oldProject,nextProject);
  const oldWorkIds=new Set(oldProject.methodology.workIds);
  const projectCompositionChanged=oldWorkIds.size!==nextProject.methodology.workIds.length
    ||nextProject.methodology.workIds.some(id=>!oldWorkIds.has(id));
  const projectIntentChanged=oldProject.methodology.objective!==nextProject.methodology.objective
    ||!equal(oldProject.domainApplicability,nextProject.domainApplicability)
    ||!equal(oldProject.templateRef,nextProject.templateRef)
    ||projectCompositionChanged;
  // Preserve the original first creation plan from the exact selected
  // Project revision, even when current stage composition changes.
  const creation=current.originalCreation;
  const projectInput=Object.freeze({...after.projectInput,methodology:Object.freeze({
    ...after.projectInput.methodology,...(creation?{creation}:{}),
  })});
  normalizeProject(projectInput);

  const oldWorks=new Map(before.workInputs.map(input=>[input.workId,normalizeWork(input)]));
  const newWorks=new Map(after.workInputs.map(input=>[input.workId,input]));
  const byId=new Map();
  for(const workId of after.writeOrder){
    const input=newWorks.get(workId),next=normalizeWork(input),old=oldWorks.get(workId);
    const fields=old?changedWorkFields(old,next):Object.freeze([]);
    const predecessorWrites=Object.freeze(next.dependencies.map(dep=>dep.predecessorWorkId)
      .filter(id=>byId.get(id)?.operation!=='KEEP'));
    const predecessorReview=next.dependencies.some(dep=>byId.get(dep.predecessorWorkId)?.reviewRequired);
    const operation=!old?'CREATE':projectChanged||fields.length||predecessorWrites.length?'REVISE':'KEEP';
    const reviewState=!old?'NEW_STAGE':projectIntentChanged?'PROJECT_INTENT_REVIEW'
      :fields.length?'CONTENT_REVIEW_REQUIRED':predecessorReview?'DEPENDENCY_REVIEW_REQUIRED'
      :operation==='REVISE'?'SOURCE_REBIND_ONLY':'NO_DECLARED_CHANGE';
    const reviewRequired=!['SOURCE_REBIND_ONLY','NO_DECLARED_CHANGE'].includes(reviewState);
    byId.set(workId,Object.freeze({
      workId,operation,baseRef:old?refFor(current,workspaceId,workId):null,
      changedFields:fields,projectRebind:!!old&&projectChanged,
      predecessorRebinds:predecessorWrites,reviewState,reviewRequired,
      input:operation==='KEEP'?null:input,
    }));
  }
  const removed=Object.freeze(before.workInputs.filter(input=>!newWorks.has(input.workId)).map(input=>
    Object.freeze({workId:input.workId,baseRef:refFor(current,workspaceId,input.workId),
      operation:'RELEASE_REVIEW',automaticRelease:false})));
  const workOperations=Object.freeze(after.writeOrder.map(id=>byId.get(id)));
  const counts=Object.freeze({create:workOperations.filter(item=>item.operation==='CREATE').length,
    revise:workOperations.filter(item=>item.operation==='REVISE').length,
    keep:workOperations.filter(item=>item.operation==='KEEP').length,releaseReview:removed.length});
  const oldPins=new Map(oldProject.methodology.materialRefs.map(ref=>[ref.object_id,ref.revision]));
  const nextPins=new Map(nextProject.methodology.materialRefs.map(ref=>[ref.object_id,ref.revision]));
  const assigned=new Set([...before.workInputs,...after.workInputs].flatMap(item=>item.methodology.materialRefs.map(ref=>ref.object_id)));
  const unassignedMaterialChanges=Object.freeze([...new Set([...oldPins.keys(),...nextPins.keys()])]
    .filter(id=>!assigned.has(id)&&oldPins.get(id)!==nextPins.get(id))
    .map(id=>Object.freeze({object_id:id,beforeRevision:oldPins.get(id)??null,afterRevision:nextPins.get(id)??null})));
  return Object.freeze({
    state:projectChanged||counts.create||counts.revise||counts.releaseReview?'CHANGES_PROPOSED':'UNCHANGED',
    workspaceId,projectId,projectIntentChanged,projectCompositionChanged,
    baseRevisionSet:Object.freeze({projectRef:current.projectRef,workRefs:current.workRefs}),
    projectOperation:Object.freeze({operation:projectChanged?'REVISE':'KEEP',baseRef:current.projectRef,
      input:projectChanged?projectInput:null}),
    workOperations,removed,counts,unassignedMaterialChanges,
    requiresReleaseReview:removed.length>0,atomicSnapshot:false,writeAuthorized:false,
    executionAuthority:false,resultReuseProven:false,
  });
}


function selectedBasis(expected){
  if(!expected?.projectRef||!Array.isArray(expected.workRefs)){
    fail('METHOD_REVISION_BASE_CHANGED','Explicit opened Project/Work references required');
  }
  return canonicalClone({projectRef:expected.projectRef,workRefs:expected.workRefs});
}
async function assertUnusedStages(owner,workspaceId,plan){
  for(const item of plan.workOperations.filter(item=>item.operation==='CREATE')){
    if(typeof owner.history!=='function')fail('METHOD_REVISION_HISTORY_REQUIRED','Original Work history required for new stages');
    if(await owner.load('work',workspaceId,item.workId)||(await owner.history('work',workspaceId,item.workId)).length){
      fail('METHOD_REVISION_STAGE_ID_USED','A proposed new stage already has original source history');
    }
  }
}

/** Preview only. Revalidates the live original revision set and new identities. */
export async function previewWorkspaceMethodRevision({owner,workspaceId,projectId,expected,draft,objects}){
  const basis=selectedBasis(expected);
  const after=prepareWorkspaceMethodSourceInputs({workspaceId,objects,draft});
  const current=await readWorkspaceMethodFromSourceOwner({owner,workspaceId,projectId});
  assertExpectedRevisionSet(basis,current);
  const plan=planRevision({workspaceId,projectId,current,after});
  await assertUnusedStages(owner,workspaceId,plan);
  const latest=await readWorkspaceMethodFromSourceOwner({owner,workspaceId,projectId});
  assertExpectedRevisionSet(current,latest);
  await assertUnusedStages(owner,workspaceId,plan);
  return plan;
}

function rowMatchesRef(row,ref){
  return !!row&&!!ref&&row.objectId===ref.objectId&&row.baseRevisionId===ref.recordId&&row.revision===ref.revision;
}
function headReference(ref){
  return {family:ref.family,objectId:ref.objectId,recordId:ref.recordId};
}
function plannedPayload(kind,input){
  return kind==='project'?normalizeProject(input):normalizeWork(input);
}
function buildEntry({kind,id,input,operation,baseRef,workspaceId,digest,index}){
  const ref=operation==='KEEP'?baseRef:Object.freeze({
    family:projectProcessSourceBinding(kind).family,
    objectId:projectProcessSourceObjectId(kind,workspaceId,id),
    recordId:'method-revision:'+digest+':'+index,
    revision:operation==='CREATE'?1:baseRef.revision+1,
  });
  if(!ref||!Number.isSafeInteger(ref.revision)||ref.revision<1){
    fail('METHOD_REVISION_REF_INVALID','Invalid target source revision');
  }
  return {kind,id,input,operation,baseRef,ref,payload:plannedPayload(kind,input)};
}
function bindTargetRefs(workspaceId,entries){
  const project=entries[0];
  const works=new Map(entries.slice(1).map(entry=>[entry.id,entry]));
  return entries.map(entry=>Object.freeze({...entry,refs:Object.freeze({
    workspaceId,canonicalHeads:Object.freeze(entry.kind==='project'?{}:{
      project:Object.freeze(headReference(project.ref)),
      ...Object.fromEntries(entry.payload.dependencies.map(dep=>[
        'predecessor:'+dep.predecessorWorkId,Object.freeze(headReference(works.get(dep.predecessorWorkId).ref)),
      ])),
    }),
  })}));
}

/** Derive the exact whole-operation identity from the original selected
 * history, the normalized target, caller operation identity and time.
 * Even a change to a not-yet-written stage changes every target record ID.
 * No second journal or extra record is stored. The caller must retain the
 * original request to resume; an arbitrary partial head is not an intent.
 */
async function prepareAttempt({owner,workspaceId,projectId,expected,draft,objects,operationId,knowledgeAt}={}){
  if(!owner||['load','history'].some(name=>typeof owner[name]!=='function')){
    fail('METHOD_SOURCE_OWNER_REQUIRED','Original Project/Process read and history ports required');
  }
  if(typeof operationId!=='string'||!operationId||operationId.length>128||operationId.trim()!==operationId
      ||/[\u0000-\u001f]/u.test(operationId)){
    fail('METHOD_REVISION_OPERATION_ID_INVALID','Stable explicit operation identity required');
  }
  const basis=selectedBasis(expected);
  const instant=knowledgeAt instanceof CanonicalInstant?knowledgeAt:CanonicalInstant.parse(knowledgeAt);
  // Capture normalized target and current material admission synchronously,
  // before any original-owner read. Never copy material contents into intent.
  const after=describeWorkspaceMethodSourceInputs({workspaceId,draft});
  const target=reconstructWorkspaceMethodDraft({workspaceId,project:normalizeProject(after.projectInput),
    works:after.workInputs.map(normalizeWork)});
  const materials=inspectWorkspaceMethodMaterials({workspaceId,objects,materials:target.materials});
  const materialReviewRequired=materials.some(item=>item.state!=='CURRENT');
  const current=await readHistoricalWorkspaceMethod({owner,workspaceId,projectId,expected:basis});
  const plan=planRevision({workspaceId,projectId,current,after});
  if(plan.requiresReleaseReview){
    fail('METHOD_REVISION_RELEASE_REVIEW_REQUIRED','Removed stages need an explicit original owner release decision');
  }
  const digest=createHash('sha256').update(canonicalStringify({
    schema:'IWXA_T2_WORKSPACE_METHOD_REVISION_ATTEMPT_V1',
    workspaceId,projectId,operationId,knowledgeAt:instant,
    basis:plan.baseRevisionSet,target,
  })).digest('hex');
  const projectInput=plan.projectOperation.input??Object.freeze({...after.projectInput,methodology:Object.freeze({
    ...after.projectInput.methodology,...(current.originalCreation?{creation:current.originalCreation}:{}),
  })});
  const works=new Map(after.workInputs.map(input=>[input.workId,input]));
  const entries=bindTargetRefs(workspaceId,[
    buildEntry({kind:'project',id:projectId,input:projectInput,operation:plan.projectOperation.operation,
      baseRef:plan.projectOperation.baseRef,workspaceId,digest,index:'project'}),
    ...plan.workOperations.map((op,index)=>buildEntry({kind:'work',id:op.workId,input:works.get(op.workId),
      operation:op.operation,baseRef:op.baseRef,workspaceId,digest,index:'work-'+index})),
  ]);
  return {owner,workspaceId,projectId,instant,digest,target,plan,entries,materials,materialReviewRequired};
}
function exactTarget(row,entry,instant){
  return rowMatchesRef(row,entry.ref)&&equal(row.value,entry.payload)&&equal(row.refs,entry.refs)
    &&(entry.operation==='KEEP'||equal(row.knowledgeAt,instant));
}
async function observeEntry(attempt,entry){
  const {owner,workspaceId,instant}=attempt;
  const row=await owner.load(entry.kind,workspaceId,entry.id);
  if(exactTarget(row,entry,instant))return entry.operation==='KEEP'?'KEPT':'CONFIRMED';
  if(entry.operation==='KEEP')return 'CONFLICT';
  if(entry.operation==='REVISE')return rowMatchesRef(row,entry.baseRef)?'PENDING':'CONFLICT';
  return row||(await owner.history(entry.kind,workspaceId,entry.id)).length?'CONFLICT':'PENDING';
}
async function observeAttempt(attempt){
  const states=new Map();
  for(const entry of attempt.entries){
    let state=await observeEntry(attempt,entry);
    // An exact saved child whose intended predecessor is missing/changed
    // cannot be presented as a recoverable complete record.
    if(state==='CONFIRMED'||state==='KEPT'){
      for(const ref of Object.values(entry.refs.canonicalHeads)){
        if(!['CONFIRMED','KEPT'].includes(states.get(ref.recordId))){
          state='CONFLICT';break;
        }
      }
    }
    states.set(entry.ref.recordId,state);
  }
  // Check that the observed state did not change while reading the set.
  // This is optimistic, never a multi-object transaction.
  for(const entry of attempt.entries){
    const state=states.get(entry.ref.recordId);
    if(state!=='CONFLICT'&&await observeEntry(attempt,entry)!==state){
      fail('METHOD_REVISION_HEAD_CHANGED','A source changed during revision inspection');
    }
  }
  const records=Object.freeze(attempt.entries.map(entry=>Object.freeze({
    kind:entry.kind,id:entry.id,operation:entry.operation,
    baseRef:entry.baseRef,targetRef:entry.ref,state:states.get(entry.ref.recordId),
  })));
  const count=state=>records.filter(row=>row.state===state).length;
  const confirmedCount=count('CONFIRMED'),pendingCount=count('PENDING'),conflictCount=count('CONFLICT'),keptCount=count('KEPT');
  return Object.freeze({state:conflictCount?'CONFLICT':pendingCount?(confirmedCount?'PARTIAL':'NOT_STARTED')
      :confirmedCount?'COMPLETE':'UNCHANGED',attemptDigest:attempt.digest,
    records,confirmedCount,pendingCount,conflictCount,keptCount,
    materials:attempt.materials,materialReviewRequired:attempt.materialReviewRequired,
    resumeCandidate:pendingCount>0&&conflictCount===0&&!attempt.materialReviewRequired,
    atomicSnapshot:false,writeAuthorized:false,executionAuthority:false,resultReuseProven:false});
}

/** Inspect recorded progress using the retained exact revision request.
 * Material admission is independent of already recorded progress.
 */
export async function inspectWorkspaceMethodRevision(input){
  return observeAttempt(await prepareAttempt(input));
}

/** Apply or resume an exact selective revision through original create/revise.
 * This does not grant write authority or authorize execution or reuse.
 * All records are preflighted before any new write, every target must be
 * read back exactly, and an uncertain response is never blindly retried.
 * The original owner enforces per-record CAS. Cross-record closure is
 * optimistic and revalidated; this is not an atomic multi-object batch.
 */
export async function applyWorkspaceMethodRevision(input){
  const attempt=await prepareAttempt(input);
  const {owner,workspaceId,projectId,instant,entries}=attempt;
  if(['create','revise'].some(name=>typeof owner[name]!=='function')){
    fail('METHOD_SOURCE_OWNER_REQUIRED','Original Project/Process write port required');
  }
  if(attempt.materialReviewRequired){
    fail('METHOD_MATERIAL_REVIEW_REQUIRED','Material revisions require review before saving');
  }
  const initial=await observeAttempt(attempt);
  if(initial.conflictCount){
    fail('METHOD_REVISION_CONFLICT','Existing source heads do not match this exact revision attempt');
  }
  const byRecord=new Map(entries.map(entry=>[entry.ref.recordId,entry]));
  const receipts=[];
  for(const entry of entries){
    const state=await observeEntry(attempt,entry);
    if(state==='KEPT'||state==='CONFIRMED'){
      receipts.push(Object.freeze({recordId:entry.ref.recordId,state:state==='KEPT'?'KEPT':'ALREADY_PRESENT'}));
      continue;
    }
    if(state!=='PENDING')fail('METHOD_REVISION_CONFLICT','Source changed before the next write');
    for(const ref of Object.values(entry.refs.canonicalHeads)){
      const prerequisite=byRecord.get(ref.recordId);
      if(!prerequisite||!['KEPT','CONFIRMED'].includes(await observeEntry(attempt,prerequisite))){
        fail('METHOD_REVISION_CONFLICT','An exact prerequisite changed before the next write');
      }
    }
    let writeError;
    const args={...entry.input,recordId:entry.ref.recordId,knowledgeAt:instant,expectedCanonicalRefs:entry.refs};
    try{
      if(entry.operation==='CREATE')await owner.create(entry.kind,args);
      else await owner.revise(entry.kind,{...args,baseRevisionId:entry.baseRef.recordId});
    }catch(error){writeError=error;}
    let observed;
    try{observed=await observeEntry(attempt,entry);}
    catch(error){throw Object.assign(new Error('Revision readback unavailable; retain the exact attempt',{cause:error}),
      {code:'METHOD_REVISION_WRITE_UNCONFIRMED'});}
    if(observed!=='CONFIRMED'){
      if(observed==='CONFLICT')fail('METHOD_REVISION_CONFLICT','Saved revision differs from the exact attempt');
      if(writeError)throw writeError;
      fail('METHOD_REVISION_WRITE_UNCONFIRMED','Owner returned without an exact saved revision');
    }
    receipts.push(Object.freeze({recordId:entry.ref.recordId,state:writeError?'ACK_RECOVERED':entry.operation==='CREATE'?'CREATED':'REVISED'}));
  }
  const result=await readWorkspaceMethodFromSourceOwner({owner,workspaceId,projectId});
  const actual=[result.projectRef,...result.workRefs];
  const targets=new Map(entries.map(entry=>[entry.ref.objectId,entry.ref]));
  if(actual.length!==entries.length||actual.some(ref=>!sameRef(ref,targets.get(ref.objectId)))
      ||!equal(result.draft,attempt.target)){
    fail('METHOD_REVISION_CONFLICT','Completed source set does not match the exact revision attempt');
  }
  const count=state=>receipts.filter(receipt=>receipt.state===state).length;
  return Object.freeze({method:result,attemptDigest:attempt.digest,receipts:Object.freeze(receipts),
    keptCount:count('KEPT'),createdCount:count('CREATED'),revisedCount:count('REVISED'),
    alreadyPresentCount:count('ALREADY_PRESENT'),recoveredAckCount:count('ACK_RECOVERED'),
    atomicBatch:false,newAuthorityGranted:false,executionAuthority:false,resultReuseProven:false});
}
