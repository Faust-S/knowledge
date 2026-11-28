import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalStringify } from '../src/persistence/canonical-codec.mjs';
import { createProjectProcessSourceOwnerQualificationHarness } from '../src/modules/base/owners/project-process-source-owner.mjs';
import { createWorkspaceMethodThroughSourceOwner } from '../src/modules/base/owners/project-process-method-materialization.mjs';
import { applyWorkspaceMethodRevision } from '../src/modules/base/owners/project-process-method-revision.mjs';
import { inspectWorkspaceMethodAgentPredecessorResults,previewWorkspaceMethodStageHandoff,inspectWorkspaceMethodNativeContinuation,buildWorkspaceMethodPersonalTaskDraft,buildWorkspaceMethodCorporateTaskInputs } from '../src/modules/base/owners/project-process-method-stage-input.mjs';
import { createTrustedWorkspaceMethodStageReader,createTrustedWorkspaceMethodCorporateInputReader,createTrustedWorkspaceMethodProgramInputReader } from '../src/t3/workspace-method-stage-reader.mjs';
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
    recordIds:{project:'method-source',works:Object.fromEntries(value.steps.map(row=>[projectId+'.'+row.id,row.id+'-source']))},knowledgeAt:time});
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
function trusted(f,{withAgent=true,withNative=false,withAssets=false,assetHook=()=>{},personalComposer=null,confirmPersonalDraft=null,personalTaskOwner=null,corporateTaskOwner=null,corporateResultOwner=null,confirmAlternative=null,subjectKind='PERSONAL',assetBytes=new Uint8Array([42]),assetMime='text/plain'}={}){
  const workspace={workspace_id:ws,deleted_at:null};
  let chosen=workspace,active=true,allowed=true;const listeners=new Set();
  const currentWorkspace={get:()=>chosen,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
  const context={kind:subjectKind,context_id:'ctx:work',actor_id:'person:owner',principal_id:subjectKind==='CORP'?'org:fixture':'person:owner',
    role_id:'role:owner',grant_id:'grant:owner',realm_id:'realm:personal',audience:'host:t3',resource:ws,
    purpose:'work',workspace_id:ws,organization_id:subjectKind==='CORP'?'org:fixture':null,scope_revision:1};
  const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
  const access={currentContext:()=>context,actionFor:()=> 'object.read',operationDigest:sha,
    authorize:request=>({schema:subjectKind==='CORP'?'IWXA_T3_ORGANIZATION_OPERATION_DECISION/1':'IWXA_T3_AUTHORIZATION_DECISION/1',allowed,outcome:allowed?'PERMITTED':'DENIED',
      ...(subjectKind==='CORP'?{organizationId:context.organization_id,workspaceId:context.workspace_id,grantId:context.grant_id,
        operationDigest:request.operationDigest,evidenceDigest:sha('corporate-evidence'),productionActivation:false,
        doesNotTransferData:true,doesNotAcceptCorporateCopy:true}:{}),
      evidenceOnly:true,requestDigest:sha(request),policyDigest:sha('policy'),statusSequence:1,
      validUntil:new Date(Date.now()+60000).toISOString(),statusObservedAt:new Date().toISOString(),
      evaluatedAt:new Date().toISOString(),authorityPath:[{grantId:context.grant_id}]}),
    verifyDecisionBinding:(request,decision)=>decision.requestDigest===sha(request)};
  const asset={workspace_id:ws,object_id:'source',asset_id:'asset:1',revision:1,mime:assetMime,size:assetBytes.byteLength,
    service_id:'svc',created_at:time,updated_at:time,updated_by_service:'svc'};
  const kernel={sessionInfo:{contract_version:'1.3.0'},hasOperation:op=>['t1.getWorkspace','t1.getObject',
      ...(withAssets?['t1.listAssets','t1.getAsset']:[])].includes(op),
    getWorkspace:async workspaceId=>workspaceId===ws?workspace:null,
    getObject:async(...a)=>{const row=await f.readObject(...a);return row?{...row,object:{...row.object,extensions:{}},relations:{incoming:[],outgoing:[]}}:null;},
    listAssets:async query=>{assetHook('list',query);return query.object_id==='source'?[asset]:[];},
    getAsset:async(workspaceId,id)=>{assetHook('get',{workspace_id:workspaceId,asset_id:id});return {asset,bytes:assetBytes.slice()};}};
  let hook=null,nativeHook=null,received=null,inspections=0,receives=0,confirmations=0;
  const recipientId='iwxa.atlas',operationId='native:operation:fixture';
  const nativeOwner={recipientId,
    inspect:async({reference})=>{inspections++;if(nativeHook)await nativeHook();return {status:'READY',reference,recipientId,operationId};},
    receive:async({reference})=>{receives++;received={state:'COMMITTED',reference,recipientId,operationId,resultRef:'atlas:result:fixture'};},
    receipt:async()=>received,readback:async()=>received?{...received,state:'PERSISTED'}:null};
  const nativeContinuation=withNative?createTrustedNativeContinuation({kernel,accessForRead:async()=>access,currentWorkspace,nativeOwner,
    confirmHuman:async()=>{confirmations++;return true;},isHostActive:()=>active}):null;
  // Controlled native Task-owner verifier. Cross-repository qualification
  // uses the actual original T3 verifier instead of this fixture port.
  const nativeTaskOwner=corporateTaskOwner?{...corporateTaskOwner,verifyTextInputs:corporateTaskOwner.verifyTextInputs??(async(request,ctx)=>{
    const last=await corporateTaskOwner.readSignedTask(request.taskId,ctx);
    const manifest=JSON.parse(request.attachments.at(-1).text),counts=manifest.materialEvidence.counts;
    return {state:'WORKFLOW_TEXT_INPUT_SNAPSHOT_MATCHED',taskId:last.taskId,taskRevisionId:last.taskRevisionId,
      packageSha256:last.packageSha256,originalContextEpoch:last.originalContextEpoch,candidateDigest:last.workflowReference.workflowInput.candidateDigest,
      attachmentDigest:createHash('sha256').update(canonicalStringify(request.attachments),'utf8').digest('hex'),
      counts:{materials:counts.materials,assets:counts.assets,results:manifest.handoff.predecessorResults.length,
        attachments:request.attachments.length,attachmentBytes:request.attachments.reduce((sum,a)=>sum+Buffer.byteLength(a.text,'utf8'),0)},
      declaredSnapshotBytesVerified:true,sourceCurrentnessProven:false,allAssetsProven:false,disclosureAuthorized:false,
      executionAuthorized:false,exactInputBindingProven:false,workCompleted:false};
  })}:null;
  const ports={kernel,accessForRead:async()=>access,currentWorkspace,sourceOwner:f.owner,
    originalAgentResultOwner:withAgent?{readAccepted:async ref=>{if(hook)await hook();return f.readAccepted(ref);}}:null,
    nativeContinuation,nativeRecipientId:withNative?recipientId:null,personalComposer,confirmPersonalDraft,personalTaskOwner,corporateTaskOwner,corporateResultOwner,confirmAlternative,isHostActive:()=>active};
  const reader=createTrustedWorkspaceMethodStageReader(ports);
  const nativeProgramInputs=createTrustedWorkspaceMethodProgramInputReader(ports);
  const nativeInputs=nativeTaskOwner?createTrustedWorkspaceMethodCorporateInputReader({...ports,corporateTaskOwner:nativeTaskOwner}):null;
  const changeSelection=()=>{chosen={...workspace};for(const notify of listeners)notify();};
  return {reader,nativeInputs,nativeProgramInputs,context,deny:()=>{allowed=false;},changeSelection,dispose:()=>{active=false;},hook:fn=>{hook=fn;},
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
      state:'accepted',kind:'result',source_ref:'agent-result:'+taskId,read_only:true,commercial_approval_claimed:false,result_id:'RES-fixture',review_id:'REV-fixture',
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

test('original initial revision guidance and native operational skill are distinct verified system sources, never declared user inputs',async()=>{
  const f=await personalTaskFixture(),text='# Revision guidance\nInitial run: no human revision guidance.\n';
  const guidance={path:'iwxa/revision-guidance.md',origin:'iwxa_revision_control',classification:'personal',trust_level:'system_generated',
    sha256:createHash('sha256').update(text).digest('hex'),bytes:Buffer.byteLength(text)};
  const skill={...guidance,path:'iwxa/operational-skill.md',origin:'iwxa_operational_skill',sha256:'b'.repeat(64),bytes:50};
  f.run.snapshot.source_items.push(guidance,skill);
  const r=await f.inspect();
  assert.equal(r.nativeSystemSourceCount,2);assert.match(r.nativeSystemSourcesDigest,/^[a-f0-9]{64}$/);
  assert.equal(f.documents(),6);assert.equal(r.exactInputBindingProven,false);
  f.run.snapshot.source_items[3]={...guidance,sha256:'f'.repeat(64)};
  await assert.rejects(f.inspect(),code('T3_METHOD_PERSONAL_TASK_INPUT_CHANGED'));
  f.run.snapshot.source_items[3]={...guidance,trust_level:'user_provided'};
  await assert.rejects(f.inspect(),code('T3_METHOD_PERSONAL_TASK_INPUT_CHANGED'));
  f.run.snapshot.source_items[3]={...guidance,path:'iwxa/unrelated.md'};
  await assert.rejects(f.inspect(),code('T3_METHOD_PERSONAL_TASK_INPUT_CHANGED'));
});


// W05.15: original C3 owner + original signed Host binding + controlled
// original Task/Context/Result owner ports; not an installed Agent claim.
async function personalChainFixture({diamond=false}={}){
  const d=draft();d.steps[1].actor='agent';
  if(diamond)d.steps.push({id:'compute',name:'Compute',actor:'agent',instruction:'Compute independent evidence',dependsOn:['analyse'],materialIds:[]});
  d.steps.push({id:'finish',name:'Finish',actor:'agent',instruction:'Prepare final conclusions',dependsOn:diamond?['review','compute']:['review'],materialIds:[]});
  const f=await setup(d),c=composerFixture(),runs=new Map(),reads=[],documents=[];
  const hash=text=>createHash('sha256').update(text,'utf8').digest('hex');
  const addRun=(taskId,summary)=>{
    const plan=c.view(),suffix=taskId.slice(5);
    const run={task:{task_id:taskId,objective:plan.text.trim()},result:{task_id:taskId,result_id:'RES-'+suffix,
      task_digest:'a'.repeat(64),context_projection_digest:'b'.repeat(64),run_bundle_digest:'c'.repeat(64),
      performed_external_actions:false,summary},
      snapshot:{task_id:taskId,snapshot_id:'CSN-'+suffix,snapshot_digest:'d'.repeat(64),projection_digest:'b'.repeat(64),
        bundle_digest:'c'.repeat(64),retrieval_refs:[],source_items:plan.attachments.map((a,i)=>({
          path:'attachments/'+String(i+1).padStart(2,'0')+'-'+a.name,origin:'interaction_attachment',sha256:hash(a.text),bytes:Buffer.byteLength(a.text)}))},
      acceptedSource:{task_id:taskId,workspace_ref:'personal',contract_version:'PA.K01_ACCEPTED_RESULT_SOURCE/0.1.0',
        state:'accepted',kind:'result',source_ref:'agent-result:'+taskId,read_only:true,commercial_approval_claimed:false,
        result_id:'RES-'+suffix,review_id:'REV-'+suffix,accepted_artifact_digest:hash(taskId+summary),
        revision:'sha256:'+hash(summary),content:summary}};
    runs.set(taskId,{run,attachments:structuredClone(plan.attachments)});
    c.edit({text:'',attachments:[],knowledge_sources:[]});return run;
  };
  let hook=null,assetReads=0;
  const taskOwner={readAcceptedRun:async(id,binding)=>{
    assert.equal(binding.agentWorkspaceId,'personal');reads.push(id);
    if(hook)await hook(id);
    return structuredClone(runs.get(id)?.run);
  },taskDocumentSource:async(id,sid,path,digest,binding)=>{
    assert.equal(binding.agentWorkspaceId,'personal');documents.push([id,path]);
    return {task_id:id,snapshot_id:sid,path,sha256:digest,text:runs.get(id).attachments[Number(path.slice(12,14))-1].text};
  }};
  const h=trusted(f,{withAgent:false,withAssets:true,personalComposer:c.port,personalTaskOwner:taskOwner,
    confirmPersonalDraft:()=>true,assetHook:kind=>{if(kind==='get')assetReads++;}});
  const input=(stepId,personalResultSelections)=>({...hostInput(f),stepId,resultSelections:[],includeMaterialEvidence:true,
    ...(personalResultSelections===undefined?{}:{personalResultSelections})});
  const prepare=async(stepId,selections)=>{
    const request=input(stepId,selections),preview=await h.reader.previewHandoff(request);
    const receipt=await h.reader.createPersonalDraft({...request,expectedCandidateDigest:preview.candidateDigest});
    assert.equal(receipt.state,'DRAFT_CONFIRMED');return {preview,request};
  };
  await prepare('analyse');
  const rootRun=addRun('TASK-root','Accepted original analysis\r\nстрока 2\n');
  const replaceManifest=(taskId,mutate)=>{
    const stored=runs.get(taskId),index=stored.attachments.findIndex(row=>row.name==='workflow-inputs.json');
    const manifest=JSON.parse(stored.attachments[index].text);
    mutate(manifest);
    manifest.candidateDigest=hash(canonicalStringify(manifest.handoff));
    const text=canonicalStringify(manifest);
    stored.attachments[index]={name:'workflow-inputs.json',text};
    stored.run.snapshot.source_items[index]={...stored.run.snapshot.source_items[index],sha256:hash(text),bytes:Buffer.byteLength(text,'utf8')};
    return manifest;
  };
  return {f,c,h,input,prepare,addRun,rootRun,reads,documents,replaceManifest,assetReads:()=>assetReads,hook:fn=>{hook=fn;}};
}
const rootSelection=[{stepId:'analyse',taskId:'TASK-root'}];
test('personal dependent Work transfers exact accepted K01 content through original composer and accepted Task inspection',async()=>{
  const x=await personalChainFixture(),before=x.assetReads();
  const request=x.input('review',rootSelection),preview=await x.h.reader.previewHandoff(request);
  assert.equal(preview.state,'PERSONAL_PRIOR_RESULTS_OBSERVED_DECLARED_INPUTS_MATCHED');
  assert.equal(preview.personalResults.length,1);assert.equal(preview.personalResults[0].acceptedTask.taskId,'TASK-root');
  assert.equal(preview.materialEvidence.observation.counts.materials,1);
  assert.equal(x.assetReads()-before,2);assert.deepEqual(x.reads,['TASK-root','TASK-root']);
  assert.equal(JSON.stringify(preview).includes('Accepted original analysis'),false);
  const receipt=await x.h.reader.createPersonalDraft({...request,expectedCandidateDigest:preview.candidateDigest});
  assert.equal(receipt.state,'DRAFT_CONFIRMED');assert.equal(receipt.taskCreated,false);
  assert.equal(x.c.view().attachments.find(a=>a.name==='result-001.txt').text,x.rootRun.result.summary);
  const manifest=JSON.parse(x.c.view().attachments.at(-1).text);
  assert.equal(manifest.handoff.predecessorResults[0].acceptedTask.acceptedDigest,x.rootRun.acceptedSource.accepted_artifact_digest);
  x.addRun('TASK-review','Accepted review conclusion');
  const beforeInspect=x.assetReads(),beforeTasks=x.reads.length;
  const accepted=await x.h.reader.inspectPersonalTask({...request,expectedCandidateDigest:preview.candidateDigest,taskId:'TASK-review'});
  assert.equal(x.assetReads()-beforeInspect,2);
  assert.deepEqual(x.reads.slice(beforeTasks),['TASK-root','TASK-review','TASK-root','TASK-review']);
  assert.equal(accepted.declaredDraftInputsVerified,true);assert.equal(accepted.workCompleted,false);
  assert.equal(JSON.stringify(accepted).includes('Accepted review conclusion'),false);
  const after=x.assetReads(),offset=x.reads.length;
  await x.prepare('finish',[...rootSelection,{stepId:'review',taskId:'TASK-review'}]);
  assert.equal(x.c.view().attachments.find(a=>a.name==='result-001.txt').text,'Accepted review conclusion');
  assert.equal(x.c.view().attachments.filter(a=>a.name.startsWith('result-')).length,1);
  // Preview and save (including consent revalidation): two full passes
  // each, one addressed shared material per pass; not per predecessor.
  assert.equal(x.assetReads()-after,6);
  assert.deepEqual(x.reads.slice(offset),Array.from({length:6},()=>['TASK-root','TASK-review']).flat());
  assert.equal((await x.f.owner.audit()).length,4);
});
test('personal chain refuses missing, unrelated, duplicate and wrong Task assignments before draft writes',async()=>{
  const x=await personalChainFixture(),before=x.assetReads();
  for(const selections of [[],[{stepId:'finish',taskId:'TASK-root'}],
    [...rootSelection,{stepId:'review',taskId:'TASK-root'}]]){
    await assert.rejects(x.h.reader.previewHandoff(x.input('finish',selections)),code('METHOD_PERSONAL_CHAIN_SELECTION_REQUIRED'));
  }
  assert.equal(x.assetReads(),before);assert.equal(x.c.writes(),1);
  await assert.rejects(x.h.reader.previewHandoff({...x.input('review',rootSelection),resultSelections:selection}),code('T3_METHOD_STAGE_SELECTION_REQUIRED'));
  x.h.context.kind='CORP';
  await assert.rejects(x.h.reader.previewHandoff(x.input('review',rootSelection)),code('T3_METHOD_PERSONAL_DRAFT_PERSONAL_OWNER_REQUIRED'));
  assert.equal(x.assetReads(),before);
});
test('personal chain refuses changed original accepted Task inputs and changing accepted evidence',async()=>{
  const x=await personalChainFixture(),request=x.input('review',rootSelection);
  const old=x.rootRun.task.objective;x.rootRun.task.objective='Wrong work';
  await assert.rejects(x.h.reader.previewHandoff(request),code('T3_METHOD_PERSONAL_TASK_INPUT_CHANGED'));
  x.rootRun.task.objective=old;
  let reads=0;x.hook(()=>{if(++reads===2)x.rootRun.acceptedSource.accepted_artifact_digest='f'.repeat(64);});
  await assert.rejects(x.h.reader.previewHandoff(request),code('METHOD_PERSONAL_CHAIN_EVIDENCE_CHANGED'));
  assert.equal(x.c.writes(),1);
});
test('personal chain checks native WorkArea epoch throughout observation and does not accept stale preview',async()=>{
  const x=await personalChainFixture(),request=x.input('review',rootSelection);
  const preview=await x.h.reader.previewHandoff(request);
  x.rootRun.acceptedSource.accepted_artifact_digest='f'.repeat(64);
  await assert.rejects(x.h.reader.createPersonalDraft({...request,expectedCandidateDigest:preview.candidateDigest}),code('METHOD_PERSONAL_DRAFT_EVIDENCE_CHANGED'));
  x.hook(()=>x.c.binding({contextEpoch:'changed'}));
  await assert.rejects(x.h.reader.previewHandoff(request),code('T3_METHOD_PERSONAL_DRAFT_NATIVE_SCOPE_CHANGED'));
  assert.equal(x.c.writes(),1);
});
test('personal chain refuses oversized accepted Result rather than truncating it',async()=>{
  const x=await personalChainFixture(),large='x'.repeat(48001);
  x.rootRun.result.summary=large;x.rootRun.acceptedSource.content=large;
  x.rootRun.acceptedSource.revision='sha256:'+createHash('sha256').update(large).digest('hex');
  await assert.rejects(x.h.reader.previewHandoff(x.input('review',rootSelection)),code('METHOD_PERSONAL_DRAFT_CONTENT_LIMIT'));
  assert.equal(x.c.writes(),1);
});


const recoverInput=(x,stepId,taskId)=>({workspaceId:ws,projectId,expected:x.f.base,stepId,taskId});
test('cold personal Task selection is recovered from original accepted Context without the composer or a prior UI preview',async()=>{
  const x=await personalChainFixture(),before=x.reads.length;
  const r=await x.h.reader.recoverPersonalTask(recoverInput(x,'analyse','TASK-root'));
  assert.equal(r.state,'ORIGINAL_ACCEPTED_TASK_DECLARED_INPUTS_MATCHED');
  assert.equal(r.recoveredFromOriginalTask,true);assert.equal(r.declaredDraftInputsVerified,true);
  assert.equal(r.workCompleted,false);assert.equal(r.resultReuseProven,false);
  assert.equal(r.canonicalWorkRef.recordId,'analyse-source');assert.deepEqual(r.personalResultSelections,[]);
  assert.deepEqual(x.reads.slice(before),['TASK-root','TASK-root','TASK-root']);
  assert.equal(x.c.writes(),1);assert.equal(x.c.view().text,'');
  assert.equal(JSON.stringify(r).includes('Accepted original analysis'),false);
});
test('recovery follows recorded exact accepted Task lineage once and verifies the entire selected chain in two shared material passes',async()=>{
  const x=await personalChainFixture();
  await x.prepare('review',rootSelection);x.addRun('TASK-review','Accepted review conclusion');
  const all=[...rootSelection,{stepId:'review',taskId:'TASK-review'}];
  const {preview}=await x.prepare('finish',all);x.addRun('TASK-finish','Accepted final result');
  const before=x.reads.length,assets=x.assetReads(),writes=x.c.writes();
  const r=await x.h.reader.recoverPersonalTask(recoverInput(x,'finish','TASK-finish'));
  assert.equal(r.recoveredFromOriginalTask,true);assert.equal(r.candidateDigest,preview.candidateDigest);
  assert.equal(r.canonicalWorkRef.recordId,'finish-source');assert.deepEqual(r.personalResultSelections,all);
  assert.deepEqual(x.reads.slice(before),['TASK-finish','TASK-review','TASK-root',
    'TASK-root','TASK-review','TASK-finish','TASK-root','TASK-review','TASK-finish']);
  assert.equal(x.assetReads()-assets,2);assert.equal(x.c.writes(),writes);
  assert.equal(r.workCompleted,false);assert.equal(r.executionAuthority,false);
  assert.equal(JSON.stringify(r).includes('Accepted final result'),false);
  assert.equal((await x.f.owner.audit()).length,4);
});
test('recovery refuses changed original manifest bytes, a forged scope and selected canonical Work mismatch',async()=>{
  const x=await personalChainFixture(),req=recoverInput(x,'analyse','TASK-root');
  const manifest=x.rootRun.snapshot.source_items.at(-1);
  const originalHash=manifest.sha256;manifest.sha256='f'.repeat(64);
  await assert.rejects(x.h.reader.recoverPersonalTask(req),code('T3_METHOD_PERSONAL_TASK_MANIFEST_INVALID'));
  manifest.sha256=originalHash;
  await assert.rejects(x.h.reader.recoverPersonalTask(recoverInput(x,'review','TASK-root')),code('T3_METHOD_PERSONAL_TASK_MANIFEST_SCOPE_MISMATCH'));
  x.replaceManifest('TASK-root',m=>{m.handoff.workspaceId='foreign';});
  await assert.rejects(x.h.reader.recoverPersonalTask(req),code('T3_METHOD_PERSONAL_TASK_MANIFEST_SCOPE_MISMATCH'));
  assert.equal(x.c.writes(),1);
});
test('recovery rejects self-reference, another Task candidate and caller supplied result selections',async()=>{
  const x=await personalChainFixture();
  await x.prepare('review',rootSelection);x.addRun('TASK-review','Accepted review conclusion');
  const req=recoverInput(x,'review','TASK-review');
  await assert.rejects(x.h.reader.recoverPersonalTask({...req,personalResultSelections:rootSelection}),code('T3_METHOD_STAGE_SELECTION_REQUIRED'));
  x.replaceManifest('TASK-review',m=>{
    m.handoff.predecessorResults[0].acceptedTask.candidateDigest='f'.repeat(64);
  });
  await assert.rejects(x.h.reader.recoverPersonalTask(req),code('T3_METHOD_PERSONAL_TASK_MANIFEST_SCOPE_MISMATCH'));
  x.replaceManifest('TASK-review',m=>{
    m.handoff.predecessorResults[0].acceptedTask.taskId='TASK-review';
  });
  await assert.rejects(x.h.reader.recoverPersonalTask(req),code('T3_METHOD_PERSONAL_TASK_MANIFEST_SCOPE_MISMATCH'));
  assert.equal(x.c.writes(),2);
});
test('manifest recovery does not bypass exact original accepted Task and full material verification',async()=>{
  const x=await personalChainFixture(),req=recoverInput(x,'analyse','TASK-root');
  x.rootRun.task.objective='Edited user instruction';
  await assert.rejects(x.h.reader.recoverPersonalTask(req),code('T3_METHOD_PERSONAL_TASK_INPUT_CHANGED'));
  x.rootRun.task.objective='Review original result\n\nAnalyse original';
  x.hook(()=>x.c.binding({contextEpoch:'changed'}));
  await assert.rejects(x.h.reader.recoverPersonalTask(req),code('T3_METHOD_PERSONAL_DRAFT_NATIVE_SCOPE_CHANGED'));
  assert.equal(x.c.writes(),1);
});


test('direct-only selection recovers exact indirect accepted Task identities and avoids rediscovery after consent',async()=>{
  const x=await personalChainFixture();
  await x.prepare('review',rootSelection);x.addRun('TASK-review','Accepted review conclusion');
  const direct=[{stepId:'review',taskId:'TASK-review'}],all=[...rootSelection,...direct];
  const request=x.input('finish',direct),before=x.reads.length,assets=x.assetReads();
  const preview=await x.h.reader.previewHandoff(request);
  assert.deepEqual(preview.personalResultSelections,all);
  assert.deepEqual(x.reads.slice(before),['TASK-review','TASK-root','TASK-root','TASK-review','TASK-root','TASK-review']);
  assert.equal(x.assetReads()-assets,2);
  const complete=await x.h.reader.previewHandoff(x.input('finish',all));
  assert.equal(complete.candidateDigest,preview.candidateDigest);
  const saveReads=x.reads.length,saveAssets=x.assetReads();
  const saved=await x.h.reader.createPersonalDraft({...request,expectedCandidateDigest:preview.candidateDigest});
  assert.equal(saved.state,'DRAFT_CONFIRMED');
  assert.equal(x.reads.length-saveReads,10);assert.equal(x.assetReads()-saveAssets,4);
  assert.equal(x.c.view().attachments.find(a=>a.name==='result-001.txt').text,'Accepted review conclusion');
});
test('diamond Workflow observes a shared accepted ancestor once per pass and transfers only two direct original Results',async()=>{
  const x=await personalChainFixture({diamond:true});
  await x.prepare('review',rootSelection);x.addRun('TASK-review','Accepted review conclusion');
  await x.prepare('compute',rootSelection);x.addRun('TASK-compute','Accepted computation');
  const direct=[{stepId:'review',taskId:'TASK-review'},{stepId:'compute',taskId:'TASK-compute'}];
  const before=x.reads.length,assets=x.assetReads();
  const request=x.input('finish',direct),preview=await x.h.reader.previewHandoff(request);
  assert.deepEqual(preview.personalResultSelections,[...rootSelection,...direct]);
  const observed=x.reads.slice(before);
  for(const task of ['TASK-root','TASK-review','TASK-compute'])
    assert.equal(observed.filter(id=>id===task).length,3);
  assert.equal(x.assetReads()-assets,2);
  const saved=await x.h.reader.createPersonalDraft({...request,expectedCandidateDigest:preview.candidateDigest});
  assert.equal(saved.state,'DRAFT_CONFIRMED');
  assert.deepEqual(x.c.view().attachments.filter(a=>a.name.startsWith('result-')).map(a=>a.text),
    preview.personalResults.map(row=>row.acceptedTask.taskId==='TASK-review'?'Accepted review conclusion':'Accepted computation'));
  assert.equal(x.c.view().attachments.some(a=>a.name.startsWith('result-')&&a.text===x.rootRun.result.summary),false);
  x.addRun('TASK-finish','Accepted final result');
  const offset=x.reads.length,oldAssets=x.assetReads();
  const recovered=await x.h.reader.recoverPersonalTask(recoverInput(x,'finish','TASK-finish'));
  assert.equal(recovered.recoveredFromOriginalTask,true);
  assert.equal(recovered.personalResultSelections.length,3);
  for(const task of ['TASK-root','TASK-review','TASK-compute','TASK-finish'])
    assert.equal(x.reads.slice(offset).filter(id=>id===task).length,3);
  assert.equal(x.assetReads()-oldAssets,2);
});
test('diamond Workflow rejects conflicting accepted versions of a shared ancestor before material bytes or a new draft are read',async()=>{
  const x=await personalChainFixture({diamond:true});
  await x.prepare('review',rootSelection);x.addRun('TASK-review','Accepted review conclusion');
  await x.prepare('analyse');x.addRun('TASK-root-second','Another accepted analysis');
  await x.prepare('compute',[{stepId:'analyse',taskId:'TASK-root-second'}]);x.addRun('TASK-compute','Accepted computation');
  const direct=[{stepId:'review',taskId:'TASK-review'},{stepId:'compute',taskId:'TASK-compute'}],assets=x.assetReads(),writes=x.c.writes();
  await assert.rejects(x.h.reader.previewHandoff(x.input('finish',direct)),code('T3_METHOD_PERSONAL_TASK_MANIFEST_SCOPE_MISMATCH'));
  assert.equal(x.assetReads(),assets);assert.equal(x.c.writes(),writes);
});


// W05.22: actual original C3 source and signed Host read composition;
// the private original issuer and recipient are qualified separately.
const corporateRoot=f=>({...hostInput(f),stepId:'analyse',resultSelections:[]});
test('corporate source reference prepares exact signed Task metadata without payload or authority',async()=>{
  const f=await setup(),h=trusted(f,{withAssets:true,subjectKind:'CORP'}),input=corporateRoot(f);
  const preview=await h.reader.previewHandoff({...input,includeMaterialEvidence:true});
  const p=await h.reader.prepareCorporateTaskReference({...input,expectedCandidateDigest:preview.candidateDigest});
  assert.equal(p.state,'CORPORATE_TASK_REFERENCE_PREPARED');
  assert.equal(p.task,'Review original result\n\nAnalyse original');
  const w=p.workflowInput;
  assert.equal(w.schema,'IWXA_T3_WORKFLOW_INPUT_REFERENCE/1');assert.equal(w.workspaceId,ws);
  assert.equal(w.candidateDigest,preview.candidateDigest);assert.equal(w.inputBasisDigest,preview.binding.inputBasisDigest);
  assert.equal(w.materialEvidenceDigest,preview.materialEvidence.materialEvidenceDigest);
  assert.equal(w.taskTextSha256,createHash('sha256').update(p.task,'utf8').digest('hex'));
  assert.deepEqual(w.projectRef,f.base.projectRef);assert.equal(w.workRef.recordId,'analyse-source');
  assert.equal(JSON.stringify(p).includes('source body'),false);
  assert.equal(p.signedTaskIssued,false);assert.equal(p.exactInputBindingProven,false);assert.equal(p.workCompleted,false);
  assert.equal((await f.owner.audit()).length,3);
});
test('corporate reference preparation refuses personal scope, missing consent digest, changed bytes and human Work',async()=>{
  const f=await setup(),p=trusted(f,{withAssets:true}),input=corporateRoot(f),digest='a'.repeat(64);
  await assert.rejects(p.reader.prepareCorporateTaskReference({...input,expectedCandidateDigest:digest}),code('T3_METHOD_CORPORATE_TASK_SCOPE_REQUIRED'));
  const h=trusted(f,{withAssets:true,subjectKind:'CORP'});
  await assert.rejects(h.reader.prepareCorporateTaskReference(input),code('T3_METHOD_STAGE_SELECTION_REQUIRED'));
  await assert.rejects(h.reader.prepareCorporateTaskReference({...input,expectedCandidateDigest:digest}),code('METHOD_CORPORATE_TASK_EVIDENCE_CHANGED'));
  const review=hostInput(f),preview=await h.reader.previewHandoff({...review,includeMaterialEvidence:true});
  await assert.rejects(h.reader.prepareCorporateTaskReference({...review,expectedCandidateDigest:preview.candidateDigest}),code('METHOD_CORPORATE_TASK_ACTOR_UNSUPPORTED'));
});
test('corporate dependent reference binds selected prior Result metadata but not execution equivalence',async()=>{
  const d=draft();d.steps[1].actor='agent';
  const f=await setup(d),h=trusted(f,{withAssets:true,subjectKind:'CORP'}),input=hostInput(f);
  const preview=await h.reader.previewHandoff({...input,includeMaterialEvidence:true});
  const p=await h.reader.prepareCorporateTaskReference({...input,expectedCandidateDigest:preview.candidateDigest});
  assert.equal(p.workflowInput.candidateDigest,preview.candidateDigest);assert.equal(p.workflowInput.workRef.recordId,'review-source');
  assert.equal(p.exactInputBindingProven,false);
  assert.equal(JSON.stringify(p).includes('must not be projected'),false);
  f.changeAccepted({...accepted,archiveSha256:'c'.repeat(64)});
  await assert.rejects(h.reader.prepareCorporateTaskReference({...input,expectedCandidateDigest:preview.candidateDigest}),code('METHOD_CORPORATE_TASK_EVIDENCE_CHANGED'));
});
test('corporate signed carrier owner readback must match current exact original source reference twice',async()=>{
  const f=await setup();let stored=null,reads=0,hook=()=>{};
  const h=trusted(f,{withAssets:true,subjectKind:'CORP',corporateTaskOwner:{readSignedTask:async(id,context)=>{
    assert.equal(id,'task:workflow');assert.equal(context.organization_id,'org:fixture');reads++;hook();return structuredClone(stored);
  }}});
  const input=corporateRoot(f),preview=await h.reader.previewHandoff({...input,includeMaterialEvidence:true});
  const p=await h.reader.prepareCorporateTaskReference({...input,expectedCandidateDigest:preview.candidateDigest});
  const request={...input,expectedCandidateDigest:preview.candidateDigest,taskId:'task:workflow'};
  stored={found:true,taskId:'task:workflow',taskRevisionId:'b'.repeat(64),packageSha256:'c'.repeat(64),recipientId:'person:worker',
    workflowReference:{state:'SIGNED_WORKFLOW_REFERENCE_ONLY',taskId:'task:workflow',taskRevisionId:'b'.repeat(64),
      workflowInput:p.workflowInput,exactInputBindingProven:false,workCompleted:false,resultReuseProven:false,executionAuthorized:false}};
  const r=await h.reader.inspectCorporateTaskReference(request);
  assert.equal(r.state,'SIGNED_CORPORATE_TASK_CURRENT_REFERENCE_MATCHED');assert.equal(r.declaredReferenceMatched,true);
  assert.equal(r.exactInputBindingProven,false);assert.equal(r.executionAuthority,false);assert.equal(reads,2);
  assert.deepEqual(r.workflowInput,p.workflowInput);assert.equal(JSON.stringify(r).includes(p.task),false);
  const recoveryRequest={...input,taskId:'task:workflow'};
  const recovered=await h.reader.recoverCorporateTaskReference(recoveryRequest);
  assert.deepEqual(recovered,{...r,recoveredFromOriginalTask:true});assert.equal(reads,4);
  await assert.rejects(h.reader.recoverCorporateTaskReference(request),code('T3_METHOD_STAGE_SELECTION_REQUIRED'));
  await assert.rejects(h.reader.recoverCorporateTaskReference({...recoveryRequest,stepId:'review'}),
    code('T3_METHOD_CORPORATE_TASK_REFERENCE_SCOPE_MISMATCH'));
  stored.workflowReference.workflowInput={...p.workflowInput,candidateDigest:'e'.repeat(64)};
  await assert.rejects(h.reader.recoverCorporateTaskReference(recoveryRequest),code('METHOD_CORPORATE_TASK_EVIDENCE_CHANGED'));
  stored.workflowReference.workflowInput=p.workflowInput;
  stored.workflowReference.workflowInput={...p.workflowInput,materialEvidenceDigest:'d'.repeat(64)};
  await assert.rejects(h.reader.inspectCorporateTaskReference(request),code('T3_METHOD_CORPORATE_TASK_REFERENCE_MISMATCH'));
  stored.workflowReference.workflowInput=p.workflowInput;
  // Force an observed revision/carrier change on the second observation.
  let n=0;hook=()=>{if(++n===2)stored.packageSha256='f'.repeat(64);};
  await assert.rejects(h.reader.inspectCorporateTaskReference(request),code('T3_METHOD_CORPORATE_TASK_REVISION_CHANGED'));
  hook=()=>h.changeSelection();
  await assert.rejects(h.reader.inspectCorporateTaskReference(request),code('T3_METHOD_STAGE_WORKSPACE_CHANGED'));
  assert.equal((await f.owner.audit()).length,3);
});

test('corporate reference recovery requires explicit current direct Result selection and rejects changed accepted predecessor',async()=>{
  const d=draft();d.steps[1].actor='agent';
  const f=await setup(d);let stored=null;
  const h=trusted(f,{withAssets:true,subjectKind:'CORP',corporateTaskOwner:{readSignedTask:async()=>structuredClone(stored)}});
  const input=hostInput(f);
  const preview=await h.reader.previewHandoff({...input,includeMaterialEvidence:true});
  const p=await h.reader.prepareCorporateTaskReference({...input,expectedCandidateDigest:preview.candidateDigest});
  stored={found:true,taskId:'task:workflow',taskRevisionId:'b'.repeat(64),packageSha256:'c'.repeat(64),recipientId:'person:worker',
    workflowReference:{state:'SIGNED_WORKFLOW_REFERENCE_ONLY',taskId:'task:workflow',taskRevisionId:'b'.repeat(64),
      workflowInput:p.workflowInput,exactInputBindingProven:false,workCompleted:false,resultReuseProven:false,executionAuthorized:false}};
  const request={...input,taskId:'task:workflow'};
  const r=await h.reader.recoverCorporateTaskReference(request);
  assert.equal(r.recoveredFromOriginalTask,true);assert.deepEqual(r.workflowInput,p.workflowInput);assert.equal(r.workCompleted,false);
  await assert.rejects(h.reader.recoverCorporateTaskReference({...request,resultSelections:[]}),code('METHOD_CORPORATE_TASK_EVIDENCE_CHANGED'));
  f.changeAccepted({...accepted,archiveSha256:'c'.repeat(64)});
  await assert.rejects(h.reader.recoverCorporateTaskReference(request),code('METHOD_CORPORATE_TASK_EVIDENCE_CHANGED'));
  assert.equal((await f.owner.audit()).length,3);
});


function signedRoot(plan,extra={}){
  return {found:true,taskId:'task:workflow',taskRevisionId:'b'.repeat(64),packageSha256:'c'.repeat(64),
    recipientId:'person:owner',organizationId:'org:fixture',workspaceId:ws,originalContextEpoch:2,status:'SIGNED_TASK_CURRENT_SELECTED',
    workflowReference:{state:'SIGNED_WORKFLOW_REFERENCE_ONLY',taskId:'task:workflow',taskRevisionId:'b'.repeat(64),
      workflowInput:plan.workflowInput,exactInputBindingProven:false,workCompleted:false,resultReuseProven:false,executionAuthorized:false},...extra};
}
test('native-only corporate root inputs include actual selected Object and Asset text and the exact signed handoff manifest',async()=>{
  const f=await setup(),raw='Первый\r\nSecond Ω\n',bytes=new TextEncoder().encode(raw);
  let stored=null,reads=0,assets=0;
  const h=trusted(f,{subjectKind:'CORP',withAssets:true,assetBytes:bytes,assetHook:(op)=>{if(op==='get')assets++;},
    corporateTaskOwner:{readSignedTask:async()=>{reads++;return clone(stored);}}});
  const input=corporateRoot(f),preview=await h.reader.previewHandoff({...input,includeMaterialEvidence:true});
  const p=await h.reader.prepareCorporateTaskReference({...input,expectedCandidateDigest:preview.candidateDigest});
  stored=signedRoot(p);
  const before=assets;
  const request={...input,taskId:'task:workflow'};
  const actual=await h.nativeInputs.readInputs(request);
  assert.equal(actual.state,'CORPORATE_TASK_TEXT_INPUTS_PREPARED');
  assert.equal(actual.task,p.task);assert.deepEqual(actual.workflowInput,p.workflowInput);
  assert.equal(actual.recipientId,h.context.actor_id);assert.equal(actual.organizationId,h.context.organization_id);
  assert.equal(actual.declaredReferenceMatched,true);assert.equal(actual.observedMaterialBytesVerified,true);
  assert.equal(actual.declaredSnapshotBytesVerified,true);
  assert.equal(actual.attachmentDigest,createHash('sha256').update(canonicalStringify(actual.attachments),'utf8').digest('hex'));
  assert.equal(actual.allAssetsProven,false);assert.equal(actual.exactInputBindingProven,false);
  assert.equal(actual.executionAuthority,false);assert.equal(actual.taskCreated,false);
  assert.deepEqual(actual.attachments.map(a=>a.name),['material-001.json','attachment-001.txt','workflow-inputs.json']);
  assert.equal(actual.attachments[1].text,raw);
  assert.equal(JSON.parse(actual.attachments[0].text).data.private,'source body');
  const manifest=JSON.parse(actual.attachments[2].text);
  assert.equal(manifest.candidateDigest,p.workflowInput.candidateDigest);
  assert.equal(manifest.handoff.subjectKind,'CORP');
  assert.equal(manifest.materialEvidence.materials[0].visibleAssets[0].sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.equal(actual.counts.attachmentBytes,actual.attachments.reduce((sum,a)=>sum+Buffer.byteLength(a.text,'utf8'),0));
  assert.equal(reads,2);assert.equal(assets-before,2);
  assert.equal('readInputs' in h.reader,false);
  const view=await h.reader.recoverCorporateTaskReference(request);
  assert.equal('attachments' in view,false);assert.equal(JSON.stringify(view).includes(raw),false);
  assert.equal((await f.owner.audit()).length,3);
});
test('corporate actual input reader checks selected recipient, organization, workspace and native context epoch before returning bytes',async()=>{
  const f=await setup();let stored=null,reads=0,assetReads=0,hook=()=>{};
  const h=trusted(f,{subjectKind:'CORP',withAssets:true,assetHook:op=>{if(op==='get')assetReads++;},
    corporateTaskOwner:{readSignedTask:async()=>{reads++;hook();return clone(stored);}}});
  const input=corporateRoot(f),preview=await h.reader.previewHandoff({...input,includeMaterialEvidence:true});
  const plan=await h.reader.prepareCorporateTaskReference({...input,expectedCandidateDigest:preview.candidateDigest});
  const request={...input,taskId:'task:workflow'},baseline=assetReads;
  for(const patch of [{recipientId:'person:other'},{organizationId:'org:other'},{workspaceId:'other'},
    {status:'SIGNED_TASK_PERSISTED_NOT_DELIVERED'},{originalContextEpoch:0}]){
    stored=signedRoot(plan,patch);
    await assert.rejects(h.nativeInputs.readInputs(request),code('T3_METHOD_CORPORATE_TASK_EXECUTOR_MISMATCH'));
  }
  assert.equal(assetReads,baseline);
  stored=signedRoot(plan);let n=0;hook=()=>{if(++n===2)stored.originalContextEpoch++;};
  await assert.rejects(h.nativeInputs.readInputs(request),code('T3_METHOD_CORPORATE_TASK_REVISION_CHANGED'));
  hook=()=>{};h.deny();const before=reads;
  await assert.rejects(h.nativeInputs.readInputs(request),code('T3_ACCESS_NOT_PERMITTED'));assert.equal(reads,before);
});
test('corporate actual input assembly refuses changed bytes, nontext and dependent Work without truncation or substitute metadata',async()=>{
  const f=await setup(),bytes=new Uint8Array([42]);let stored=null;
  const h=trusted(f,{subjectKind:'CORP',withAssets:true,assetBytes:bytes,corporateTaskOwner:{readSignedTask:async()=>clone(stored)}});
  const input=corporateRoot(f),preview=await h.reader.previewHandoff({...input,includeMaterialEvidence:true});
  const plan=await h.reader.prepareCorporateTaskReference({...input,expectedCandidateDigest:preview.candidateDigest});
  stored=signedRoot(plan);bytes[0]=43;
  await assert.rejects(h.nativeInputs.readInputs({...input,taskId:'task:workflow'}),code('METHOD_CORPORATE_TASK_EVIDENCE_CHANGED'));
  for(const [assetMime,assetBytes,expected] of [
    ['application/pdf',new Uint8Array([1,2,3]),'METHOD_PERSONAL_DRAFT_ATTACHMENT_UNSUPPORTED'],
    ['text/plain',new Uint8Array([0xff]),'METHOD_PERSONAL_DRAFT_ATTACHMENT_UNSUPPORTED'],
    ['text/plain',new TextEncoder().encode('x'.repeat(48001)),'METHOD_PERSONAL_DRAFT_CONTENT_LIMIT']]){
    const next=trusted(f,{subjectKind:'CORP',withAssets:true,assetMime,assetBytes,corporateTaskOwner:{readSignedTask:async()=>clone(stored)}});
    const report=await next.reader.previewHandoff({...input,includeMaterialEvidence:true});
    stored=signedRoot(await next.reader.prepareCorporateTaskReference({...input,expectedCandidateDigest:report.candidateDigest}));
    await assert.rejects(next.nativeInputs.readInputs({...input,taskId:'task:workflow'}),code(expected));
  }
  const d=draft();d.steps[1].actor='agent';
  const g=await setup(d);const dependent=trusted(g,{subjectKind:'CORP',withAssets:true});
  const current=await dependent.reader.previewHandoff({...hostInput(g),includeMaterialEvidence:true});
  const req=args(g,{subjectKind:'CORP',expectedCandidateDigest:current.candidateDigest,readObject:async(...a)=>{
    const row=await g.readObject(...a);return row?{object:{...row.object,extensions:{}}}:null;},
    listAssets:async()=>[],getAsset:async()=>null});
  await assert.rejects(buildWorkspaceMethodCorporateTaskInputs(req),code('METHOD_CORPORATE_TASK_ROOT_AGENT_REQUIRED'));
});


const corpHash=text=>createHash('sha256').update(text,'utf8').digest('hex');
function corporateAccepted(plan,step,content){
  return {state:'ORIGINAL_CORPORATE_ACCEPTED_WORKFLOW_RESULT',organizationId:'org:fixture',workspaceId:ws,executorId:'person:worker',
    acceptanceId:corpHash('acceptance:'+step),resultRevisionId:corpHash('result:'+step),packageSha256:corpHash('package:'+step),
    taskId:'task:'+step,taskRevisionId:corpHash('task:'+step),taskPackageSha256:corpHash('task-package:'+step),
    workflowInput:plan.workflowInput,result:content,resultSha256:corpHash(content),acceptanceState:'ACCEPTED',currentness:'CURRENT_BOUNDED',
    readOnly:true,originalRecipientReadback:true,exactInputBindingProven:false,disclosureAuthorized:false,executionAuthorized:false,workCompleted:false};
}
const corporateSelect=(stepId,row)=>({stepId,acceptanceId:row.acceptanceId,resultRevisionId:row.resultRevisionId});
async function corporateChainFixture(){
  const d=draft();d.steps[1].actor='agent';
  d.steps.push({id:'finish',name:'Finish',actor:'agent',instruction:'Final decision',dependsOn:['review'],materialIds:[]});
  const f=await setup(d),rows=new Map(),counts={assets:0,planning:0,inputs:0},raw='Source measurement\r\nΩ\n';
  let stored=null;
  const originalResultOwner={readAccepted:async selected=>{counts.planning++;return clone(rows.get(selected.stepId));},
    readAcceptedForInputs:async(selected,context,task)=>{
      counts.inputs++;assert.equal(context.organization_id,'org:fixture');assert.equal(task.taskId,'task:workflow');
      assert.equal(task.recipientId,context.actor_id);return clone(rows.get(selected.stepId));
    }};
  const h=trusted(f,{subjectKind:'CORP',withAssets:true,assetBytes:new TextEncoder().encode(raw),
    assetHook:op=>{if(op==='get')counts.assets++;},corporateResultOwner:originalResultOwner,
    corporateTaskOwner:{readSignedTask:async()=>clone(stored)}});
  const base={workspaceId:ws,projectId,expected:f.base,resultSelections:[]};
  const preview=async(stepId,corporateResultSelections)=>h.reader.previewHandoff({...base,stepId,includeMaterialEvidence:true,
    ...(corporateResultSelections?{corporateResultSelections}:{})});
  const plan=async(stepId,corporateResultSelections)=>{const current=await preview(stepId,corporateResultSelections);
    return h.reader.prepareCorporateTaskReference({...base,stepId,expectedCandidateDigest:current.candidateDigest,
      ...(corporateResultSelections?{corporateResultSelections}:{})});};
  const root=await plan('analyse');
  const a=corporateAccepted(root,'analyse','Synthetic accepted analysis\r\nДанные: 42 Ω\n');rows.set('analyse',a);
  const selectA=corporateSelect('analyse',a),review=await plan('review',[selectA]);
  const b=corporateAccepted(review,'review','Synthetic accepted review\r\nConclusion B\n');rows.set('review',b);
  const selectB=corporateSelect('review',b),selections=[selectA,selectB];
  return {f,h,base,preview,plan,rows,counts,raw,a,b,selectA,selectB,selections,originalResultOwner,setStored:v=>{stored=v;}};
}
test('corporate signed three-Work chain uses exact current accepted Result content with no repeat material reads per ancestor',async()=>{
  const x=await corporateChainFixture(),{h,base,selections,counts}=x;
  const before={...counts},preview=await x.preview('finish',selections);
  assert.equal(counts.assets-before.assets,2);assert.equal(counts.planning-before.planning,4);
  assert.equal(preview.state,'CORPORATE_PRIOR_RESULTS_OBSERVED_SIGNED_REFERENCES_MATCHED');
  assert.deepEqual(preview.corporateResultSelections,selections);
  assert.equal(preview.corporateResults.length,1);
  assert.equal(preview.corporateResults[0].acceptedResult.resultRevisionId,x.b.resultRevisionId);
  assert.equal(preview.corporateResults[0].canonicalWorkRef.recordId,'review-source');
  assert.equal(preview.executionAuthority,false);assert.equal(preview.exactInputBindingProven,false);
  assert.equal(JSON.stringify(preview).includes('Synthetic accepted'),false);
  const plan=await x.plan('finish',selections);
  assert.equal(plan.workflowInput.candidateDigest,preview.candidateDigest);
  assert.equal((await x.preview('finish',[...selections].reverse())).candidateDigest,preview.candidateDigest);
  x.setStored(signedRoot(plan));
  const request={...base,stepId:'finish',corporateResultSelections:selections,taskId:'task:workflow'};
  const count={...counts},actual=await h.nativeInputs.readInputs(request);
  assert.deepEqual(actual.workflowInput,plan.workflowInput);
  assert.equal(counts.inputs-count.inputs,4);assert.equal(counts.planning,count.planning);
  assert.equal(counts.assets-count.assets,2);
  assert.deepEqual(actual.attachments.map(a=>a.name),['material-001.json','attachment-001.txt','result-001.txt','workflow-inputs.json']);
  assert.equal(actual.attachments[1].text,x.raw);assert.equal(actual.attachments[2].text,x.b.result);
  assert.equal(actual.counts.results,1);
  const manifest=JSON.parse(actual.attachments[3].text);
  assert.equal(manifest.handoff.predecessorResults[0].acceptedResult.resultSha256,x.b.resultSha256);
  assert.equal(manifest.candidateDigest,plan.workflowInput.candidateDigest);
  assert.equal(manifest.handoff.corporateResultChain,true);
  assert.equal(actual.executionAuthority,false);assert.equal(actual.workCompleted,false);
  assert.equal(actual.resultReuseProven,false);
  const restored=await h.reader.recoverCorporateTaskReference(request);
  assert.equal(restored.recoveredFromOriginalTask,true);assert.equal('attachments' in restored,false);
  assert.equal(JSON.stringify(restored).includes('Synthetic accepted'),false);
  assert.equal((await x.f.owner.audit()).length,4);
});
test('corporate accepted lineage requires every exact ancestor and refuses a changed signed predecessor, altered content and foreign recipient scope',async()=>{
  const x=await corporateChainFixture(),{counts}=x;
  const initial={...counts};
  await assert.rejects(x.preview('finish',[x.selectB]),code('METHOD_CORPORATE_CHAIN_SELECTION_REQUIRED'));
  await assert.rejects(x.preview('finish',[x.selectA,x.selectA]),code('METHOD_CORPORATE_CHAIN_SELECTION_REQUIRED'));
  assert.deepEqual(counts,initial);
  for(const patch of [{organizationId:'org:other'},{workspaceId:'foreign'},{acceptanceState:'REJECTED'},
    {currentness:'HISTORICAL_SUPERSEDED'},{result:x.a.result+'modified'},
    {workflowInput:{...x.a.workflowInput,workRef:{...x.a.workflowInput.workRef,recordId:'other'}}}]){
    x.rows.set('analyse',{...x.a,...patch});const start=counts.assets;
    await assert.rejects(x.preview('finish',x.selections),code('METHOD_CORPORATE_CHAIN_RESULT_MISMATCH'));
    assert.equal(counts.assets,start);
  }
  x.rows.set('analyse',{...x.a,workflowInput:{...x.a.workflowInput,candidateDigest:'e'.repeat(64)}});
  await assert.rejects(x.preview('finish',x.selections),code('METHOD_CORPORATE_CHAIN_SIGNED_REFERENCE_CHANGED'));
  x.rows.set('analyse',{...x.a,result:'Other accepted analysis',resultSha256:corpHash('Other accepted analysis')});
  await assert.rejects(x.preview('finish',x.selections),code('METHOD_CORPORATE_CHAIN_SIGNED_REFERENCE_CHANGED'));
  x.rows.set('analyse',x.a);
  await assert.rejects(x.h.reader.previewHandoff({...x.base,stepId:'review',includeMaterialEvidence:true,
    corporateResultSelections:[x.selectA],resultSelections:selection}),code('T3_METHOD_STAGE_SELECTION_REQUIRED'));
  assert.equal((await x.preview('finish',x.selections)).corporateResults.length,1);
});
test('native corporate dependency input read cannot borrow original recipient planning authority or trust changed accepted bytes',async()=>{
  const x=await corporateChainFixture(),plan=await x.plan('review',[x.selectA]);
  const request={...x.base,stepId:'review',corporateResultSelections:[x.selectA],taskId:'task:workflow'};
  let calls=0,assets=0;
  const h=trusted(x.f,{subjectKind:'CORP',withAssets:true,assetHook:op=>{if(op==='get')assets++;},
    corporateTaskOwner:{readSignedTask:async()=>signedRoot(plan)},
    corporateResultOwner:{readAccepted:async()=>{calls++;return clone(x.a);}}});
  await assert.rejects(h.nativeInputs.readInputs(request),code('T3_METHOD_CORPORATE_RESULT_ORIGINAL_OWNER_REQUIRED'));
  assert.equal(calls,0);assert.equal(assets,0);
  // A change between the two current owner observations cannot create a
  // stable candidate even when the owner returns a new matching content hash.
  const changing=trusted(x.f,{subjectKind:'CORP',withAssets:true,assetBytes:new TextEncoder().encode(x.raw),
    corporateResultOwner:{readAccepted:async()=>{
      if(++calls===1)return clone(x.a);
      const result=x.a.result+'changed';return {...x.a,result,resultSha256:corpHash(result)};
    }}});
  await assert.rejects(changing.reader.previewHandoff({...request,includeMaterialEvidence:true}),code('METHOD_CORPORATE_CHAIN_EVIDENCE_CHANGED'));
  assert.equal(calls,2);
  const denied=trusted(x.f,{subjectKind:'CORP',withAssets:true,corporateResultOwner:{readAccepted:async()=>clone(x.a)}});
  denied.deny();
  await assert.rejects(denied.reader.previewHandoff({...request,includeMaterialEvidence:true}),code('T3_ACCESS_NOT_PERMITTED'));
});

test('native corporate preparation cannot return payload without original exact-byte Task-owner verification',async()=>{
  const f=await setup();let stored=null,verifiedCalls=0,assetReads=0;
  const h=trusted(f,{subjectKind:'CORP',withAssets:true,assetHook:op=>{if(op==='get')assetReads++;},
    corporateTaskOwner:{readSignedTask:async()=>clone(stored),verifyTextInputs:async()=>{verifiedCalls++;
      return {state:'WORKFLOW_TEXT_INPUT_SNAPSHOT_MATCHED',taskId:stored.taskId,taskRevisionId:stored.taskRevisionId,
        packageSha256:stored.packageSha256,originalContextEpoch:stored.originalContextEpoch,
        candidateDigest:stored.workflowReference.workflowInput.candidateDigest,attachmentDigest:'f'.repeat(64),
        declaredSnapshotBytesVerified:true,executionAuthorized:false};}}});
  const input=corporateRoot(f),preview=await h.reader.previewHandoff({...input,includeMaterialEvidence:true});
  stored=signedRoot(await h.reader.prepareCorporateTaskReference({...input,expectedCandidateDigest:preview.candidateDigest}));
  const before=assetReads;
  await assert.rejects(h.nativeInputs.readInputs({...input,taskId:'task:workflow'}),code('T3_METHOD_CORPORATE_TASK_INPUT_VERIFICATION_FAILED'));
  assert.equal(verifiedCalls,1);assert.equal(assetReads-before,2);
  // The ordinary reference reader still does not need or invoke the native verifier.
  assert.equal((await h.reader.recoverCorporateTaskReference({...input,taskId:'task:workflow'})).recoveredFromOriginalTask,true);
  assert.equal(verifiedCalls,1);
});


test('selected native signed Task recovers only its Work closure without unrelated Work readback',async()=>{
  const d=draft();d.steps.push({id:'independent',name:'Independent',actor:'agent',instruction:'Unrelated source work',dependsOn:[],materialIds:[]});
  const f=await setup(d);let stored=null;const loaded=[];
  const h=trusted(f,{subjectKind:'CORP',withAssets:true,corporateTaskOwner:{readSignedTask:async()=>clone(stored)}});
  const input=corporateRoot(f),preview=await h.reader.previewHandoff({...input,includeMaterialEvidence:true});
  stored=signedRoot(await h.reader.prepareCorporateTaskReference({...input,expectedCandidateDigest:preview.candidateDigest}));
  const explicit=await h.nativeInputs.readInputs({...input,taskId:'task:workflow'});
  const original=f.owner.load.bind(f.owner);
  f.owner.load=async(kind,workspaceId,id)=>{loaded.push([kind,id]);assert.notEqual(id,projectId+'.independent');assert.notEqual(id,projectId+'.review');return original(kind,workspaceId,id);};
  const selected=await h.nativeInputs.readSelectedInputs({taskId:'task:workflow'});
  assert.equal(selected.attachmentDigest,explicit.attachmentDigest);
  assert.deepEqual(selected.attachments,explicit.attachments);
  assert.equal(selected.executionAuthority,false);assert.equal(selected.workCompleted,false);
  assert.ok(loaded.some(([,id])=>id===projectId+'.analyse'));
  assert.equal('readSelectedInputs' in h.reader,false);
  await assert.rejects(h.nativeInputs.readSelectedInputs({taskId:'task:workflow',workspaceId:ws}),code('T3_METHOD_STAGE_SELECTION_REQUIRED'));
});


test('trusted method reader compares original creation through signed current Workspace without writes',async()=>{
  const f=await setup(),h=trusted(f),input={workspaceId:ws,projectId,expected:f.base};
  const result=await h.reader.compareCreation(input);
  assert.equal(result.state,'UNCHANGED');assert.equal(result.comparisonBasis,'ORIGINAL_CREATION_TO_SELECTED_CURRENT');
  assert.equal(result.currentHeadVerified,true);assert.equal(result.executionAuthority,false);
  assert.equal(f.nativeCalls.length,0);assert.equal((await f.owner.audit()).length,3);
  h.deny();await assert.rejects(h.reader.compareCreation(input),code('T3_ACCESS_NOT_PERMITTED'));
});

test('trusted method creation comparison ignores disposed or changed Workspace before read completes',async()=>{
  for(const change of ['selection','dispose','context']){
    const f=await setup();
    let release,started;const gate=new Promise(resolve=>{release=resolve;});
    const ready=new Promise(resolve=>{started=resolve;});
    const actual=f.owner;
    const scoped={...actual,load:(...a)=>actual.load(...a),historyThrough:async(...a)=>{started();await gate;return actual.historyThrough(...a);}};
    const h=trusted({...f,owner:scoped});
    const pending=h.reader.compareCreation({workspaceId:ws,projectId,expected:f.base});
    await ready;
    if(change==='selection')h.changeSelection();
    else if(change==='dispose')h.dispose();
    else h.context.scope_revision++;
    release();
    await assert.rejects(pending,e=>['T3_METHOD_STAGE_WORKSPACE_CHANGED','T3_METHOD_STAGE_SIGNED_CONTEXT_CHANGED'].includes(e.code));
    assert.equal((await actual.audit()).length,3);
  }
});


test('actual trusted alternative creates independent original Project/Works and compares them without a new owner',async()=>{
  const f=await setup(),confirmations=[];
  const h=trusted(f,{confirmAlternative:async value=>{confirmations.push(value);return true;}});
  const source={workspaceId:ws,projectId,expected:f.base};
  const result=await h.reader.createAlternative(source);
  assert.equal(result.state,'CREATED');assert.notEqual(result.targetProjectId,projectId);
  assert.equal(result.selection.workRefs.length,2);assert.equal(result.sourceModified,false);
  assert.equal(confirmations.length,1);assert.equal(confirmations[0].kind,'CREATE_ALTERNATIVE');
  assert.equal((await f.owner.audit()).length,6);
  const target={workspaceId:ws,projectId:result.targetProjectId,expected:result.selection};
  assert.equal((await h.reader.overview(target)).stages.length,2);
  const comparison=await h.reader.compareOrigin(target);
  assert.equal(comparison.state,'INDEPENDENT_IDENTITIES');assert.deepEqual(comparison.beforeSelection.projectRef,f.base.projectRef);
  assert.equal(comparison.originCurrentHeadVerified,false);assert.equal(comparison.resultReuseProven,false);
  const recovered=await h.reader.recoverAlternative({...source,targetProjectId:result.targetProjectId});
  assert.equal(recovered.state,'RECOVERED');assert.deepEqual(recovered.selection,result.selection);
  assert.equal(confirmations.length,1);assert.equal((await f.owner.audit()).length,6);
  assert.equal(f.nativeCalls.length,0);
});

test('alternative write action requires trusted confirmation and current material and scope',async()=>{
  const f=await setup(),source={workspaceId:ws,projectId,expected:f.base};
  assert.equal(trusted(f).reader.createAlternative,undefined);
  assert.equal((await trusted(f).reader.compareOrigin(source)).state,'NO_ALTERNATIVE_ORIGIN');
  const cancelled=trusted(f,{confirmAlternative:async()=>false});
  assert.equal((await cancelled.reader.createAlternative(source)).state,'USER_CANCELLED');
  let changed=false;
  const h=trusted({...f,readObject:async(...a)=>{
    const value=await f.readObject(...a);return changed&&value&&a[1]==='source'?{object:{...value.object,revision:2}}:value;
  }},{confirmAlternative:async()=>{changed=true;return true;}});
  const refused=await h.reader.createAlternative(source);
  assert.equal(refused.state,'MATERIAL_REVIEW_REQUIRED');
  assert.equal(refused.selection,null);
  assert.equal(await f.owner.load('project',ws,refused.targetProjectId),null);
  const revoked=trusted(f,{confirmAlternative:async()=>{revoked.deny();return true;}});
  await assert.rejects(revoked.reader.createAlternative(source),code('T3_ACCESS_NOT_PERMITTED'));
  const switched=trusted(f,{confirmAlternative:async()=>{switched.changeSelection();return true;}});
  await assert.rejects(switched.reader.createAlternative(source),code('T3_METHOD_STAGE_WORKSPACE_CHANGED'));
  assert.equal((await f.owner.audit()).length,3);
});

test('partial alternative creation resumes original records after lost write, not a replacement Project',async()=>{
  const f=await setup(),actual=f.owner,source={workspaceId:ws,projectId,expected:f.base};
  let failWork=true,materialChanged=false,changeDuringRecovery=false;const confirmations=[];
  const owner={
    load:(...a)=>actual.load(...a),history:(...a)=>actual.history(...a),
    historyThrough:(...a)=>actual.historyThrough(...a),sourceIdentityExists:(...a)=>actual.sourceIdentityExists(...a),
    create:async(kind,input)=>{if(kind==='work'&&failWork)throw Error('interrupted original Work write');
      return actual.create(kind,input);}
  };
  const h=trusted({...f,owner,readObject:async(...a)=>{
    const value=await f.readObject(...a);return materialChanged&&value&&a[1]==='source'?{object:{...value.object,revision:2}}:value;
  }},{confirmAlternative:async value=>{confirmations.push(value.kind);
    if(value.kind==='RESUME_ALTERNATIVE'&&changeDuringRecovery)materialChanged=true;
    return true;
  }});
  const first=await h.reader.createAlternative(source);
  assert.equal(first.state,'OUTCOME_UNKNOWN');assert.equal(first.selection,null);
  assert.equal((await actual.audit()).length,4);
  failWork=false;materialChanged=true;
  const blocked=await h.reader.recoverAlternative({...source,targetProjectId:first.targetProjectId});
  assert.equal(blocked.state,'RECOVERY_MATERIAL_REVIEW_REQUIRED');assert.equal(blocked.targetProjectId,first.targetProjectId);
  assert.equal(blocked.selection,null);assert.equal((await actual.audit()).length,4);
  assert.deepEqual(confirmations,['CREATE_ALTERNATIVE']);
  materialChanged=false;changeDuringRecovery=true;
  const blockedAfterConfirmation=await h.reader.recoverAlternative({...source,targetProjectId:first.targetProjectId});
  assert.equal(blockedAfterConfirmation.state,'RECOVERY_MATERIAL_REVIEW_REQUIRED');
  assert.equal(blockedAfterConfirmation.targetProjectId,first.targetProjectId);assert.equal((await actual.audit()).length,4);
  materialChanged=false;changeDuringRecovery=false;
  const next=await h.reader.recoverAlternative({...source,targetProjectId:first.targetProjectId});
  assert.equal(next.state,'RECOVERED');assert.equal(next.targetProjectId,first.targetProjectId);
  assert.equal((await actual.audit()).length,6);assert.deepEqual(confirmations,['CREATE_ALTERNATIVE','RESUME_ALTERNATIVE','RESUME_ALTERNATIVE']);
  const final=await h.reader.recoverAlternative({...source,targetProjectId:first.targetProjectId});
  assert.equal(final.state,'RECOVERED');assert.deepEqual(final.selection,next.selection);
  assert.equal((await actual.audit()).length,6);
  assert.equal((await h.reader.recoverAlternative({...source,targetProjectId:'project-absent'})).state,'NOT_FOUND');
});


test('fresh trusted reader opens the saved edited variant and historical origin after source changes',async()=>{
  const f=await setup(),source={workspaceId:ws,projectId,expected:f.base};
  const creator=trusted(f,{confirmAlternative:async()=>true});
  const created=await creator.reader.createAlternative(source),targetProjectId=created.targetProjectId;
  const sourceEdit=draft();sourceEdit.steps[0].instruction='Source revision changed after creating the variant';
  const sourceNext=(await applyWorkspaceMethodRevision({owner:f.owner,workspaceId:ws,projectId,expected:f.base,draft:sourceEdit,objects:[material],
    operationId:'saved-variant-source-edit',knowledgeAt:'2026-11-28T12:00:00Z'})).method;
  const targetDraft={...draft(),projectId:targetProjectId};targetDraft.steps[0].instruction='Independent variant changed';
  const edited=(await applyWorkspaceMethodRevision({owner:f.owner,workspaceId:ws,projectId:targetProjectId,expected:created.selection,draft:targetDraft,objects:[material],
    operationId:'saved-variant-target-edit',knowledgeAt:new Date(Date.now()+60000).toISOString()})).method;
  const before=(await f.owner.audit()).length;let confirms=0;
  const fresh=trusted(f,{confirmAlternative:async()=>{confirms++;return false;}});
  const input={workspaceId:ws,projectId,targetProjectId};
  const reopened=await fresh.reader.reopenSavedAlternative(input);
  assert.equal(reopened.state,'OPENED');assert.deepEqual(reopened.selection.projectRef,edited.projectRef);
  assert.deepEqual(reopened.selection.workRefs,[...edited.workRefs].sort((a,b)=>a.objectId.localeCompare(b.objectId)));
  const comparison=await fresh.reader.compareOrigin({workspaceId:ws,projectId:targetProjectId,expected:reopened.selection});
  assert.deepEqual(comparison.beforeSelection.projectRef,f.base.projectRef);
  assert.equal((await fresh.reader.overview({...source,expected:sourceNext})).stages.length,2);
  assert.equal(confirms,0);assert.equal((await f.owner.audit()).length,before);
  assert.equal((await fresh.reader.reopenSavedAlternative({...input,targetProjectId:'not-saved'})).state,'NOT_FOUND');
  await assert.rejects(fresh.reader.reopenSavedAlternative({...input,projectId:'foreign-origin'}),code('METHOD_ALTERNATIVE_ORIGIN_MISMATCH'));
  await assert.rejects(fresh.reader.reopenSavedAlternative({...input,workspaceId:'foreign'}),code('T3_METHOD_STAGE_WORKSPACE_REQUIRED'));
  await assert.rejects(fresh.reader.reopenSavedAlternative({...input,expected:f.base}),code('T3_METHOD_STAGE_SELECTION_REQUIRED'));
  assert.equal(trusted(f).reader.reopenSavedAlternative,undefined);
  fresh.deny();await assert.rejects(fresh.reader.reopenSavedAlternative(input),code('T3_ACCESS_NOT_PERMITTED'));
  assert.equal((await f.owner.audit()).length,before);
});

test('fresh trusted reader resumes only the original interrupted creation after source revision changes',async()=>{
  const f=await setup(),actual=f.owner,source={workspaceId:ws,projectId,expected:f.base};
  const owner={load:(...a)=>actual.load(...a),history:(...a)=>actual.history(...a),historyThrough:(...a)=>actual.historyThrough(...a),
    sourceIdentityExists:(...a)=>actual.sourceIdentityExists(...a),create:async(kind,input)=>{
      if(kind==='work')throw Error('interrupted before first variant Work');return actual.create(kind,input);}};
  const first=await trusted({...f,owner},{confirmAlternative:async()=>true}).reader.createAlternative(source);
  assert.equal(first.state,'OUTCOME_UNKNOWN');
  const targetProjectId=first.targetProjectId,initial=await actual.load('project',ws,targetProjectId);
  const nextDraft=draft();nextDraft.steps[0].instruction='Different source revision';
  await applyWorkspaceMethodRevision({owner:actual,workspaceId:ws,projectId,expected:f.base,draft:nextDraft,objects:[material],
    operationId:'partial-variant-source-edit',knowledgeAt:'2026-11-28T12:02:00Z'});
  const before=(await actual.audit()).length,input={workspaceId:ws,projectId,targetProjectId};
  const cancelled=trusted(f,{confirmAlternative:async()=>false});
  assert.equal((await cancelled.reader.reopenSavedAlternative(input)).state,'RECOVERY_REQUIRED');
  assert.equal((await actual.audit()).length,before);
  const confirmations=[],fresh=trusted(f,{confirmAlternative:async value=>{confirmations.push(value);return true;}});
  const recovered=await fresh.reader.reopenSavedAlternative(input);
  assert.equal(recovered.state,'RECOVERED');assert.equal(recovered.targetProjectId,targetProjectId);
  assert.equal(recovered.selection.projectRef.recordId,initial.baseRevisionId);
  assert.equal(confirmations.length,1);assert.deepEqual(confirmations[0].sourceSelection.projectRef,f.base.projectRef);
  assert.equal((await actual.audit()).length,before+2);
  const reopened=await fresh.reader.reopenSavedAlternative(input);
  assert.equal(reopened.state,'OPENED');assert.deepEqual(reopened.selection,recovered.selection);
  assert.equal(confirmations.length,1);assert.equal((await actual.audit()).length,before+2);
});

const selectedProgram=(f,extra={})=>({workspaceId:ws,projectId,expected:f.base,stepId:'analyse',
  sourceAsset:{objectId:'source',assetId:'asset:1',revision:1,name:'points.json'},
  program:{providerId:'QGIS_PROCESSING_V1',operation:'reproject_points',parameters:{specification:'{"target_crs":"EPSG:32632"}'},
    connectionEpoch:'program-epoch',trustedCodeConfirmed:false},...extra});
test('native program input binds exact original Work and selected UTF-8 Asset, not UI-provided text',async()=>{
  const d=draft();d.steps[0].actor='program';
  const f=await setup(d),bytes=new TextEncoder().encode('{"label":"Проверка"}\r\n');
  const h=trusted(f,{withAssets:true,assetBytes:bytes,assetMime:'application/json'});
  const input=selectedProgram(f),result=await h.nativeProgramInputs.readInputs(input);
  assert.equal(result.state,'ORIGINAL_PROGRAM_WORK_INPUT_PREPARED');
  assert.equal(result.modelingSource.text,'{"label":"Проверка"}\r\n');
  assert.equal(result.reference.source.sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(result.reference.workRef,f.base.workRefs.find(ref=>ref.objectId.endsWith('.analyse')));
  assert.equal(result.reference.source.objectRevision,1);
  assert.deepEqual(result.reference.program,input.program);
  assert.equal(result.candidateDigest,createHash('sha256').update(canonicalStringify(result.reference)).digest('hex'));
  assert.equal(result.executionAuthority,false);assert.equal(result.taskCreated,false);
  assert.equal(h.reader.readInputs,undefined);assert.equal(h.reader.prepareProgramInput,undefined);
  assert.equal((await f.owner.audit()).length,3);
});
test('native program input rejects stale Asset, wrong actor, missing declared material and denied D1',async()=>{
  const d=draft();d.steps[0].actor='program';
  const f=await setup(d),h=trusted(f,{withAssets:true,assetBytes:new TextEncoder().encode('{}')});
  const input=selectedProgram(f);
  await assert.rejects(h.nativeProgramInputs.readInputs({...input,sourceAsset:{...input.sourceAsset,revision:2}}),code('METHOD_PROGRAM_ASSET_CHANGED'));
  await assert.rejects(h.nativeProgramInputs.readInputs({...input,sourceAsset:{...input.sourceAsset,objectId:'other'}}),code('METHOD_PROGRAM_MATERIAL_REVIEW_REQUIRED'));
  const a=await setup();
  await assert.rejects(trusted(a,{withAssets:true}).nativeProgramInputs.readInputs(selectedProgram(a)),code('METHOD_PROGRAM_WORK_UNSUPPORTED'));
  h.deny();await assert.rejects(h.nativeProgramInputs.readInputs(input),code('T3_ACCESS_NOT_PERMITTED'));
});
test('native program input rejects changed bytes without changed Object or Asset revision',async()=>{
  const d=draft();d.steps[0].actor='program';
  const f=await setup(d),bytes=new TextEncoder().encode('{"a":1}');
  let count=0;
  const h=trusted(f,{withAssets:true,assetBytes:bytes,assetMime:'application/json',
    assetHook:kind=>{if(kind==='get'&&++count===2)bytes[5]=50;}});
  await assert.rejects(h.nativeProgramInputs.readInputs(selectedProgram(f)),code('METHOD_PROGRAM_ASSET_CHANGED'));
  assert.equal(count,2);assert.equal((await f.owner.audit()).length,3);
});
