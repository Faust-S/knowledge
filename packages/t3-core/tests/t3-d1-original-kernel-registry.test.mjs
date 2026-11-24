import test from "node:test";
import assert from "node:assert/strict";
import {digest,signRecord} from "../src/t3/access/core.mjs";
import {NOW,model,originalKernelFixture as corporateKernelFixture} from "./support/t3-two-corp-original-authority.mjs";
import {createOriginalKernelRegistryStatePort,ORIGINAL_REGISTRY_EVENT,
  ORIGINAL_REGISTRY_SCHEMA,originalEmployeeRegistryWorkspaceId,prepareOriginalEmployeeRegistryRefresh}
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

function productionRegistryFixture({legacy=false,loseCreateAck=false,denyRead=false}={}){
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
  const storageId=originalEmployeeRegistryWorkspaceId(scope);
  const original=corporateKernelFixture();
  const workspaces=new Map([[scope.workspaceId,{workspace_id:scope.workspaceId,profile:"generic"}]]);
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
  return {kernel,scope,storageId,creates,original,port,opts,state,
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
