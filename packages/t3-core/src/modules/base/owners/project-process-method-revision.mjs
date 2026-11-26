import { canonicalStringify } from '../../../persistence/canonical-codec.mjs';
import { normalizeProject,normalizeWork } from '../features/project-process/project-process.mjs';
import { describeWorkspaceMethodSourceInputs,prepareWorkspaceMethodSourceInputs } from '../features/workspace/workspace-project-method.mjs';
import { projectProcessSourceObjectId } from './project-process-source-owner.mjs';
import { readWorkspaceMethodFromSourceOwner } from './project-process-method-readback.mjs';

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

/** Preview a revision of the original planned Project and Work records.
 * The caller must explicitly supply the revision set originally opened by
 * the user. Project changes and predecessor changes require source-head
 * rebinding; this does not imply that every computation must be rerun.
 * No mutation, Task, Result, Acceptance, schedule, or execution is performed.
 * Removed stages require a separate explicit owner decision; historical
 * source records are never deleted by this preview.
 */
export async function previewWorkspaceMethodRevision({owner,workspaceId,projectId,expected,draft,objects}){
  const current=await readWorkspaceMethodFromSourceOwner({owner,workspaceId,projectId});
  assertExpectedRevisionSet(expected,current);
  if(draft?.projectId!==projectId||draft.templateId!==current.draft.templateId){
    fail('METHOD_REVISION_ID_CHANGED','Use a new project for a distinct method identity');
  }
  const before=describeWorkspaceMethodSourceInputs({workspaceId,draft:current.draft});
  const after=prepareWorkspaceMethodSourceInputs({workspaceId,objects,draft});
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
  const sourceProject=await owner.load('project',workspaceId,projectId);
  if(sourceProject?.objectId!==current.projectRef.objectId||sourceProject?.baseRevisionId!==current.projectRef.recordId
      ||sourceProject?.revision!==current.projectRef.revision){
    fail('METHOD_REVISION_BASE_CHANGED','Project changed during revision preview');
  }
  // Retain the original creation plan exactly, even when current stage
  // composition changes. The original owner rejects loss of this snapshot.
  const creation=sourceProject.value.methodology?.creation;
  const projectInput=Object.freeze({...after.projectInput,methodology:Object.freeze({
    ...after.projectInput.methodology,...(creation?{creation}:{}),
  })});
  normalizeProject(projectInput);

  const oldWorks=new Map(before.workInputs.map(input=>[input.workId,normalizeWork(input)]));
  const newWorks=new Map(after.workInputs.map(input=>[input.workId,input]));
  // A removed historical Work identity is not a new unused identity.
  // A new stage needs a never-used logical ID, or an explicit restoration
  // operation under the original owner, not an inferred create.
  const added=[...newWorks.keys()].filter(id=>!oldWorks.has(id));
  if(added.length && typeof owner.history!=='function') fail('METHOD_REVISION_HISTORY_REQUIRED','Original Work history required for new stages');
  const checkAdded=async()=>{
    for(const id of added){
      if(await owner.load('work',workspaceId,id)||(await owner.history('work',workspaceId,id)).length){
        fail('METHOD_REVISION_STAGE_ID_USED','A proposed new stage already has original source history');
      }
    }
  };
  await checkAdded();
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
  // Detect observed concurrent edits after reading the creation snapshot.
  const latest=await readWorkspaceMethodFromSourceOwner({owner,workspaceId,projectId});
  assertExpectedRevisionSet(current,latest);
  await checkAdded();
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
