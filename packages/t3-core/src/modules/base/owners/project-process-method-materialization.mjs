import { CanonicalInstant } from '../../../foundation/time.mjs';
import { canonicalStringify } from '../../../persistence/canonical-codec.mjs';
import { normalizeProject, normalizeWork, assertProjectMethodologyCreation, assertProjectMethodologyCreationWork } from '../features/project-process/project-process.mjs';
import { prepareWorkspaceMethodSourceInputs, reconstructWorkspaceMethodDraft, inspectWorkspaceMethodMaterials } from '../features/workspace/workspace-project-method.mjs';
import { projectProcessSourceObjectId,hasProjectProcessSourceIdentity } from './project-process-source-owner.mjs';
import { projectProcessSourceBinding } from './project-process-source-contract.mjs';
import { readWorkspaceMethodFromSourceOwner } from './project-process-method-readback.mjs';
import { verifyProjectMethodAlternativeOrigin } from './project-process-method-origin.mjs';

function fail(code,message,cause){
  throw Object.assign(new Error(message,cause===undefined?undefined:{cause}),{code});
}

function sameKeys(value,keys){
  return Boolean(value && typeof value==='object' && !Array.isArray(value)
    && Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key)));
}

function recordId(value){
  if(typeof value!=='string' || !value || value.length>512 || value!==value.trim() || /[\u0000-\u001f]/u.test(value)){
    fail('METHOD_SOURCE_RECORD_ID_INVALID','A stable explicit source record ID is required');
  }
  return value;
}

function makeEntry(workspaceId,kind,id,input,idValue){
  const binding=projectProcessSourceBinding(kind);
  return {kind,id,input,recordId:recordId(idValue),objectId:projectProcessSourceObjectId(kind,workspaceId,id),
    family:binding.family,payload:kind==='project'?normalizeProject(input):normalizeWork(input)};
}

function bindExpectedRefs(workspaceId,entries){
  const p=entries[0];
  const byId=new Map(entries.slice(1).map(item=>[item.id,item]));
  const ref=item=>({family:item.family,objectId:item.objectId,recordId:item.recordId});
  for(const item of entries){
    const heads=item.kind==='project'?{}:{project:ref(p),
      ...Object.fromEntries(item.payload.dependencies.map(dep=>['predecessor:'+dep.predecessorWorkId,ref(byId.get(dep.predecessorWorkId))]))};
    item.expectedRefs={workspaceId,canonicalHeads:heads};
  }
  return entries;
}

/** Build immutable inputs for the original owner create operations.
 * recordIds and knowledgeAt belong to this exact creation attempt. Retrying
 * requires the same values and identical method; never allocate fresh IDs
 * on an ambiguous outcome. The first Project retains the full initial plan,
 * in existing source history, not a second journal, Store or grant.
 */
function prepareEntries({workspaceId,objects,draft,recordIds,knowledgeAt,alternativeOrigin}){
  const plan=prepareWorkspaceMethodSourceInputs({workspaceId,objects,draft});
  if(!sameKeys(recordIds,['project','works']) || !sameKeys(recordIds.works,plan.writeOrder)){
    fail('METHOD_SOURCE_RECORD_ID_INVALID','Exactly one record ID per declared Project and Work is required');
  }
  const instant=knowledgeAt instanceof CanonicalInstant?knowledgeAt:CanonicalInstant.parse(knowledgeAt);
  const entry=(kind,id,input,idValue)=>makeEntry(workspaceId,kind,id,input,idValue);
  const projectRecordId=recordId(recordIds.project);
  const inputs=new Map(plan.workInputs.map(input=>[input.workId,input]));
  const workEntries=plan.writeOrder.map(id=>entry('work',id,inputs.get(id),recordIds.works[id]));
  if(new Set([projectRecordId,...workEntries.map(item=>item.recordId)]).size!==workEntries.length+1){
    fail('METHOD_SOURCE_RECORD_ID_INVALID','Source record IDs must be distinct');
  }
  const creation=Object.freeze({version:1,projectRecordId,steps:Object.freeze(plan.workInputs.map(input=>Object.freeze({
    workId:input.workId,recordId:recordId(recordIds.works[input.workId]),name:input.name,
    intendedActor:input.methodology.intendedActor,instruction:input.methodology.instruction,
    materialRefs:input.methodology.materialRefs,predecessorWorkIds:Object.freeze(input.dependencies.map(dep=>dep.predecessorWorkId)),
  }))),...(alternativeOrigin===undefined?{}:{origin:alternativeOrigin})});
  const projectInput=Object.freeze({...plan.projectInput,methodology:Object.freeze({...plan.projectInput.methodology,creation})});
  const p=entry('project',projectInput.projectId,projectInput,projectRecordId);
  assertProjectMethodologyCreation(p.payload,p.recordId);
  for(const item of workEntries) assertProjectMethodologyCreationWork(p.payload,item.payload,item.recordId);
  const entries=bindExpectedRefs(workspaceId,[p,...workEntries]);
  return {entries,instant,projectId:p.id};
}

function matches(row,item,instant){
  return row.objectId===item.objectId && row.baseRevisionId===item.recordId && row.revision===1
    && canonicalStringify(row.knowledgeAt)===canonicalStringify(instant)
    && canonicalStringify(row.value)===canonicalStringify(item.payload)
    && canonicalStringify(row.refs)===canonicalStringify(item.expectedRefs);
}

async function readExact(owner,workspaceId,item,instant){
  const row=await owner.load(item.kind,workspaceId,item.id);
  if(!row)return null;
  if(!matches(row,item,instant)){
    fail('METHOD_SOURCE_CREATE_CONFLICT','Existing source record does not match the exact creation attempt');
  }
  return row;
}

/** Create or resume one complete method using ONLY the original source owner.
 * No automatic retry, overwrite, release, parallel executor, new owner,
 * Store or Task. No browser wiring while the original C3/D4 gate is closed.
 * The caller must have an already authorized owner port and maintain the
 * original creation identity; this function cannot grant such access.
 * Individual writes are not an atomic batch. A partial outcome is retained
 * in original history; exact readback is required to resume.
 */
export async function createWorkspaceMethodThroughSourceOwner({owner,workspaceId,objects,draft,recordIds,knowledgeAt,alternativeOrigin}){
  if(!owner || ['create','load','history'].some(name=>typeof owner[name]!=='function')){
    fail('METHOD_SOURCE_OWNER_REQUIRED','Original Project/Process source owner port required');
  }
  const {entries,instant,projectId}=prepareEntries({workspaceId,objects,draft,recordIds,knowledgeAt,alternativeOrigin});
  // Recovery of a previously saved Project also verifies its exact origin
  // using present owner access. Normal method creation has no history read.
  if(entries[0].payload.methodology.creation.origin)await verifyProjectMethodAlternativeOrigin(owner,entries[0].payload);
  const preflight=new Set();
  // Refuse conflicts anywhere in the declared method BEFORE adding more
  // records; a tombstoned logical ID is not an unused identity.
  for(const item of entries){
    const existing=await readExact(owner,workspaceId,item,instant);
    if(existing){
      for(const ref of Object.values(item.expectedRefs.canonicalHeads)){
        if(!preflight.has(ref.recordId)) fail('METHOD_SOURCE_CREATE_CONFLICT','Existing record has an unavailable creation prerequisite');
      }
      preflight.add(item.recordId);
    }else if(await hasProjectProcessSourceIdentity(owner,item.kind,workspaceId,item.id)){
      fail('METHOD_SOURCE_CREATE_CONFLICT','Existing history prevents new creation of this identity');
    }
  }
  const confirmed=[];
  for(const item of entries){
    if(await readExact(owner,workspaceId,item,instant)){
      confirmed.push(Object.freeze({recordId:item.recordId,state:'ALREADY_PRESENT'}));
      continue;
    }
    let writeError;
    try{
      await owner.create(item.kind,{...item.input,recordId:item.recordId,knowledgeAt:instant,expectedCanonicalRefs:item.expectedRefs});
    }catch(error){writeError=error;}
    let row;
    try{row=await readExact(owner,workspaceId,item,instant);}
    catch(error){
      if(error?.code==='METHOD_SOURCE_CREATE_CONFLICT')throw error;
      fail('METHOD_SOURCE_WRITE_UNCONFIRMED','Readback is unavailable; resume only with the same creation identity',error);
    }
    if(!row){
      if(writeError)throw writeError;
      fail('METHOD_SOURCE_WRITE_UNCONFIRMED','Owner returned without an exact persisted record');
    }
    confirmed.push(Object.freeze({recordId:item.recordId,state:writeError?'ACK_RECOVERED':'CREATED'}));
  }
  const result=await readWorkspaceMethodFromSourceOwner({owner,workspaceId,projectId});
  const actual=[result.projectRef,...result.workRefs];
  const expected=new Map(entries.map(item=>[item.objectId,item.recordId]));
  if(actual.length!==entries.length || actual.some(ref=>ref.revision!==1 || expected.get(ref.objectId)!==ref.recordId)){
    fail('METHOD_SOURCE_CREATE_CONFLICT','Source revision set changed after creation');
  }
  return Object.freeze({method:result,confirmed:Object.freeze(confirmed),
    createdCount:confirmed.filter(item=>item.state==='CREATED').length,
    alreadyPresentCount:confirmed.filter(item=>item.state==='ALREADY_PRESENT').length,
    recoveredAckCount:confirmed.filter(item=>item.state==='ACK_RECOVERED').length,
    atomicBatch:false,newAuthorityGranted:false,executionAuthority:false});
}


// Build the original creation set without inventing an admitted material catalog.
async function readCreationPlan({owner,workspaceId,projectId}){
  if(!owner||typeof owner.load!=='function') fail('METHOD_SOURCE_OWNER_REQUIRED','Original Project/Process source owner port required');
  const row=await owner.load('project',workspaceId,projectId),value=row?.value;
  if(!row||row.objectId!==projectProcessSourceObjectId('project',workspaceId,projectId)
      ||row.revision!==1||value?.workspaceId!==workspaceId||value?.projectId!==projectId
      ||value?.schema!=='IWXA_T2_PROJECT_V1'||value?.objectKind!=='project'||value?.sourceTruth!==true
      ||row.refs?.workspaceId!==workspaceId||!value.methodology?.creation||!(row.knowledgeAt instanceof CanonicalInstant)){
    fail('METHOD_SOURCE_CREATION_UNAVAILABLE','The original first Project creation intent is unavailable');
  }
  const project=normalizeProject(value),creation=project.methodology.creation;
  assertProjectMethodologyCreation(project,row.baseRevisionId);
  if(canonicalStringify(row.refs)!==canonicalStringify({workspaceId,canonicalHeads:{}})){
    fail('METHOD_SOURCE_CREATE_CONFLICT','Unexpected first Project reference set');
  }
  const works=creation.steps.map(step=>normalizeWork({
    workspaceId,projectId,workId:step.workId,name:step.name,status:'planned',schedule:{},
    methodology:{version:1,stepId:step.workId.slice(projectId.length+1),intendedActor:step.intendedActor,
      instruction:step.instruction,materialRefs:step.materialRefs},
    dependencies:step.predecessorWorkIds.map(predecessorWorkId=>({predecessorWorkId,relation:'finish-to-start',lagNanoseconds:'0'})),
  }));
  for(let i=0;i<works.length;i++) assertProjectMethodologyCreationWork(project,works[i],creation.steps[i].recordId);
  const draft=reconstructWorkspaceMethodDraft({workspaceId,project,works});
  const recordIds=Object.freeze({project:creation.projectRecordId,
    works:Object.freeze(Object.fromEntries(creation.steps.map(step=>[step.workId,step.recordId])))});
  return {draft,recordIds,knowledgeAt:row.knowledgeAt,project,works,alternativeOrigin:creation.origin};
}

/** Historical creation intention, even when no Work has been saved. */
export async function readWorkspaceMethodCreationIntent(input){
  const {draft,recordIds,knowledgeAt,alternativeOrigin}=await readCreationPlan(input);
  return Object.freeze({draft,recordIds,knowledgeAt,...(alternativeOrigin?{alternativeOrigin}:{}),executionAuthority:false,writeAuthorized:false});
}

/** Read-only progress for the exact original attempt. Never represents
 * a missing entry as completed, overwrites a conflicting revision, or grants
 * access. The material review is independent of recorded source progress.
 * This is an optimistic observation, not an atomic snapshot or a run gate.
 */
export async function inspectWorkspaceMethodCreation({owner,workspaceId,projectId,objects}){
  if(!owner || typeof owner.history!=='function') fail('METHOD_SOURCE_OWNER_REQUIRED','Original source history port required');
  const {draft,recordIds,knowledgeAt,project,works,alternativeOrigin}=await readCreationPlan({owner,workspaceId,projectId});
  if(alternativeOrigin)await verifyProjectMethodAlternativeOrigin(owner,project);
  const entries=bindExpectedRefs(workspaceId,[
    makeEntry(workspaceId,'project',projectId,project,recordIds.project),
    ...works.map(work=>makeEntry(workspaceId,'work',work.workId,work,recordIds.works[work.workId])),
  ]);
  const observed=new Map();
  const sourceStates=new Map();
  for(const item of entries){
    const row=await owner.load(item.kind,workspaceId,item.id);
    observed.set(item.recordId,row?.baseRevisionId??null);
    const state=row ? (matches(row,item,knowledgeAt)?'CONFIRMED':'CONFLICT')
      : (await hasProjectProcessSourceIdentity(owner,item.kind,workspaceId,item.id)) ? 'CONFLICT':'MISSING';
    sourceStates.set(item.recordId,state);
  }
  // An exact child is not a confirmed part of a recoverable creation set
  // if its declared prerequisite closure has been deleted or changed.
  for(let pass=0;pass<entries.length;pass++){
    let changed=false;
    for(const item of entries){
      if(sourceStates.get(item.recordId)==='CONFIRMED'
          && Object.values(item.expectedRefs.canonicalHeads).some(ref=>sourceStates.get(ref.recordId)!=='CONFIRMED')){
        sourceStates.set(item.recordId,'CONFLICT');changed=true;
      }
    }
    if(!changed)break;
  }
  // Recheck observed live heads; concurrent changes must be reviewed again.
  for(const item of entries){
    const row=await owner.load(item.kind,workspaceId,item.id);
    if((row?.baseRevisionId??null)!==observed.get(item.recordId)
        || (sourceStates.get(item.recordId)==='CONFIRMED' && (!row||!matches(row,item,knowledgeAt)))
        || (!row && sourceStates.get(item.recordId)==='MISSING' && await hasProjectProcessSourceIdentity(owner,item.kind,workspaceId,item.id))){
      fail('METHOD_SOURCE_REFERENCE_CHANGED','Source head changed during creation inspection');
    }
  }
  const records=Object.freeze(entries.map(item=>Object.freeze({kind:item.kind,id:item.id,recordId:item.recordId,state:sourceStates.get(item.recordId)})));
  const confirmedCount=records.filter(row=>row.state==='CONFIRMED').length;
  const missingCount=records.filter(row=>row.state==='MISSING').length;
  const conflictCount=records.filter(row=>row.state==='CONFLICT').length;
  const materials=inspectWorkspaceMethodMaterials({workspaceId,objects,materials:draft.materials});
  const materialReviewRequired=materials.some(item=>item.state!=='CURRENT');
  const state=conflictCount?'CONFLICT':missingCount?'PARTIAL':'COMPLETE';
  return Object.freeze({state,draft,records,materials,confirmedCount,missingCount,conflictCount,materialReviewRequired,
    ...(alternativeOrigin?{alternativeOrigin}:{}),
    resumeCandidate:state==='PARTIAL'&&!materialReviewRequired,atomicSnapshot:false,writeAuthorized:false,executionAuthority:false});
}

/** Explicit recovery through the original owner; no automatic continuation,
 * material rebind or new write authority. Supply the current admitted catalog.
 */
export async function resumeWorkspaceMethodThroughSourceOwner({owner,workspaceId,projectId,objects}){
  const attempt=await readWorkspaceMethodCreationIntent({owner,workspaceId,projectId});
  return createWorkspaceMethodThroughSourceOwner({owner,workspaceId,objects,
    draft:attempt.draft,recordIds:attempt.recordIds,knowledgeAt:attempt.knowledgeAt,
    alternativeOrigin:attempt.alternativeOrigin});
}
