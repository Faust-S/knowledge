import { CanonicalInstant } from '../../../foundation/time.mjs';
import { canonicalStringify } from '../../../persistence/canonical-codec.mjs';
import { normalizeProject, normalizeWork } from '../features/project-process/project-process.mjs';
import { prepareWorkspaceMethodSourceInputs } from '../features/workspace/workspace-project-method.mjs';
import { projectProcessSourceObjectId } from './project-process-source-owner.mjs';
import { projectProcessSourceBinding } from './project-process-source-contract.mjs';
import { readWorkspaceMethodFromSourceOwner } from './project-process-method-readback.mjs';

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

/** Build immutable inputs for the original owner create operations.
 * recordIds and knowledgeAt belong to this exact creation attempt. Retrying
 * requires the same values and identical method; never allocate fresh IDs
 * on an ambiguous outcome. This is not a persisted journal or a grant.
 */
function prepareEntries({workspaceId,objects,draft,recordIds,knowledgeAt}){
  const plan=prepareWorkspaceMethodSourceInputs({workspaceId,objects,draft});
  if(!sameKeys(recordIds,['project','works']) || !sameKeys(recordIds.works,plan.writeOrder)){
    fail('METHOD_SOURCE_RECORD_ID_INVALID','Exactly one record ID per declared Project and Work is required');
  }
  const instant=knowledgeAt instanceof CanonicalInstant?knowledgeAt:CanonicalInstant.parse(knowledgeAt);
  const entry=(kind,id,input,idValue)=>{
    const binding=projectProcessSourceBinding(kind);
    return {kind,id,input,recordId:recordId(idValue),objectId:projectProcessSourceObjectId(kind,workspaceId,id),
      family:binding.family,payload:kind==='project'?normalizeProject(input):normalizeWork(input)};
  };
  const p=entry('project',plan.projectInput.projectId,plan.projectInput,recordIds.project);
  const inputs=new Map(plan.workInputs.map(input=>[input.workId,input]));
  const entries=[p,...plan.writeOrder.map(id=>entry('work',id,inputs.get(id),recordIds.works[id]))];
  if(new Set(entries.map(item=>item.recordId)).size!==entries.length){
    fail('METHOD_SOURCE_RECORD_ID_INVALID','Source record IDs must be distinct');
  }
  const byId=new Map(entries.slice(1).map(item=>[item.id,item]));
  const ref=item=>({family:item.family,objectId:item.objectId,recordId:item.recordId});
  for(const item of entries){
    const heads=item.kind==='project'?{}:{project:ref(p),
      ...Object.fromEntries(item.payload.dependencies.map(dep=>['predecessor:'+dep.predecessorWorkId,ref(byId.get(dep.predecessorWorkId))]))};
    item.expectedRefs={workspaceId,canonicalHeads:heads};
  }
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
export async function createWorkspaceMethodThroughSourceOwner({owner,workspaceId,objects,draft,recordIds,knowledgeAt}){
  if(!owner || ['create','load','history'].some(name=>typeof owner[name]!=='function')){
    fail('METHOD_SOURCE_OWNER_REQUIRED','Original Project/Process source owner port required');
  }
  const {entries,instant,projectId}=prepareEntries({workspaceId,objects,draft,recordIds,knowledgeAt});
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
    }else if((await owner.history(item.kind,workspaceId,item.id)).length!==0){
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
      await owner.create(item.kind,{...item.input,recordId:item.recordId,knowledgeAt:instant});
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
