// W05.1: exact input basis for one Work using original Project/Work owner
// and an already scoped original Kernel getObject port. No new executor,
// Task, Result, acceptance, storage or grant. This is a non-atomic read.
import { createHash } from 'node:crypto';
import { canonicalStringify } from '../../../persistence/canonical-codec.mjs';
import { openWorkspaceMethodStageClosure,openWorkspaceMethodCompleteClosure } from './project-process-method-readback.mjs';

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
// Build the same exact digest from a single selected closure or a complete
// current method observation. Whole-method order is the original
// dependency wave/declaration order, not an execution schedule.
function stageReport({workspaceId,projectId,stepId,closure,observedById}){
  const byStage=new Map(closure.works.map(row=>[row.work.methodology.stepId,row]));
  const selected=byStage.get(stepId);
  if(!selected)fail('METHOD_STAGE_UNKNOWN','Selected stage is not declared in the original Project');
  const ancestors=new Set();
  function include(id){
    if(ancestors.has(id))return;
    const item=byStage.get(id);
    if(!item)fail('METHOD_SOURCE_INCOMPLETE','Undeclared prerequisite Work');
    ancestors.add(id);
    for(const dep of item.work.dependencies)include(dep.predecessorWorkId.slice(projectId.length+1));
  }
  include(stepId);
  const relevant=closure.works.filter(row=>ancestors.has(row.work.methodology.stepId));
  const pins=[...new Set(relevant.flatMap(row=>row.work.methodology.materialRefs.map(pin=>pin.object_id)))].sort(order);
  const materials=Object.freeze(pins.map(id=>{
    const observed=observedById.get(id);
    if(!observed)fail('METHOD_STAGE_MATERIAL_IDENTITY_MISMATCH','Selected material observation is missing');
    return observed;
  }));
  const work=selected.work;
  const predecessors=Object.freeze(work.dependencies.map(dep=>{
    const id=dep.predecessorWorkId.slice(projectId.length+1);
    return Object.freeze({stepId:id,workRef:byStage.get(id).workRef,acceptedResultRef:null,state:'ORIGINAL_RESULT_OWNER_REQUIRED'});
  }));
  const closureRefs=Object.freeze(relevant.map(row=>Object.freeze({stepId:row.work.methodology.stepId,workRef:row.workRef})));
  const current=materials.every(row=>row.state==='CURRENT');
  const basis=Object.freeze({workspaceId,projectId,stepId,projectRef:closure.projectRef,stageRef:selected.workRef,
    prerequisiteClosure:closureRefs,materialRefs:Object.freeze(materials.map(row=>row.current)),
    objective:closure.project.methodology.objective,domainApplicability:Object.freeze([...closure.project.domainApplicability]),
    intendedActor:work.methodology.intendedActor,instruction:work.methodology.instruction});
  const inputBasisDigest=current?createHash('sha256').update(canonicalStringify(basis)).digest('hex'):null;
  return Object.freeze({schema:'IWXA_T2_WORKSPACE_METHOD_STAGE_INPUT_BASIS_V1',
    state:current?'INPUT_REFERENCES_VERIFIED':'MATERIAL_REVIEW_REQUIRED',basis,inputBasisDigest,
    materials,predecessors,requiredResultOwnerReadback:predecessors.length>0,
    selectedClosureVerified:true,completeMethodCurrentVerified:closure.completeMethodCurrentVerified===true,
    unrelatedHeadsNotRead:closure.completeMethodCurrentVerified!==true,
    atomicSnapshot:false,writeAuthorized:false,executionAuthority:false,resultReuseProven:false});
}
async function openInputObservation({owner,readObject,workspaceId,projectId,expected,stepId},wholeMethod){
  if(!text(workspaceId)||!text(projectId)||(!wholeMethod&&(typeof stepId!=='string'||!/^[A-Za-z0-9_-]{1,63}$/u.test(stepId)))
      ||typeof readObject!=='function'){
    fail('METHOD_STAGE_INPUT_INVALID','Original method owner, addressed material port and exact scope required');
  }
  const selected=selection(expected),args={owner,workspaceId,projectId,expected:selected,stepId};
  const closure=await (wholeMethod?openWorkspaceMethodCompleteClosure(args):openWorkspaceMethodStageClosure(args));
  const pins=new Set(closure.works.flatMap(row=>row.work.methodology.materialRefs.map(pin=>pin.object_id)));
  const chosen=closure.project.methodology.materialRefs.filter(pin=>pins.has(pin.object_id))
    .sort((a,b)=>order(a.object_id,b.object_id));
  const readMaterials=()=>Promise.all(chosen.map(pin=>observeMaterial(readObject,workspaceId,pin)));
  const materials=Object.freeze(await readMaterials());
  await closure.verifyCurrent();
  const revalidate=async(code='METHOD_STAGE_MATERIAL_CHANGED')=>{
    if(!equal(materials,await readMaterials()))fail(code,'A selected material changed during addressed readback');
    await closure.verifyCurrent();
  };
  await revalidate();
  const observedById=new Map(materials.map(row=>[row.object_id,row]));
  const reportFor=id=>stageReport({workspaceId,projectId,stepId:id,closure,observedById});
  return {closure,materials,reportFor,revalidate};
}
async function openStageInputObservation(input={}){
  const stepId=input.stepId;
  const observation=await openInputObservation({...input,stepId},false);
  return {report:observation.reportFor(stepId),revalidate:observation.revalidate};
}
export async function readWorkspaceMethodStageInputBasis(input){
  return (await openStageInputObservation(input)).report;
}

/** W05.5: all Work input observations in ONE bounded complete-method read.
 * Does not interpret predecessor execution, compute a schedule or declare
 * readiness to launch. Reuse the original selected-stage digest algorithm.
 * The caller selects the exact complete current method; unrelated histories
 * are never enumerated. Material payloads and full basis per stage are not
 * copied into the overview.
 */
export async function readWorkspaceMethodInputOverview(input={}){
  const {workspaceId,projectId}=input;
  const observation=await openInputObservation(input,true);
  const {closure,materials,reportFor}=observation;
  const rowsById=new Map(closure.works.map(row=>[row.work.workId,row]));
  // Display order is the original Project order, not the topological order.
  const stages=Object.freeze(closure.project.methodology.workIds.map(id=>{
    const row=rowsById.get(id),report=reportFor(row.work.methodology.stepId);
    const state=report.state!=='INPUT_REFERENCES_VERIFIED'?'MATERIAL_REVIEW_REQUIRED':
      report.predecessors.length?'PREDECESSOR_RESULTS_REQUIRED':'INPUT_REFERENCES_VERIFIED';
    return Object.freeze({stepId:row.work.methodology.stepId,name:row.work.name,actor:row.work.methodology.intendedActor,
      workRef:row.workRef,state,inputBasisDigest:report.inputBasisDigest,
      directPredecessorStepIds:Object.freeze(report.predecessors.map(p=>p.stepId)),
      prerequisiteCount:report.basis.prerequisiteClosure.length-1,
      materialIssues:Object.freeze(report.materials.filter(material=>material.state!=='CURRENT').map(material=>material.object_id))});
  }));
  const counts=Object.freeze({
    total:stages.length,
    inputReferencesVerified:stages.filter(row=>row.inputBasisDigest!==null).length,
    materialReviewRequired:stages.filter(row=>row.state==='MATERIAL_REVIEW_REQUIRED').length,
    predecessorResultsRequired:stages.filter(row=>row.state==='PREDECESSOR_RESULTS_REQUIRED').length,
    rootInputsVerified:stages.filter(row=>row.state==='INPUT_REFERENCES_VERIFIED').length,
  });
  return Object.freeze({schema:'IWXA_T2_WORKSPACE_METHOD_INPUT_OVERVIEW_V1',workspaceId,projectId,
    projectRef:closure.projectRef,stages,materials,counts,completeMethodCurrentVerified:true,
    atomicSnapshot:false,writeAuthorized:false,executionAuthority:false,resultReuseProven:false,
    executionStatusObserved:false});
}


// W05.8: explicit bounded content evidence over original Kernel reads.
// This is NOT a new material store, package format, or signed Task binding.
// Catalog visibility remains the original passport/Access owner's decision.
export const WORKSPACE_METHOD_MATERIAL_EVIDENCE_LIMITS=Object.freeze({
  materials:128,assets:128,assetBytes:32*1024*1024,canonicalBytes:8*1024*1024,
});
function assetMetadata(row,workspaceId,objectId){
  if(!row||row.workspace_id!==workspaceId||row.object_id!==objectId
      ||!text(row.asset_id)||!text(row.mime)||!text(row.service_id)
      ||!text(row.created_at)||!text(row.updated_at)||!text(row.updated_by_service)
      ||!Number.isSafeInteger(row.revision)||row.revision<1
      ||!Number.isSafeInteger(row.size)||row.size<0){
    fail('METHOD_MATERIAL_ASSET_IDENTITY_MISMATCH','Original Asset metadata does not match the selected material');
  }
  return Object.freeze({workspace_id:row.workspace_id,object_id:row.object_id,asset_id:row.asset_id,
    revision:row.revision,mime:row.mime,size:row.size,service_id:row.service_id,
    created_at:row.created_at,updated_at:row.updated_at,updated_by_service:row.updated_by_service});
}
function materialPayloadDigest(object,budget){
  let canonical;
  try{
    if(!Object.hasOwn(object,'data')||!Object.hasOwn(object,'extensions'))
      fail('METHOD_MATERIAL_CONTENT_UNSUPPORTED','Original material payload and extensions required');
    canonical=canonicalStringify({data:object.data,extensions:object.extensions});
  }catch{
    fail('METHOD_MATERIAL_CONTENT_UNSUPPORTED','Original material is not supported by the existing canonical codec');
  }
  budget.canonicalBytes+=Buffer.byteLength(canonical,'utf8');
  if(budget.canonicalBytes>WORKSPACE_METHOD_MATERIAL_EVIDENCE_LIMITS.canonicalBytes)
    fail('METHOD_MATERIAL_EVIDENCE_BUDGET_EXCEEDED','Explicit material content evidence exceeds its bound');
  return createHash('sha256').update(canonical).digest('hex');
}
async function readVisibleMaterialEvidence({readObject,listAssets,getAsset,workspaceId,materials}){
  const limits=WORKSPACE_METHOD_MATERIAL_EVIDENCE_LIMITS;
  if(materials.length>limits.materials)fail('METHOD_MATERIAL_EVIDENCE_BUDGET_EXCEEDED','Too many materials for one observation');
  const budget={assets:0,assetBytes:0,canonicalBytes:0},seenAssets=new Set(),rows=[];
  // Sequential addressed reads bound the retained bytes. No whole-Workspace
  // enumeration and no material payload or attachment bytes in the report.
  for(const selected of materials){
    const current=selected.current,object=(await readObject(workspaceId,selected.object_id))?.object;
    if(!object||object.deleted===true||object.deleted_at!=null||!current
        ||['workspace_id','object_id','schema_id','schema_version','revision'].some(key=>object[key]!==current[key])){
      fail('METHOD_MATERIAL_CONTENT_CHANGED','Original material reference changed during content observation');
    }
    const payloadDigest=materialPayloadDigest(object,budget);
    const list=await listAssets({workspace_id:workspaceId,object_id:selected.object_id});
    if(!Array.isArray(list))fail('METHOD_MATERIAL_ASSET_IDENTITY_MISMATCH','Original addressed Asset listing required');
    budget.assets+=list.length;
    if(budget.assets>limits.assets)fail('METHOD_MATERIAL_EVIDENCE_BUDGET_EXCEEDED','Too many visible Assets for one observation');
    const metadata=list.map(row=>assetMetadata(row,workspaceId,selected.object_id)).sort((a,b)=>order(a.asset_id,b.asset_id));
    const assets=[];
    for(const asset of metadata){
      if(seenAssets.has(asset.asset_id))fail('METHOD_MATERIAL_ASSET_IDENTITY_MISMATCH','Duplicate visible Asset reference');
      seenAssets.add(asset.asset_id);
      budget.assetBytes+=asset.size;
      if(budget.assetBytes>limits.assetBytes)fail('METHOD_MATERIAL_EVIDENCE_BUDGET_EXCEEDED','Visible Asset bytes exceed the observation bound');
    }
    // Validate the entire addressed listing before reading attachment bytes.
    for(const asset of metadata){
      const actual=await getAsset(workspaceId,asset.asset_id);
      if(!actual||!equal(assetMetadata(actual.asset,workspaceId,selected.object_id),asset)
          ||!(actual.bytes instanceof Uint8Array)||actual.bytes.byteLength!==asset.size){
        fail('METHOD_MATERIAL_ASSET_CHANGED','Original Asset readback differs from the addressed listing');
      }
      assets.push(Object.freeze({...asset,sha256:createHash('sha256').update(actual.bytes).digest('hex')}));
    }
    rows.push(Object.freeze({reference:current,payloadDigest,visibleAssets:Object.freeze(assets)}));
  }
  return Object.freeze({materials:Object.freeze(rows),counts:Object.freeze({materials:rows.length,
    assets:budget.assets,assetBytes:budget.assetBytes,canonicalBytes:budget.canonicalBytes})});
}
export async function inspectWorkspaceMethodMaterialEvidence(input={}){
  if(typeof input.listAssets!=='function'||typeof input.getAsset!=='function')
    fail('METHOD_MATERIAL_ASSET_OWNER_REQUIRED','Original addressed Asset read ports required');
  const {readObject,listAssets,getAsset,workspaceId}=input;
  const observation=await openStageInputObservation(input),stageInput=observation.report;
  if(stageInput.inputBasisDigest===null)return materialEvidenceReport(stageInput,null);
  const args={readObject,listAssets,getAsset,workspaceId,materials:stageInput.materials};
  const first=await readVisibleMaterialEvidence(args);
  await observation.revalidate('METHOD_MATERIAL_CONTENT_CHANGED');
  const second=await readVisibleMaterialEvidence(args);
  await observation.revalidate('METHOD_MATERIAL_CONTENT_CHANGED');
  if(!equal(first,second))fail('METHOD_MATERIAL_CONTENT_CHANGED','Material content or visible Assets changed during observation');
  return materialEvidenceReport(stageInput,first);
}
function materialEvidenceReport(stageInput,observation){
  const materialEvidenceDigest=observation?createHash('sha256').update(canonicalStringify({
    inputBasisDigest:stageInput.inputBasisDigest,observation})).digest('hex'):null;
  return Object.freeze({schema:'IWXA_T2_WORKSPACE_METHOD_MATERIAL_EVIDENCE_V1',
    state:observation?'VISIBLE_MATERIAL_CONTENT_OBSERVED':'MATERIAL_REVIEW_REQUIRED',
    stageInput,materialEvidenceDigest,observation,atomicSnapshot:false,allAssetsProven:false,
    contentBindingProven:false,exactInputBindingProven:false,writeAuthorized:false,
    executionAuthority:false,resultReuseProven:false,dispatchAuthorized:false});
}

// W05.2: the existing installed original Agent accepted-result owner
// already exposes readAccepted for a published, explicitly selected
// original Result. Its current contract binds Work number, signed Task,
// acceptance and archive, but not the canonical Project/Work recordId or
// W05 input-basis digest. Never turn that distinction into reuse authority.
const AGENT_RESULT_SCHEMA='iwxa.agent.accepted-result';
const AGENT_RESULT_SCHEMA_VERSION='1.0.0';
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
      ||o.schema_version!==AGENT_RESULT_SCHEMA_VERSION||!Number.isSafeInteger(o.revision)||o.revision<1){
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
  // Fence the addressed publication across the asynchronous native read.
  // The installed original owner remains the acceptance authority.
  const confirmed=await readObject(workspaceId,reference.object_id);
  const latest=confirmed?.object;
  if(!latest||latest.workspace_id!==workspaceId||latest.object_id!==reference.object_id
      ||latest.schema_id!==reference.schema_id||latest.schema_version!==AGENT_RESULT_SCHEMA_VERSION
      ||latest.revision!==reference.revision||latest.deleted===true||latest.deleted_at!=null){
    fail('METHOD_STAGE_RESULT_CHANGED','Original publication changed during accepted Result readback');
  }
  const published=latest.data;
  if(!o.data||!published||!equal(workNumber(o.data.workRef),workNumber(published.workRef))
      ||['taskId','resultId','acceptedDigest','signedTaskId','signedTaskRevisionId','signedTaskPackageSha256','contextDigest']
        .some(key=>o.data[key]!==published[key])){
    fail('METHOD_STAGE_RESULT_CHANGED','Original publication binding changed during accepted Result readback');
  }
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
export async function inspectWorkspaceMethodAgentPredecessorResults(input={}){
  return inspectStageResults(input,null);
}
async function inspectStageResults({
  owner,readObject,readAccepted,workspaceId,projectId,expected,stepId,resultSelections=[]
},nativeRequest,materialRequest=null){
  const selected=selection(expected),selections=captureResultSelections(resultSelections,workspaceId);
  if(selections.length&&typeof readAccepted!=='function')fail('METHOD_STAGE_RESULT_OWNER_REQUIRED','Original installed Agent accepted Result read port required');
  const args={owner,readObject,workspaceId,projectId,expected:selected,stepId};
  const observation=await openStageInputObservation(args),initial=observation.report;
  const byStep=new Map(initial.predecessors.map(row=>[row.stepId,row]));
  if(selections.some(row=>!byStep.has(row.stepId))){
    fail('METHOD_STAGE_RESULT_SELECTION_INVALID','Only direct declared predecessor Results may be selected');
  }
  if(nativeRequest&&!byStep.has(nativeRequest.predecessorStepId)){
    fail('METHOD_STAGE_NATIVE_PREDECESSOR_REQUIRED','Only a direct declared predecessor can be inspected for native continuation');
  }
  const flags={atomicSnapshot:false,executionAuthority:false,resultReuseProven:false,writeAuthorized:false,
    exactInputBindingProven:false,originalExecutionOwnerRequired:true};
  if(initial.state!=='INPUT_REFERENCES_VERIFIED'){
    return Object.freeze({state:'MATERIAL_REVIEW_REQUIRED',stageInput:initial,results:Object.freeze([]),...flags,
      ...(materialRequest?{materialEvidence:null}:{}),
      ...(nativeRequest?{nativeContinuation:null,nativeContinuationState:'MATERIAL_REVIEW_REQUIRED',targetWorkBound:false,dispatchAuthorized:false}:{})});
  }
  const bySelection=new Map(selections.map(row=>[row.stepId,row.reference]));
  const observe=()=>Promise.all(initial.predecessors.map(predecessor=>{
    const reference=bySelection.get(predecessor.stepId);
    return reference?observeAgentResult({readObject,readAccepted,workspaceId,projectId,predecessor,reference})
      :Object.freeze({stepId:predecessor.stepId,workRef:predecessor.workRef,reference:null,
        accepted:null,state:'ORIGINAL_RESULT_OWNER_REQUIRED',exactInputBindingProven:false});
  }));
  const results=await observe();
  // D6 is a read-only observation of an existing recipient route here.
  // It must finish between the same original source/material/Result fences.
  let nativeObservation=null;
  if(nativeRequest){
    const source=results.find(row=>row.stepId===nativeRequest.predecessorStepId);
    if(source?.state==='ACCEPTED_WORK_NUMBER_MATCHED_INPUT_BINDING_UNPROVEN'){
      nativeObservation=await observeNativeContinuation(nativeRequest,source);
    }
  }
  // W05.9: one selected source observation for the combined handoff.
  // Do not read attachment bytes for a Work with unresolved predecessors.
  // Both Result observations surround the two complete material reads.
  // This is a bounded, non-atomic observation, never a signed Task.
  let materialEvidence=null,materialFirst=null;
  const canObserveContent=materialRequest&&results.every(row=>row.state==='ACCEPTED_WORK_NUMBER_MATCHED_INPUT_BINDING_UNPROVEN');
  const materialArgs=canObserveContent?{readObject,workspaceId,materials:initial.materials,...materialRequest}:null;
  if(materialArgs)materialFirst=await readVisibleMaterialEvidence(materialArgs);
  await observation.revalidate('METHOD_STAGE_RESULT_BASIS_CHANGED');
  if(materialArgs){
    const second=await readVisibleMaterialEvidence(materialArgs);
    if(!equal(materialFirst,second))fail('METHOD_MATERIAL_CONTENT_CHANGED','Material content or visible Assets changed during combined handoff observation');
    materialEvidence=materialEvidenceReport(initial,materialFirst);
  }
  const confirmed=await observe();
  if(!equal(results,confirmed))fail('METHOD_STAGE_RESULT_CHANGED','Original accepted Result observation changed during inspection');
  await observation.revalidate('METHOD_STAGE_RESULT_BASIS_CHANGED');
  const state=results.some(r=>['RESULT_UNAVAILABLE','RESULT_REVISION_CHANGED','ACCEPTED_OLDER_OR_OTHER_WORK_REVISION'].includes(r.state))
    ?'PREDECESSOR_RESULT_REVIEW_REQUIRED':results.some(r=>r.state==='ORIGINAL_RESULT_OWNER_REQUIRED')
      ?'PREDECESSOR_RESULTS_REQUIRED':results.length?'ACCEPTED_RESULTS_OBSERVED_INPUT_BINDING_UNPROVEN':'NO_PREDECESSOR_RESULTS_REQUIRED';
  return Object.freeze({state,stageInput:initial,results:Object.freeze(results),...flags,
    ...(materialRequest?{materialEvidence}:{}),
    ...(nativeRequest?{nativeContinuation:nativeObservation,
      nativeContinuationState:nativeObservation?'ORIGINAL_RECIPIENT_OBSERVED_TARGET_WORK_BINDING_UNPROVEN':'PREDECESSOR_RESULT_NOT_AVAILABLE',
      targetWorkBound:false,dispatchAuthorized:false}:{})});
}


// W05.6. A source-owned handoff PREVIEW, not a new Task/Exchange contract.
// The original executor must later sign/validate the exact input binding,
// including actual content/assets and its native execution identity.
export async function previewWorkspaceMethodStageHandoff(input={}){
  const {includeMaterialEvidence=false,listAssets,getAsset}=input;
  if(typeof includeMaterialEvidence!=='boolean')
    fail('METHOD_MATERIAL_EVIDENCE_REQUEST_INVALID','Explicit content evidence selection required');
  if(includeMaterialEvidence&&(typeof listAssets!=='function'||typeof getAsset!=='function'))
    fail('METHOD_MATERIAL_ASSET_OWNER_REQUIRED','Original addressed Asset read ports required');
  const inspection=includeMaterialEvidence?
    await inspectStageResults(input,null,Object.freeze({listAssets,getAsset})):
    await inspectWorkspaceMethodAgentPredecessorResults(input);
  const materialEvidence=inspection.materialEvidence??null;
  const {stageInput,results}=inspection,basis=stageInput.basis;
  const actor=basis.intendedActor;
  const needs=Object.freeze([
    'EXACT_MATERIAL_CONTENT_AND_ASSET_BINDING',
    ...(stageInput.predecessors.length?['EXACT_PREDECESSOR_RESULT_INPUT_BINDING']:[]),
    ...(actor==='agent'?['ORIGINAL_SIGNED_TASK_BINDING','CURRENT_MODEL_AND_AUTHORITY']:
      actor==='program'?['EXPLICIT_PROGRAM_OPERATION_AND_ARGUMENTS','CURRENT_CONNECTION_AND_TOOL_APPROVAL']:
        ['HUMAN_REVIEW_AND_ORIGINAL_RESULT_OWNER'])
  ]);
  const complete=stageInput.inputBasisDigest!==null&&results.length===stageInput.predecessors.length
    &&results.every(row=>row.state==='ACCEPTED_WORK_NUMBER_MATCHED_INPUT_BINDING_UNPROVEN')
    &&(!includeMaterialEvidence||materialEvidence?.materialEvidenceDigest!=null);
  const binding=complete?Object.freeze({
    schema:'IWXA_T2_WORKSPACE_METHOD_HANDOFF_PREVIEW_V1',
    workspaceId:basis.workspaceId,projectId:basis.projectId,stepId:basis.stepId,
    projectRef:basis.projectRef,workRef:basis.stageRef,intendedActor:actor,
    inputBasisDigest:stageInput.inputBasisDigest,
    ...(includeMaterialEvidence?{materialEvidenceDigest:materialEvidence.materialEvidenceDigest}:{}),
    predecessorResults:Object.freeze(results.map(row=>Object.freeze({stepId:row.stepId,
      canonicalWorkRef:row.workRef,accepted:row.accepted}))),
  }):null;
  const candidateDigest=binding?createHash('sha256').update(canonicalStringify(binding)).digest('hex'):null;
  const state=!complete?inspection.state:stageInput.predecessors.length?
    'PRIOR_RESULTS_OBSERVED_EXACT_BINDING_REQUIRED':'INPUTS_PREPARED_OWNER_SELECTION_REQUIRED';
  return Object.freeze({schema:'IWXA_T2_WORKSPACE_METHOD_STAGE_HANDOFF_PREVIEW_V1',state,
    inspection,binding,candidateDigest,requiredOriginalOwnerChecks:needs,
    ...(includeMaterialEvidence?{materialEvidenceRequested:true,materialEvidence}:{}),
    signedTaskIssued:false,taskCreated:false,contentBindingProven:false,exactInputBindingProven:false,
    dispatchAuthorized:false,executionAuthority:false,writeAuthorized:false,resultReuseProven:false,atomicSnapshot:false});
}

// W07.1. Reuse the existing trusted D6 recipient preview/recovery port.
// The existing D6 transfer binds the source Object and recipient, but NOT
// the exact target canonical Work. No new transfer or dispatcher here.
const NATIVE_ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
function nativePreviewReport(value,reference,recipientId){
  if(!value||value.recipientId!==recipientId||!NATIVE_ID.test(value.operationId??'')
      ||!['AVAILABLE','RECOVER_ONLY','OPERATION_IN_PROGRESS'].includes(value.status)
      ||!equal(resultRef(value.reference,reference.workspace_id),reference)){
    fail('METHOD_STAGE_NATIVE_PREVIEW_MISMATCH','Original D6 recipient preview must match exact selected source and recipient');
  }
  return Object.freeze({status:value.status,operationId:value.operationId,recipientId,reference});
}
async function observeNativeContinuation(request,source){
  const reference=source.reference;
  const preview=nativePreviewReport(await request.port.preview(reference),reference,request.recipientId);
  let receipt=null;
  if(request.recover){
    const raw=await request.port.recover(reference);
    if(!raw||raw.operationId!==preview.operationId||!['OWNER_READBACK_CONFIRMED','OUTCOME_UNKNOWN'].includes(raw.status)){
      fail('METHOD_STAGE_NATIVE_RECEIPT_MISMATCH','Original D6 recovery must address the previewed operation');
    }
    if(raw.status==='OWNER_READBACK_CONFIRMED'){
      if(raw.recipientId!==request.recipientId||!NATIVE_ID.test(raw.resultRef??'')
          ||!equal(resultRef(raw.reference,reference.workspace_id),reference)){
        fail('METHOD_STAGE_NATIVE_RECEIPT_MISMATCH','Original D6 receipt identity mismatch');
      }
      receipt=Object.freeze({status:raw.status,operationId:raw.operationId,recipientId:request.recipientId,
        resultRef:raw.resultRef,reference});
    }else receipt=Object.freeze({status:raw.status,operationId:raw.operationId});
  }
  return Object.freeze({predecessorStepId:source.stepId,sourceWorkRef:source.workRef,preview,receipt,
    targetWorkBound:false,dispatchAuthorized:false,recipientAcceptanceDoesNotProveWorkCompletion:true});
}
export async function inspectWorkspaceMethodNativeContinuation({nativeContinuation,recipientId,
  predecessorStepId,recover=false,...input}={}){
  if(typeof predecessorStepId!=='string'||!/^[A-Za-z0-9_-]{1,63}$/u.test(predecessorStepId)
      ||typeof recipientId!=='string'||!NATIVE_ID.test(recipientId)
      ||typeof nativeContinuation?.preview!=='function'||typeof recover!=='boolean'
      ||(recover&&typeof nativeContinuation.recover!=='function')){
    fail('METHOD_STAGE_NATIVE_OWNER_REQUIRED','Trusted original D6 recipient port and explicit predecessor required');
  }
  return inspectStageResults(input,Object.freeze({predecessorStepId,recipientId,recover,port:nativeContinuation}));
}
