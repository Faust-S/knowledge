import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createProjectProcessSourceOwnerQualificationHarness } from '../src/modules/base/owners/project-process-source-owner.mjs';
import { createWorkspaceMethodThroughSourceOwner } from '../src/modules/base/owners/project-process-method-materialization.mjs';
import { applyWorkspaceMethodRevision } from '../src/modules/base/owners/project-process-method-revision.mjs';
import { inspectWorkspaceMethodAgentPredecessorResults,previewWorkspaceMethodStageHandoff,inspectWorkspaceMethodNativeContinuation,buildWorkspaceMethodPersonalTaskDraft } from '../src/modules/base/owners/project-process-method-stage-input.mjs';
import { createTrustedWorkspaceMethodStageReader } from '../src/t3/workspace-method-stage-reader.mjs';
import { inspectOriginalPersonalWorkflowTask } from '../src/t3/workspace-method-personal-draft.mjs';
import { createTrustedNativeContinuation } from '../src/t3/native-result-continuation.mjs';

const ws='stage-result-workspace',projectId='research',time='2026-11-27T14:00:00Z';
const material={workspace_id:ws,object_id:'source',schema_id:'note',schema_version:'1.0.0',revision:1,data:{private:'source body'}};
const resultRef=Object.freeze({workspace_id:ws,object_id:'agent-atlas-result:fixture',schema_id:'iwxa.agent.accepted-result',revision:1});
const accepted={acceptanceKind:'HUMAN_ACCEPTED_DRAFT',readOnly:true,sourceObjectRef:resultRef,
  workRef:{projectId,workId:projectId+'.analyse',revision:'1'},taskId:'TSK-fixture',resultId:'RES-fixture',
  acceptedDigest:'a'.repeat(64),archiveSha256:'b'.repeat(64),privateSummary:'must not be projected'};
const resultObject={...resultRef,schema_version:'1.0.0',data:{taskId:accepted.taskId,resultId:accepted.resultId,
  acceptedDigest:accepted.acceptedDigest,workRef:accepted.workRef}};
const selection=[{stepId:'analyse',reference:resultRef}];
function draft(){return {templateId:'method',templateRevision:'1',projectId,name:'Research',objective:'Review original result',
  domainApplicability:['generic'],materials:[{object_id:'source',revision:1}],steps:[
    {id:'analyse',name:'Analyse',actor:'agent',instruction:'Analyse original',dependsOn:[],materialIds:['source']},
    {id:'review',name:'Review',actor:'human',instruction:'Review accepted result',dependsOn:['analyse'],materialIds:[]},
  ]};}
const clone=structuredClone;
async function setup(value=draft()){
  const {owner}=await createProjectProcessSourceOwnerQualificationHarness();
  const result=await createWorkspaceMethodThroughSourceOwner({owner,workspaceId:ws,objects:[material],draft:value,
    recordIds:{project:'method-source',works:{[projectId+'.analyse']:'analyse-source',[projectId+'.review']:'review-source'}},knowledgeAt:time});
  const calls=[],nativeCalls=[];let selectedResult=clone(resultObject),native=clone(accepted);
  const readObject=async(workspaceId,id)=>{calls.push([workspaceId,id]);return workspaceId===ws?
    id===material.object_id?{object:clone(material)}:id===resultRef.object_id&&selectedResult?{object:clone(selectedResult)}:null:null;};
  const readAccepted=async ref=>{nativeCalls.push(ref);return clone(native);};
  return {owner,base:result.method,calls,nativeCalls,readObject,readAccepted,
    changeResult:x=>{selectedResult=x;},changeAccepted:x=>{native=x;}};
}
const args=(f,extra={})=>({owner:f.owner,readObject:f.readObject,readAccepted:f.readAccepted,workspaceId:ws,projectId,
  expected:f.base,stepId:'review',resultSelections:selection,...extra});
const code=expected=>error=>error?.code===expected;
test('original accepted Result readback is observed but cannot prove exact canonical input or reuse',async()=>{
  const f=await setup(),r=await inspectWorkspaceMethodAgentPredecessorResults(args(f));
  assert.equal(r.state,'ACCEPTED_RESULTS_OBSERVED_INPUT_BINDING_UNPROVEN');
  assert.equal(r.results[0].state,'ACCEPTED_WORK_NUMBER_MATCHED_INPUT_BINDING_UNPROVEN');
  assert.equal(r.results[0].accepted.resultId,accepted.resultId);assert.equal(r.results[0].accepted.acceptedDigest,accepted.acceptedDigest);
  assert.equal(r.exactInputBindingProven,false);assert.equal(r.resultReuseProven,false);assert.equal(r.executionAuthority,false);
  assert.equal(JSON.stringify(r).includes('must not be projected'),false);assert.equal(f.nativeCalls.length,2);
  assert.equal((await f.owner.audit()).length,3);
});
test('missing predecessor Result and root Work retain distinct non-execution states',async()=>{
  const f=await setup();
  const r=await inspectWorkspaceMethodAgentPredecessorResults(args(f,{resultSelections:[]}));
  assert.equal(r.state,'PREDECESSOR_RESULTS_REQUIRED');assert.equal(f.nativeCalls.length,0);
  const root=await inspectWorkspaceMethodAgentPredecessorResults(args(f,{stepId:'analyse',resultSelections:[]}));
  assert.equal(root.state,'NO_PREDECESSOR_RESULTS_REQUIRED');assert.equal(root.executionAuthority,false);
  await assert.rejects(inspectWorkspaceMethodAgentPredecessorResults(args(f,{stepId:'analyse'})),code('METHOD_STAGE_RESULT_SELECTION_INVALID'));
});
test('stale or missing published Result cannot invoke original accepted owner',async()=>{
  const f=await setup();
  for(const object of [{...resultObject,revision:2},null,{...resultObject,deleted:true}]){
    f.changeResult(object);const r=await inspectWorkspaceMethodAgentPredecessorResults(args(f));
    assert.equal(r.state,'PREDECESSOR_RESULT_REVIEW_REQUIRED');assert.equal(r.results[0].accepted,null);
  }
  assert.equal(f.nativeCalls.length,0);
});
test('accepted Result from prior Work revision requires review, not implicit reuse',async()=>{
  const f=await setup(),d=draft();d.steps[0].instruction='New calculation scope';
  const next=(await applyWorkspaceMethodRevision({owner:f.owner,workspaceId:ws,projectId,expected:f.base,draft:d,objects:[material],
    operationId:'changed-work',knowledgeAt:'2026-11-27T14:01:00Z'})).method;
  const r=await inspectWorkspaceMethodAgentPredecessorResults(args(f,{expected:next}));
  assert.equal(r.state,'PREDECESSOR_RESULT_REVIEW_REQUIRED');assert.equal(r.results[0].state,'ACCEPTED_OLDER_OR_OTHER_WORK_REVISION');
  assert.equal(r.results[0].workRef.revision,2);assert.equal(r.results[0].accepted.workRef.revision,'1');
  assert.equal(r.resultReuseProven,false);
});
test('wrong published object, foreign selection, forged owner evidence or another Work is rejected',async()=>{
  const f=await setup();
  await assert.rejects(inspectWorkspaceMethodAgentPredecessorResults(args(f,{resultSelections:[{stepId:'analyse',reference:{...resultRef,workspace_id:'foreign'}}]})),code('METHOD_STAGE_RESULT_SELECTION_INVALID'));
  await assert.rejects(inspectWorkspaceMethodAgentPredecessorResults(args(f,{resultSelections:[...selection,...selection]})),code('METHOD_STAGE_RESULT_SELECTION_INVALID'));
  f.changeAccepted({...accepted,readOnly:false});
  await assert.rejects(inspectWorkspaceMethodAgentPredecessorResults(args(f)),code('METHOD_STAGE_RESULT_OWNER_READBACK_INVALID'));
  f.changeAccepted({...accepted,resultId:'RES-other'});
  await assert.rejects(inspectWorkspaceMethodAgentPredecessorResults(args(f)),code('METHOD_STAGE_RESULT_OWNER_READBACK_INVALID'));
  const other={...accepted,workRef:{...accepted.workRef,workId:projectId+'.other'}};
  f.changeAccepted(other);f.changeResult({...resultObject,data:{...resultObject.data,workRef:other.workRef}});
  await assert.rejects(inspectWorkspaceMethodAgentPredecessorResults(args(f)),code('METHOD_STAGE_RESULT_WORK_MISMATCH'));
  f.changeResult({...resultObject,workspace_id:'foreign'});
  await assert.rejects(inspectWorkspaceMethodAgentPredecessorResults(args(f)),code('METHOD_STAGE_RESULT_IDENTITY_MISMATCH'));
});
test('accepted owner or exact material changed during observation cannot confirm result',async()=>{
  const f=await setup();let calls=0;
  await assert.rejects(inspectWorkspaceMethodAgentPredecessorResults(args(f,{readAccepted:async()=>({
    ...accepted,archiveSha256:(++calls===1?'b':'c').repeat(64)})})),code('METHOD_STAGE_RESULT_CHANGED'));
  let changed=false;
  await assert.rejects(inspectWorkspaceMethodAgentPredecessorResults(args(f,{
    readAccepted:async()=>{changed=true;return accepted;},readObject:async(w,id)=>{
      const r=await f.readObject(w,id);return changed&&id==='source'?{object:{...r.object,revision:2}}:r;
    }})),code('METHOD_STAGE_RESULT_BASIS_CHANGED'));
});
function trusted(f,{withAgent=true,withNative=false,withAssets=false,assetHook=()=>{},personalComposer=null,confirmPersonalDraft=null}={}){
  const workspace={workspace_id:ws,deleted_at:null};
  let chosen=workspace,active=true,allowed=true;const listeners=new Set();
  const currentWorkspace={get:()=>chosen,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
  const context={kind:'PERSONAL',context_id:'ctx:work',actor_id:'person:owner',principal_id:'person:owner',
    role_id:'role:owner',grant_id:'grant:owner',realm_id:'realm:personal',audience:'host:t3',resource:ws,
    purpose:'work',workspace_id:ws,organization_id:null,scope_revision:1};
  const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
  const access={currentContext:()=>context,actionFor:()=> 'object.read',operationDigest:sha,
    authorize:request=>({schema:'IWXA_T3_AUTHORIZATION_DECISION/1',allowed,outcome:allowed?'PERMITTED':'DENIED',
      evidenceOnly:true,requestDigest:sha(request),policyDigest:sha('policy'),statusSequence:1,
      validUntil:new Date(Date.now()+60000).toISOString(),statusObservedAt:new Date().toISOString(),
      evaluatedAt:new Date().toISOString(),authorityPath:[{grantId:context.grant_id}]}),
    verifyDecisionBinding:(request,decision)=>decision.requestDigest===sha(request)};
  const asset={workspace_id:ws,object_id:'source',asset_id:'asset:1',revision:1,mime:'text/plain',size:1,
    service_id:'svc',created_at:time,updated_at:time,updated_by_service:'svc'};
  const kernel={sessionInfo:{contract_version:'1.3.0'},hasOperation:op=>['t1.getWorkspace','t1.getObject',
      ...(withAssets?['t1.listAssets','t1.getAsset']:[])].includes(op),
    getWorkspace:async workspaceId=>workspaceId===ws?workspace:null,
    getObject:async(...a)=>{const row=await f.readObject(...a);return row?{...row,object:{...row.object,extensions:{}},relations:{incoming:[],outgoing:[]}}:null;},
    listAssets:async query=>{assetHook('list',query);return query.object_id==='source'?[asset]:[];},
    getAsset:async(workspaceId,id)=>{assetHook('get',{workspace_id:workspaceId,asset_id:id});return {asset,bytes:new Uint8Array([42])};}};
  let hook=null,nativeHook=null,received=null,inspections=0,receives=0,confirmations=0;
  const recipientId='iwxa.atlas',operationId='native:operation:fixture';
  const nativeOwner={recipientId,
    inspect:async({reference})=>{inspections++;if(nativeHook)await nativeHook();return {status:'READY',reference,recipientId,operationId};},
    receive:async({reference})=>{receives++;received={state:'COMMITTED',reference,recipientId,operationId,resultRef:'atlas:result:fixture'};},
    receipt:async()=>received,readback:async()=>received?{...received,state:'PERSISTED'}:null};
  const nativeContinuation=withNative?createTrustedNativeContinuation({kernel,accessForRead:async()=>access,currentWorkspace,nativeOwner,
    confirmHuman:async()=>{confirmations++;return true;},isHostActive:()=>active}):null;
  const reader=createTrustedWorkspaceMethodStageReader({kernel,accessForRead:async()=>access,currentWorkspace,sourceOwner:f.owner,
    originalAgentResultOwner:withAgent?{readAccepted:async ref=>{if(hook)await hook();return f.readAccepted(ref);}}:null,
    nativeContinuation,nativeRecipientId:withNative?recipientId:null,personalComposer,confirmPersonalDraft,isHostActive:()=>active});
  const changeSelection=()=>{chosen={...workspace};for(const notify of listeners)notify();};
  return {reader,context,deny:()=>{allowed=false;},changeSelection,dispose:()=>{active=false;},hook:fn=>{hook=fn;},
    nativeHook:fn=>{nativeHook=fn;},nativeContinuation,inspections:()=>inspections,receives:()=>receives,confirmations:()=>confirmations};
}
const hostInput=f=>({workspaceId:ws,projectId,stepId:'review',expected:f.base,resultSelections:selection});
test('trusted stage reader composes actual original signed binding and scoped original owner',async()=>{
  const f=await setup(),h=trusted(f);
  const r=await h.reader.inspect(hostInput(f));
  assert.equal(r.state,'ACCEPTED_RESULTS_OBSERVED_INPUT_BINDING_UNPROVEN');
  assert.equal(f.nativeCalls.length,2);
  h.deny();await assert.rejects(h.reader.inspect(hostInput(f)),code('T3_ACCESS_NOT_PERMITTED'));
  assert.equal(f.nativeCalls.length,2);
});
test('trusted stage reader rejects Workspace or full signed context changes during native owner read',async()=>{
  for(const change of ['selection','context','dispose']){
    const f=await setup(),h=trusted(f);
    h.hook(()=>{if(change==='selection')h.changeSelection();else if(change==='dispose')h.dispose();else h.context.purpose='different';});
    await assert.rejects(h.reader.inspect(hostInput(f)),e=>['T3_METHOD_STAGE_WORKSPACE_CHANGED','T3_METHOD_STAGE_SIGNED_CONTEXT_CHANGED'].includes(e.code));
  }
});

test('material changed during second native Result readback cannot pass final stage evidence',async()=>{
  const f=await setup();let calls=0;
  await assert.rejects(inspectWorkspaceMethodAgentPredecessorResults(args(f,{
    readAccepted:async()=>{calls++;return accepted;},
    readObject:async(w,id)=>{
      const r=await f.readObject(w,id);return calls>=2&&id==='source'?{object:{...r.object,revision:2}}:r;
    }})),code('METHOD_STAGE_RESULT_BASIS_CHANGED'));
});
test('original D1 permission revocation during accepted owner read prevents report',async()=>{
  const f=await setup(),h=trusted(f);
  h.hook(()=>{h.deny();});
  await assert.rejects(h.reader.inspect(hostInput(f)),code('T3_ACCESS_NOT_PERMITTED'));
});

test('published original Result revision changing during the final native owner call is rejected',async()=>{
  const f=await setup();let calls=0;
  await assert.rejects(inspectWorkspaceMethodAgentPredecessorResults(args(f,{
    readAccepted:async()=>{if(++calls===2)f.changeResult({...resultObject,revision:2});return accepted;}
  })),code('METHOD_STAGE_RESULT_CHANGED'));
  assert.equal(calls,2);
});
test('original publication schema version must match the existing accepted Result schema',async()=>{
  const f=await setup();
  f.changeResult({...resultObject,schema_version:'2.0.0'});
  await assert.rejects(inspectWorkspaceMethodAgentPredecessorResults(args(f)),code('METHOD_STAGE_RESULT_IDENTITY_MISMATCH'));
  assert.equal(f.nativeCalls.length,0);
});
test('material-free root Work still requires current D1 at final trusted readback',async()=>{
  const value=draft();value.materials=[];value.steps[0].materialIds=[];
  const f=await setup(value);let h;
  const owner={load:async(...a)=>{const row=await f.owner.load(...a);h.deny();return row;}};
  h=trusted({...f,owner});
  await assert.rejects(h.reader.inspect({...hostInput(f),stepId:'analyse',resultSelections:[]}),code('T3_ACCESS_NOT_PERMITTED'));
  assert.equal(f.calls.length,0);assert.equal(f.nativeCalls.length,0);
});


test('root handoff preview is exact and deterministic but does not issue a signed Task or approve a model',async()=>{
  const f=await setup(),request=args(f,{stepId:'analyse',resultSelections:[],readAccepted:undefined});
  const first=await previewWorkspaceMethodStageHandoff(request),second=await previewWorkspaceMethodStageHandoff(request);
  assert.equal(first.state,'INPUTS_PREPARED_OWNER_SELECTION_REQUIRED');assert.match(first.candidateDigest,/^[a-f0-9]{64}$/);
  assert.equal(first.candidateDigest,second.candidateDigest);assert.deepEqual(first.binding.workRef,first.inspection.stageInput.basis.stageRef);
  assert.equal(first.binding.inputBasisDigest,first.inspection.stageInput.inputBasisDigest);
  assert.ok(first.requiredOriginalOwnerChecks.includes('ORIGINAL_SIGNED_TASK_BINDING'));
  assert.equal(first.signedTaskIssued,false);assert.equal(first.taskCreated,false);
  assert.equal(first.contentBindingProven,false);assert.equal(first.dispatchAuthorized,false);assert.equal(f.nativeCalls.length,0);
});
test('downstream handoff binds observed native Result references but requires exact original input binding',async()=>{
  const f=await setup();
  const r=await previewWorkspaceMethodStageHandoff(args(f));
  assert.equal(r.state,'PRIOR_RESULTS_OBSERVED_EXACT_BINDING_REQUIRED');
  assert.equal(r.binding.predecessorResults[0].accepted.resultId,accepted.resultId);
  assert.equal(r.binding.predecessorResults[0].canonicalWorkRef.recordId,'analyse-source');
  assert.ok(r.requiredOriginalOwnerChecks.includes('EXACT_PREDECESSOR_RESULT_INPUT_BINDING'));
  assert.ok(r.requiredOriginalOwnerChecks.includes('HUMAN_REVIEW_AND_ORIGINAL_RESULT_OWNER'));
  assert.equal(r.exactInputBindingProven,false);assert.equal(r.resultReuseProven,false);
  f.changeAccepted({...accepted,archiveSha256:'c'.repeat(64)});
  const changed=await previewWorkspaceMethodStageHandoff(args(f));
  assert.notEqual(changed.candidateDigest,r.candidateDigest);
  const missing=await previewWorkspaceMethodStageHandoff(args(f,{resultSelections:[]}));
  assert.equal(missing.binding,null);assert.equal(missing.candidateDigest,null);
});
test('program handoff never infers program operation, parameters or connection from methodology text',async()=>{
  const value=draft();value.steps[0].actor='program';
  const f=await setup(value),r=await previewWorkspaceMethodStageHandoff(args(f,{stepId:'analyse',resultSelections:[]}));
  assert.equal(r.binding.intendedActor,'program');
  assert.ok(r.requiredOriginalOwnerChecks.includes('EXPLICIT_PROGRAM_OPERATION_AND_ARGUMENTS'));
  assert.ok(r.requiredOriginalOwnerChecks.includes('CURRENT_CONNECTION_AND_TOOL_APPROVAL'));
  for(const key of ['operation','parameters','providerId','connectionEpoch'])assert.equal(Object.hasOwn(r.binding,key),false);
  assert.equal(r.dispatchAuthorized,false);
});
test('trusted overview and root handoff work without an installed Agent; selecting its Result requires original owner',async()=>{
  const f=await setup(),h=trusted(f,{withAgent:false});
  const report=await h.reader.overview({workspaceId:ws,projectId,expected:f.base});
  assert.equal(report.counts.total,2);assert.equal(report.executionAuthority,false);
  const r=await h.reader.previewHandoff({...hostInput(f),stepId:'analyse',resultSelections:[]});
  assert.equal(r.state,'INPUTS_PREPARED_OWNER_SELECTION_REQUIRED');
  await assert.rejects(h.reader.inspect(hostInput(f)),code('T3_METHOD_STAGE_RESULT_OWNER_REQUIRED'));
});
test('trusted Workflow uses the ORIGINAL D6 preview and recovery; it never dispatches or confirms a native write',async()=>{
  const f=await setup(),h=trusted(f,{withNative:true}),input={...hostInput(f),predecessorStepId:'analyse'};
  const first=await h.reader.previewContinuation({...input,recipientId:'caller:forged',recover:true,confirmHuman:()=>true});
  assert.equal(first.nativeContinuation.preview.status,'AVAILABLE');
  assert.equal(first.nativeContinuation.preview.recipientId,'iwxa.atlas');
  assert.equal(first.nativeContinuation.receipt,null);assert.equal(first.targetWorkBound,false);
  assert.equal(first.dispatchAuthorized,false);assert.equal(h.receives(),0);assert.equal(h.confirmations(),0);
  const unknown=await h.reader.recoverContinuation(input);
  assert.equal(unknown.nativeContinuation.receipt.status,'OUTCOME_UNKNOWN');assert.equal(h.receives(),0);
  // The existing original D6 product route performs its own separate
  // explicit native write; the Workflow only observes its durable receipt.
  const committed=await h.nativeContinuation.continueSelected(resultRef);
  assert.equal(committed.status,'OWNER_READBACK_CONFIRMED');assert.equal(h.receives(),1);assert.equal(h.confirmations(),1);
  const recovered=await h.reader.recoverContinuation(input);
  assert.equal(recovered.nativeContinuation.preview.status,'RECOVER_ONLY');
  assert.equal(recovered.nativeContinuation.receipt.status,'OWNER_READBACK_CONFIRMED');
  assert.equal(recovered.nativeContinuation.receipt.resultRef,'atlas:result:fixture');
  assert.equal(recovered.targetWorkBound,false);assert.equal(recovered.executionAuthority,false);
  assert.equal(h.receives(),1);assert.equal(h.confirmations(),1);
});
test('unselected or stale predecessor cannot enter native recipient preview; caller cannot supply a native port',async()=>{
  const f=await setup(),h=trusted(f,{withNative:true});
  await assert.rejects(h.reader.previewContinuation({...hostInput(f),predecessorStepId:'other'}),code('METHOD_STAGE_NATIVE_PREDECESSOR_REQUIRED'));
  const input={...hostInput(f),predecessorStepId:'analyse'};
  const missing=await h.reader.previewContinuation({...input,resultSelections:[]});
  assert.equal(missing.nativeContinuation,null);assert.equal(h.inspections(),0);
  f.changeResult({...resultObject,revision:2});
  const stale=await h.reader.previewContinuation(input);
  assert.equal(stale.nativeContinuationState,'PREDECESSOR_RESULT_NOT_AVAILABLE');assert.equal(h.inspections(),0);
  const noNative=trusted(f);
  await assert.rejects(noNative.reader.previewContinuation({...input,nativeContinuation:{preview:()=>({})}}),
    code('T3_METHOD_STAGE_NATIVE_OWNER_REQUIRED'));
});
test('native continuation readback must match exact source and pinned recipient; no target Work acceptance',async()=>{
  const f=await setup(),p={status:'AVAILABLE',operationId:'native:op',recipientId:'iwxa.atlas',reference:resultRef};
  const call=extra=>inspectWorkspaceMethodNativeContinuation({...args(f),predecessorStepId:'analyse',recipientId:'iwxa.atlas',
    nativeContinuation:{preview:()=>p,recover:()=>({status:'OWNER_READBACK_CONFIRMED',operationId:p.operationId,
      recipientId:p.recipientId,reference:p.reference,resultRef:'atlas:result'})},...extra});
  await assert.rejects(call({nativeContinuation:{preview:()=>({...p,recipientId:'wrong'})}}),code('METHOD_STAGE_NATIVE_PREVIEW_MISMATCH'));
  await assert.rejects(call({recover:true,nativeContinuation:{preview:()=>p,recover:()=>({status:'OUTCOME_UNKNOWN',operationId:'other'})}}),
    code('METHOD_STAGE_NATIVE_RECEIPT_MISMATCH'));
  const r=await call({recover:true});
  assert.equal(r.nativeContinuation.receipt.status,'OWNER_READBACK_CONFIRMED');
  assert.equal(r.nativeContinuation.recipientAcceptanceDoesNotProveWorkCompletion,true);
  assert.equal(r.targetWorkBound,false);assert.equal(r.resultReuseProven,false);
});
test('changed materials or signed context while original native recipient is inspected invalidate Workflow observation',async()=>{
  const f=await setup(),h=trusted(f,{withNative:true}),input={...hostInput(f),predecessorStepId:'analyse'};
  h.nativeHook(()=>{h.context.purpose='other';});
  await assert.rejects(h.reader.previewContinuation(input),e=>['T3_D6_SIGNED_CONTEXT_CHANGED','T3_METHOD_STAGE_SIGNED_CONTEXT_CHANGED'].includes(e.code));
  const g=await setup();let changed=false;
  const port={preview:async reference=>{changed=true;return {status:'AVAILABLE',recipientId:'iwxa.atlas',operationId:'native:op',reference};}};
  await assert.rejects(inspectWorkspaceMethodNativeContinuation({...args(g),predecessorStepId:'analyse',recipientId:'iwxa.atlas',
    nativeContinuation:port,readObject:async(w,id)=>{
      const row=await g.readObject(w,id);return changed&&id==='source'?{object:{...row.object,revision:2}}:row;
    }}),code('METHOD_STAGE_RESULT_BASIS_CHANGED'));
});

test('trusted original Host material evidence uses scoped D1 Asset operations and never native dispatch',async()=>{
  const f=await setup(),calls=[],h=trusted(f,{withAssets:true,withAgent:false,assetHook:(kind,query)=>calls.push([kind,query])});
  const result=await h.reader.inspectMaterialEvidence({...hostInput(f),stepId:'analyse',resultSelections:[]});
  assert.equal(result.state,'VISIBLE_MATERIAL_CONTENT_OBSERVED');assert.equal(result.observation.counts.assets,1);
  assert.equal(calls.length,4);assert.equal(calls.every(row=>row[1].workspace_id===ws),true);
  assert.equal(result.contentBindingProven,false);assert.equal(h.receives(),0);assert.equal(f.nativeCalls.length,0);
  const missing=trusted(f,{withAgent:false});
  await assert.rejects(missing.reader.inspectMaterialEvidence({...hostInput(f),stepId:'analyse',resultSelections:[]}),
    code('T3_METHOD_STAGE_ASSET_READ_REQUIRED'));
});
test('trusted original Host fences signed context throughout visible Asset observation',async()=>{
  const f=await setup();let h;
  h=trusted(f,{withAssets:true,assetHook:kind=>{if(kind==='get')h.context.purpose='different';}});
  await assert.rejects(h.reader.inspectMaterialEvidence({...hostInput(f),stepId:'analyse',resultSelections:[]}),
    e=>['T3_SUBJECT_CONTEXT_CHANGED','T3_METHOD_STAGE_SIGNED_CONTEXT_CHANGED','T3_SUBJECT_RESULT_STALE_AFTER_KERNEL'].includes(e.code));
});


// W05.9: combined content + accepted predecessor evidence, shared original
// source observation. No second store, task or cached UI evidence.
function contentPort(){
  const bytes=new Uint8Array([1,2,3]),calls=[];
  const asset={workspace_id:ws,object_id:'source',asset_id:'attachment',revision:1,mime:'application/octet-stream',
    size:3,service_id:'svc',created_at:time,updated_at:time,updated_by_service:'svc'};
  return {asset,bytes,calls,listAssets:async query=>{calls.push(['list',query]);return query.object_id==='source'?[asset]:[];},
    getAsset:async(w,id)=>{calls.push(['get',w,id]);return {asset,bytes};}};
}
function contentArgs(f,port,extra={}){
  return args(f,{includeMaterialEvidence:true,listAssets:port.listAssets,getAsset:port.getAsset,
    readObject:async(w,id)=>{const row=await f.readObject(w,id);return row?{object:{...row.object,extensions:{}}}:null;},...extra});
}
test('combined handoff uses one original selected source closure and binds visible content plus explicit accepted Result',async()=>{
  const f=await setup(),p=contentPort();let loads=0;
  const owner={load:async(...a)=>{loads++;return f.owner.load(...a);}};
  const refOnly=await previewWorkspaceMethodStageHandoff(args(f,{owner})),referenceLoads=loads;loads=0;f.nativeCalls.length=0;
  const combined=await previewWorkspaceMethodStageHandoff(contentArgs(f,p,{owner}));
  assert.equal(loads,referenceLoads);
  assert.equal(combined.materialEvidenceRequested,true);
  assert.equal(combined.materialEvidence.state,'VISIBLE_MATERIAL_CONTENT_OBSERVED');
  assert.equal(combined.materialEvidence.observation.counts.assets,1);
  assert.equal(combined.binding.materialEvidenceDigest,combined.materialEvidence.materialEvidenceDigest);
  assert.equal(combined.binding.inputBasisDigest,refOnly.binding.inputBasisDigest);
  assert.deepEqual(combined.binding.predecessorResults,refOnly.binding.predecessorResults);
  assert.notEqual(combined.candidateDigest,refOnly.candidateDigest);
  assert.equal(f.nativeCalls.length,2);assert.equal(p.calls.length,4);
  assert.equal(combined.exactInputBindingProven,false);assert.equal(combined.contentBindingProven,false);
  assert.equal(combined.taskCreated,false);assert.equal(combined.dispatchAuthorized,false);
  assert.equal(JSON.stringify(combined).includes('source body'),false);
  const repeat=await previewWorkspaceMethodStageHandoff(contentArgs(f,p));
  assert.equal(repeat.candidateDigest,combined.candidateDigest);
  const changed=await previewWorkspaceMethodStageHandoff(contentArgs(f,p,{getAsset:async()=>({asset:p.asset,bytes:new Uint8Array([1,2,4])})}));
  assert.notEqual(changed.candidateDigest,combined.candidateDigest);
  assert.equal(changed.binding.inputBasisDigest,combined.binding.inputBasisDigest);
  assert.equal((await f.owner.audit()).length,3);
});
test('combined handoff does not read attachment bytes while required predecessor is missing or stale',async()=>{
  const f=await setup(),p=contentPort();
  for(const x of [{resultSelections:[]},{resultSelections:selection}]){
    if(x.resultSelections.length)f.changeResult({...resultObject,revision:2});
    const r=await previewWorkspaceMethodStageHandoff(contentArgs(f,p,x));
    assert.equal(r.candidateDigest,null);assert.equal(r.binding,null);assert.equal(r.materialEvidence,null);
    assert.equal(r.materialEvidenceRequested,true);assert.equal(p.calls.length,0);
  }
  await assert.rejects(previewWorkspaceMethodStageHandoff(contentArgs(f,p,{getAsset:undefined})),code('METHOD_MATERIAL_ASSET_OWNER_REQUIRED'));
  await assert.rejects(previewWorkspaceMethodStageHandoff(args(f,{includeMaterialEvidence:'true'})),code('METHOD_MATERIAL_EVIDENCE_REQUEST_INVALID'));
});
test('combined handoff rejects changes in actual visible bytes and original accepted owner evidence between reads',async()=>{
  const f=await setup(),p=contentPort();let calls=0;
  await assert.rejects(previewWorkspaceMethodStageHandoff(contentArgs(f,p,{getAsset:async()=>({asset:p.asset,
    bytes:++calls===1?p.bytes:new Uint8Array([1,2,4])})})),code('METHOD_MATERIAL_CONTENT_CHANGED'));
  await assert.rejects(previewWorkspaceMethodStageHandoff(contentArgs(f,p,{getAsset:async()=>{f.changeAccepted({...accepted,archiveSha256:'c'.repeat(64)});
    return {asset:p.asset,bytes:p.bytes};}})),code('METHOD_STAGE_RESULT_CHANGED'));
});
test('combined root handoff works without an Agent Result owner and uses original content evidence',async()=>{
  const f=await setup(),p=contentPort();
  const r=await previewWorkspaceMethodStageHandoff(contentArgs(f,p,{stepId:'analyse',resultSelections:[],readAccepted:undefined}));
  assert.equal(r.state,'INPUTS_PREPARED_OWNER_SELECTION_REQUIRED');assert.ok(r.candidateDigest);
  assert.equal(r.materialEvidence.observation.counts.assets,1);assert.deepEqual(r.binding.predecessorResults,[]);
  assert.equal(f.nativeCalls.length,0);assert.equal(r.signedTaskIssued,false);
});
test('trusted Host combined handoff obtains original Asset permissions and ignores caller evidence or read ports',async()=>{
  const f=await setup(),calls=[],h=trusted(f,{withAssets:true,assetHook:(kind,query)=>calls.push([kind,query])});
  const r=await h.reader.previewHandoff({...hostInput(f),includeMaterialEvidence:true,
    materialEvidence:{materialEvidenceDigest:'e'.repeat(64)},listAssets:()=>{throw Error('caller');},getAsset:()=>{throw Error('caller');}});
  assert.equal(r.materialEvidenceRequested,true);assert.equal(r.materialEvidence.observation.counts.assets,1);
  assert.notEqual(r.materialEvidence.materialEvidenceDigest,'e'.repeat(64));assert.equal(calls.length,4);
  assert.equal(h.receives(),0);
  await assert.rejects(trusted(f).reader.previewHandoff({...hostInput(f),includeMaterialEvidence:true}),code('T3_METHOD_STAGE_ASSET_READ_REQUIRED'));
});


function personalTextPort(){
  const p=contentPort(),bytes=new TextEncoder().encode('actual text');
  const asset={...p.asset,mime:'text/plain',size:bytes.length};
  return {...p,asset,bytes,listAssets:async q=>q.object_id==='source'?[asset]:[],
    getAsset:async()=>({asset,bytes})};
}
const personalArgs=(f,p,extra={})=>contentArgs(f,p,{stepId:'analyse',resultSelections:[],subjectKind:'PERSONAL',...extra});
test('root personal Agent draft materializes exact original text and canonical input metadata, never a Task',async()=>{
  const f=await setup(),p=personalTextPort(),input=personalArgs(f,p);
  const preview=await previewWorkspaceMethodStageHandoff(input);
  assert.ok(preview.requiredOriginalOwnerChecks.includes('ORIGINAL_PERSONAL_TASK_AND_CONTEXT_BINDING'));
  assert.ok(!preview.requiredOriginalOwnerChecks.includes('ORIGINAL_SIGNED_TASK_BINDING'));
  const r=await buildWorkspaceMethodPersonalTaskDraft({...input,expectedCandidateDigest:preview.candidateDigest});
  assert.equal(r.candidateDigest,preview.candidateDigest);assert.equal(r.draft.text,'Review original result\n\nAnalyse original');
  assert.deepEqual(r.draft.attachments.map(a=>a.name),['material-001.json','attachment-001.txt','workflow-inputs.json']);
  assert.equal(r.draft.attachments[1].text,'actual text');
  assert.equal(JSON.parse(r.draft.attachments[0].text).data.private,'source body');
  const manifest=JSON.parse(r.draft.attachments[2].text);
  assert.equal(manifest.candidateDigest,preview.candidateDigest);
  assert.equal(manifest.materialEvidence.materials[0].visibleAssets[0].sha256,createHash('sha256').update(p.bytes).digest('hex'));
  assert.equal(manifest.allAssetsProven,false);
  assert.equal(JSON.stringify(preview).includes('actual text'),false);
  assert.equal((await f.owner.audit()).length,3);
});
test('personal draft does not silently truncate, substitute or omit unsupported content',async()=>{
  const f=await setup(),p=personalTextPort(),input=personalArgs(f,p);
  const preview=await previewWorkspaceMethodStageHandoff(input);
  await assert.rejects(buildWorkspaceMethodPersonalTaskDraft({...input,expectedCandidateDigest:'e'.repeat(64)}),code('METHOD_PERSONAL_DRAFT_EVIDENCE_CHANGED'));
  await assert.rejects(buildWorkspaceMethodPersonalTaskDraft({...contentArgs(f,p),expectedCandidateDigest:preview.candidateDigest}),code('METHOD_PERSONAL_DRAFT_ROOT_AGENT_REQUIRED'));
  const unsupported=contentPort(),u=personalArgs(f,unsupported),up=await previewWorkspaceMethodStageHandoff(u);
  await assert.rejects(buildWorkspaceMethodPersonalTaskDraft({...u,expectedCandidateDigest:up.candidateDigest}),code('METHOD_PERSONAL_DRAFT_ATTACHMENT_UNSUPPORTED'));
  const bytes=new Uint8Array(48000).fill(65),asset={...p.asset,size:bytes.length};
  const big=personalArgs(f,{...p,listAssets:async()=>[asset],getAsset:async()=>({asset,bytes})});
  const bp=await previewWorkspaceMethodStageHandoff(big);
  await assert.rejects(buildWorkspaceMethodPersonalTaskDraft({...big,expectedCandidateDigest:bp.candidateDigest}),code('METHOD_PERSONAL_DRAFT_CONTENT_LIMIT'));
});
function composerFixture(){
  const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
  let binding={subjectKind:'PERSONAL',sourceWorkspaceId:ws,agentWorkspaceId:'personal',contextEpoch:'native-1'};
  let state={workspace_id:'personal',state:'EMPTY_OR_UNREADABLE',text:'',knowledge_sources:[],attachments:[],local_model:null,pending_submission:null};
  let reads=0,writes=0,lose=false,hook=null;
  const view=()=>({...structuredClone(state),draft_digest:hash(state)});
  const port={currentBinding:async()=>({...binding}),composerDraft:async (input,expectedBinding)=>{
    assert.deepEqual(expectedBinding,binding);
    if(!Object.hasOwn(input,'text')){reads++;return view();}
    writes++;if(hook)await hook();
    if(JSON.stringify(expectedBinding)!==JSON.stringify(binding)||input.expected_draft_digest!==view().draft_digest
      ||state.pending_submission!==null||state.text!==''||state.attachments.length||state.knowledge_sources.length)
      throw Error('composer_draft_changed');
    state={...state,state:'SAVED',text:input.text,knowledge_sources:structuredClone(input.knowledge_sources),attachments:structuredClone(input.attachments)};
    if(lose)throw Error('lost ACK');return view();
  }};
  return {port,view,reads:()=>reads,writes:()=>writes,lose:()=>{lose=true;},hook:fn=>{hook=fn;},
    edit:patch=>{state={...state,...patch};},binding:patch=>{binding={...binding,...patch};}};
}
async function personalHost(f,composer,confirm=()=>true){
  const h=trusted(f,{withAssets:true,withAgent:false,personalComposer:composer.port,confirmPersonalDraft:confirm});
  const input={...hostInput(f),stepId:'analyse',resultSelections:[],includeMaterialEvidence:true};
  const preview=await h.reader.previewHandoff(input);
  return {h,input:{...input,expectedCandidateDigest:preview.candidateDigest},preview};
}
test('trusted personal Workflow saves actual editable draft through original composer CAS and recovers a lost ACK without resend',async()=>{
  const f=await setup(),c=composerFixture();let confirms=0;c.lose();
  const {h,input}=await personalHost(f,c,()=>{confirms++;return true;});
  const first=await h.reader.createPersonalDraft(input);
  assert.equal(first.state,'DRAFT_CONFIRMED');assert.equal(first.draftSaved,true);
  assert.equal(first.taskCreated,false);assert.equal(first.executionPerformed,false);assert.equal(first.modelInvoked,false);
  assert.equal(c.writes(),1);assert.equal(confirms,1);
  assert.equal(c.view().attachments[1].text,'*');assert.equal(c.view().attachments.length,3);
  assert.equal(JSON.stringify(first).includes('source body'),false);
  const repeat=await h.reader.createPersonalDraft(input);assert.equal(repeat.state,'DRAFT_ALREADY_PRESENT');
  const recovered=await h.reader.recoverPersonalDraft(input);assert.equal(recovered.state,'DRAFT_ALREADY_PRESENT');
  assert.equal(c.writes(),1);assert.equal(confirms,1);
});
test('existing draft, pending submission and human cancellation never overwrite original Agent composer',async()=>{
  const f=await setup(),c=composerFixture();let confirms=0;
  const {h,input}=await personalHost(f,c,()=>{confirms++;return false;});
  c.edit({state:'SAVED',text:'Existing user work'});
  assert.equal((await h.reader.createPersonalDraft(input)).state,'DRAFT_OCCUPIED');
  c.edit({text:'',pending_submission:{submission_id:'fixture'}});
  assert.equal((await h.reader.createPersonalDraft(input)).state,'DRAFT_OCCUPIED');
  c.edit({pending_submission:null});assert.equal((await h.reader.createPersonalDraft(input)).state,'USER_CANCELLED');
  assert.equal(c.writes(),0);assert.equal(confirms,1);
});
test('personal draft checks original context and native area mapping across consent and refuses stale candidate digest',async()=>{
  const f=await setup(),c=composerFixture();let h;
  const x=await personalHost(f,c,()=>{c.binding({contextEpoch:'new'});return true;});h=x.h;
  await assert.rejects(h.reader.createPersonalDraft(x.input),code('T3_METHOD_PERSONAL_DRAFT_NATIVE_SCOPE_CHANGED'));
  assert.equal(c.writes(),0);
  c.binding({contextEpoch:'native-1'});await assert.rejects(h.reader.createPersonalDraft({...x.input,expectedCandidateDigest:'f'.repeat(64)}),code('METHOD_PERSONAL_DRAFT_EVIDENCE_CHANGED'));
  h.context.kind='CORP';await assert.rejects(h.reader.createPersonalDraft(x.input),code('T3_METHOD_PERSONAL_DRAFT_PERSONAL_OWNER_REQUIRED'));
  assert.equal(c.writes(),0);
});
test('native composer edit after consent is kept; original visible input change after consent aborts before save',async()=>{
  const f=await setup(),c=composerFixture();const x=await personalHost(f,c,()=>{c.edit({state:'SAVED',text:'User just typed'});return true;});
  assert.equal((await x.h.reader.createPersonalDraft(x.input)).state,'DRAFT_CHANGED');assert.equal(c.view().text,'User just typed');assert.equal(c.writes(),0);
  const g=await setup(),d=composerFixture();let changed=false;
  const ownerRead=g.readObject;g.readObject=async(...a)=>{const row=await ownerRead(...a);return changed&&a[1]==='source'?{object:{...row.object,data:{changed:true}}}:row;};
  const y=await personalHost(g,d,()=>{changed=true;return true;});
  await assert.rejects(y.h.reader.createPersonalDraft(y.input),code('METHOD_PERSONAL_DRAFT_EVIDENCE_CHANGED'));
  assert.equal(d.writes(),0);
});
test('personal draft recovery of absent or different content only reads, never creates or resubmits a Task',async()=>{
  const f=await setup(),c=composerFixture(),x=await personalHost(f,c,()=>{throw Error('unexpected consent');});
  assert.equal((await x.h.reader.recoverPersonalDraft(x.input)).state,'OUTCOME_UNKNOWN');
  c.edit({state:'SAVED',text:'Different'});assert.equal((await x.h.reader.recoverPersonalDraft(x.input)).state,'OUTCOME_UNKNOWN');
  assert.equal(c.writes(),0);
});

test('personal composer adapter fences pending submission even when content digest is unchanged',async()=>{
  const f=await setup(),c=composerFixture(),x=await personalHost(f,c);
  c.hook(()=>c.edit({pending_submission:{submission_id:'new reservation'}}));
  const r=await x.h.reader.createPersonalDraft(x.input);
  assert.equal(r.state,'OUTCOME_UNKNOWN');assert.equal(c.view().text,'');
  assert.equal(c.view().pending_submission.submission_id,'new reservation');
});
test('personal draft Host permits only one outstanding approval and preserves original model preference',async()=>{
  const f=await setup(),c=composerFixture();
  c.edit({state:'SAVED',local_model:'original-model'});
  let approve,entered;const started=new Promise(resolve=>{entered=resolve;});
  const x=await personalHost(f,c,()=>{entered();return new Promise(resolve=>{approve=resolve;});});
  const first=x.h.reader.createPersonalDraft(x.input);await started;
  await assert.rejects(x.h.reader.createPersonalDraft(x.input),code('T3_METHOD_PERSONAL_DRAFT_IN_PROGRESS'));
  await assert.rejects(x.h.reader.recoverPersonalDraft(x.input),code('T3_METHOD_PERSONAL_DRAFT_IN_PROGRESS'));
  approve(true);
  assert.equal((await first).state,'DRAFT_CONFIRMED');assert.equal(c.writes(),1);
  assert.equal(c.view().local_model,'original-model');
});

async function personalTaskFixture(){
  const f=await setup(),p=personalTextPort(),input=personalArgs(f,p);
  const preview=await previewWorkspaceMethodStageHandoff(input),build=()=>buildWorkspaceMethodPersonalTaskDraft({...input,expectedCandidateDigest:preview.candidateDigest});
  const plan=await build(),c=composerFixture(),hash=text=>createHash('sha256').update(text,'utf8').digest('hex');
  const taskId='TASK-fixture',summary='Human reviewed analysis';
  let run={task:{task_id:taskId,objective:plan.draft.text},result:{task_id:taskId,result_id:'RES-fixture',
    task_digest:'a'.repeat(64),context_projection_digest:'b'.repeat(64),run_bundle_digest:'c'.repeat(64),
    performed_external_actions:false,summary},
    snapshot:{task_id:taskId,snapshot_id:'CSN-fixture',snapshot_digest:'d'.repeat(64),projection_digest:'b'.repeat(64),
      bundle_digest:'c'.repeat(64),retrieval_refs:[],source_items:plan.draft.attachments.map((a,i)=>({
        path:'attachments/'+String(i+1).padStart(2,'0')+'-'+a.name,origin:'interaction_attachment',sha256:hash(a.text),bytes:Buffer.byteLength(a.text)}))},
    acceptedSource:{task_id:taskId,workspace_ref:'personal',contract_version:'PA.K01_ACCEPTED_RESULT_SOURCE/0.1.0',
      state:'accepted',read_only:true,commercial_approval_claimed:false,result_id:'RES-fixture',review_id:'REV-fixture',
      accepted_artifact_digest:'e'.repeat(64),revision:'sha256:'+hash(summary),content:summary}};
  let reads=0,documents=0,hook=null;
  const taskOwner={readAcceptedRun:async(id,binding)=>{assert.equal(id,taskId);assert.equal(binding.agentWorkspaceId,'personal');reads++;return structuredClone(run);},
    taskDocumentSource:async(id,sid,path,digest,binding)=>{assert.equal(binding.agentWorkspaceId,'personal');documents++;
      const a=plan.draft.attachments[Number(path.slice(12,14))-1];
      const value={task_id:id,snapshot_id:sid,path,sha256:digest,text:a.text};
      return hook?hook(value):value;}};
  return {run,plan,c,build,reads:()=>reads,documents:()=>documents,hook:fn=>{hook=fn;},
    inspect:()=>inspectOriginalPersonalWorkflowTask({plan,taskId,composer:c.port,taskOwner,guarded:fn=>fn(),refreshPlan:build})};
}
test('selected accepted personal Task matches original accepted run and exact declared text sources, not the editable draft',async()=>{
  const f=await personalTaskFixture(),r=await f.inspect();
  assert.equal(r.state,'ORIGINAL_ACCEPTED_TASK_DECLARED_INPUTS_MATCHED');assert.equal(r.declaredDraftInputsVerified,true);
  assert.equal(r.exactInputBindingProven,false);assert.equal(r.workCompleted,false);assert.equal(r.resultReuseProven,false);
  assert.equal(f.reads(),2);assert.equal(f.documents(),6);assert.equal(f.c.writes(),0);
  assert.equal(JSON.stringify(r).includes('Human reviewed analysis'),false);
});
test('accepted Task verification rejects a different run, extra retrieval, altered objective and changed attachment bytes',async()=>{
  for(const mutate of [r=>r.snapshot.bundle_digest='f'.repeat(64),r=>r.acceptedSource.workspace_ref='AREA-123456789012345678',
    r=>r.acceptedSource.revision='sha256:'+'f'.repeat(64)]){
    const f=await personalTaskFixture();mutate(f.run);
    await assert.rejects(f.inspect(),code('T3_METHOD_PERSONAL_TASK_ACCEPTED_RUN_MISMATCH'));
  }
  for(const mutate of [r=>r.snapshot.retrieval_refs.push({id:'extra'}),r=>r.task.objective='changed',
    r=>r.snapshot.source_items[0].sha256='f'.repeat(64)]){
    const f=await personalTaskFixture();mutate(f.run);
    await assert.rejects(f.inspect(),code('T3_METHOD_PERSONAL_TASK_INPUT_CHANGED'));
  }
  const f=await personalTaskFixture();f.hook(value=>({...value,text:'changed'}));
  await assert.rejects(f.inspect(),code('T3_METHOD_PERSONAL_TASK_INPUT_CHANGED'));
});
test('accepted personal Task changed during verification is not reported as matched',async()=>{
  const f=await personalTaskFixture();
  f.hook(value=>{f.run.acceptedSource.accepted_artifact_digest='f'.repeat(64);return value;});
  await assert.rejects(f.inspect(),code('T3_METHOD_PERSONAL_TASK_ACCEPTED_RUN_CHANGED'));
});
