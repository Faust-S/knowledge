import { describeWorkspaceMethodSourceInputs } from '../features/workspace/workspace-project-method.mjs';
import { projectProcessSourceObjectId } from './project-process-source-owner.mjs';
import { readHistoricalWorkspaceMethod } from './project-process-method-readback.mjs';

function fail(code,message){throw Object.assign(new Error(message),{code});}
function text(value){return typeof value==='string'&&value.trim().length>0;}
function sameSet(a,b){return a.length===b.length&&a.every(value=>b.includes(value));}
function sameArray(a,b){return a.length===b.length&&a.every((value,index)=>value===b[index]);}
function sameRef(a,b){return !!a&&!!b&&a.family===b.family&&a.objectId===b.objectId
  &&a.recordId===b.recordId&&a.revision===b.revision;}
function mapMaterials(values){return new Map(values.map(value=>[value.object_id,value.revision]));}
function materialDiff(before,after){
  const a=mapMaterials(before),b=mapMaterials(after),ids=[...new Set([...a.keys(),...b.keys()])].sort();
  return ids.filter(id=>a.get(id)!==b.get(id)).map(id=>Object.freeze({
    object_id:id,beforeRevision:a.get(id)??null,afterRevision:b.get(id)??null,
    operation:!a.has(id)?'ADDED':!b.has(id)?'REMOVED':'REVISED',
  }));
}
function readback(value,label){
  if(!value||value.revisionSetVerified!==true||!text(value.workspaceId)
      ||!text(value.draft?.projectId)||!Array.isArray(value.workRefs)){
    fail('METHOD_COMPARISON_READBACK_REQUIRED',label+' must be a verified Project/Work revision readback');
  }
  const workspaceId=value.workspaceId,projectId=value.draft.projectId;
  const structure=describeWorkspaceMethodSourceInputs({workspaceId,draft:value.draft});
  const projectRef=value.projectRef;
  if(projectRef?.family!=='iwxa.project'
      ||projectRef.objectId!==projectProcessSourceObjectId('project',workspaceId,projectId)
      ||!text(projectRef.recordId)||!Number.isSafeInteger(projectRef.revision)||projectRef.revision<1){
    fail('METHOD_COMPARISON_REVISION_SET_INVALID',label+' Project reference is invalid');
  }
  if(value.workRefs.length!==structure.workInputs.length){
    fail('METHOD_COMPARISON_REVISION_SET_INVALID',label+' Work reference count does not match the method');
  }
  const byId=new Map();
  for(const ref of value.workRefs){
    if(ref?.family!=='iwxa.work'||!text(ref.recordId)||!Number.isSafeInteger(ref.revision)||ref.revision<1
        ||byId.has(ref.objectId)){
      fail('METHOD_COMPARISON_REVISION_SET_INVALID',label+' Work reference is invalid or duplicated');
    }
    byId.set(ref.objectId,ref);
  }
  const byWorkId=new Map();
  for(const step of value.draft.steps){
    const workId=projectId+'.'+step.id;
    const objectId=projectProcessSourceObjectId('work',workspaceId,workId);
    const ref=byId.get(objectId);
    if(!ref)fail('METHOD_COMPARISON_REVISION_SET_INVALID',label+' is missing exact Work reference '+workId);
    byWorkId.set(step.id,ref);
  }
  return Object.freeze({workspaceId,projectId,draft:value.draft,structure,projectRef,workRefs:byWorkId});
}
function downstream(read,seedIds){
  const reverse=new Map(read.draft.steps.map(step=>[step.id,[]]));
  for(const step of read.draft.steps)for(const predecessor of step.dependsOn)reverse.get(predecessor)?.push(step.id);
  const result=new Set(seedIds),queue=[...seedIds];
  while(queue.length){const current=queue.shift();for(const child of reverse.get(current)??[]){
    if(!result.has(child)){result.add(child);queue.push(child);}
  }}
  return result;
}

/** Compare two explicitly selected, verified Project/Work revision sets.
 * This is semantic/read-only comparison, not a result-reuse proof, execution
 * approval, atomic snapshot, or permission to revise the source owner.
 */
export function compareWorkspaceMethodRevisions({before,after}={}){
  const a=readback(before,'before'),b=readback(after,'after');
  if(a.workspaceId!==b.workspaceId||a.projectId!==b.projectId){
    fail('METHOD_COMPARISON_SCOPE_MISMATCH','Both revisions must belong to the same Workspace and Project');
  }
  return compareReadbacks(a,b,false);
}

// This private projection is used across independent identities only after
// original historical reads have verified a direct or shared exact origin.
// Match stages by their declared stage ID, not by rewritten canonical refs.
function compareReadbacks(a,b,independent){
  const ap=a.structure.projectInput,bp=b.structure.projectInput;
  const projectChanges=[];
  const addProject=(field,left,right)=>{if(!Object.is(left,right))projectChanges.push(Object.freeze({field,before:left,after:right}));};
  addProject('NAME',ap.name,bp.name);
  addProject('OBJECTIVE',ap.methodology.objective,bp.methodology.objective);
  addProject('TEMPLATE',ap.templateRef.templateId+'@'+ap.templateRef.templateRevision,
    bp.templateRef.templateId+'@'+bp.templateRef.templateRevision);
  if(!sameSet(ap.domainApplicability,bp.domainApplicability))projectChanges.push(Object.freeze({
    field:'DOMAIN_APPLICABILITY',before:Object.freeze([...ap.domainApplicability]),after:Object.freeze([...bp.domainApplicability])}));
  const beforeWorkIds=ap.methodology.workIds,afterWorkIds=bp.methodology.workIds;
  const beforeStepIds=beforeWorkIds.map(id=>id.slice(a.projectId.length+1));
  const afterStepIds=afterWorkIds.map(id=>id.slice(b.projectId.length+1));
  const projectCompositionChanged=!sameSet(beforeStepIds,afterStepIds);
  const displayOrderChanged=!sameArray(beforeStepIds,afterStepIds);
  if(projectCompositionChanged)projectChanges.push(Object.freeze({
    field:'WORK_COMPOSITION',before:Object.freeze([...beforeWorkIds]),after:Object.freeze([...afterWorkIds])}));
  else if(displayOrderChanged)projectChanges.push(Object.freeze({
    field:'WORK_ORDER',before:Object.freeze([...beforeWorkIds]),after:Object.freeze([...afterWorkIds])}));
  const materialChanges=materialDiff(ap.methodology.materialRefs,bp.methodology.materialRefs);
  if(materialChanges.length)projectChanges.push(Object.freeze({field:'MATERIAL_REVISIONS',before:ap.methodology.materialRefs,after:bp.methodology.materialRefs}));
  const projectIntentChanged=ap.methodology.objective!==bp.methodology.objective
    ||!sameSet(ap.domainApplicability,bp.domainApplicability)
    ||ap.templateRef.templateId!==bp.templateRef.templateId
    ||ap.templateRef.templateRevision!==bp.templateRef.templateRevision
    ||projectCompositionChanged;

  const oldSteps=new Map(a.draft.steps.map(step=>[step.id,step]));
  const newSteps=new Map(b.draft.steps.map(step=>[step.id,step]));
  const stepIds=[...new Set([...beforeWorkIds.map(id=>id.slice(a.projectId.length+1)),
    ...afterWorkIds.map(id=>id.slice(b.projectId.length+1))])];
  const stepChanges=[];
  for(const id of stepIds){
    const left=oldSteps.get(id),right=newSteps.get(id);
    if(!left){stepChanges.push(Object.freeze({stepId:id,operation:'ADDED',changedFields:Object.freeze(['ADDED']),
      beforeIndex:null,afterIndex:b.draft.steps.findIndex(step=>step.id===id),reviewRequired:true}));continue;}
    if(!right){stepChanges.push(Object.freeze({stepId:id,operation:'REMOVED',changedFields:Object.freeze(['REMOVED']),
      beforeIndex:a.draft.steps.findIndex(step=>step.id===id),afterIndex:null,reviewRequired:true}));continue;}
    const fields=[];
    if(left.name!==right.name)fields.push('NAME');
    if(left.actor!==right.actor)fields.push('ACTOR');
    if(left.instruction!==right.instruction)fields.push('INSTRUCTION');
    if(!sameSet(left.materialIds,right.materialIds))fields.push('MATERIALS');
    if(!sameSet(left.dependsOn,right.dependsOn))fields.push('DEPENDENCIES');
    stepChanges.push(Object.freeze({stepId:id,operation:fields.length?'CHANGED':'UNCHANGED',
      changedFields:Object.freeze(fields),beforeIndex:a.draft.steps.findIndex(step=>step.id===id),
      afterIndex:b.draft.steps.findIndex(step=>step.id===id),reviewRequired:fields.length>0}));
  }
  const orderedIds=[...b.structure.writeOrder.map(id=>id.slice(b.projectId.length+1)),
    ...a.structure.writeOrder.map(id=>id.slice(a.projectId.length+1))]
    .filter((id,index,all)=>all.indexOf(id)===index);
  const changedSet=new Set(stepChanges.filter(item=>item.operation!=='UNCHANGED').map(item=>item.stepId));
  const changedStepIds=orderedIds.filter(id=>changedSet.has(id));
  const dependencyChanges=orderedIds.map(id=>stepChanges.find(item=>item.stepId===id))
    .filter(item=>item&&item.operation!=='UNCHANGED'
      &&(item.changedFields.includes('DEPENDENCIES')||item.operation==='ADDED'||item.operation==='REMOVED'));
  const assigned=new Set([...a.draft.steps,...b.draft.steps].flatMap(step=>step.materialIds));
  const unassignedMaterialChanges=materialChanges.filter(item=>!assigned.has(item.object_id));
  const assignedMaterialChanges=materialChanges.filter(item=>assigned.has(item.object_id));
  const materialImpactSet=new Set([...a.draft.steps,...b.draft.steps]
    .filter(step=>assignedMaterialChanges.some(item=>step.materialIds.includes(item.object_id)))
    .map(step=>step.id));
  const materialImpactStepIds=orderedIds.filter(id=>materialImpactSet.has(id));
  const beforeAffected=downstream(a,[...changedStepIds,...materialImpactStepIds]);
  const afterAffected=downstream(b,[...changedStepIds,...materialImpactStepIds]);
  const affected=new Set([...beforeAffected,...afterAffected]);
  if(projectIntentChanged)for(const id of [...oldSteps.keys(),...newSteps.keys()])affected.add(id);
  const affectedStepIds=orderedIds.filter(id=>affected.has(id));
  const sourceStepIds=[...new Set([...beforeStepIds,...afterStepIds])];
  const sourceRevisionChanges=Object.freeze({
    project:Object.freeze({before:a.projectRef,after:b.projectRef,changed:!sameRef(a.projectRef,b.projectRef)}),
    works:Object.freeze(sourceStepIds.map(stepId=>{
      const beforeRef=a.workRefs.get(stepId)??null;
      const afterRef=b.workRefs.get(stepId)??null;
      return Object.freeze({...independent?{stepId,beforeWorkId:beforeRef?a.projectId+'.'+stepId:null,
        afterWorkId:afterRef?b.projectId+'.'+stepId:null}:{workId:a.projectId+'.'+stepId},
        before:beforeRef,after:afterRef,changed:!sameRef(beforeRef,afterRef)});
    })),
  });
  const semanticChanges=projectIntentChanged||stepChanges.some(item=>item.operation!=='UNCHANGED')
    ||assignedMaterialChanges.length>0;
  const sourceRevisionSetChanged=sourceRevisionChanges.project.changed||sourceRevisionChanges.works.some(item=>item.changed);
  const state=semanticChanges?'CHANGES_PROPOSED':independent?(projectChanges.length?'CHANGES_PROPOSED':'INDEPENDENT_IDENTITIES')
    :sourceRevisionSetChanged?'SOURCE_REBIND_ONLY'
    :projectChanges.length||stepChanges.some(item=>item.operation!=='UNCHANGED')?'CHANGES_PROPOSED':'UNCHANGED';
  return Object.freeze({
    schema:independent?'IWXA_T2_WORKSPACE_METHOD_ALTERNATIVE_COMPARISON_V1':'IWXA_T2_WORKSPACE_METHOD_REVISION_COMPARISON_V1',
    state,workspaceId:a.workspaceId,...(independent?{beforeProjectId:a.projectId,afterProjectId:b.projectId,
      independentIdentities:true}:{projectId:a.projectId}),
    projectChanges:Object.freeze(projectChanges),projectCompositionChanged,displayOrderChanged,projectIntentChanged,
    materialChanges:Object.freeze(materialChanges),unassignedMaterialChanges:Object.freeze(unassignedMaterialChanges),
    stepChanges:Object.freeze(stepChanges),changedStepIds:Object.freeze(changedStepIds),
    dependencyChanges:Object.freeze(dependencyChanges),materialImpactStepIds:Object.freeze(materialImpactStepIds),
    affectedStepIds:Object.freeze(affectedStepIds),sourceRevisionChanges,sourceRevisionSetChanged,
    reviewRequired:semanticChanges,atomicSnapshot:false,writeAuthorized:false,executionAuthority:false,resultReuseProven:false,
  });
}


// Capture both selections before the first asynchronous read. The caller
// supplies exact identities only, never a purported verified draft.
function captureSelection(value,label){
  if(!value||!Array.isArray(value.workRefs)||!value.workRefs.length||value.workRefs.length>64){
    fail('METHOD_COMPARISON_SELECTION_INVALID',label+' requires a complete explicit revision selection');
  }
  const copyRef=ref=>Object.freeze({family:ref?.family,objectId:ref?.objectId,
    recordId:ref?.recordId,revision:ref?.revision});
  const refs=Array.from(value.workRefs,copyRef);
  return Object.freeze({projectRef:copyRef(value.projectRef),workRefs:Object.freeze(refs)});
}

/** W06: compare two exact persisted selections using the original owner.
 * A changed or missing record is not replaced by the live head. This
 * deliberately does not issue grants, restore history, or execute a method.
 */
export async function compareWorkspaceMethodSelections({owner,workspaceId,projectId,before,after}={}){
  if(!text(workspaceId)||!text(projectId)||workspaceId.trim()!==workspaceId||projectId.trim()!==projectId){
    fail('METHOD_COMPARISON_SELECTION_INVALID','Exact Workspace and Project identities are required');
  }
  const selectedBefore=captureSelection(before,'before'),selectedAfter=captureSelection(after,'after');
  const a=await readHistoricalWorkspaceMethod({owner,workspaceId,projectId,expected:selectedBefore});
  const b=await readHistoricalWorkspaceMethod({owner,workspaceId,projectId,expected:selectedAfter});
  const comparison=compareWorkspaceMethodRevisions({before:a,after:b});
  const selectionOf=read=>Object.freeze({projectRef:read.projectRef,workRefs:read.workRefs});
  return Object.freeze({...comparison,comparisonBasis:'EXACT_HISTORICAL_REVISIONS',
    beforeSelection:selectionOf(a),afterSelection:selectionOf(b),currentHeadVerified:false});
}


function sameSelection(a,b){
  if(!a||!b||!sameRef(a.projectRef,b.projectRef)||a.workRefs.length!==b.workRefs.length)return false;
  const byId=new Map(a.workRefs.map(r=>[r.objectId,r]));
  return byId.size===a.workRefs.length&&b.workRefs.every(r=>sameRef(r,byId.get(r.objectId)));
}
function selectionOf(read){return Object.freeze({projectRef:read.projectRef,workRefs:read.workRefs});}
function alternativeOrigin(a,b){
  const ao=a.originalCreation?.origin,bo=b.originalCreation?.origin;
  if(bo?.workspaceId===a.workspaceId&&bo.projectId===a.projectId)return bo;
  if(ao?.workspaceId===b.workspaceId&&ao.projectId===b.projectId)return ao;
  if(ao&&bo&&ao.workspaceId===a.workspaceId&&bo.workspaceId===a.workspaceId
      &&ao.projectId===bo.projectId&&sameSelection(ao,bo))return ao;
  fail('METHOD_ALTERNATIVE_COMPARISON_ORIGIN_REQUIRED',
    'Independent Projects must have a direct origin or the same exact historical origin');
}

/** W06.4: compare two related, independently stored Projects. Both
 * selections and the common historical origin are read through the original
 * owner. Unrelated lookalike methods are not declared branches; no merge,
 * copy of Results, execution, source writes or implicit rebinding. */
export async function compareWorkspaceMethodAlternatives({owner,workspaceId,before,after}={}){
  if(!text(workspaceId)||workspaceId.trim()!==workspaceId
      ||!text(before?.projectId)||!text(after?.projectId)
      ||before.projectId.trim()!==before.projectId||after.projectId.trim()!==after.projectId
      ||before.projectId===after.projectId){
    fail('METHOD_ALTERNATIVE_COMPARISON_SCOPE_INVALID','Two independent Projects in one exact Workspace required');
  }
  const left={projectId:before.projectId,expected:captureSelection(before,'before')};
  const right={projectId:after.projectId,expected:captureSelection(after,'after')};
  const a=await readHistoricalWorkspaceMethod({owner,workspaceId,...left});
  const b=await readHistoricalWorkspaceMethod({owner,workspaceId,...right});
  const origin=alternativeOrigin(a,b);
  const source=await readHistoricalWorkspaceMethod({owner,workspaceId,projectId:origin.projectId,
    expected:captureSelection(origin,'origin')});
  const ar=readback(a,'before'),br=readback(b,'after'),sr=readback(source,'origin');
  const comparison=compareReadbacks(ar,br,true);
  return Object.freeze({...comparison,comparisonBasis:'EXACT_RELATED_ALTERNATIVE_REVISIONS',
    beforeSelection:selectionOf(a),afterSelection:selectionOf(b),
    origin:Object.freeze({workspaceId,projectId:source.projectId,...selectionOf(source)}),
    beforeFromOrigin:compareReadbacks(sr,ar,sr.projectId!==ar.projectId),
    afterFromOrigin:compareReadbacks(sr,br,sr.projectId!==br.projectId),
    currentHeadVerified:false,mergeAuthorized:false});
}
