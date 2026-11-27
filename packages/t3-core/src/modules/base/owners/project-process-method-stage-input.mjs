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


// W05.2: the existing installed original Agent accepted-result owner
// already exposes readAccepted for a published, explicitly selected
// original Result. Its current contract binds Work number, signed Task,
// acceptance and archive, but not the canonical Project/Work recordId or
// W05 input-basis digest. Never turn that distinction into reuse authority.
const AGENT_RESULT_SCHEMA='iwxa.agent.accepted-result';
const HEX=/^[a-f0-9]{64}$/;
function resultRef(value,workspaceId){
  if(!value||value.workspace_id!==workspaceId||!text(value.object_id)
      ||value.schema_id!==AGENT_RESULT_SCHEMA||!Number.isSafeInteger(value.revision)||value.revision<1){
    fail('METHOD_STAGE_RESULT_SELECTION_INVALID','Exact published original Agent Result reference required');
  }
  return Object.freeze({workspace_id:workspaceId,object_id:value.object_id,schema_id:value.schema_id,revision:value.revision});
}
function captureResultSelections(values,workspaceId){
  if(!Array.isArray(values)||values.length>64)fail('METHOD_STAGE_RESULT_SELECTION_INVALID','Explicit predecessor Result selections required');
  const rows=Array.from(values,row=>{
    if(!row||typeof row.stepId!=='string'||!/^[A-Za-z0-9_-]{1,63}$/u.test(row.stepId)){
      fail('METHOD_STAGE_RESULT_SELECTION_INVALID','Exact predecessor stage required');
    }
    return Object.freeze({stepId:row.stepId,reference:resultRef(row.reference,workspaceId)});
  });
  if(new Set(rows.map(r=>r.stepId)).size!==rows.length||new Set(rows.map(r=>r.reference.object_id)).size!==rows.length){
    fail('METHOD_STAGE_RESULT_SELECTION_INVALID','Duplicate predecessor or published Result selection');
  }
  return Object.freeze(rows);
}
function workNumber(value){
  if(!value||!text(value.projectId)||!text(value.workId)||typeof value.revision!=='string'
      ||! /^[1-9][0-9]*$/.test(value.revision)||!Number.isSafeInteger(Number(value.revision))){
    fail('METHOD_STAGE_RESULT_BINDING_INVALID','Original Agent Work revision binding required');
  }
  return Object.freeze({projectId:value.projectId,workId:value.workId,revision:value.revision});
}
function acceptedMetadata(value,reference){
  if(!value||value.acceptanceKind!=='HUMAN_ACCEPTED_DRAFT'||value.readOnly!==true
      ||!equal(resultRef(value.sourceObjectRef,reference.workspace_id),reference)
      ||!text(value.taskId)||!text(value.resultId)||!HEX.test(value.acceptedDigest??'')||!HEX.test(value.archiveSha256??'')){
    fail('METHOD_STAGE_RESULT_OWNER_READBACK_INVALID','Exact original accepted Result owner readback required');
  }
  return Object.freeze({acceptanceKind:value.acceptanceKind,sourceObjectRef:reference,
    workRef:workNumber(value.workRef),taskId:value.taskId,resultId:value.resultId,
    acceptedDigest:value.acceptedDigest,archiveSha256:value.archiveSha256});
}
async function observeAgentResult({readObject,readAccepted,workspaceId,projectId,predecessor,reference}){
  const row=await readObject(workspaceId,reference.object_id);
  if(row===null)return Object.freeze({stepId:predecessor.stepId,workRef:predecessor.workRef,
    reference,state:'RESULT_UNAVAILABLE',accepted:null,exactInputBindingProven:false});
  const o=row?.object;
  if(!o||o.workspace_id!==workspaceId||o.object_id!==reference.object_id||o.schema_id!==reference.schema_id
      ||!Number.isSafeInteger(o.revision)||o.revision<1){
    fail('METHOD_STAGE_RESULT_IDENTITY_MISMATCH','Original Kernel returned a different Result identity');
  }
  if(o.deleted===true||o.deleted_at!=null||o.revision!==reference.revision){
    return Object.freeze({stepId:predecessor.stepId,workRef:predecessor.workRef,reference,
      state:o.deleted===true||o.deleted_at!=null?'RESULT_UNAVAILABLE':'RESULT_REVISION_CHANGED',
      accepted:null,exactInputBindingProven:false});
  }
  // Only original signed Kernel readback may precede the native owner
  // call. Neither the published metadata nor a caller assertion is an
  // acceptance decision. No private Result summary is returned.
  const accepted=acceptedMetadata(await readAccepted(reference),reference);
  const published=o.data;
  if(!published||!equal(workNumber(published.workRef),accepted.workRef)
      ||['taskId','resultId','acceptedDigest'].some(k=>published[k]!==accepted[k])){
    fail('METHOD_STAGE_RESULT_OWNER_READBACK_INVALID','Published original Object and accepted owner disagree');
  }
  if(accepted.workRef.projectId!==projectId||accepted.workRef.workId!==projectId+'.'+predecessor.stepId){
    fail('METHOD_STAGE_RESULT_WORK_MISMATCH','Selected Result belongs to another original Work');
  }
  return Object.freeze({stepId:predecessor.stepId,workRef:predecessor.workRef,reference,accepted,
    state:accepted.workRef.revision===String(predecessor.workRef.revision)
      ?'ACCEPTED_WORK_NUMBER_MATCHED_INPUT_BINDING_UNPROVEN':'ACCEPTED_OLDER_OR_OTHER_WORK_REVISION',
    exactInputBindingProven:false});
}
export async function inspectWorkspaceMethodAgentPredecessorResults({
  owner,readObject,readAccepted,workspaceId,projectId,expected,stepId,resultSelections=[]
}={}){
  if(typeof readAccepted!=='function')fail('METHOD_STAGE_RESULT_OWNER_REQUIRED','Original installed Agent accepted Result read port required');
  const selected=selection(expected),selections=captureResultSelections(resultSelections,workspaceId);
  const args={owner,readObject,workspaceId,projectId,expected:selected,stepId};
  const initial=await readWorkspaceMethodStageInputBasis(args);
  const byStep=new Map(initial.predecessors.map(row=>[row.stepId,row]));
  if(selections.some(row=>!byStep.has(row.stepId))){
    fail('METHOD_STAGE_RESULT_SELECTION_INVALID','Only direct declared predecessor Results may be selected');
  }
  const flags={atomicSnapshot:false,executionAuthority:false,resultReuseProven:false,writeAuthorized:false,
    exactInputBindingProven:false,originalExecutionOwnerRequired:true};
  if(initial.state!=='INPUT_REFERENCES_VERIFIED'){
    return Object.freeze({state:'MATERIAL_REVIEW_REQUIRED',stageInput:initial,results:Object.freeze([]),...flags});
  }
  const bySelection=new Map(selections.map(row=>[row.stepId,row.reference]));
  const observe=()=>Promise.all(initial.predecessors.map(predecessor=>{
    const reference=bySelection.get(predecessor.stepId);
    return reference?observeAgentResult({readObject,readAccepted,workspaceId,projectId,predecessor,reference})
      :Object.freeze({stepId:predecessor.stepId,workRef:predecessor.workRef,reference:null,
        accepted:null,state:'ORIGINAL_RESULT_OWNER_REQUIRED',exactInputBindingProven:false});
  }));
  const results=await observe();
  const final=await readWorkspaceMethodStageInputBasis(args);
  if(initial.inputBasisDigest!==final.inputBasisDigest||final.state!=='INPUT_REFERENCES_VERIFIED'){
    fail('METHOD_STAGE_RESULT_BASIS_CHANGED','Exact Work/material basis changed during original Result readback');
  }
  const confirmed=await observe();
  if(!equal(results,confirmed))fail('METHOD_STAGE_RESULT_CHANGED','Original accepted Result observation changed during inspection');
  verifySelection(selected,await readWorkspaceMethodFromSourceOwner({owner,workspaceId,projectId}));
  const state=results.some(r=>['RESULT_UNAVAILABLE','RESULT_REVISION_CHANGED','ACCEPTED_OLDER_OR_OTHER_WORK_REVISION'].includes(r.state))
    ?'PREDECESSOR_RESULT_REVIEW_REQUIRED':results.some(r=>r.state==='ORIGINAL_RESULT_OWNER_REQUIRED')
      ?'PREDECESSOR_RESULTS_REQUIRED':results.length?'ACCEPTED_RESULTS_OBSERVED_INPUT_BINDING_UNPROVEN':'NO_PREDECESSOR_RESULTS_REQUIRED';
  return Object.freeze({state,stageInput:final,results:Object.freeze(results),...flags});
}
