// Exact released K036 + original Project/Work owner qualification witness.
import { createHash } from 'node:crypto';
import { canonicalStringify } from '../src/persistence/canonical-codec.mjs';
import { createWorkspaceMethodThroughSourceOwner } from '../src/modules/base/owners/project-process-method-materialization.mjs';
import { readWorkspaceMethodFromSourceOwner,readHistoricalWorkspaceMethod } from '../src/modules/base/owners/project-process-method-readback.mjs';
import { applyWorkspaceMethodRevision,inspectWorkspaceMethodRevision } from '../src/modules/base/owners/project-process-method-revision.mjs';
import { openK036C3QualificationOwner,captureK036C3CopyFixture,verifyK036C3CopyFixture } from './k036-c3-owner-qualification-adapter.mjs';
import { projectProcessSourceObjectId } from '../src/modules/base/owners/project-process-source-owner.mjs';
import { readWorkspaceMethodStageInputBasis,readWorkspaceMethodInputOverview,previewWorkspaceMethodStageHandoff,inspectWorkspaceMethodMaterialEvidence,buildWorkspaceMethodPersonalTaskDraft,prepareWorkspaceMethodPersonalChain,buildWorkspaceMethodCorporateTaskReference,buildWorkspaceMethodCorporateTaskInputs } from '../src/modules/base/owners/project-process-method-stage-input.mjs';
import { createOriginalPersonalWorkflowTaskObserver,recoverOriginalPersonalWorkflowTaskSelection,recoverOriginalPersonalWorkflowTaskSelections,personalWorkflowTaskInspection } from '../src/t3/workspace-method-personal-draft.mjs';
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
  count=restored.metrics.addressedReads;
  const overviewBefore=await readWorkspaceMethodInputOverview({owner:restored.owner,workspaceId:ws,projectId,expected:resumed.method,
    readObject:(...args)=>restoredClient.t1.getObject(...args)});
  const beforeOverviewReads=restored.metrics.addressedReads-count;
  same('original K036 complete method overview shares exact selected stage digest',
    overviewBefore.stages.find(s=>s.stepId==='compute').inputBasisDigest,selectedCompute.inputBasisDigest);
  same('original K036 complete method overview observes all four stages without execution',
    overviewBefore.counts,{total:4,inputReferencesVerified:4,materialReviewRequired:0,predecessorResultsRequired:3,rootInputsVerified:1});
  same('original K036 complete method overview bounded addressed read count',beforeOverviewReads,45);
  // Explicit material evidence on the released runtime, not a new persisted
  // object or a new Task. Put the fixture Asset only after the earlier copy
  // tests: legacy Asset copy isolation is separately known to be defective.
  const attachmentId='qualification-material-attachment',attachment=new Uint8Array([1,2,3,4,5]);
  await restoredClient.t1.putAsset({workspace_id:ws,object_id:materialId,asset_id:attachmentId,
    mime:'application/octet-stream',bytes:attachment,base_revision:0,event:{event_type:'qualification.material.attachment',
      idempotency_key:'qualification-material-attachment'}});
  const contentArgs={owner:restored.owner,workspaceId:ws,projectId,expected:resumed.method,stepId:'compute',
    readObject:(...a)=>restoredClient.t1.getObject(...a),listAssets:q=>restoredClient.t1.listAssets(q),getAsset:(...a)=>restoredClient.t1.getAsset(...a)};
  const materialEvidence=await inspectWorkspaceMethodMaterialEvidence(contentArgs);
  same('original K036 visible material and attachment bytes observed',materialEvidence.observation.counts.assets,1);
  same('original K036 attachment byte count is exact',materialEvidence.observation.counts.assetBytes,5);
  same('original K036 material evidence retains exact stage input digest',materialEvidence.stageInput.inputBasisDigest,selectedCompute.inputBasisDigest);
  same('original K036 repeated content evidence is stable',(await inspectWorkspaceMethodMaterialEvidence(contentArgs)).materialEvidenceDigest,materialEvidence.materialEvidenceDigest);
  check('original K036 material evidence remains non-authorizing',materialEvidence.executionAuthority===false&&materialEvidence.allAssetsProven===false);
  const rootContentArgs={...contentArgs,stepId:'prepare',includeMaterialEvidence:true};
  const combinedHandoff=await previewWorkspaceMethodStageHandoff(rootContentArgs);
  same('original K036 combined root handoff observes visible attached material',combinedHandoff.materialEvidence.observation.counts.assets,1);
  same('original K036 combined handoff digest binds its original content evidence',combinedHandoff.binding.materialEvidenceDigest,combinedHandoff.materialEvidence.materialEvidenceDigest);
  check('original K036 combined handoff is not a signed or created Task',!!combinedHandoff.candidateDigest&&!combinedHandoff.taskCreated&&!combinedHandoff.signedTaskIssued&&!combinedHandoff.dispatchAuthorized);
  same('original K036 repeat combined handoff is deterministic',(await previewWorkspaceMethodStageHandoff(rootContentArgs)).candidateDigest,combinedHandoff.candidateDigest);
  // Avoid exporting this new synthetic Asset into the old copy-isolation
  // witness: its independent copy behavior is already measured elsewhere.
  await restoredClient.t1.deleteAsset({workspace_id:ws,asset_id:attachmentId,base_revision:1,event:{event_type:'qualification.material.attachment.removed',idempotency_key:'qualification-material-attachment-remove'}});
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
  count=restored.metrics.addressedReads;
  const overviewAfter=await readWorkspaceMethodInputOverview({owner:restored.owner,workspaceId:ws,projectId,expected:resumed.method,
    readObject:(...args)=>restoredClient.t1.getObject(...args)});
  const afterOverviewReads=restored.metrics.addressedReads-count;
  same('original K036 complete method overview read count independent of 64 unrelated revisions',afterOverviewReads,beforeOverviewReads);
  same('original K036 complete method overview stable after unrelated history',exact(overviewAfter),exact(overviewBefore));
  const rootProposal=await previewWorkspaceMethodStageHandoff({owner:restored.owner,workspaceId:ws,projectId,expected:resumed.method,
    stepId:'prepare',readObject:(...args)=>restoredClient.t1.getObject(...args)});
  same('original K036 root Work handoff proposal is read-only',rootProposal.state,'INPUTS_PREPARED_OWNER_SELECTION_REQUIRED');
  check('original K036 root handoff has candidate digest without Task or dispatch authority',
    /^[a-f0-9]{64}$/.test(rootProposal.candidateDigest)&&!rootProposal.taskCreated&&!rootProposal.dispatchAuthorized);
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
  // Prepare a real root Agent Work against the original restored K036
  // objects and text Asset. This is not an installed Agent write.
  const personalProjectId='personal-root-project',personalMaterial=(await reopenedClient.t1.getObject(ws,materialId)).object;
  const personal=await createWorkspaceMethodThroughSourceOwner({owner:reopened.owner,workspaceId:ws,objects:[personalMaterial],
    draft:{templateId:'personal-root',templateRevision:'1',projectId:personalProjectId,name:'Personal research',
      objective:'Analyse source',domainApplicability:['generic'],materials:[{object_id:materialId,revision:personalMaterial.revision}],
      steps:[{id:'analyse',name:'Analyse',actor:'agent',instruction:'Prepare analysis',dependsOn:[],materialIds:[materialId]},
        {id:'review',name:'Review',actor:'agent',instruction:'Review analysis',dependsOn:['analyse'],materialIds:[]},
        {id:'finish',name:'Finish',actor:'agent',instruction:'Write conclusion',dependsOn:['review'],materialIds:[]}]},
    recordIds:{project:'personal-root-project@1',works:{[personalProjectId+'.analyse']:'personal-root-analyse@1',
      [personalProjectId+'.review']:'personal-root-review@1',[personalProjectId+'.finish']:'personal-root-finish@1'}},knowledgeAt:time});
  const actualText='Original K036 text attachment\r\nЁмкость ячейки: 42 Ω\n';
  await reopenedClient.t1.putAsset({workspace_id:ws,object_id:materialId,asset_id:'personal-root-text',
    mime:'text/plain',bytes:new TextEncoder().encode(actualText),base_revision:0,event:{event_type:'qualification.personal-text',
      idempotency_key:'qualification-personal-text'}});
  const personalArgs={owner:reopened.owner,workspaceId:ws,projectId:personalProjectId,expected:personal.method,
    stepId:'analyse',subjectKind:'PERSONAL',includeMaterialEvidence:true,resultSelections:[],
    readObject:(...a)=>reopenedClient.t1.getObject(...a),listAssets:q=>reopenedClient.t1.listAssets(q),getAsset:(...a)=>reopenedClient.t1.getAsset(...a)};
  // Reference-only corporate qualification using the original K036 source fixture.
  // Actual signed issuer is qualified separately.
  const corporateArgs={...personalArgs,subjectKind:'CORP'};
  const corporatePreview=await previewWorkspaceMethodStageHandoff(corporateArgs);
  const corporateReference=await buildWorkspaceMethodCorporateTaskReference({...corporateArgs,
    expectedCandidateDigest:corporatePreview.candidateDigest});
  same('original K036 corporate reference binds exact canonical Project and Work',
    exact([corporateReference.workflowInput.projectRef,corporateReference.workflowInput.workRef]),
    exact([personal.method.projectRef,personal.method.workRefs.find(r=>r.recordId==='personal-root-analyse@1')]));
  check('original K036 corporate reference never discloses attachment bytes or authorizes execution',
    !JSON.stringify(corporateReference).includes('Original K036 text attachment')&&
    corporateReference.workflowInput.materialEvidenceDigest===corporatePreview.materialEvidence.materialEvidenceDigest&&
    corporateReference.signedTaskIssued===false&&corporateReference.executionAuthority===false&&corporateReference.exactInputBindingProven===false);
  const corporateInputs=await buildWorkspaceMethodCorporateTaskInputs({...corporateArgs,
    expectedCandidateDigest:corporatePreview.candidateDigest});
  same('original K036 corporate native inputs carry exact attachment bytes',corporateInputs.attachments[1].text,actualText);
  same('original K036 corporate native inputs carry actual Object data',
    exact(JSON.parse(corporateInputs.attachments[0].text).data),exact(personalMaterial.data));
  same('original K036 corporate native inputs carry same signed reference',exact(corporateInputs.workflowInput),exact(corporateReference.workflowInput));
  check('original K036 native input preparation does not authorize execution or claim complete visibility',
    corporateInputs.observedMaterialBytesVerified===true&&corporateInputs.allAssetsProven===false&&corporateInputs.executionAuthority===false);
  const personalPreview=await previewWorkspaceMethodStageHandoff(personalArgs);
  const personalPlan=await buildWorkspaceMethodPersonalTaskDraft({...personalArgs,expectedCandidateDigest:personalPreview.candidateDigest});
  same('original K036 root personal draft has exact text attachment',personalPlan.draft.attachments[1].text,actualText);
  same('original K036 root personal draft retains original object data',exact(JSON.parse(personalPlan.draft.attachments[0].text).data),exact(personalMaterial.data));
  same('original K036 root personal draft provenance binds observed material digest',
    JSON.parse(personalPlan.draft.attachments[2].text).handoff.materialEvidenceDigest,personalPreview.materialEvidence.materialEvidenceDigest);
  // W05.19: exact released K036 persisted source, real Asset bytes and
  // same-ID .iwxa restore. Accepted Task ports remain controlled fixtures;
  // separate Center qualification exercises the actual Agent.
  const hash=text=>createHash('sha256').update(text,'utf8').digest('hex');
  const runs=new Map(),taskReads=[];
  const acceptFixture=(plan,taskId,summary)=>{
    const suffix=taskId.slice(5);
    const value={task:{task_id:taskId,objective:plan.draft.text.trim()},result:{task_id:taskId,result_id:'RES-'+suffix,
      task_digest:hash(taskId),context_projection_digest:hash(taskId+'projection'),run_bundle_digest:hash(taskId+'bundle'),
      performed_external_actions:false,summary},
      snapshot:{task_id:taskId,snapshot_id:'CSN-'+suffix,snapshot_digest:hash(taskId+'snapshot'),
        projection_digest:hash(taskId+'projection'),bundle_digest:hash(taskId+'bundle'),retrieval_refs:[],
        source_items:plan.draft.attachments.map((a,i)=>({path:'attachments/'+String(i+1).padStart(2,'0')+'-'+a.name,
          origin:'interaction_attachment',sha256:hash(a.text),bytes:Buffer.byteLength(a.text,'utf8')}))},
      acceptedSource:{task_id:taskId,workspace_ref:'personal',contract_version:'PA.K01_ACCEPTED_RESULT_SOURCE/0.1.0',
        state:'accepted',kind:'result',source_ref:'agent-result:'+taskId,read_only:true,commercial_approval_claimed:false,
        result_id:'RES-'+suffix,review_id:'REV-'+suffix,accepted_artifact_digest:hash(taskId+summary),
        revision:'sha256:'+hash(summary),content:summary}};
    runs.set(taskId,{value,attachments:structuredClone(plan.draft.attachments)});
  };
  const observer=await createOriginalPersonalWorkflowTaskObserver({workspaceId:ws,
    composer:{currentBinding:async()=>({subjectKind:'PERSONAL',sourceWorkspaceId:ws,agentWorkspaceId:'personal',contextEpoch:'fixture'})},
    taskOwner:{readAcceptedRun:async taskId=>{taskReads.push(taskId);return structuredClone(runs.get(taskId)?.value);},
      taskDocumentSource:async(taskId,snapshotId,path,sha256)=>({task_id:taskId,snapshot_id:snapshotId,path,sha256,
        text:runs.get(taskId).attachments[Number(path.slice(12,14))-1].text})},guarded:fn=>fn()});
  const rootSummary='Accepted original analysis\r\nСохранённый результат\n';
  acceptFixture(personalPlan,'TASK-k036-root',rootSummary);
  let assetReads=0;
  const chain=(c,o,stepId,personalResultSelections,extra={})=>prepareWorkspaceMethodPersonalChain({...personalArgs,
    owner:o,stepId,personalResultSelections,readObject:(...a)=>c.t1.getObject(...a),
    listAssets:q=>c.t1.listAssets(q),getAsset:(...a)=>{assetReads++;return c.t1.getAsset(...a);},
    readVerifiedPersonalResult:observer.read,
    resolvePersonalResultSelections:selections=>recoverOriginalPersonalWorkflowTaskSelections({workspaceId:ws,
      projectId:personalProjectId,expected:personal.method,observer,selections}),...extra});
  const rootSelection=[{stepId:'analyse',taskId:'TASK-k036-root'}];
  const review=await chain(reopenedClient,reopened.owner,'review',rootSelection);
  same('original K036 dependent Work receives exact accepted fixture text',review.plan.draft.attachments.find(a=>a.name==='result-001.txt').text,rootSummary);
  same('original K036 dependent Work shares attachment reads',assetReads,2);
  const reviewSummary='Accepted review conclusion\n';
  acceptFixture(review.plan,'TASK-k036-review',reviewSummary);
  const direct=[{stepId:'review',taskId:'TASK-k036-review'}];
  const final=await chain(reopenedClient,reopened.owner,'finish',direct);
  same('original K036 direct choice recovers exact prior fixture identities',final.resolvedSelections,[...rootSelection,...direct]);
  same('original K036 final Work receives only direct result',final.plan.draft.attachments.filter(a=>a.name.startsWith('result-')).map(a=>a.text),[reviewSummary]);
  acceptFixture(final.plan,'TASK-k036-finish','Accepted final conclusion');
  // W05.39: exact K036/Exchange persistence and material bytes for a
  // dependent corporate chain. Recipient ledger remains an addressed test
  // port here; Center separately qualifies the original signed recipient.
  const corporateAccepted=new Map(),corporateReadIds=[];
  let corporateAssetReads=0;
  const acceptCorporateFixture=(reference,stepId,result)=>{
    const taskId='task:k036-'+stepId,acceptanceId=hash('accept-'+stepId),resultRevisionId=hash('result-'+stepId);
    corporateAccepted.set(acceptanceId,Object.freeze({
      state:'ORIGINAL_CORPORATE_ACCEPTED_WORKFLOW_RESULT',originalRecipientReadback:true,readOnly:true,
      acceptanceState:'ACCEPTED',currentness:'CURRENT_BOUNDED',exactInputBindingProven:false,executionAuthorized:false,workCompleted:false,
      organizationId:'org:k036-fixture',workspaceId:ws,executorId:'person:k036-fixture',acceptanceId,resultRevisionId,taskId,
      taskRevisionId:hash('task-rev-'+stepId),taskPackageSha256:hash('task-package-'+stepId),packageSha256:hash('result-package-'+stepId),
      workflowInput:reference.workflowInput,result,resultSha256:hash(result)
    }));
    return {stepId,acceptanceId,resultRevisionId};
  };
  const readCorporateAcceptedResult=async selection=>{
    corporateReadIds.push(selection.acceptanceId);
    return structuredClone(corporateAccepted.get(selection.acceptanceId));
  };
  const corporateChainArgs=(c,o,stepId,corporateResultSelections)=>({...corporateArgs,owner:o,stepId,corporateResultSelections,
    organizationId:'org:k036-fixture',readCorporateAcceptedResult,
    readObject:(...a)=>c.t1.getObject(...a),listAssets:q=>c.t1.listAssets(q),
    getAsset:(...a)=>{corporateAssetReads++;return c.t1.getAsset(...a);}});
  const acceptedRoot=acceptCorporateFixture(corporateReference,'analyse','Corporate analysis\r\nТочные результаты: 42 Ω');
  const cReviewArgs=corporateChainArgs(reopenedClient,reopened.owner,'review',[acceptedRoot]);
  const cReviewPreview=await previewWorkspaceMethodStageHandoff(cReviewArgs);
  const cReview=await buildWorkspaceMethodCorporateTaskInputs({...cReviewArgs,expectedCandidateDigest:cReviewPreview.candidateDigest});
  same('original K036 corporate dependent Work receives exact direct predecessor bytes',
    cReview.attachments.filter(a=>a.name.startsWith('result-')).map(a=>a.text),[corporateAccepted.get(acceptedRoot.acceptanceId).result]);
  const acceptedReview=acceptCorporateFixture(cReview,'review','Corporate review\r\nПроверено без преобразования');
  const cFinalArgs=corporateChainArgs(reopenedClient,reopened.owner,'finish',[acceptedRoot,acceptedReview]);
  const cFinalPreview=await previewWorkspaceMethodStageHandoff(cFinalArgs);
  const cFinal=await buildWorkspaceMethodCorporateTaskInputs({...cFinalArgs,expectedCandidateDigest:cFinalPreview.candidateDigest});
  same('original K036 final corporate Work receives only its direct accepted predecessor',
    cFinal.attachments.filter(a=>a.name.startsWith('result-')).map(a=>a.text),[corporateAccepted.get(acceptedReview.acceptanceId).result]);
  check('original K036 corporate dependent inputs remain a preparation only',cFinal.executionAuthority===false&&cFinal.workCompleted===false);
  const chainPackage=await exportAll(reopenedClient,ws),chainClient=await openEmpty();
  await importAll(chainClient,chainPackage.bytes,{mode:'full'});
  const chainOwner=await open(chainClient,ws);
  const restoredCorporateArgs={...corporateArgs,owner:chainOwner.owner,
    readObject:(...a)=>chainClient.t1.getObject(...a),listAssets:q=>chainClient.t1.listAssets(q),getAsset:(...a)=>chainClient.t1.getAsset(...a)};
  const restoredCorporate=await buildWorkspaceMethodCorporateTaskReference({...restoredCorporateArgs,
    expectedCandidateDigest:corporatePreview.candidateDigest});
  same('original K036 same-ID Exchange preserves exact corporate Task reference',
    exact(restoredCorporate),exact(corporateReference));
  const restoredCorporateInputs=await buildWorkspaceMethodCorporateTaskInputs({...restoredCorporateArgs,
    expectedCandidateDigest:corporatePreview.candidateDigest});
  same('original K036 same-ID Exchange preserves actual corporate native input bytes and reference',
    exact(restoredCorporateInputs),exact(corporateInputs));
  const cRestoredArgs=corporateChainArgs(chainClient,chainOwner.owner,'finish',[acceptedRoot,acceptedReview]);
  const beforeCorporateAssets=corporateAssetReads,beforeCorporateResults=corporateReadIds.length;
  const cRestored=await buildWorkspaceMethodCorporateTaskInputs({...cRestoredArgs,expectedCandidateDigest:cFinalPreview.candidateDigest});
  same('original K036 same-ID restore preserves all corporate chain native input bytes',exact(cRestored),exact(cFinal));
  same('original K036 restored corporate chain reads each shared Asset twice',corporateAssetReads-beforeCorporateAssets,2);
  same('original K036 restored corporate chain reads each accepted predecessor twice',corporateReadIds.length-beforeCorporateResults,4);
  const originalAcceptedRoot=corporateAccepted.get(acceptedRoot.acceptanceId);
  const changedRoot=originalAcceptedRoot.result+' changed';
  corporateAccepted.set(acceptedRoot.acceptanceId,{...originalAcceptedRoot,result:changedRoot,resultSha256:hash(changedRoot)});
  await expectReject('original K036 changed accepted ancestor invalidates signed descendant lineage',
    ()=>buildWorkspaceMethodCorporateTaskInputs({...cRestoredArgs,expectedCandidateDigest:cFinalPreview.candidateDigest}),
    ['METHOD_CORPORATE_CHAIN_SIGNED_REFERENCE_CHANGED']);
  corporateAccepted.set(acceptedRoot.acceptanceId,originalAcceptedRoot);
  const recovered=await recoverOriginalPersonalWorkflowTaskSelection({workspaceId:ws,projectId:personalProjectId,
    stepId:'finish',taskId:'TASK-k036-finish',expected:personal.method,observer});
  same('original K036 same-ID restore retains canonical Work identity',recovered.canonicalWorkRef.recordId,'personal-root-finish@1');
  const beforeAssetReads=assetReads,beforeTaskReads=taskReads.length;
  const restoredChain=await chain(chainClient,chainOwner.owner,'finish',recovered.personalResultSelections,
    {expectedCandidateDigest:recovered.candidateDigest,targetTaskId:'TASK-k036-finish'});
  same('original K036 same-ID restore preserves exact dependent draft',exact(restoredChain.plan.draft),exact(final.plan.draft));
  same('original K036 same-ID restore preserves candidate digest',restoredChain.plan.candidateDigest,final.plan.candidateDigest);
  same('original K036 restored accepted-chain verification uses two shared Asset reads',assetReads-beforeAssetReads,2);
  same('original K036 restored accepted-chain verifies each fixture Task twice',taskReads.length-beforeTaskReads,6);
  const accepted=personalWorkflowTaskInspection(restoredChain.plan,restoredChain.targetAccepted);
  check('original K036 accepted-chain witness never claims completion or authority',accepted.declaredDraftInputsVerified===true&&accepted.workCompleted===false&&accepted.resultReuseProven===false);
  await chainClient.t1.putAsset({workspace_id:ws,object_id:materialId,asset_id:'personal-root-text',
    mime:'text/plain',bytes:new TextEncoder().encode(actualText+'Changed actual bytes'),base_revision:1,
    event:{event_type:'qualification.personal-text.changed',idempotency_key:'qualification-personal-text-changed'}});
  same('original K036 Asset edit leaves selected material Object revision unchanged',
    (await chainClient.t1.getObject(ws,materialId)).object.revision,personalMaterial.revision);
  await expectReject('original K036 changed actual attachment invalidates accepted chain without changing Object revision',
    ()=>chain(chainClient,chainOwner.owner,'finish',direct),['T3_METHOD_PERSONAL_TASK_INPUT_CHANGED']);
  await expectReject('original K036 actual attachment edit invalidates previous corporate Task reference',
    ()=>buildWorkspaceMethodCorporateTaskReference({...restoredCorporateArgs,expectedCandidateDigest:corporatePreview.candidateDigest}),
    ['METHOD_CORPORATE_TASK_EVIDENCE_CHANGED']);
  await expectReject('original K036 changed actual attachment refuses old corporate native inputs',
    ()=>buildWorkspaceMethodCorporateTaskInputs({...restoredCorporateArgs,expectedCandidateDigest:corporatePreview.candidateDigest}),
    ['METHOD_CORPORATE_TASK_EVIDENCE_CHANGED']);
  await expectReject('original K036 changed actual Asset invalidates dependent corporate chain',
    ()=>buildWorkspaceMethodCorporateTaskInputs({...cRestoredArgs,expectedCandidateDigest:cFinalPreview.candidateDigest}),
    ['METHOD_CORPORATE_CHAIN_SIGNED_REFERENCE_CHANGED']);
  same('fixture owner and Exchange use only original database',(await indexedDB.databases()).map(d=>d.name),['iwxa-local']);
  return {status:'PASS_ORIGINAL_OWNER_FIXTURE_ONLY',recordCount:9,restoredPartial:true,copyBinding:'EXPLICIT_EPHEMERAL_FIXTURE_PASS_PRODUCTION_BLOCKED',
    currentMethodAddressedReads:{before:beforeReads,after:afterReads},unfilteredCatalog:{before:catalogBefore,after:catalogAfter},
    additionalHistoryRevisions:64,alternativeLineageRestored:true,
    copiedMethodLocalProjection:true,copyOfCopyLocalProjection:true,durableCopyProvenance:false,
    stageInputBasisVerified:true,selectedStageAddressedReads:{before:beforeStageReads,after:afterStageReads},
    completeOverviewAddressedReads:{before:beforeOverviewReads,after:afterOverviewReads},rootHandoffPreview:true,
    corporateReferenceOriginalK036:{sameIdRestore:true,changedAssetRejected:true,actualSignedIssuerQualifiedSeparately:true,
      nativeTextInputsSameIdRestore:true,actualTextAndObjectBytesVerified:true,executionAuthorized:false},
    corporateChainOriginalK036:{sameIdRestore:true,sharedAssetReads:2,acceptedPredecessorsReadTwice:true,changedAncestorRejected:true,changedAssetRejected:true,acceptedResultOwner:'CONTROLLED_FIXTURE_ONLY',executionAuthorized:false},
    personalChainOriginalK036:{sameIdRestore:true,directSelection:true,sharedAssetReads:2,changedAssetRejected:true,
      acceptedTaskOwner:'CONTROLLED_FIXTURE_ONLY',workCompleted:false},physicalBrowser:false,productionAdapterApproved:false};
}
