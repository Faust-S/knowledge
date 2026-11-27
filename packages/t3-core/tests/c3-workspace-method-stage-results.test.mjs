import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createProjectProcessSourceOwnerQualificationHarness } from '../src/modules/base/owners/project-process-source-owner.mjs';
import { createWorkspaceMethodThroughSourceOwner } from '../src/modules/base/owners/project-process-method-materialization.mjs';
import { applyWorkspaceMethodRevision } from '../src/modules/base/owners/project-process-method-revision.mjs';
import { inspectWorkspaceMethodAgentPredecessorResults,previewWorkspaceMethodStageHandoff,inspectWorkspaceMethodNativeContinuation } from '../src/modules/base/owners/project-process-method-stage-input.mjs';
import { createTrustedWorkspaceMethodStageReader } from '../src/t3/workspace-method-stage-reader.mjs';
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
function trusted(f,{withAgent=true,withNative=false,withAssets=false,assetHook=()=>{}}={}){
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
    nativeContinuation,nativeRecipientId:withNative?recipientId:null,isHostActive:()=>active});
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
    e=>['T3_SUBJECT_CONTEXT_CHANGED','T3_METHOD_STAGE_SIGNED_CONTEXT_CHANGED'].includes(e.code));
});
