// Exact released K036 + original Project/Work owner qualification witness.
import { canonicalStringify } from '../src/persistence/canonical-codec.mjs';
import { createWorkspaceMethodThroughSourceOwner } from '../src/modules/base/owners/project-process-method-materialization.mjs';
import { readWorkspaceMethodFromSourceOwner,readHistoricalWorkspaceMethod } from '../src/modules/base/owners/project-process-method-readback.mjs';
import { applyWorkspaceMethodRevision,inspectWorkspaceMethodRevision } from '../src/modules/base/owners/project-process-method-revision.mjs';
import { openK036C3QualificationOwner,captureK036C3CopyFixture,verifyK036C3CopyFixture } from './k036-c3-owner-qualification-adapter.mjs';
import { projectProcessSourceObjectId } from '../src/modules/base/owners/project-process-source-owner.mjs';
import { readWorkspaceMethodStageInputBasis } from '../src/modules/base/owners/project-process-method-stage-input.mjs';
import { compareWorkspaceMethodAlternatives } from '../src/modules/base/owners/project-process-method-comparison.mjs';
import { previewWorkspaceMethodAlternative,createWorkspaceMethodAlternativeThroughSourceOwner,readWorkspaceMethodAlternativeOrigin } from '../src/modules/base/owners/project-process-method-alternative.mjs';

const ws='qualification-c3-owner-source',copyWs='qualification-c3-owner-copy',projectId='research-project';
const time='2026-11-27T12:00:00.000000123Z',time2='2026-11-27T12:01:00.000000456Z',time3='2026-11-27T12:02:00.000000789Z';
const materialId='original-research-material';
function method(){
  return {templateId:'research-method',templateRevision:'1',projectId,name:'Research project',
    objective:'Compare an independent calculation with analytical research',domainApplicability:['generic'],
    materials:[{object_id:materialId,revision:1}],steps:[
      {id:'prepare',name:'Prepare',actor:'human',instruction:'Read the original material',dependsOn:[],materialIds:[materialId]},
      {id:'analyse',name:'Analyse',actor:'agent',instruction:'Analyse the original material',dependsOn:['prepare'],materialIds:[materialId]},
      {id:'compute',name:'Compute',actor:'program',instruction:'Calculate independently',dependsOn:['prepare'],materialIds:[materialId]},
      {id:'review',name:'Review',actor:'human',instruction:'Compare both results',dependsOn:['analyse','compute'],materialIds:[]},
    ]};
}
const edit=(draft,id,instruction)=>({...draft,steps:draft.steps.map(s=>s.id===id?{...s,instruction}:s)});
const order=rows=>rows.slice().sort((a,b)=>a.recordId.localeCompare(b.recordId));
const exact=value=>canonicalStringify(value);
export async function qualifyOriginalC3OwnerOnK036({client,openEmpty,anchorSchema,revisionSchema,schemaVersion,serviceId,check,same,expectReject}){
  const options={anchorSchema,revisionSchema,schemaVersion,serviceId};
  const open=(c,workspaceId,extra={})=>openK036C3QualificationOwner({client:c,workspaceId,...options,...extra});
  const material=async(c,workspaceId)=>[(await c.t1.getObject(workspaceId,materialId)).object];
  const exportAll=(c,workspaceId)=>c.t2.exportPackage({workspaces:[workspaceId],include_history:true,
    include_relations:true,include_assets:true,include_schemas:true});
  const importAll=async(c,bytes,plan)=>{
    const p=await c.t2.importPreview(bytes);
    const receipt=await c.t2.importCommit({preview_token:p.preview_token,package_digest:p.package_digest,plan});
    return {receipt,packageDigest:p.package_digest};
  };
  await client.t1.createWorkspace({workspace_id:ws,profile:'personal'});
  await client.t1.commitObjectGraph({workspace_id:ws,idempotency_key:'original-material',
    object:{object_id:materialId,schema_id:anchorSchema,schema_version:schemaVersion,base_revision:0,
      data:{kind:'material',value:'source observation'}},event:{event_type:'qualification.original-material'}});
  let lose=true;
  const source=await open(client,ws,{afterCommit:async input=>{
    const row=input.object.data?.record;
    if(lose&&row?.revision===2&&row.payload?.workId===projectId+'.analyse'){
      lose=false;throw Object.assign(new Error('simulated lost response after original commit'),{code:'FIXTURE_LOST_ACK'});
    }
  }});
  const objects=await material(client,ws),draft=method();
  const recordIds={project:'original-owner-project@1',
    works:Object.fromEntries(draft.steps.map(s=>[projectId+'.'+s.id,'original-owner-'+s.id+'@1']))};
  const created=await createWorkspaceMethodThroughSourceOwner({owner:source.owner,workspaceId:ws,objects,draft,recordIds,knowledgeAt:time});
  same('original owner creates five exact records through K036',created.createdCount,5);
  same('original owner material references restored from K036',exact(created.method.draft),exact(draft));
  const base=created.method;
  const readStage=(owner,c,workspaceId,expected,stepId)=>readWorkspaceMethodStageInputBasis({owner,workspaceId,projectId,expected,stepId,
    readObject:(...args)=>c.t1.getObject(...args)});
  const initialCompute=await readStage(source.owner,client,ws,base,'compute');
  const firstEdit=edit(draft,'analyse','Revised original analysis');
  const request=(owner,basis,target,operationId,knowledgeAt,objects)=>({owner,workspaceId:ws,projectId,
    expected:basis,draft:target,objects,operationId,knowledgeAt});
  const second=await applyWorkspaceMethodRevision(request(source.owner,base,firstEdit,'fixture-first-edit',time2,objects));
  same('original owner observes actual lost graph acknowledgement',second.recoveredAckCount,1);
  same('original owner writes only dependent second revision',second.revisedCount,1);
  same('original owner keeps three independent heads',second.keptCount,3);
  const independentCompute=await readStage(source.owner,client,ws,base,'compute');
  same('original K036 selected independent stage retains input basis after unrelated Work edit',independentCompute.inputBasisDigest,initialCompute.inputBasisDigest);
  same('original K036 selected stage does not assert entire method current',independentCompute.completeMethodCurrentVerified,false);
  await expectReject('original K036 changed dependent Work cannot use older selected basis',()=>readStage(source.owner,client,ws,base,'review'),['METHOD_STAGE_SOURCE_CHANGED']);
  same('exact historical method read through released K036',exact((await readHistoricalWorkspaceMethod({
    owner:source.owner,workspaceId:ws,projectId,expected:base})).draft),exact(draft));
  same('ordinary original owner operations do not enumerate catalog',source.metrics.catalogReads,0);
  same('ordinary original owner operations do not enumerate journal',source.metrics.journalReads,0);
  const beforePartial=second.method,thirdDraft=edit(firstEdit,'compute','Revised independent calculation');
  const interrupted={...Object.fromEntries(['create','revise','release','load','sourceIdentityExists','history','historyThrough','audit']
    .map(name=>[name,source.owner[name].bind(source.owner)])),
    revise:async(kind,input)=>{
      if(kind==='work'&&input.workId===projectId+'.review'){
        throw Object.assign(new Error('interrupted before dependent write'),{code:'FIXTURE_INTERRUPTED'});
      }
      return source.owner.revise(kind,input);
    }};
  const partialArgs=request(interrupted,beforePartial,thirdDraft,'fixture-partial-edit',time3,objects);
  await expectReject('original owner interruption retains partial exact history',
    ()=>applyWorkspaceMethodRevision(partialArgs),['FIXTURE_INTERRUPTED']);
  const observed=await inspectWorkspaceMethodRevision({...partialArgs,owner:source.owner});
  same('original owner detects partial method before export',observed.state,'PARTIAL');
  same('one saved revision before export',observed.confirmedCount,1);
  same('one pending dependent before export',observed.pendingCount,1);
  const auditBefore=order(await source.owner.audit());
  same('canonical audit includes exact eight saved revisions',auditBefore.length,8);
  const recordsBefore=await Promise.all(auditBefore.map(a=>source.gateway.record(a.recordId)));
  const artifact=await exportAll(client,ws);
  const restoredClient=await openEmpty();
  await importAll(restoredClient,artifact.bytes,{mode:'full'});
  const restored=await open(restoredClient,ws);
  const restoredObjects=await material(restoredClient,ws);
  const restoredAudit=order(await restored.owner.audit());
  same('same-ID package restores exact canonical audit including knowledge times',exact(restoredAudit),exact(auditBefore));
  same('same-ID package restores exact original canonical record bytes',
    exact(await Promise.all(auditBefore.map(a=>restored.gateway.record(a.recordId)))),exact(recordsBefore));
  same('same-ID original owner retains exact partial method after import',
    (await inspectWorkspaceMethodRevision(request(restored.owner,beforePartial,thirdDraft,'fixture-partial-edit',time3,restoredObjects))).state,'PARTIAL');
  const resumed=await applyWorkspaceMethodRevision(request(restored.owner,beforePartial,thirdDraft,'fixture-partial-edit',time3,restoredObjects));
  same('original owner resumes partial operation after package restore',resumed.alreadyPresentCount,1);
  same('only missing dependent written after restore',resumed.revisedCount,1);
  same('restored method exact content after resume',exact(resumed.method.draft),exact(thirdDraft));
  const replay=await applyWorkspaceMethodRevision(request(restored.owner,beforePartial,thirdDraft,'fixture-partial-edit',time3,restoredObjects));
  same('complete restored attempt replay does not write new revisions',replay.alreadyPresentCount,2);
  same('complete restored attempt retains exact nine audit records',(await restored.owner.audit()).length,9);
  same('old historical read survives restore and resume',exact((await readHistoricalWorkspaceMethod({
    owner:restored.owner,workspaceId:ws,projectId,expected:base})).draft),exact(draft));

  // Current-method read cost must not grow when unrelated history grows.
  const liveRead=()=>readWorkspaceMethodFromSourceOwner({owner:restored.owner,workspaceId:ws,projectId});
  let count=restored.metrics.addressedReads;
  await liveRead();
  const beforeReads=restored.metrics.addressedReads-count;
  count=restored.metrics.addressedReads;
  const selectedCompute=await readStage(restored.owner,restoredClient,ws,resumed.method,'compute');
  const beforeStageReads=restored.metrics.addressedReads-count;
  check('original K036 stage input reads only selected prerequisite closure',beforeStageReads<=27);
  check('current-method read does not repeat already observed physical revision lookup',beforeReads<=30);
  const catalogBefore=(await restoredClient.t1.listObjects({workspace_id:ws})).length;
  const unrelated={workspaceId:ws,projectId:'unrelated-project',name:'Unrelated project',domainApplicability:['generic']};
  await restored.owner.create('project',{...unrelated,recordId:'unrelated-1',knowledgeAt:time});
  for(let revision=2;revision<=64;revision++){
    await restored.owner.revise('project',{...unrelated,name:'Unrelated revision '+revision,
      recordId:'unrelated-'+revision,baseRevisionId:'unrelated-'+(revision-1),knowledgeAt:time2});
  }
  count=restored.metrics.addressedReads;
  await liveRead();
  const afterReads=restored.metrics.addressedReads-count;
  count=restored.metrics.addressedReads;
  const selectedComputeAfter=await readStage(restored.owner,restoredClient,ws,resumed.method,'compute');
  const afterStageReads=restored.metrics.addressedReads-count;
  same('selected Work addressed read count remains independent of 64 unrelated revisions',afterStageReads,beforeStageReads);
  same('unrelated historical records do not change selected Work exact inputs',selectedComputeAfter.inputBasisDigest,selectedCompute.inputBasisDigest);
  same('addressed current method read is independent of unrelated 64 revision history',afterReads,beforeReads);
  const catalogAfter=(await restoredClient.t1.listObjects({workspace_id:ws})).length;
  same('unfiltered owner catalog grows by anchor plus all 64 unrelated revisions',catalogAfter-catalogBefore,65);
  // The alternative has its own original Project/Work identities and exact
  // historical origin stored in the original first Project plan.
  const alternativeId='research-option-b';
  const alternativeRequest={owner:restored.owner,workspaceId:ws,projectId,targetProjectId:alternativeId,
    selected:base,objects:restoredObjects,operationId:'fixture-alternative',knowledgeAt:time3};
  const preview=await previewWorkspaceMethodAlternative(alternativeRequest);
  same('original K036 owner admits exact historical alternative',preview.state,'ALTERNATIVE_READY');
  const fork=await createWorkspaceMethodAlternativeThroughSourceOwner({...alternativeRequest,confirmationDigest:preview.confirmationDigest});
  same('original K036 owner creates independent five-record alternative',fork.createdCount,5);
  same('alternative stores exact historical origin in original Project',exact(fork.method.originalCreation.origin),exact(preview.origin));
  same('creating alternative leaves source method unchanged',exact((await liveRead()).draft),exact(thirdDraft));
  // Independent copy cannot be represented as an unchanged original owner
  // record. Refuse, rather than read from the source or report unused IDs.
  const compare=await compareWorkspaceMethodAlternatives({owner:restored.owner,workspaceId:ws,
    before:{...resumed.method,projectId},after:{...fork.method,projectId:alternativeId}});
  same('original K036 alternative comparison preserves exact source origin',compare.origin.projectRef,base.projectRef);
  same('original K036 alternative comparison detects independent branch changes',compare.changedStepIds,['analyse','compute']);
  const basis=await readWorkspaceMethodStageInputBasis({owner:restored.owner,workspaceId:ws,projectId,expected:resumed.method,
    stepId:'review',readObject:(...args)=>restoredClient.t1.getObject(...args)});
  same('original K036 Work input basis reads exact declared original material',basis.state,'INPUT_REFERENCES_VERIFIED');
  same('original K036 Work input basis requires actual predecessor Result owner',basis.predecessors.map(r=>r.state),
    ['ORIGINAL_RESULT_OWNER_REQUIRED','ORIGINAL_RESULT_OWNER_REQUIRED']);
  const capture=async(c,workspaceId)=>captureK036C3CopyFixture({client:c,workspaceId,...options});
  const bind=async(c,workspaceId,source,packageDigest)=>verifyK036C3CopyFixture({client:c,workspaceId,source,packageDigest,...options});
  const sourceEvidence=await capture(restoredClient,ws);
  const completeArtifact=await exportAll(restoredClient,ws);
  const copied=await importAll(restoredClient,completeArtifact.bytes,{mode:'new-workspace',target_workspace:copyWs,workspace_id_map:{[ws]:copyWs}});
  const target=await open(restoredClient,copyWs);
  await expectReject('same-ID adapter refuses copied origin in independent target',
    ()=>readWorkspaceMethodFromSourceOwner({owner:target.owner,workspaceId:copyWs,projectId}),['C3_FIXTURE_SCOPE_MISMATCH']);
  await expectReject('copied identity is not silently reported as unused',
    ()=>target.owner.sourceIdentityExists('project',copyWs,projectId),['C3_FIXTURE_SCOPE_MISMATCH']);
  same('source owner remains unchanged after independent copy',exact((await liveRead()).draft),exact(thirdDraft));
  const copyBinding=await bind(restoredClient,copyWs,sourceEvidence,copied.packageDigest);
  const local=await open(restoredClient,copyWs,{copyBinding});
  const localRead=()=>readWorkspaceMethodFromSourceOwner({owner:local.owner,workspaceId:copyWs,projectId});
  const copyMethod=await localRead();
  same('verified copy fixture opens complete method through original owner',exact(copyMethod.draft),exact(thirdDraft));
  same('copied Project has target-local logical identity',copyMethod.projectRef.objectId,
    projectProcessSourceObjectId('project',copyWs,projectId));
  same('copied Project retains exact original record identity',copyMethod.projectRef.recordId,resumed.method.projectRef.recordId);
  same('copied Work refs use target scope and original record IDs',
    copyMethod.workRefs.map(r=>r.recordId),resumed.method.workRefs.map(r=>r.recordId));
  const copyCompute=await readStage(local.owner,restoredClient,copyWs,copyMethod,'compute');
  same('copied selected stage reads original local material',copyCompute.state,'INPUT_REFERENCES_VERIFIED');
  same('copied stage input basis uses target-local Workspace',copyCompute.basis.workspaceId,copyWs);
  check('independent Workspace cannot inherit source input basis digest',copyCompute.inputBasisDigest!==selectedCompute.inputBasisDigest);
  const copyOrigin=await readWorkspaceMethodAlternativeOrigin({owner:local.owner,workspaceId:copyWs,projectId:alternativeId});
  same('copied alternative uses exact target-local origin scope',copyOrigin.origin.workspaceId,copyWs);
  same('copied alternative resolves exact original historical content',exact(copyOrigin.source.draft),exact(draft));
  same('copied alternative preserves exact historical origin record IDs',copyOrigin.source.projectRef.recordId,base.projectRef.recordId);
  await expectReject('bound copy cannot read original Workspace via target owner',
    ()=>local.owner.load('project',ws,projectId),['C3_FIXTURE_SCOPE_MISMATCH']);
  const localObjects=await material(restoredClient,copyWs);
  const targetDraft=edit(thirdDraft,'analyse','Independent target analysis');
  const targetEdit=await applyWorkspaceMethodRevision({owner:local.owner,workspaceId:copyWs,projectId,expected:copyMethod,
    draft:targetDraft,objects:localObjects,operationId:'target-independent-edit',knowledgeAt:'2026-11-27T12:03:00Z'});
  same('bound copy evolves independently through original selective owner',targetEdit.revisedCount,2);
  same('target-local copy current method matches independent edit',exact((await localRead()).draft),exact(targetDraft));
  same('source original method remains unchanged after target edit',exact((await liveRead()).draft),exact(thirdDraft));
  const inherited=await local.owner.history('work',copyWs,projectId+'.analyse');
  same('target history preserves inherited canonical record IDs and adds local revision',
    inherited.map(r=>r.recordId),[...(await restored.owner.history('work',ws,projectId+'.analyse')).map(r=>r.recordId),
      targetEdit.method.workRefs.find(r=>r.objectId.endsWith('.analyse')).recordId]);
  const localAudit=await local.owner.audit();
  check('target-local audit verifies original inherited source events and local changes',
    localAudit.every(r=>r.objectId.includes(':'+copyWs+':')));
  const secondEvidence=await capture(restoredClient,copyWs);
  check('original raw copied record fingerprints remain unchanged after local revisions',
    sourceEvidence.ids().every(id=>secondEvidence.fingerprint(id)===sourceEvidence.fingerprint(id)));
  const nextCopyWs='qualification-c3-owner-copy-of-copy';
  const targetArtifact=await exportAll(restoredClient,copyWs);
  const recopy=await importAll(restoredClient,targetArtifact.bytes,{mode:'new-workspace',target_workspace:nextCopyWs,
    workspace_id_map:{[copyWs]:nextCopyWs}});
  const nextBinding=await bind(restoredClient,nextCopyWs,secondEvidence,recopy.packageDigest);
  const next=await open(restoredClient,nextCopyWs,{copyBinding:nextBinding});
  const nextMethod=await readWorkspaceMethodFromSourceOwner({owner:next.owner,workspaceId:nextCopyWs,projectId});
  same('copy of edited copy opens mixed-origin history through original owner',exact(nextMethod.draft),exact(targetDraft));
  same('copy of copy preserves exact selected Work record IDs',nextMethod.workRefs.map(r=>r.recordId),targetEdit.method.workRefs.map(r=>r.recordId));
  const nextLineage=await readWorkspaceMethodAlternativeOrigin({owner:next.owner,workspaceId:nextCopyWs,projectId:alternativeId});
  same('copy of copy resolves local historical alternative origin',exact(nextLineage.source.draft),exact(draft));
  same('copy of copy leaves original source unchanged',exact((await liveRead()).draft),exact(thirdDraft));
  same('copy of copy leaves edited first target unchanged',exact((await localRead()).draft),exact(targetDraft));
  const reopenedClient=await openEmpty();
  await importAll(reopenedClient,completeArtifact.bytes,{mode:'full'});
  const reopened=await open(reopenedClient,ws);
  const lineage=await readWorkspaceMethodAlternativeOrigin({owner:reopened.owner,workspaceId:ws,projectId:alternativeId});
  same('same-ID Exchange preserves explicit original alternative lineage',lineage.state,'ORIGIN_VERIFIED');
  same('restored alternative resolves exact original historical source',exact(lineage.source.draft),exact(draft));
  same('fixture owner and Exchange use only original database',(await indexedDB.databases()).map(d=>d.name),['iwxa-local']);
  return {status:'PASS_ORIGINAL_OWNER_FIXTURE_ONLY',recordCount:9,restoredPartial:true,copyBinding:'EXPLICIT_EPHEMERAL_FIXTURE_PASS_PRODUCTION_BLOCKED',
    currentMethodAddressedReads:{before:beforeReads,after:afterReads},unfilteredCatalog:{before:catalogBefore,after:catalogAfter},
    additionalHistoryRevisions:64,alternativeLineageRestored:true,
    copiedMethodLocalProjection:true,copyOfCopyLocalProjection:true,durableCopyProvenance:false,
    stageInputBasisVerified:true,selectedStageAddressedReads:{before:beforeStageReads,after:afterStageReads},physicalBrowser:false,productionAdapterApproved:false};
}
