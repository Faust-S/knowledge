import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createTrustedReconciliationKernelApply}
  from "../src/t3/reconciliation-kernel-apply.mjs";
import {createSubjectKernelBinding} from "../src/t3/subject-access-binding.mjs";

// Contract-only owner. This is NOT a private original Reconciler, signed JIT,
// installed native owner, or a replacement for the G4 product qualification.
const accepted="a".repeat(64),rev="b".repeat(64),effect="c".repeat(64);
test("separate original-owner Apply uses the inherited Kernel graph and readback once",async()=>{
  let approves=false,active=true,commits=0;
  let sourceCurrent=true,revokeDuringJit=false,stopHostDuringJit=false;
  let changePurposeDuringHumanApply=false;
  let signedJitCount=0,preconditionCount=0,workspaceReady=true;
  let workspaceReadError=null,applyPrompts=0;
  let holdApply=null,enterApply=null;
  const context={kind:"CORP",context_id:"ctx:a",actor_id:"person:a",
    principal_id:"org:a",organization_id:"org:a",role_id:"role:admin",
    grant_id:"grant:a",realm_id:"realm:a",audience:"host:t3",
    purpose:"result.apply",resource:"ws:a",workspace_id:"ws:a",scope_revision:1};
  const command={workspace_id:"ws:a",idempotency_key:effect,
    object:{object_id:"result:one",schema_id:"iwxa.result.native",
      schema_version:"1.0.0",base_revision:0,
      data:{text:"reviewed",review_meta:{status:"accepted",approvalCount:2}}},
    event:{event_type:"native.result.applied",payload:{
      reconciliation_acceptance_id:accepted,
      reconciliation_revision_ids:[rev],
      source_result_digest:"9".repeat(64),
      owner_provenance:{origin:"agent-human-review",revision:2}}}};
  const binding={
    schema:"IWXA_T3_APPLICATION_HOST_BINDING/1",effectKey:effect,
    operation:{operationId:"effect:"+effect,payloadDigest:"d".repeat(64),
      resource:"ws:a",productId:"IWXA_ADMIN_CENTER",audience:"host:t3",
      purpose:"result.apply",action:"object.write"},expectedRevision:0,
    applicationAuthorized:false,writeAllowed:false,
    hostJitRequired:true,explicitHumanDecisionRequired:true,
    decisionCheckAtCommit:true,externalContextCoreApplied:false,
    commitPrecondition:()=>{preconditionCount++;return sourceCurrent&&signedJitCount>0;},
  };
  let written=null,lastEvent=null,loseAckAfterWrite=false;
  let tamperInitialEvent=false,hideOriginalEvent=false,duplicateEvent=false;
  let tamperStoredProvenance=false,tamperStoredData=false;
  let getObjectErrorCode=null,eventsErrorCode=null;
  const hash=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const access={
    currentContext:()=>context,
    actionFor:operation=>operation==="t1.commitObjectGraph"?"object.write":"object.read",
    operationDigest:hash,
    authorize:request=>{
      signedJitCount++;
      if(revokeDuringJit&&request.action==="object.write")sourceCurrent=false;
      if(stopHostDuringJit&&request.action==="object.write")active=false;
      return ({
      schema:"IWXA_T3_ORGANIZATION_OPERATION_DECISION/1",
      allowed:true,outcome:"PERMITTED",evidenceOnly:true,
      requestDigest:hash(request),policyDigest:hash("policy"),
      operationDigest:hash("operation"),evidenceDigest:hash("evidence"),
      productionActivation:false,doesNotTransferData:true,
      doesNotAcceptCorporateCopy:true,organizationId:context.organization_id,
      workspaceId:context.workspace_id,grantId:request.grantId,
      statusSequence:1,validUntil:new Date(Date.now()+60000).toISOString(),
      });
    },
    verifyDecisionBinding:(request,decision)=>decision.requestDigest===hash(request),
  };
  const makePort=()=>createTrustedReconciliationKernelApply({
    admission:{inspectAcceptedApplication:async()=>({
      schema:"IWXA_T3_APPLICATION_PROJECTION_CANDIDATE/1",
      status:"CANDIDATE_REQUIRES_INDEPENDENT_HOST_AUTHORIZATION",
      applicationAuthorized:false,
    })},
    kernel:{
      sessionInfo:{contract_version:"1.3.0"},
      hasOperation:()=>true,
      getWorkspace:async ws=>{
        if(workspaceReadError)throw Object.assign(
          Error(workspaceReadError),{code:workspaceReadError});
        return workspaceReady?{workspace_id:ws,read_only:false}:null;
      },
      commitObjectGraph:async input=>{
        commits++;written=structuredClone(input);
        lastEvent={event_id:"evt:a",event_type:input.event.event_type,
          workspace_id:"ws:a",service_id:"iwxa.test",object_id:"result:one",
          revision:1,occurred_at:new Date().toISOString(),
          idempotency_key:input.idempotency_key,
          payload:structuredClone(input.event.payload)};
        if(tamperStoredProvenance)
          lastEvent.payload.owner_provenance.revision=3;
        if(loseAckAfterWrite)throw new Error("ORIGINAL_KERNEL_ACK_LOST");
        const confirmedEvent=structuredClone(lastEvent);
        if(tamperInitialEvent)confirmedEvent.idempotency_key="f".repeat(64);
        return {
          workspace_id:"ws:a",object:{workspace_id:"ws:a",object_id:"result:one",
            revision:1,schema_id:"iwxa.result.native"},
          relations_put:[],event:confirmedEvent};
      },
      getObject:async()=>{
        if(getObjectErrorCode)throw Object.assign(Error(getObjectErrorCode),
          {code:getObjectErrorCode});
        return written?{object:{
          workspace_id:"ws:a",object_id:"result:one",revision:1,
          schema_id:"iwxa.result.native",schema_version:"1.0.0",
          // Original T2 canonicalizes nested JSON key ordering on disk.
          data:{review_meta:{approvalCount:tamperStoredData?3:2,
            status:"accepted"},text:"reviewed"}},
          relations:{incoming:[],outgoing:[]}}:null;
      },
      listEventsSince:async()=>{
        if(eventsErrorCode)throw Object.assign(Error(eventsErrorCode),
          {code:eventsErrorCode});
        return !lastEvent||hideOriginalEvent?[]:
          duplicateEvent?[structuredClone(lastEvent),structuredClone(lastEvent)]:
          [structuredClone(lastEvent)];
      },
    },
    access,
    stageFromOriginalOwner:()=>({binding,command,authorizationContext:{
      operationId:"effect:"+effect,payloadDigest:"d".repeat(64),
      organizationId:"org:a",workspaceId:"ws:a",dataRootId:"root:a",
      storageScopeDigest:"f".repeat(64),expectedRevision:0,
      actorId:"person:a",principalId:"org:a",roleId:"role:admin",
      grantId:"grant:a",operationDigest:"e".repeat(64)}}),
    confirmSeparateApply:async()=>{
      applyPrompts++;
      if(holdApply!==null){enterApply();await holdApply;}
      if(changePurposeDuringHumanApply)context.purpose="changed-purpose";
      return approves;
    },isHostActive:()=>active,
  });
  let port=makePort();
  const selection={acceptanceId:accepted,revisionIds:[rev],
    target:{workspaceId:"ws:a",subjectId:"org:a",dataRootId:"root:a",
      consumerId:"consumer:a",processId:"process:a",
      processVersion:"1.0.0",purpose:"result.apply"}};
  // The domain graph MUST apply to the same original revision sealed by
  // the accepted application owner. A shifted base revision must fail
  // before Human APPLY and before any original Kernel write.
  command.object.base_revision=1;
  await assert.rejects(port.applyAccepted(selection),
    {code:"T3_D3_ORIGINAL_GRAPH_PROVENANCE_REQUIRED"});
  assert.equal(applyPrompts,0);
  assert.equal(commits,0);
  command.object.base_revision=0;
  await assert.rejects(port.applyAccepted({...selection,target:{
    ...selection.target,dataRootId:null}}),
    {code:"T3_D3_ORIGINAL_APPLICATION_TARGET_INCOMPLETE"});
  await assert.rejects(port.applyAccepted(selection),
    {code:"T3_D3_SEPARATE_HUMAN_APPLY_REQUIRED"});
  assert.equal(commits,0);
  // A matching object is insufficient if the actual original Event is absent.
  const notYetApplied=await port.recoverApplied(selection);
  assert.equal(notYetApplied.status,"OUTCOME_UNKNOWN");
  assert.equal(notYetApplied.automaticRetryAllowed,false);
  // Real T2 returns a typed NOT_FOUND error when the first original read
  // sees no persisted Object after a lost reply, rather than a null result.
  for(const code of ["OBJECT_NOT_FOUND","WORKSPACE_NOT_FOUND"]){
    getObjectErrorCode=code;
    const missing=await port.recoverApplied(selection);
    assert.equal(missing.status,"OUTCOME_UNKNOWN");
    assert.equal(missing.kernelWriteReadback,"NOT_CONFIRMED");
    assert.equal(missing.automaticRetryAllowed,false);
    assert.equal(commits,0,"read-only recovery cannot write missing graph");
  }
  getObjectErrorCode="PERMISSION_DENIED";
  await assert.rejects(port.recoverApplied(selection),
    {code:"PERMISSION_DENIED"},
    "a revoked or denied original owner must NOT become a false readback");
  getObjectErrorCode=null;
  approves=true;
  workspaceReady=false;
  const beforeMissing=applyPrompts;
  await assert.rejects(port.applyAccepted(selection),
    {code:"T3_D3_ORIGINAL_WORKSPACE_PROVISION_REQUIRED"});
  assert.equal(applyPrompts,beforeMissing,
    "no Human APPLY decision is consumed before Workspace provisioning");
  workspaceReadError="WORKSPACE_NOT_FOUND";
  await assert.rejects(port.applyAccepted(selection),
    {code:"T3_D3_ORIGINAL_WORKSPACE_PROVISION_REQUIRED"});
  assert.equal(applyPrompts,beforeMissing,
    "typed original missing Workspace also precedes Human APPLY");
  workspaceReadError="PERMISSION_DENIED";
  await assert.rejects(port.applyAccepted(selection),{code:"PERMISSION_DENIED"});
  assert.equal(applyPrompts,beforeMissing,
    "signed authorization denial cannot become a Human APPLY decision");
  assert.equal(commits,0,"missing original Workspace must never dispatch Apply");
  workspaceReadError=null;
  workspaceReady=true;
  // A human approval is bound to the exact signed purpose/audience/realm,
  // even if the selected organization, actor and Workspace do not change.
  changePurposeDuringHumanApply=true;
  await assert.rejects(port.applyAccepted(selection),
    {code:"T3_D3_APPLY_CONTEXT_CHANGED"});
  assert.equal(commits,0);
  context.purpose="result.apply";
  changePurposeDuringHumanApply=false;
  // Revoke the accepted source DURING the signed authorization callback.
  // The last original Reconciliation check must reject before Kernel writes.
  sourceCurrent=true;
  revokeDuringJit=true;
  await assert.rejects(port.applyAccepted(selection),
    {code:"T3_D3_ORIGINAL_APPLICATION_PRECONDITION_DENIED"});
  assert.equal(commits,0);
  assert.ok(preconditionCount>=1);
  // A signed owner may revoke the Host while authorize() is pending.
  // This denial occurs BEFORE the original Kernel dispatch, so must not
  // be mislabeled as a lost post-write acknowledgement.
  revokeDuringJit=false;
  sourceCurrent=true;
  stopHostDuringJit=true;
  await assert.rejects(port.applyAccepted(selection),{code:"T3_HOST_DISPOSED"});
  assert.equal(commits,0);
  active=false;
  await assert.rejects(port.applyAccepted(selection),{code:"T3_HOST_DISPOSED"});
  assert.equal(commits,0);
  active=true;stopHostDuringJit=false;sourceCurrent=true;
  let signalApply,resumeApply;
  const enteredApply=new Promise(resolve=>{signalApply=resolve;});
  const pendingApproval=new Promise(resolve=>{resumeApply=resolve;});
  holdApply=pendingApproval;enterApply=signalApply;
  const pending=port.applyAccepted(selection);
  await enteredApply;
  await assert.rejects(port.applyAccepted(selection),
    {code:"T3_D3_APPLY_IN_PROGRESS"});
  assert.equal(commits,0,"concurrent APPLY must not reach Kernel");
  // The first trusted Host is still waiting on the manager's Human APPLY.
  // A second independent Host can commit the same original effect. When the
  // first manager confirms, it must see that Event and never write again.
  holdApply=null;enterApply=null;
  const competingHost=makePort();
  const result=await competingHost.applyAccepted(selection);
  assert.equal(commits,1,"independent Host committed one original graph");
  resumeApply();
  await assert.rejects(pending,
    {code:"T3_D3_ORIGINAL_EFFECT_ALREADY_RECORDED_USE_RECOVERY"});
  assert.equal(commits,1,"stale Human APPLY cannot dispatch a second graph");
  // Retain the successful Host for the existing same-process no-replay test.
  port=competingHost;
  assert.equal(result.kernelWriteReadback,"CONFIRMED");
  assert.equal(result.originalEventReadback.idempotency_key,effect);
  assert.equal(result.originalEventReadback.payload.reconciliation_acceptance_id,accepted);
  assert.equal(result.externalProductAcceptance,"NOT_ACCEPTED");
  assert.equal(written.idempotency_key,effect);
  assert.equal(commits,1);
  const promptsAfterCommit=applyPrompts;
  await assert.rejects(port.applyAccepted(selection),
    {code:"T3_D3_APPLY_ALREADY_DISPATCHED_USE_RECOVERY"});
  assert.equal(commits,1);
  assert.equal(applyPrompts,promptsAfterCommit);
  const recovered=await port.recoverApplied(selection);
  assert.equal(recovered.status,"ORIGINAL_KERNEL_APPLY_READBACK_CONFIRMED");
  assert.equal(recovered.kernelWriteReadback,"CONFIRMED");
  assert.equal(recovered.effectKey,effect);
  assert.equal(recovered.originalEventReadback.idempotency_key,effect);
  assert.equal(commits,1,"recover must never repeat original Kernel commit");
  // The next instance has NO volatile in-flight/dispatched flags, but the
  // original durable Kernel Event still rejects a second Human APPLY.
  port=makePort();
  const beforeColdPrompt=applyPrompts;
  await assert.rejects(port.applyAccepted(selection),
    {code:"T3_D3_ORIGINAL_EFFECT_ALREADY_RECORDED_USE_RECOVERY"});
  assert.equal(applyPrompts,beforeColdPrompt,
    "cold trusted Host must not request a second Human APPLY");
  assert.equal(commits,1,"cold trusted Host must not replay original Kernel");
  eventsErrorCode="WORKSPACE_NOT_FOUND";
  const missingHistory=await port.recoverApplied(selection);
  assert.equal(missingHistory.status,"OUTCOME_UNKNOWN");
  assert.equal(missingHistory.automaticRetryAllowed,false);
  assert.equal(commits,1,"lost Event history never replays Kernel APPLY");
  eventsErrorCode="PERMISSION_DENIED";
  await assert.rejects(port.recoverApplied(selection),{code:"PERMISSION_DENIED"},
    "revoked Event access must not be hidden as uncertain write");
  eventsErrorCode=null;
  lastEvent.idempotency_key="f".repeat(64);
  const forged=await port.recoverApplied(selection);
  assert.equal(forged.status,"OUTCOME_UNKNOWN");
  assert.equal(forged.automaticRetryAllowed,false);
  assert.equal(commits,1);
  lastEvent.idempotency_key=effect;
  // The inherited T2 graph Event ALWAYS binds object_id and revision.
  // An incomplete Event must never attest a different Object as applied.
  const boundObjectId=lastEvent.object_id,boundRevision=lastEvent.revision;
  delete lastEvent.object_id;delete lastEvent.revision;
  assert.equal((await port.recoverApplied(selection)).status,"OUTCOME_UNKNOWN");
  lastEvent.object_id=boundObjectId;lastEvent.revision=boundRevision;
  // Independent mock operation: after a lost original Kernel ACK this
  // direct Host port must only allow read-only recovery, never a retry.
  active=true;stopHostDuringJit=false;sourceCurrent=true;
  port=makePort();
  commits=0;written=null;lastEvent=null;loseAckAfterWrite=true;
  await assert.rejects(port.applyAccepted(selection),
    {code:"T3_D3_KERNEL_WRITE_MAY_HAVE_COMMITTED"});
  assert.equal(commits,1);
  assert.equal(written.idempotency_key,effect);
  const afterLostAck=await port.recoverApplied(selection);
  assert.equal(afterLostAck.status,"ORIGINAL_KERNEL_APPLY_READBACK_CONFIRMED");
  assert.equal(afterLostAck.originalEventReadback.idempotency_key,effect);
  assert.equal(afterLostAck.automaticRetryAllowed,false);
  assert.equal(commits,1,"recovery may read but must never repeat APPLY");
  await assert.rejects(port.applyAccepted(selection),
    {code:"T3_D3_APPLY_ALREADY_DISPATCHED_USE_RECOVERY"});
  assert.equal(commits,1,"lost ACK cannot be followed by another direct Apply");
  port=makePort();
  const beforeColdLostAckPrompt=applyPrompts;
  await assert.rejects(port.applyAccepted(selection),
    {code:"T3_D3_ORIGINAL_EFFECT_ALREADY_RECORDED_USE_RECOVERY"});
  assert.equal(commits,1,"reopened Host cannot replay lost-ACK Kernel write");
  assert.equal(applyPrompts,beforeColdLostAckPrompt);
  loseAckAfterWrite=false; // NOW exercise forged receipts, not the earlier ACK-loss flag
  // In the original T2 graph a returned object or event ID alone is not
  // proof of the accepted Result. A forged ACK, missing independent Event,
  // or duplicate matching Event must never produce CONFIRMED. Every one of
  // these failures is POST-dispatch and cannot authorize a replay.
  const beforeUncertain=commits;
  port=makePort();written=null;lastEvent=null;
  tamperInitialEvent=true;
  await assert.rejects(port.applyAccepted(selection),
    {code:"T3_D3_KERNEL_WRITE_MAY_HAVE_COMMITTED"});
  assert.equal(commits,beforeUncertain+1);
  tamperInitialEvent=false;
  port=makePort();written=null;lastEvent=null;
  hideOriginalEvent=true;
  await assert.rejects(port.applyAccepted(selection),
    {code:"T3_D3_KERNEL_WRITE_MAY_HAVE_COMMITTED"});
  assert.equal(commits,beforeUncertain+2);
  hideOriginalEvent=false;
  port=makePort();written=null;lastEvent=null;
  duplicateEvent=true;
  await assert.rejects(port.applyAccepted(selection),
    {code:"T3_D3_KERNEL_WRITE_MAY_HAVE_COMMITTED"});
  assert.equal(commits,beforeUncertain+3);
  duplicateEvent=false;
  const independentlyRecovered=await port.recoverApplied(selection);
  assert.equal(independentlyRecovered.status,
    "ORIGINAL_KERNEL_APPLY_READBACK_CONFIRMED");
  assert.equal(commits,beforeUncertain+3,
    "read-only recovery cannot reissue any uncertain original Kernel write");
  // Original T2 canonical storage can change JSON key ordering, but not
  // the CONTENT of any application provenance field. A changed extra
  // field must invalidate BOTH immediate APPLY and cold read-only recovery.
  port=makePort();written=null;lastEvent=null;
  tamperStoredProvenance=true;
  await assert.rejects(port.applyAccepted(selection),
    {code:"T3_D3_KERNEL_WRITE_MAY_HAVE_COMMITTED"});
  assert.equal(commits,beforeUncertain+4,
    "a forged persisted Event still counts as a possibly committed write");
  assert.equal((await port.recoverApplied(selection)).status,"OUTCOME_UNKNOWN");
  assert.equal(commits,beforeUncertain+4,"forged Event recovery must not replay");
  tamperStoredProvenance=false;
  // Even a fresh owner can confirm only the exact originally signed
  // provenance; reversed key ordering is a valid T2 canonicalization.
  lastEvent.payload={
    owner_provenance:{revision:2,origin:"agent-human-review"},
    source_result_digest:"9".repeat(64),
    reconciliation_revision_ids:[rev],
    reconciliation_acceptance_id:accepted,
  };
  const reordered=await makePort().recoverApplied(selection);
  assert.equal(reordered.status,"ORIGINAL_KERNEL_APPLY_READBACK_CONFIRMED");
  assert.equal(commits,beforeUncertain+4);
  // A genuinely changed result body is still NOT confirmed, even though
  // the same body with reversed JSON keys is correctly recognized above.
  tamperStoredData=true;
  const corrupted=await makePort().recoverApplied(selection);
  assert.equal(corrupted.status,"OUTCOME_UNKNOWN");
  assert.equal(corrupted.automaticRetryAllowed,false);
  assert.equal(commits,beforeUncertain+4);
  tamperStoredData=false;
  assert.equal((await makePort().recoverApplied(selection)).status,
    "ORIGINAL_KERNEL_APPLY_READBACK_CONFIRMED");
  assert.equal(commits,beforeUncertain+4);
  // Original T2 persists only dense JSON arrays. A sparse readback must
  // NEVER validate against a genuine explicit null in a sealed Event, even
  // though Array.every() silently skips the hole. No new Kernel dispatch.
  command.event.payload.reviewWitnesses=[null];
  lastEvent.payload.reviewWitnesses=new Array(1);
  const incompleteProvenance=await makePort().recoverApplied(selection);
  assert.equal(incompleteProvenance.status,"OUTCOME_UNKNOWN");
  assert.equal(incompleteProvenance.automaticRetryAllowed,false);
  assert.equal(commits,beforeUncertain+4);
  lastEvent.payload.reviewWitnesses=[null];
  assert.equal((await makePort().recoverApplied(selection)).status,
    "ORIGINAL_KERNEL_APPLY_READBACK_CONFIRMED");
  assert.equal(commits,beforeUncertain+4);
  // The original T2 contract, not this adapter, owns legitimate Event size.
  // A large but complete JSON result must not be rejected by a new arbitrary
  // 4096-element ceiling introduced during the sparse-array fix.
  const largeWitnesses=Array.from({length:5000},(_,i)=>({index:i,valid:true}));
  command.event.payload.reviewWitnesses=largeWitnesses;
  lastEvent.payload.reviewWitnesses=structuredClone(largeWitnesses);
  assert.equal((await makePort().recoverApplied(selection)).status,
    "ORIGINAL_KERNEL_APPLY_READBACK_CONFIRMED");
  lastEvent.payload.reviewWitnesses[4999].valid=false;
  assert.equal((await makePort().recoverApplied(selection)).status,
    "OUTCOME_UNKNOWN");
  assert.equal(commits,beforeUncertain+4);
  delete command.event.payload.reviewWitnesses;
  delete lastEvent.payload.reviewWitnesses;
});


// Contract fixture only. The physical archive test independently executes
// the qualified original T2 runtime against separate IndexedDB platforms.
const adminStorage="workspace:registry:"+"7".repeat(64);
function partitionFixture(){
  const ws="workspace:business",org="org:company",hash=value=>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const c={kind:"CORP",context_id:"context:admin",actor_id:"person:manager",
    principal_id:org,organization_id:org,role_id:"role:manager",
    grant_id:"grant:application",realm_id:"realm:corp",audience:"host:t3",
    purpose:"application",resource:ws,workspace_id:ws,scope_revision:1};
  const target={consumerId:"IWXA_ADMIN_CENTER",processId:"admin.applied-results",
    processVersion:"1",purpose:"application",subjectId:org,workspaceId:ws,dataRootId:"root:company"};
  const command={workspace_id:ws,idempotency_key:effect,object:{
    object_id:"result:applied:"+effect,schema_id:"iwxa.admin.applied-results",
    schema_version:"1.0.0",base_revision:0,data:{schema:"IWXA_T3_ADMIN_APPLIED_RESULTS/1",
      records:[{taskId:"task:1",taskRevisionId:"1".repeat(64),resultRevisionId:rev,
        organizationId:org,workspaceId:ws,executorId:"person:employee",
        result:"Completed work",acceptanceId:accepted}]}},
    event:{event_type:"iwxa.admin.result.applied",payload:{
      reconciliation_acceptance_id:accepted,reconciliation_revision_ids:[rev]}}};
  const binding={schema:"IWXA_T3_APPLICATION_HOST_BINDING/1",effectKey:effect,
    operation:{operationId:"effect:"+effect,payloadDigest:"d".repeat(64),resource:ws,
      productId:"IWXA_ADMIN_CENTER",audience:c.audience,purpose:c.purpose,action:"application.apply"},
    expectedRevision:0,applicationAuthorized:false,writeAllowed:false,hostJitRequired:true,
    explicitHumanDecisionRequired:true,decisionCheckAtCommit:true,
    externalContextCoreApplied:false,commitPrecondition:()=>true};
  const f={ws,org,c,target,command,storage:adminStorage,commits:0,prompts:0,
    loseAck:false,changeOnConsent:false,signed:[],requests:[],objects:new Map(),events:new Map()};
  const key=(w,o)=>w+"/"+o;
  const persist=(input)=>{
    const w=input.workspace_id,o={...structuredClone(input.object),workspace_id:w,revision:1};
    delete o.base_revision;
    const event={workspace_id:w,event_id:"event:"+w,object_id:o.object_id,revision:1,
      idempotency_key:input.idempotency_key,event_type:input.event.event_type,
      payload:structuredClone(input.event.payload)};
    f.objects.set(key(w,o.object_id),o);
    f.events.set(w,[...(f.events.get(w)??[]),event]);
    return {workspace_id:w,object:o,event,relations_put:[]};
  };
  f.seed=w=>persist({...command,workspace_id:w});
  const access={currentContext:()=>c,actionFor:()=>"application.apply",
    operationDigest:input=>{f.signed.push(structuredClone(input));return hash(input);},
    authorize:request=>{f.requests.push(request);return {
      schema:"IWXA_T3_ORGANIZATION_OPERATION_DECISION/1",allowed:true,outcome:"PERMITTED",
      evidenceOnly:true,requestDigest:hash(request),policyDigest:hash("policy"),
      operationDigest:hash("operation"),evidenceDigest:hash("evidence"),
      organizationId:org,workspaceId:ws,grantId:c.grant_id,statusSequence:1,
      productionActivation:false,doesNotTransferData:true,doesNotAcceptCorporateCopy:true,
      validUntil:new Date(Date.now()+60000).toISOString()};},
    verifyDecisionBinding:(request,decision)=>decision.requestDigest===hash(request)};
  const kernel={sessionInfo:{contract_version:"1.3.0",service_id:"iwxa.admin-center.workspace"},
    hasOperation:()=>true,
    getWorkspace:async w=>({workspace_id:w,profile:"generic"}),
    getObject:async(w,o)=>{const object=f.objects.get(key(w,o));
      return object?{object:structuredClone(object),relations:{incoming:[],outgoing:[]}}:null;},
    listEventsSince:async w=>structuredClone(f.events.get(w)??[]),
    commitObjectGraph:async input=>{f.commits++;const receipt=persist(input);
      if(f.loseAck)throw Error("ORIGINAL_ACK_LOST");return structuredClone(receipt);}};
  f.kernel=kernel;f.access=access;
  f.port=()=>createTrustedReconciliationKernelApply({
    admission:{inspectAcceptedApplication:async()=>({})},kernel,access,isHostActive:()=>true,
    resolveReceiptWorkspace:async()=>f.storage,
    stageFromOriginalOwner:()=>({command,binding,authorizationContext:{
      operationId:binding.operation.operationId,payloadDigest:binding.operation.payloadDigest,
      organizationId:org,workspaceId:ws,dataRootId:target.dataRootId,storageScopeDigest:"e".repeat(64),
      expectedRevision:0,actorId:c.actor_id,principalId:c.principal_id,roleId:c.role_id,
      grantId:c.grant_id,operationDigest:"f".repeat(64)}}),
    confirmSeparateApply:async()=>{f.prompts++;
      if(f.changeOnConsent)f.storage="workspace:registry:"+"8".repeat(64);return true;}});
  f.selection={acceptanceId:accepted,revisionIds:[rev],target};
  return f;
}
test("new APPLY persists only in the exact original admin partition and survives cold read",async()=>{
  const f=partitionFixture(),port=f.port();
  const result=await port.applyAccepted(f.selection);
  assert.equal(f.commits,1);assert.equal(f.prompts,1);
  assert.equal(result.originalKernelReceipt.workspace_id,adminStorage);
  assert.equal(result.originalKernelReadback.object.workspace_id,adminStorage);
  assert.equal(result.originalEventReadback.workspace_id,adminStorage);
  assert.equal(result.originalKernelReadback.object.data.records[0].workspaceId,f.ws);
  assert.deepEqual(f.events.get(f.ws)??[],[]);
  assert.ok(f.requests.every(r=>r.resource===f.ws));
  const write=f.signed.find(x=>x.operation==="t1.commitObjectGraph");
  assert.equal(write.input.workspace_id,f.ws);
  assert.equal(write.input.original_application_receipt_workspace_id,adminStorage);
  assert.equal(write.input.original_application_effect_key,effect);
  const cold=f.port(),observed=await cold.recoverApplied(f.selection);
  assert.equal(observed.status,"ORIGINAL_KERNEL_APPLY_READBACK_CONFIRMED");
  assert.deepEqual(observed.originalKernelReadback,result.originalKernelReadback);
  await assert.rejects(cold.applyAccepted(f.selection),
    {code:"T3_D3_ORIGINAL_EFFECT_ALREADY_RECORDED_USE_RECOVERY"});
  assert.equal(f.commits,1);assert.equal(f.prompts,1);
});
test("unprovisioned or changed administrative partition cannot consume a new graph write",async()=>{
  const f=partitionFixture();f.storage=null;
  await assert.rejects(f.port().applyAccepted(f.selection),{code:"T3_D3_ADMIN_RECEIPT_WORKSPACE_REQUIRED"});
  assert.equal(f.prompts,0);assert.equal(f.commits,0);
  f.storage=adminStorage;f.changeOnConsent=true;
  await assert.rejects(f.port().applyAccepted(f.selection),{code:"T3_D3_ADMIN_RECEIPT_WORKSPACE_CHANGED"});
  assert.equal(f.commits,0);
});
test("legacy APPLY is read-only; duplicate placement or incomplete legacy evidence is HOLD",async()=>{
  const f=partitionFixture();f.seed(f.ws);
  const legacy=await f.port().recoverApplied(f.selection);
  assert.equal(legacy.status,"ORIGINAL_KERNEL_APPLY_READBACK_CONFIRMED");
  assert.equal(legacy.originalKernelReadback.object.workspace_id,f.ws);
  await assert.rejects(f.port().applyAccepted(f.selection),
    {code:"T3_D3_ORIGINAL_EFFECT_ALREADY_RECORDED_USE_RECOVERY"});
  assert.equal(f.prompts,0);assert.equal(f.commits,0);
  f.seed(adminStorage);
  assert.equal((await f.port().recoverApplied(f.selection)).status,"OUTCOME_UNKNOWN");
  f.objects.delete(f.ws+"/"+f.command.object.object_id);
  assert.equal((await f.port().recoverApplied(f.selection)).status,"OUTCOME_UNKNOWN");
  assert.equal(f.commits,0);
});
test("lost admin partition ACK recovers without another APPLY",async()=>{
  const f=partitionFixture();f.loseAck=true;
  await assert.rejects(f.port().applyAccepted(f.selection),
    {code:"T3_D3_KERNEL_WRITE_MAY_HAVE_COMMITTED"});
  const result=await f.port().recoverApplied(f.selection);
  assert.equal(result.status,"ORIGINAL_KERNEL_APPLY_READBACK_CONFIRMED");
  assert.equal(result.originalEventReadback.workspace_id,adminStorage);
  assert.equal(f.commits,1);assert.equal(f.prompts,1);
});
test("private receipt scope cannot export, read the registry or write a different graph",async()=>{
  const f=partitionFixture(),port=createSubjectKernelBinding({kernel:f.kernel,access:f.access,
    applicationReceiptScope:{workspaceId:adminStorage,effectKey:effect}});
  await assert.rejects(port.getObject(f.ws,"t3.access.signed-registry"),
    {code:"T3_D3_APPLICATION_RECEIPT_SCOPE_INVALID"});
  await assert.rejects(port.exportPreview({workspaces:[f.ws]}),
    {code:"T3_D3_APPLICATION_RECEIPT_SCOPE_INVALID"});
  await assert.rejects(port.commitObjectGraph({...f.command,object:{
    ...f.command.object,schema_id:"iwxa.t3.access.signed-registry"}}),
    {code:"T3_D3_APPLICATION_RECEIPT_SCOPE_INVALID"});
  await assert.rejects(port.getObject(adminStorage,f.command.object.object_id),
    {code:"T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE"});
  assert.equal(f.commits,0);assert.equal(f.signed.length,0);
});
