// Exact released K036 + original Project/Work owner qualification witness.
import { canonicalStringify } from '../src/persistence/canonical-codec.mjs';
import { createWorkspaceMethodThroughSourceOwner } from '../src/modules/base/owners/project-process-method-materialization.mjs';
import { readWorkspaceMethodFromSourceOwner,readHistoricalWorkspaceMethod } from '../src/modules/base/owners/project-process-method-readback.mjs';
import { applyWorkspaceMethodRevision,inspectWorkspaceMethodRevision } from '../src/modules/base/owners/project-process-method-revision.mjs';
import { openK036C3QualificationOwner } from './k036-c3-owner-qualification-adapter.mjs';
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
    return c.t2.importCommit({preview_token:p.preview_token,package_digest:p.package_digest,plan});
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
  const firstEdit=edit(draft,'analyse','Revised original analysis');
  const request=(owner,basis,target,operationId,knowledgeAt,objects)=>({owner,workspaceId:ws,projectId,
    expected:basis,draft:target,objects,operationId,knowledgeAt});
  const second=await applyWorkspaceMethodRevision(request(source.owner,base,firstEdit,'fixture-first-edit',time2,objects));
  same('original owner observes actual lost graph acknowledgement',second.recoveredAckCount,1);
  same('original owner writes only dependent second revision',second.revisedCount,1);
  same('original owner keeps three independent heads',second.keptCount,3);
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
  const completeArtifact=await exportAll(restoredClient,ws);
  await importAll(restoredClient,completeArtifact.bytes,{mode:'new-workspace',target_workspace:copyWs,workspace_id_map:{[ws]:copyWs}});
  const target=await open(restoredClient,copyWs);
  await expectReject('same-ID adapter refuses copied origin in independent target',
    ()=>readWorkspaceMethodFromSourceOwner({owner:target.owner,workspaceId:copyWs,projectId}),['C3_FIXTURE_SCOPE_MISMATCH']);
  await expectReject('copied identity is not silently reported as unused',
    ()=>target.owner.sourceIdentityExists('project',copyWs,projectId),['C3_FIXTURE_SCOPE_MISMATCH']);
  same('source owner remains unchanged after independent copy',exact((await liveRead()).draft),exact(thirdDraft));
  const reopenedClient=await openEmpty();
  await importAll(reopenedClient,completeArtifact.bytes,{mode:'full'});
  const reopened=await open(reopenedClient,ws);
  const lineage=await readWorkspaceMethodAlternativeOrigin({owner:reopened.owner,workspaceId:ws,projectId:alternativeId});
  same('same-ID Exchange preserves explicit original alternative lineage',lineage.state,'ORIGIN_VERIFIED');
  same('restored alternative resolves exact original historical source',exact(lineage.source.draft),exact(draft));
  same('fixture owner and Exchange use only original database',(await indexedDB.databases()).map(d=>d.name),['iwxa-local']);
  return {status:'PASS_ORIGINAL_OWNER_FIXTURE_ONLY',recordCount:9,restoredPartial:true,copyBinding:'BLOCKED_AS_DESIGNED',
    currentMethodAddressedReads:{before:beforeReads,after:afterReads},unfilteredCatalog:{before:catalogBefore,after:catalogAfter},
    additionalHistoryRevisions:64,alternativeLineageRestored:true,physicalBrowser:false,productionAdapterApproved:false};
}
