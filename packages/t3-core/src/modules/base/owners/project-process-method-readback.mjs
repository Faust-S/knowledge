import { projectProcessSourceObjectId } from './project-process-source-owner.mjs';
import { projectProcessSourceBinding } from './project-process-source-contract.mjs';
import { reconstructWorkspaceMethodDraft } from '../features/workspace/workspace-project-method.mjs';
import { normalizeProject,normalizeWork,assertProjectMethodologyCreation,assertProjectMethodologyCreationWork } from '../features/project-process/project-process.mjs';
import { CanonicalInstant } from '../../../foundation/time.mjs';

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
  return ref?.family===expected.family && ref.objectId===expected.objectId && ref.recordId===expected.recordId;
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
  const ids=project.value.methodology?.workIds;
  if(!Array.isArray(ids) || !ids.length || ids.length>64 || new Set(ids).size!==ids.length
      || ids.some(id=>typeof id!=='string' || !id.startsWith(projectId+'.')
        || !/^[A-Za-z0-9_-]{1,63}$/u.test(id.slice(projectId.length+1)))){
    fail('METHOD_SOURCE_INCOMPATIBLE','Project does not declare a compatible method');
  }
  const loaded=await Promise.all(ids.map(id=>owner.load('work',workspaceId,id)));
  const workRefs=loaded.map((row,index)=>sourceRef('work',workspaceId,ids[index],row));
  const byId=new Map(ids.map((id,index)=>[id,workRefs[index]]));
  const draft=reconstructWorkspaceMethodDraft({workspaceId,project:project.value,works:loaded.map(row=>row.value)});
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
  return Object.freeze({draft,projectRef,workRefs:Object.freeze(workRefs),
    revisionSetVerified:true,atomicSnapshot:false,writeAuthorized:false,executionAuthority:false});
}
