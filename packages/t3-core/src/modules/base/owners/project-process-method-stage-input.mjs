// W05.1: exact input basis for one Work using original Project/Work owner
// and an already scoped original Kernel getObject port. No new executor,
// Task, Result, acceptance, storage or grant. This is a non-atomic read.
import { createHash } from 'node:crypto';
import { canonicalStringify } from '../../../persistence/canonical-codec.mjs';
import { describeWorkspaceMethodSourceInputs } from '../features/workspace/workspace-project-method.mjs';
import { projectProcessSourceObjectId } from './project-process-source-owner.mjs';
import { readWorkspaceMethodFromSourceOwner } from './project-process-method-readback.mjs';

function fail(code,message){throw Object.assign(new Error(message),{code});}
const text=value=>typeof value==='string'&&value.length>0&&value.trim()===value;
const equal=(a,b)=>canonicalStringify(a)===canonicalStringify(b);
const order=(a,b)=>a<b?-1:a>b?1:0;
function ref(value){
  if(!value||!text(value.family)||!text(value.objectId)||!text(value.recordId)
      ||!Number.isSafeInteger(value.revision)||value.revision<1){
    fail('METHOD_STAGE_SELECTION_INVALID','Exact original source revision required');
  }
  return Object.freeze({family:value.family,objectId:value.objectId,recordId:value.recordId,revision:value.revision});
}
function selection(value){
  if(!Array.isArray(value?.workRefs)||!value.workRefs.length||value.workRefs.length>64){
    fail('METHOD_STAGE_SELECTION_INVALID','Complete original Project/Work selection required');
  }
  const rows=Array.from(value.workRefs,ref).sort((a,b)=>order(a.objectId,b.objectId));
  if(new Set(rows.map(r=>r.objectId)).size!==rows.length)fail('METHOD_STAGE_SELECTION_INVALID','Duplicate Work reference');
  return Object.freeze({projectRef:ref(value.projectRef),workRefs:Object.freeze(rows)});
}
function verifySelection(expected,current){
  if(!equal(expected,selection(current)))fail('METHOD_STAGE_SOURCE_CHANGED','The selected complete method is no longer current');
}
async function observeMaterial(readObject,workspaceId,pin){
  const row=await readObject(workspaceId,pin.object_id);
  if(row===null)return Object.freeze({object_id:pin.object_id,revision:pin.revision,state:'UNAVAILABLE',current:null});
  const o=row?.object;
  if(!o||o.workspace_id!==workspaceId||o.object_id!==pin.object_id
      ||!Number.isSafeInteger(o.revision)||o.revision<1||!text(o.schema_id)||!text(o.schema_version)){
    fail('METHOD_STAGE_MATERIAL_IDENTITY_MISMATCH','Original Kernel material readback does not match the requested identity');
  }
  if(o.deleted===true||o.deleted_at!=null)return Object.freeze({object_id:pin.object_id,revision:pin.revision,state:'UNAVAILABLE',current:null});
  if(o.schema_id==='iwxa.workspace.internal.saved-view')fail('METHOD_STAGE_MATERIAL_IDENTITY_MISMATCH','Saved presentation is not a method material');
  const current=Object.freeze({workspace_id:o.workspace_id,object_id:o.object_id,revision:o.revision,
    schema_id:o.schema_id,schema_version:o.schema_version});
  return Object.freeze({object_id:pin.object_id,revision:pin.revision,state:o.revision===pin.revision?'CURRENT':'CHANGED',current});
}
export async function readWorkspaceMethodStageInputBasis({owner,readObject,workspaceId,projectId,expected,stepId}={}){
  if(!text(workspaceId)||!text(projectId)||typeof stepId!=='string'||!/^[A-Za-z0-9_-]{1,63}$/u.test(stepId)
      ||typeof readObject!=='function'){
    fail('METHOD_STAGE_INPUT_INVALID','Original method owner, addressed material port and exact stage required');
  }
  const selected=selection(expected);
  const live=()=>readWorkspaceMethodFromSourceOwner({owner,workspaceId,projectId});
  const method=await live();
  verifySelection(selected,method);
  const byStage=new Map(method.draft.steps.map(step=>[step.id,step]));
  if(!byStage.has(stepId))fail('METHOD_STAGE_UNKNOWN','Selected stage is not declared in the original Project');
  const closure=new Set(),visit=id=>{
    if(closure.has(id))return;closure.add(id);
    for(const predecessor of byStage.get(id).dependsOn)visit(predecessor);
  };
  visit(stepId);
  const plan=describeWorkspaceMethodSourceInputs({workspaceId,draft:method.draft});
  const byObject=new Map(method.workRefs.map(row=>[row.objectId,row]));
  const workRef=id=>ref(byObject.get(projectProcessSourceObjectId('work',workspaceId,projectId+'.'+id)));
  const stage=byStage.get(stepId);
  const ordered=plan.writeOrder.map(id=>id.slice(projectId.length+1)).filter(id=>closure.has(id));
  const pins=new Set(ordered.flatMap(id=>byStage.get(id).materialIds));
  const chosen=method.draft.materials.filter(pin=>pins.has(pin.object_id)).sort((a,b)=>order(a.object_id,b.object_id));
  const readMaterials=()=>Promise.all(chosen.map(pin=>observeMaterial(readObject,workspaceId,pin)));
  const materials=await readMaterials();
  // Revalidate after async addressed reads. This does not claim a
  // cross-owner atomic snapshot; native execution must revalidate again.
  verifySelection(selected,await live());
  const finalMaterials=await readMaterials();
  if(!equal(materials,finalMaterials))fail('METHOD_STAGE_MATERIAL_CHANGED','A selected material changed during addressed readback');
  verifySelection(selected,await live());
  const predecessors=Object.freeze(stage.dependsOn.map(id=>Object.freeze({stepId:id,workRef:workRef(id),
    acceptedResultRef:null,state:'ORIGINAL_RESULT_OWNER_REQUIRED'})));
  const stageRef=workRef(stepId),closureRefs=Object.freeze(ordered.map(id=>Object.freeze({stepId:id,workRef:workRef(id)})));
  const current=materials.every(row=>row.state==='CURRENT');
  const basis=Object.freeze({workspaceId,projectId,stepId,projectRef:ref(method.projectRef),stageRef,
    prerequisiteClosure:closureRefs,materialRefs:Object.freeze(materials.map(row=>row.current)),
    objective:method.draft.objective,domainApplicability:Object.freeze([...method.draft.domainApplicability]),
    intendedActor:stage.actor,instruction:stage.instruction});
  const inputBasisDigest=current?createHash('sha256').update(canonicalStringify(basis)).digest('hex'):null;
  return Object.freeze({schema:'IWXA_T2_WORKSPACE_METHOD_STAGE_INPUT_BASIS_V1',
    state:current?'INPUT_REFERENCES_VERIFIED':'MATERIAL_REVIEW_REQUIRED',basis,inputBasisDigest,
    materials:Object.freeze(materials),predecessors,requiredResultOwnerReadback:predecessors.length>0,
    atomicSnapshot:false,writeAuthorized:false,executionAuthority:false,resultReuseProven:false});
}
