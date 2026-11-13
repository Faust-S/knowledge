import test from "node:test";
import assert from "node:assert/strict";
import {digest} from "../src/t3/access/core.mjs";
import {createOriginalKernelRegistryStatePort,ORIGINAL_REGISTRY_EVENT,
  ORIGINAL_REGISTRY_SCHEMA}
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
