import { projectProcessSourceObjectId } from './project-process-source-owner.mjs';
import { projectProcessSourceBinding } from './project-process-source-contract.mjs';
import { reconstructWorkspaceMethodDraft } from '../features/workspace/workspace-project-method.mjs';
import { normalizeProject,normalizeWork,assertProjectMethodologyWork,assertProjectMethodologyCreation,assertProjectMethodologyCreationWork } from '../features/project-process/project-process.mjs';
import { CanonicalInstant } from '../../../foundation/time.mjs';
import { qualifyProjectProcessSameWorkspaceHistory } from './project-process-history.mjs';

function fail(code,message){
  throw Object.assign(new Error(message),{code});
}

function sourceRef(kind,workspaceId,id,loaded){
  if(!loaded) fail('METHOD_SOURCE_INCOMPLETE','Missing declared '+kind);
  const binding=projectProcessSourceBinding(kind);
  if(loaded.objectId!==projectProcessSourceObjectId(kind,workspaceId,id)
      || typeof loaded.baseRevisionId!=='string' || !loaded.baseRevisionId
      || !Number.isSafeInteger(loaded.revision) || loaded.revision<1
      || loaded.value?.workspaceId!==workspaceId || loaded.value?.[binding.idField]!==id
      || loaded.value?.objectKind!==kind || loaded.value?.schema!==binding.schema
      || loaded.value?.sourceTruth!==true || loaded.refs?.workspaceId!==workspaceId){
    fail('METHOD_SOURCE_INCOMPATIBLE','Source record identity does not match requested '+kind);
  }
  return Object.freeze({family:binding.family,objectId:loaded.objectId,
    recordId:loaded.baseRevisionId,revision:loaded.revision});
}

function matches(ref,expected){
  return !!expected && ref?.family===expected.family && ref.objectId===expected.objectId && ref.recordId===expected.recordId;
}

function methodWorkIds(project,projectId){
  const ids=project.value.methodology?.workIds;
  if(!Array.isArray(ids) || !ids.length || ids.length>64 || new Set(ids).size!==ids.length
      || ids.some(id=>typeof id!=='string' || !id.startsWith(projectId+'.')
        || !/^[A-Za-z0-9_-]{1,63}$/u.test(id.slice(projectId.length+1)))){
    fail('METHOD_SOURCE_INCOMPATIBLE','Project does not declare a compatible method');
  }
  return ids;
}

function verifyMethodSet({workspaceId,project,projectRef,ids,loaded}){
  const workRefs=loaded.map((row,index)=>sourceRef('work',workspaceId,ids[index],row));
  const byId=new Map(ids.map((id,index)=>[id,workRefs[index]]));
  const draft=reconstructWorkspaceMethodDraft({workspaceId,project:project.value,works:loaded.map(row=>row.value)});
  verifyMethodWorkBindings({project,projectRef,loaded,byId});
  const originalCreation=normalizeProject(project.value).methodology.creation??null;
  return {draft,workRefs,originalCreation};
}

function verifyMethodWorkBindings({project,projectRef,loaded,byId}){
  const initial=projectRef.revision===1 && project.value.methodology?.creation;
  if(initial){
    const normalized=normalizeProject(project.value);
    assertProjectMethodologyCreation(normalized,projectRef.recordId);
    if(!(project.knowledgeAt instanceof CanonicalInstant)) fail('METHOD_SOURCE_INCOMPATIBLE','First Project creation time is unavailable');
    for(const row of loaded) if(row.revision===1){
      assertProjectMethodologyCreationWork(normalized,normalizeWork(row.value),row.baseRevisionId);
      if(!(row.knowledgeAt instanceof CanonicalInstant) || project.knowledgeAt.compare(row.knowledgeAt)!==0
          || row.value.dependencies.some(dep=>{
            const expected=initial.steps.find(step=>step.workId===dep.predecessorWorkId);
            return !expected || row.refs?.canonicalHeads?.['predecessor:'+dep.predecessorWorkId]?.recordId!==expected.recordId;
          })){
        fail('METHOD_SOURCE_REFERENCE_CHANGED','First Work does not match the exact original creation set');
      }
    }
  }
  for(const row of loaded){
    const refs=row.refs?.canonicalHeads;
    const expectedKeys=['project',...row.value.dependencies.map(dep=>'predecessor:'+dep.predecessorWorkId)];
    if(!refs || Object.keys(refs).length!==expectedKeys.length || expectedKeys.some(key=>!Object.hasOwn(refs,key))
        || !matches(refs.project,projectRef)
        || row.value.dependencies.some(dep=>!matches(refs['predecessor:'+dep.predecessorWorkId],byId.get(dep.predecessorWorkId)))){
      fail('METHOD_SOURCE_REFERENCE_CHANGED','Project/Work references no longer form the captured revision set');
    }
  }
}

/** Read a complete planned methodology via the existing source owner's load
 * operation. Never synthesize missing Work, silently use newer revisions, or
 * treat a partial multi-record write as a complete method. This is a bounded,
 * optimistic readback, NOT an atomic transaction or authorization receipt.
 */
export async function readWorkspaceMethodFromSourceOwner({owner,workspaceId,projectId}){
  if(!owner || typeof owner.load!=='function') fail('METHOD_SOURCE_INCOMPATIBLE','Original source owner read port required');
  const project=await owner.load('project',workspaceId,projectId);
  const projectRef=sourceRef('project',workspaceId,projectId,project);
  const ids=methodWorkIds(project,projectId);
  const loaded=await Promise.all(ids.map(id=>owner.load('work',workspaceId,id)));
  const {draft,workRefs,originalCreation}=verifyMethodSet({workspaceId,project,projectRef,ids,loaded});
  // A concurrent edit observed during readback must cause explicit review.
  // The source owner's immutable record IDs, not payload similarity, bind
  // this read. Revalidation is still required for any future mutation.
  const second=await Promise.all([owner.load('project',workspaceId,projectId),
    ...ids.map(id=>owner.load('work',workspaceId,id))]);
  const secondRefs=[sourceRef('project',workspaceId,projectId,second[0]),
    ...ids.map((id,index)=>sourceRef('work',workspaceId,id,second[index+1]))];
  if(secondRefs.some((ref,index)=>!matches(ref,[projectRef,...workRefs][index])
      || ref.revision!==[projectRef,...workRefs][index].revision)){
    fail('METHOD_SOURCE_REFERENCE_CHANGED','Source head changed during readback');
  }
  return Object.freeze({workspaceId,projectId,draft,projectRef,workRefs:Object.freeze(workRefs),originalCreation,
    revisionSetVerified:true,atomicSnapshot:false,writeAuthorized:false,executionAuthority:false});
}

function historyRef(kind,workspaceId,id,value){
  const binding=projectProcessSourceBinding(kind);
  if(!value || value.family!==binding.family
      || value.objectId!==projectProcessSourceObjectId(kind,workspaceId,id)
      || typeof value.recordId!=='string' || !value.recordId || value.recordId.trim()!==value.recordId
      || !Number.isSafeInteger(value.revision) || value.revision<1){
    fail('METHOD_HISTORY_REF_INVALID','Exact original '+kind+' revision reference required');
  }
  return Object.freeze({family:value.family,objectId:value.objectId,recordId:value.recordId,revision:value.revision});
}

async function historicalRevision(owner,kind,workspaceId,id,ref){
  const addressed=typeof owner.historyThrough==='function';
  let history;
  try{
    history=addressed?await owner.historyThrough(kind,workspaceId,id,ref.recordId,ref.revision)
      :await owner.history(kind,workspaceId,id);
  }catch(error){
    if(error?.code==='CANONICAL_HISTORY_PREFIX_INCOMPLETE'){
      fail('METHOD_HISTORY_INCOMPLETE','Exact selected source history prefix is unavailable');
    }
    if(error?.code==='CANONICAL_HISTORY_PREFIX_INVALID'||error?.code==='PROJECT_PROCESS_SOURCE_HEAD_MISMATCH'){
      fail('METHOD_HISTORY_REF_INVALID','Original historical source identity mismatch');
    }
    throw error;
  }
  if(!Array.isArray(history)) fail('METHOD_HISTORY_INCOMPLETE','Original history is unavailable');
  // Require a contiguous prefix through the selected immutable revision.
  // Later tombstones or revisions must not substitute for the selection.
  const prefix=history.filter(row=>row?.revision<=ref.revision);
  if(prefix.length!==ref.revision||(addressed&&history.length!==prefix.length)){
    fail('METHOD_HISTORY_INCOMPLETE','Exact source history prefix is incomplete');
  }
  for(const row of prefix){
    const command=row.revision===1?'create':row.operation==='tombstone'?'release':'revise';
    if(row.schema!=='IWXA_T2_CANONICAL_RECORD_V1' || row.family!==ref.family || row.objectId!==ref.objectId
        || row.commandId!==kind+'.'+command || !(row.knowledgeAt instanceof CanonicalInstant)
        || (row.operation!=='upsert' && row.operation!=='tombstone')
        || (row.operation==='upsert' && (row.payload?.sourceTruth!==true
          || row.payload?.[projectProcessSourceBinding(kind).idField]!==id))){
      fail('METHOD_HISTORY_REF_INVALID','Original historical source identity mismatch');
    }
  }
  qualifyProjectProcessSameWorkspaceHistory({workspaceId,records:prefix,requireReferencedHeads:false});
  const selected=prefix.find(row=>row.revision===ref.revision && row.recordId===ref.recordId);
  if(!selected || selected.operation!=='upsert') fail('METHOD_HISTORY_INCOMPLETE','Selected source revision is absent or deleted');
  return {prefix,loaded:Object.freeze({objectId:selected.objectId,baseRevisionId:selected.recordId,
    revision:selected.revision,knowledgeAt:selected.knowledgeAt,value:selected.payload,refs:selected.refs})};
}

/** Reconstruct an explicitly selected historical revision set through original
 * history only. No latest-head fallback, time-based guessing, resurrection,
 * material rebinding, or execution. Closure is verified, not simultaneity:
 * a compatible historical set is not proof of an atomic snapshot at a time.
 * Current permissions and suitability of materials must be checked separately.
 */
export async function readHistoricalWorkspaceMethod({owner,workspaceId,projectId,expected}){
  if(!owner || (typeof owner.historyThrough!=='function'&&typeof owner.history!=='function')){
    fail('METHOD_HISTORY_INCOMPLETE','Original source owner history port required');
  }
  const projectRef=historyRef('project',workspaceId,projectId,expected?.projectRef);
  if(!Array.isArray(expected?.workRefs) || !expected.workRefs.length || expected.workRefs.length>64){
    fail('METHOD_HISTORY_REF_INVALID','Complete Work revision references required');
  }
  const refs=expected.workRefs.map(ref=>Object.freeze({family:ref?.family,objectId:ref?.objectId,recordId:ref?.recordId,revision:ref?.revision}));
  const byObject=new Map(refs.map(ref=>[ref.objectId,ref]));
  if(byObject.size!==refs.length) fail('METHOD_HISTORY_REF_INVALID','Duplicate Work revision references');
  const projectHistory=await historicalRevision(owner,'project',workspaceId,projectId,projectRef);
  const project=projectHistory.loaded;
  const ids=methodWorkIds(project,projectId);
  if(ids.length!==refs.length) fail('METHOD_HISTORY_REF_INVALID','Work references do not match selected Project');
  const selected=ids.map(id=>historyRef('work',workspaceId,id,byObject.get(projectProcessSourceObjectId('work',workspaceId,id))));
  const histories=await Promise.all(ids.map((id,index)=>historicalRevision(owner,'work',workspaceId,id,selected[index])));
  // Reject duplicate record IDs across the requested histories too.
  // References in earlier prefixes may legitimately target removed stages;
  // only the exact selected Project/Work set is required to be closed.
  qualifyProjectProcessSameWorkspaceHistory({workspaceId,
    records:[...projectHistory.prefix,...histories.flatMap(item=>item.prefix)],requireReferencedHeads:false});
  const loaded=histories.map(item=>item.loaded);
  const {draft,workRefs,originalCreation}=verifyMethodSet({workspaceId,project,projectRef,ids,loaded});
  return Object.freeze({workspaceId,projectId,draft,projectRef,workRefs:Object.freeze(workRefs),originalCreation,revisionSetVerified:true,
    historicalRead:true,currentHeadVerified:false,atomicSnapshot:false,writeAuthorized:false,executionAuthority:false});
}


/** Address only the selected Work and its transitive prerequisite closure.
 * The captured selection declares every Work identity, but unrelated heads
 * need not still match. This is NOT verification of the whole method or an
 * execution authorization. The original immutable source owner is required.
 */
export async function openWorkspaceMethodStageClosure(input){
  return openMethodInputClosure({...input,wholeMethod:false});
}
/** Read all current declared planned Works once, using the SAME source
 * authority, creation/closure validation and exact revision fences as a
 * single stage. No catalog or history enumeration, no persisted cache. */
export async function openWorkspaceMethodCompleteClosure(input){
  return openMethodInputClosure({...input,wholeMethod:true});
}
async function openMethodInputClosure({owner,workspaceId,projectId,expected,stepId,wholeMethod}){
  if(!owner||typeof owner.load!=='function')fail('METHOD_SOURCE_INCOMPATIBLE','Original source owner read port required');
  const projectRef=historyRef('project',workspaceId,projectId,expected?.projectRef);
  const requested=Array.from(expected?.workRefs??[],row=>Object.freeze({
    family:row?.family,objectId:row?.objectId,recordId:row?.recordId,revision:row?.revision}));
  if(!requested.length||requested.length>64||new Set(requested.map(row=>row.objectId)).size!==requested.length
      ||new Set([projectRef.recordId,...requested.map(row=>row.recordId)]).size!==requested.length+1){
    fail('METHOD_STAGE_SELECTION_INVALID','Distinct declared Work revisions required');
  }
  const loadExact=async(kind,id,ref)=>{
    const row=await owner.load(kind,workspaceId,id);
    if(!row)fail('METHOD_STAGE_SOURCE_CHANGED','Selected original source is no longer available');
    const actual=sourceRef(kind,workspaceId,id,row);
    if(!matches(actual,ref)||actual.revision!==ref.revision){
      fail('METHOD_STAGE_SOURCE_CHANGED','Selected original source revision changed');
    }
    return row;
  };
  const project=await loadExact('project',projectId,projectRef);
  if(project.value.status!=='planned'||!project.value.methodology){
    fail('METHOD_SOURCE_INCOMPATIBLE','Expected planned original Project methodology');
  }
  const normalized=normalizeProject(project.value),ids=methodWorkIds(project,projectId);
  const byObject=new Map(requested.map(row=>[row.objectId,row]));
  if(ids.length!==requested.length||ids.some(id=>!byObject.has(projectProcessSourceObjectId('work',workspaceId,id)))){
    fail('METHOD_STAGE_SOURCE_CHANGED','Work selection does not match Project declarations');
  }
  const refs=new Map(ids.map(id=>[id,historyRef('work',workspaceId,id,byObject.get(projectProcessSourceObjectId('work',workspaceId,id)))]));
  const selectedId=projectId+'.'+stepId;
  if(!wholeMethod&&!refs.has(selectedId))fail('METHOD_STAGE_UNKNOWN','Selected stage is not declared in the original Project');
  const loaded=new Map(),depth=new Map(),visiting=new Set();
  // Complete overview addresses all Works concurrently once. Selected
  // stage traversal still loads ONLY its ancestors.
  const prefetched=wholeMethod?new Map(await Promise.all(ids.map(async id=>[id,await loadExact('work',id,refs.get(id))]))):null;
  async function visit(id){
    if(visiting.has(id))fail('METHOD_DEPENDENCY_CYCLE','The selected closure has cyclic prerequisites');
    if(loaded.has(id))return depth.get(id);
    if(!refs.has(id))fail('METHOD_SOURCE_INCOMPLETE','Undeclared prerequisite Work');
    visiting.add(id);
    const row=prefetched?prefetched.get(id):await loadExact('work',id,refs.get(id)),value=row.value;
    if(value.projectId!==projectId||value.status!=='planned'||!value.methodology||!value.schedule
        ||value.schedule.plannedStart!==null||value.schedule.plannedFinish!==null){
      fail('METHOD_SOURCE_INCOMPATIBLE','Selected Work is not an unscheduled planned method step');
    }
    const work=normalizeWork(value);
    assertProjectMethodologyWork(normalized,work);
    let level=0;
    for(const predecessor of work.dependencies){
      level=Math.max(level,1+await visit(predecessor.predecessorWorkId));
    }
    loaded.set(id,{row,work});depth.set(id,level);visiting.delete(id);
    return level;
  }
  if(wholeMethod){for(const id of ids)await visit(id);}else await visit(selectedId);
  // Preserve the original structural preview's wave/declaration ordering;
  // ancestors of a selected node are closed under prerequisites.
  const ordered=ids.filter(id=>loaded.has(id)).sort((a,b)=>depth.get(a)-depth.get(b));
  if(wholeMethod){
    verifyMethodSet({workspaceId,project,projectRef,ids,loaded:ids.map(id=>loaded.get(id).row)});
  }else{
    verifyMethodWorkBindings({project,projectRef,loaded:ordered.map(id=>loaded.get(id).row),
      byId:new Map(ordered.map(id=>[id,refs.get(id)]))});
  }
  const works=Object.freeze(ordered.map(id=>Object.freeze({work:loaded.get(id).work,workRef:refs.get(id)})));
  const verifyCurrent=async()=>{
    await Promise.all([loadExact('project',projectId,projectRef),...ordered.map(id=>loadExact('work',id,refs.get(id)))]);
  };
  return Object.freeze({project:normalized,projectRef,works,verifyCurrent,
    completeMethodCurrentVerified:wholeMethod,atomicSnapshot:false});
}
