import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {digest,signRecord,makeProof,iso,keyObjectSigner} from "../src/t3/access/core.mjs";
import {ORIGINAL_NETWORK_KEY_TRANSITION,ORIGINAL_NETWORK_KEY_MANAGE,originalNetworkKeyPossessionBytes,
  originalNetworkKeyOperationDigest,originalNetworkKeyStatusId} from "../src/t3/access/original-network-key-lifecycle.mjs";
import {NOW,model,originalKernelFixture as corporateKernelFixture} from "./support/t3-two-corp-original-authority.mjs";
import {createOriginalKernelRegistryStatePort,ORIGINAL_REGISTRY_EVENT,
  ORIGINAL_REGISTRY_SCHEMA,originalEmployeeRegistryWorkspaceId,prepareOriginalEmployeeRegistryRefresh,
  isOriginalKernelRegistryStatePortForKernel,resolveOriginalKernelRegistryStatePortForKernel,
  ORIGINAL_PROOF_KEY_ADMISSION,ORIGINAL_CORPORATE_SEAT_POLICY}
  from "../src/t3/access/original-kernel-registry-state.mjs";
import {createTemporaryOriginalPersonalAuthority}
  from "./support/t3-original-personal-authority.mjs";

function originalKernelFixture(){
  const objects=new Map(),events=[];
  const clone=value=>structuredClone(value);
  return Object.freeze({
    sessionInfo:{contract_version:"1.3.0",runtime_version:"0.3.6"},
    hasOperation:id=>["t1.getObject","t1.putObject","t1.listEventsSince"].includes(id),
    async getObject(workspaceId,objectId){
      const record=objects.get(workspaceId+"/"+objectId);
      return record?{object:clone(record)}:null;
    },
    async putObject(input){
      const key=input.workspace_id+"/"+input.object_id;
      const old=objects.get(key);
      if(input.base_revision!==(old?.revision??0))
        throw Error("ORIGINAL_KERNEL_REVISION_CONFLICT");
      const object={workspace_id:input.workspace_id,object_id:input.object_id,
        schema_id:input.schema_id,schema_version:input.schema_version,
        revision:(old?.revision??0)+1,data:clone(input.data)};
      const event={workspace_id:input.workspace_id,
        event_id:"original:event:"+(events.length+1),
        event_type:input.event.event_type,payload:clone(input.event.payload)};
      objects.set(key,object);events.push(event);
      return clone({object,event});
    },
    async listEventsSince(workspaceId){
      return clone(events.filter(e=>e.workspace_id===workspaceId));
    },
  });
}
test("signed AccessRegistry persists in the ONE original Kernel Store; cold port recreation refuses signed revocation rollback",async()=>{
  const now=Date.now(),clock=()=>now;
  const authority=createTemporaryOriginalPersonalAuthority({
    workspaceId:"ws:personal",now,
  });
  const first=authority.snapshotSignedState();
  const kernel=originalKernelFixture(),options={
    kernel,workspaceId:"workspace:host-access",
    trustedPolicy:first.policy,clock,
  };
  const registry=createOriginalKernelRegistryStatePort(options);
  await assert.rejects(registry.readState(),
    {code:"T3_ACCESS_REGISTRY_STATE_UNAVAILABLE"});
  const issued=await registry.commitSignedState(first);
  assert.equal(issued.revision,1);
  assert.equal(issued.policy_digest,digest(first.policy));
  const saved=await registry.readState();
  assert.equal(saved.statusFloor["authority:personal"],1);
  assert.equal((await kernel.getObject(options.workspaceId,
    "t3.access.signed-registry")).object.schema_id,ORIGINAL_REGISTRY_SCHEMA);
  authority.revoke();
  const revoked=authority.snapshotSignedState();
  const second=await registry.commitSignedState(revoked);
  assert.equal(second.revision,2);
  // Deliberately destroy the adapter: the read is from the unchanged
  // ORIGINAL Kernel/Store, not an in-process grant/status cache.
  const recovered=createOriginalKernelRegistryStatePort(options);
  assert.equal((await recovered.readState()).statusFloor["authority:personal"],2);
  assert.deepEqual((await recovered.getStatus()).sequences,
    {"authority:personal":2});
  await assert.rejects(recovered.commitSignedState(first),
    {code:"T3_ACCESS_REGISTRY_SEQUENCE_ROLLBACK"});
  const forged=structuredClone(revoked);
  forged.statuses["authority:personal"].payload.sequence=3;
  forged.statusFloor["authority:personal"]=3;
  await assert.rejects(recovered.commitSignedState(forged),
    {code:"T3_ACCESS_REGISTRY_SIGNED_STATE_INVALID"});
  const wrongRoot=createOriginalKernelRegistryStatePort({
    ...options,trustedPolicy:{...first.policy,version:"v2"},
  });
  await assert.rejects(wrongRoot.readState(),
    {code:"T3_ACCESS_REGISTRY_TRUST_ANCHOR_MISMATCH"});
  // An unauthorized raw writer with access to the same Kernel service can
  // attempt to replay a SIGNED but obsolete snapshot with another revision.
  // The pre-existing original T2 Event journal remembers the higher floor.
  const before=await kernel.getObject(options.workspaceId,"t3.access.signed-registry");
  const stale=structuredClone(before.object.data);
  stale.statuses=first.statuses;stale.statusFloor=first.statusFloor;
  await kernel.putObject({
    workspace_id:options.workspaceId,object_id:"t3.access.signed-registry",
    schema_id:ORIGINAL_REGISTRY_SCHEMA,schema_version:"1.0.0",
    base_revision:before.object.revision,data:stale,extensions:{},
    event:{event_type:ORIGINAL_REGISTRY_EVENT,payload:{
      object_id:"t3.access.signed-registry",revision:3,
      policy_digest:digest(first.policy),state_digest:digest(stale),
      status_sequences:first.statusFloor,
    }},
  });
  await assert.rejects(recovered.readState(),
    {code:"T3_ACCESS_REGISTRY_ORIGINAL_SEQUENCE_ROLLBACK"});
});

function productionRegistryFixture({legacy=false,loseCreateAck=false,denyRead=false,emptyPartition=false,networkAdmin=false}={}){
  // Genuine signed state, with disposable keys from the original authority fixture.
  const fixture=model();
  const policy=structuredClone(fixture.policy);
  policy.environment="PRODUCTION";
  for(const key of Object.values(policy.keys))key.environment="PRODUCTION";
  const state={...fixture.state,policy,
    grants:Object.fromEntries(Object.entries(fixture.state.grants).map(([id,g])=>[
      id,signRecord({...g.payload,environment:"PRODUCTION"},fixture.signers[g.keyId])
    ])),
    statuses:Object.fromEntries(Object.entries(fixture.state.statuses).map(([id,s])=>[
      id,signRecord({...s.payload,environment:"PRODUCTION"},fixture.signers[s.keyId])
    ]))};
  const scope={organizationId:"org:north",authorityId:"issuer:north",workspaceId:"ws:north"};
  let manager=null;
  if(networkAdmin){
    const a=policy.authorities[scope.authorityId],member=state.grants["grant:north"].payload;
    const actions=["grant.issue","grant.revoke",ORIGINAL_NETWORK_KEY_MANAGE];
    a.actions.push(...actions);a.resources.push("authority:"+scope.authorityId);
    a.roles.push("role:manager");a.rightClasses.push("ADMINISTRATION");a.purposes.push("access-administration");
    Object.assign(policy.actionCatalog,Object.fromEntries(actions.map(action=>[action,"ADMINISTRATION"])));
    manager={...member,id:"grant:north:manager",lineageId:"grant:north:manager",
      roleId:"role:manager",rightClass:"ADMINISTRATION",resources:["authority:"+scope.authorityId,scope.workspaceId],
      actions,purposes:["access-administration"]};
    const issuer=fixture.all.north.issuerSigner;
    state.grants[manager.id]=signRecord(manager,issuer);
    const prior=state.statuses[scope.authorityId].payload;
    state.statuses[scope.authorityId]=signRecord({...prior,entries:[...prior.entries,
      {grantId:manager.id,state:"ACTIVE",effectiveAt:iso(NOW-2500),evidenceRef:"evidence:manager"}]},issuer);
  }
  const storageId=originalEmployeeRegistryWorkspaceId(scope);
  const original=corporateKernelFixture();
  const workspaces=new Map([[scope.workspaceId,{workspace_id:scope.workspaceId,profile:"generic"}]]);
  if(emptyPartition)workspaces.set(storageId,{workspace_id:storageId,profile:"generic"});
  const creates=[];
  const kernel={...original.api,
    hasOperation:op=>original.api.hasOperation(op)||["t1.getWorkspace","t1.createWorkspace"].includes(op),
    async getWorkspace(id){
      if(denyRead&&id===storageId)throw Object.assign(Error("denied"),{code:"DENIED"});
      return structuredClone(workspaces.get(id)??null);
    },
    async createWorkspace(input){
      assert.equal(input.workspace_id,storageId);
      assert.equal(input.profile,"generic");
      assert.ok(!workspaces.has(storageId));
      creates.push(structuredClone(input));
      workspaces.set(storageId,{...input});
      if(loseCreateAck)throw Error("SIMULATED_LOST_CREATE_ACK");
      return structuredClone(input);
    }
  };
  const opts={kernel,workspaceId:scope.workspaceId,trustedPolicy:policy,clock:()=>NOW};
  const port=()=>createOriginalKernelRegistryStatePort({...opts,corporateScope:{
    organizationId:scope.organizationId,authorityId:scope.authorityId}});
  return {kernel,scope,storageId,creates,original,port,opts,state,manager,fixture,
    prepareLegacy:async()=>{if(legacy)await createOriginalKernelRegistryStatePort(opts).commitSignedState(state);}};
}
test("fresh corporate registry occupies an original separate Workspace; grants retain exact business scope",async()=>{
  const s=productionRegistryFixture(),p=s.port();
  assert.notEqual(s.storageId,s.scope.workspaceId);
  assert.equal((await p.readStoragePlacement()).mode,"NOT_CREATED");
  await assert.rejects(p.readState(),{code:"T3_ACCESS_REGISTRY_STATE_UNAVAILABLE"});
  await assert.rejects(p.commitSignedState(s.state),{code:"T3_ACCESS_REGISTRY_STATE_UNAVAILABLE"});
  await assert.rejects(p.initializeStorage(),{code:"T3_ACCESS_REGISTRY_STORAGE_HUMAN_REQUIRED"});
  assert.equal(s.creates.length,0);
  const placement=await p.initializeStorage({confirmed:true});
  assert.equal(placement.mode,"SEPARATE");
  assert.equal(placement.registrySeparated,true);
  assert.equal(placement.workspaceId,s.storageId);
  await p.commitSignedState(s.state);
  assert.equal(s.creates.length,1);
  assert.equal(s.original.calls[0].workspace_id,s.storageId);
  assert.equal(await s.kernel.getObject(s.scope.workspaceId,"t3.access.signed-registry"),null);
  const cold=s.port();
  assert.equal((await cold.readStoragePlacement()).mode,"SEPARATE");
  assert.deepEqual((await cold.readState()).grants["grant:north"].payload.resources,[s.scope.workspaceId]);
  const delivery=await cold.readRegistryDelivery();
  assert.equal(delivery.record.workspace_id,s.storageId);
  const verified=prepareOriginalEmployeeRegistryRefresh({...s.scope,previousState:s.state,delivery,now:NOW});
  assert.equal(verified.originalReadback,true);
  assert.equal(verified.outcome,"ALREADY_CURRENT");
  const wrong=structuredClone(delivery);
  wrong.record.workspace_id="ws:foreign";
  await assert.rejects(async()=>prepareOriginalEmployeeRegistryRefresh({...s.scope,previousState:s.state,delivery:wrong,now:NOW}),{code:"T3_ACCESS_REGISTRY_REFRESH_STORAGE_SCOPE_INVALID"});
  // Simulate an unrelated business-archive registry-shaped object. It never
  // changes the private registry location or the genuine signed readback.
  await s.kernel.putObject({...s.original.calls[0],workspace_id:s.scope.workspaceId,
    data:{untrustedBusinessData:true}});
  assert.equal((await s.port().readStoragePlacement()).workspaceId,s.storageId);
  assert.equal((await s.port().readState()).statusFloor["issuer:north"],1);
});
test("existing corporate registry stays in the original business Workspace until an explicit migration exists",async()=>{
  const s=productionRegistryFixture({legacy:true});await s.prepareLegacy();
  const port=s.port(),where=await port.readStoragePlacement();
  assert.equal(where.mode,"LEGACY");
  assert.equal(where.registrySeparated,false);
  assert.equal((await port.initializeStorage({confirmed:true})).mode,"LEGACY");
  assert.equal(s.creates.length,0);
  assert.equal(s.original.calls.length,1);
  const delivery=await port.readRegistryDelivery();
  assert.equal(delivery.record.workspace_id,s.scope.workspaceId);
  assert.equal(prepareOriginalEmployeeRegistryRefresh({...s.scope,previousState:s.state,delivery,now:NOW}).originalReadback,true);
});
test("lost acknowledgement of original management Workspace creation is reconciled without another write",async()=>{
  const s=productionRegistryFixture({loseCreateAck:true}),p=s.port();
  assert.equal((await p.initializeStorage({confirmed:true})).mode,"SEPARATE");
  assert.equal((await p.initializeStorage({confirmed:true})).mode,"SEPARATE");
  await p.commitSignedState(s.state);
  assert.equal(s.creates.length,1);
  assert.equal(s.original.calls.length,1);
});
test("unknown or denied private Workspace read never becomes an absent registry or a second initialization",async()=>{
  const s=productionRegistryFixture({denyRead:true}),p=s.port();
  await assert.rejects(p.readStoragePlacement(),{code:"DENIED"});
  await assert.rejects(p.initializeStorage({confirmed:true}),{code:"DENIED"});
  assert.equal(s.creates.length,0);
});

test("an empty private partition cannot reset a populated legacy authority",async()=>{
  const s=productionRegistryFixture({legacy:true,emptyPartition:true});await s.prepareLegacy();
  const port=s.port();
  await assert.rejects(port.readStoragePlacement(),{code:"T3_ACCESS_REGISTRY_STORAGE_LEGACY_CONFLICT"});
  await assert.rejects(port.initializeStorage({confirmed:true}),{code:"T3_ACCESS_REGISTRY_STORAGE_LEGACY_CONFLICT"});
  assert.equal(s.creates.length,0);
  assert.equal(s.original.calls.length,1);
});


test("converged original corporate Registry proves the selected physical workspace, not its expected address",async()=>{
  const s=productionRegistryFixture(),p=s.port(),match=(port,workspaceId,kernel=s.kernel)=>
    isOriginalKernelRegistryStatePortForKernel(port,kernel,{workspaceId});
  assert.equal(match(p,s.storageId),false);
  assert.equal(match(p,s.scope.workspaceId),false);
  await p.initializeStorage({confirmed:true});
  await p.commitSignedState(s.state);
  assert.equal(match(p,s.storageId),true);
  assert.equal(match(p,s.scope.workspaceId),false);
  assert.equal(match(p,s.storageId,{...s.kernel}),false);
  const query={keyId:"key:test:network",nodeRef:"node:test:a",recipientNodeRef:"node:test:b",
    workspaceId:s.scope.workspaceId,originalWriteOwnerRef:"owner:test",scopeRef:"scope:test",ownerEpoch:1,keyUse:"NETWORK_FRAME"};
  const cold=s.port();
  assert.equal(match(cold,s.storageId),false);
  assert.equal(await cold.readNetworkKeyEvidence(query),null);
  assert.equal(await cold.readNetworkKeyHistoryEvidence(query),null);
  assert.equal(match(cold,s.storageId),true);
  assert.deepEqual((await cold.readState()).grants["grant:north"].payload.resources,[s.scope.workspaceId]);
  assert.equal(s.creates.length,1);assert.equal(s.original.calls.length,1);
  const legacy=productionRegistryFixture({legacy:true});await legacy.prepareLegacy();
  const legacyPort=legacy.port();await legacyPort.readState();
  assert.equal(isOriginalKernelRegistryStatePortForKernel(legacyPort,legacy.kernel,{workspaceId:legacy.storageId}),false);
  assert.equal(isOriginalKernelRegistryStatePortForKernel(legacyPort,legacy.kernel,{workspaceId:legacy.scope.workspaceId}),true);
  assert.equal(legacy.creates.length,0);
});

test("cold corporate network admission resolves only its exact existing physical Registry",async()=>{
  const s=productionRegistryFixture(),scope={workspaceId:s.storageId};
  const absent=s.port();
  assert.equal(await resolveOriginalKernelRegistryStatePortForKernel(absent,s.kernel,scope),false);
  assert.equal(s.creates.length,0);
  await absent.initializeStorage({confirmed:true});await absent.commitSignedState(s.state);
  const cold=s.port();
  assert.equal(isOriginalKernelRegistryStatePortForKernel(cold,s.kernel,scope),false);
  assert.equal(await resolveOriginalKernelRegistryStatePortForKernel(cold,{...s.kernel},scope),false);
  assert.equal(await resolveOriginalKernelRegistryStatePortForKernel(cold,s.kernel,{workspaceId:s.scope.workspaceId}),false);
  assert.equal(await resolveOriginalKernelRegistryStatePortForKernel(cold,s.kernel,scope),true);
  assert.equal(isOriginalKernelRegistryStatePortForKernel(cold,s.kernel,scope),true);
  assert.equal(s.creates.length,1);assert.equal(s.original.calls.length,1);
  const legacy=productionRegistryFixture({legacy:true});await legacy.prepareLegacy();
  assert.equal(await resolveOriginalKernelRegistryStatePortForKernel(legacy.port(),legacy.kernel,{workspaceId:legacy.storageId}),false);
  assert.equal(legacy.creates.length,0);
  const denied=productionRegistryFixture({denyRead:true});
  assert.equal(await resolveOriginalKernelRegistryStatePortForKernel(denied.port(),{...denied.kernel},{workspaceId:denied.storageId}),false);
  await assert.rejects(resolveOriginalKernelRegistryStatePortForKernel(denied.port(),denied.kernel,{workspaceId:denied.storageId}),{code:"DENIED"});
});

test("one original corporate Registry replays employee proof, seat policy and network key lifecycle in one signed history",async()=>{
  const s=productionRegistryFixture({networkAdmin:true}),p=s.port(),{authorityId,organizationId,workspaceId}=s.scope;
  const issuerSigner=s.fixture.all.north.issuerSigner,managerSigner=s.fixture.all.north.credentialSigner,g=s.manager;
  const initial=structuredClone(s.state),rootDigest=digest(initial.policy);
  await p.initializeStorage({confirmed:true});await p.commitSignedState(initial);
  let serial=0;
  const managerFor=(operationDigest,resource,action)=>{
    const id=++serial,managerRequest={id:"request:merge:"+id,actorId:g.holderId,principalId:organizationId,
      roleId:g.roleId,grantId:g.id,realmId:g.realmId,audience:g.audience,resource,action,
      purpose:"access-administration",operationDigest};
    const managerChallenge="challenge:merge:manager:"+id;
    return {managerRequest,managerChallenge,managerProof:makeProof(managerRequest,managerChallenge,NOW,managerSigner,"PRODUCTION")};
  };
  const keyFor=(subjectId,use)=>{
    const {privateKey,publicKey}=generateKeyPairSync("ed25519");
    return {privateKey,keyRecord:{subjectId,environment:"PRODUCTION",status:"ACTIVE",uses:[use],
      publicKey:publicKey.export({type:"spki",format:"pem"}).toString(),notBefore:iso(NOW-1000),expiresAt:iso(NOW+300000)}};
  };
  const employee=keyFor("person:merge:employee","PROOF"),credentialKeyId="key:merge:employee";
  const admissionDigest=digest({schema:ORIGINAL_PROOF_KEY_ADMISSION,authorityId,organizationId,
    employeeWorkspaceId:workspaceId,credentialKeyId,keyRecord:employee.keyRecord});
  const employeeRequest={id:"request:merge:employee",actorId:employee.keyRecord.subjectId,principalId:organizationId,
    roleId:"role:member",grantId:"grant:pending",realmId:g.realmId,audience:g.audience,resource:workspaceId,
    action:"work.prepare",purpose:"work",operationDigest:admissionDigest};
  const employeeChallenge="challenge:merge:employee";
  await p.admitProofCredential({authorityId,organizationId,employeeWorkspaceId:workspaceId,credentialKeyId,
    keyRecord:employee.keyRecord,issuerSigner,...managerFor(admissionDigest,"authority:"+authorityId,"grant.issue"),
    employeeRequest,employeeChallenge,employeeProof:makeProof(employeeRequest,employeeChallenge,NOW,
      keyObjectSigner(credentialKeyId,employee.privateKey),"PRODUCTION")});
  const beforeSeat=await p.readState();
  assert.equal(beforeSeat.statusFloor[authorityId],2);
  const seatDigest=digest({schema:ORIGINAL_CORPORATE_SEAT_POLICY,authorityId,organizationId,oldPolicyDigest:digest(beforeSeat.policy)});
  const seat=await p.enableCorporateSeatPolicy({authorityId,organizationId,issuerSigner,expectedStateDigest:digest(beforeSeat),
    ...managerFor(seatDigest,"authority:"+authorityId,"grant.issue")});
  assert.equal(seat.registryRevision,3);
  const key=keyFor(employee.keyRecord.subjectId,"NETWORK_FRAME");
  const binding={bindingRef:"binding:merge:one",subjectId:key.keyRecord.subjectId,permissionRef:"permission:merge:one",
    keyId:"key:merge:network",nodeRef:"node:merge:a",recipientNodeRef:"node:merge:b",workspaceId,
    originalWriteOwnerRef:"owner:merge",scopeRef:"scope:merge",ownerEpoch:1,generation:1,keyUse:"NETWORK_FRAME"};
  const commandFor=async(kind,b,previous=null,patch={})=>{
    const state=await p.readState();
    const claims={schema:ORIGINAL_NETWORK_KEY_TRANSITION,kind,transitionRef:"transition:merge:"+kind,
      authorityId,principalId:organizationId,previousPolicyDigest:digest(state.policy),registryWorkspaceId:s.storageId,
      registryObjectId:"t3.access.signed-registry",rootPolicyDigest:rootDigest,
      expectedStatusSequence:state.statusFloor[authorityId],previousBindingDigest:previous?digest(previous):null,
      issuedAt:iso(NOW),binding:b,keyRecord:kind==="REVOKE"?null:key.keyRecord,...patch};
    const transition={claims,possessionSignature:kind==="REVOKE"?null:sign(null,originalNetworkKeyPossessionBytes(claims),key.privateKey).toString("base64url"),
      agreementPossession:null};
    const signedStatus=signRecord({...state.statuses[authorityId].payload,id:originalNetworkKeyStatusId(transition),
      sequence:claims.expectedStatusSequence+1,issuedAt:claims.issuedAt},issuerSigner);
    return {transition,signedStatus,...managerFor(originalNetworkKeyOperationDigest(transition),workspaceId,ORIGINAL_NETWORK_KEY_MANAGE)};
  };
  await assert.rejects(p.applyNetworkKeyTransition(await commandFor("ENROLL",binding,null,{registryWorkspaceId:workspaceId})),
    {code:"NETWORK_KEY_REGISTRY_SCOPE_MISMATCH"});
  assert.equal(s.original.calls.length,3);
  const enrolled=await p.applyNetworkKeyTransition(await commandFor("ENROLL",binding));
  assert.equal(enrolled.kernelRevision,4);assert.equal(enrolled.keyCurrentlyActive,true);
  const query=Object.fromEntries(["keyId","nodeRef","recipientNodeRef","workspaceId","originalWriteOwnerRef","scopeRef","ownerEpoch","keyUse"].map(k=>[k,binding[k]]));
  const cold=s.port();
  assert.equal(await resolveOriginalKernelRegistryStatePortForKernel(cold,s.kernel,{workspaceId:s.storageId}),true);
  const evidence=await cold.readNetworkKeyEvidence(query);assert.equal(evidence.binding.keyId,binding.keyId);
  const beforeRevoke=await cold.readState();
  assert.ok(beforeRevoke.policy.keys[credentialKeyId]);
  assert.ok(beforeRevoke.policy.authorities[authorityId].rightClasses.includes("ENTITLEMENT"));
  assert.equal(beforeRevoke.statusFloor[authorityId],4);
  const revoked=await p.applyNetworkKeyTransition(await commandFor("REVOKE",{...binding,generation:2},evidence.binding));
  assert.equal(revoked.kernelRevision,5);assert.equal(revoked.keyCurrentlyActive,false);
  const recovered=s.port();assert.equal(await recovered.readNetworkKeyEvidence(query),null);
  const historic=await recovered.readNetworkKeyHistoryEvidence(query);
  assert.equal(historic.admission.revision,4);assert.equal(historic.retirement.revision,5);
  assert.equal(historic.liveNetworkAuthorityGranted,false);
  const delivery=await recovered.readRegistryDelivery();
  const refreshed=prepareOriginalEmployeeRegistryRefresh({...s.scope,previousState:initial,delivery,now:NOW});
  assert.equal(refreshed.outcome,"VERIFIED_REFRESH");assert.equal(refreshed.originalRevision,5);
  assert.equal(refreshed.state.statusFloor[authorityId],5);
  assert.equal(refreshed.state.policy.keys[binding.keyId].status,"REVOKED");
  assert.deepEqual(Object.keys(refreshed.state.grants).sort(),Object.keys(initial.grants).sort());
  assert.equal(s.creates.length,1);assert.equal(s.original.calls.length,5);
  assert.ok(s.original.calls.every(row=>row.workspace_id===s.storageId));
  // One Event must never assert two independent policy transitions.
  const corrupt=structuredClone(delivery);
  const seatEvent=corrupt.events.find(e=>e.payload.corporate_seat_policy_admission);
  const proofEvent=corrupt.events.find(e=>e.payload.proof_credential_admission);
  seatEvent.payload.proof_credential_admission=proofEvent.payload.proof_credential_admission;
  assert.throws(()=>prepareOriginalEmployeeRegistryRefresh({...s.scope,previousState:initial,delivery:corrupt,now:NOW}),
    {code:"T3_ACCESS_REGISTRY_POLICY_ADMISSION_CONFLICT"});
});
