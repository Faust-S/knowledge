import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createSignedAccessHostPort } from "../../src/t3/signed-access-host-port.mjs";
import test from "node:test";
import { readActivityFromT2Host } from "../../src/t3/activity/kernel-reader.mjs";
import { readActivityFromWorkspaceContext } from "../../src/t3/index.mjs";
import { readFromLiveT2Kernel } from "../../src/t3/activity/live-iwxa-client.mjs";

const workspaceId = "workspace:one";
const operations = new Set([
  "t1.getWorkspace", "t1.listObjects", "t1.listEventsSince", "t1.getObject",
]);
const bindings = {
  objects: [
    { schema_id: "d06.requirement", schema_version: "1.0.0", semantic_kind: "Entity" },
    { schema_id: "d06.order", schema_version: "1.0.0", semantic_kind: "Process",
      links: [{ field: "requirement_id", relation: "depends_on" }] },
  ],
  events: [{ event_type: "d06.order.confirmed", semantic_kind: "Event" }],
  relations: [{ kind: "fulfills", relation: "fulfills" }],
};

function makeObject(id, schemaId, data, revision = 1, workspace = workspaceId) {
  return {
    object_id: id, workspace_id: workspace,
    schema_id: schemaId, schema_version: "1.0.0",
    created_by_service: "d06", updated_by_service: "d06",
    created_at: "2026-11-10T09:00:00.000Z",
    updated_at: "2026-11-10T09:00:00.000Z",
    revision, data, extensions: {}, deleted: false, deleted_at: undefined,
  };
}
const requirement = makeObject("requirement:1", "d06.requirement", { budget: 5000 });
const order = makeObject("order:42", "d06.order", {
  requirement_id: "requirement:1", buyer: "private name",
}, 2);
const event = {
  event_id: "event:confirmed", workspace_id: workspaceId, service_id: "d06",
  event_type: "d06.order.confirmed", object_id: "order:42", revision: 2,
  occurred_at: "2026-11-10T10:00:00.000Z", payload: { private_notes: "secret" },
};
const relation = {
  relation_id: "relation:1", workspace_id: workspaceId,
  from_object_id: "order:42", to_object_id: "requirement:1",
  kind: "fulfills", created_at: "2026-11-10T09:15:00.000Z",
  created_by_service: "d06",
};

function fixture() {
  const data = {
    workspace: {
      workspace_id: workspaceId, profile: "domain", capabilities: ["read"],
      created_at: "2026-11-10T09:00:00.000Z", updated_at: "2026-11-10T10:00:00.000Z",
    },
    objects: [structuredClone(requirement), structuredClone(order)],
    events: [structuredClone(event)],
    outgoing: new Map([["order:42", [structuredClone(relation)]]]),
  };
  const counts = { getWorkspace: 0, listObjects: 0, listEventsSince: 0, getObject: 0 };
  const kernel = {
    sessionInfo: Object.freeze({
      mode: "full", contract_version: "1.3.0",
      runtime_version: "0.3.6", service_id: "d06",
    }),
    hasOperation(operation) { return operations.has(operation); },
    async getWorkspace(id) {
      counts.getWorkspace += 1;
      return id === workspaceId ? data.workspace : null;
    },
    async listObjects(query) {
      counts.listObjects += 1;
      assert.deepEqual(query, { workspace_id: workspaceId, include_deleted: true });
      return data.objects;
    },
    async listEventsSince(id) {
      counts.listEventsSince += 1;
      assert.equal(id, workspaceId);
      return data.events;
    },
    async getObject(id, objectId) {
      counts.getObject += 1;
      assert.equal(id, workspaceId);
      const object = data.objects.find((row) => row.object_id === objectId);
      if (!object) return null;
      return { object, relations: {
        outgoing: data.outgoing.get(objectId) ?? [], incoming: [],
      } };
    },
  };
  return { kernel, data, counts };
}
async function read(kernel, overrides = {}) {
  return readActivityFromT2Host({
    kernel, workspace_id: workspaceId, bindings, ...overrides,
  });
}

test("actual T2 KernelFacade method names and shape: objects, events and outgoing relations", async () => {
  const { kernel, data, counts } = fixture();
  const before = structuredClone(data.objects);
  const result = await read(kernel);
  assert.equal(result.nodes.length, 2);
  assert.equal(result.events.length, 1);
  assert.equal(result.relations.length, 2);
  assert.ok(result.relations.some((row) =>
    row.relation_id === "relation:1" && row.relation === "fulfills"));
  assert.ok(result.relations.some((row) =>
    row.source_id === "order:42" && row.relation === "depends_on"));
  assert.deepEqual(result.unmapped.relation_ids, []);
  assert.deepEqual(data.objects, before);
  assert.deepEqual(counts, {
    getWorkspace: 2, listObjects: 2, listEventsSince: 2, getObject: 2,
  });
  assert.equal(JSON.stringify(result).includes("private name"), false);
  assert.equal(JSON.stringify(result).includes("private_notes"), false);
  assert.equal(JSON.stringify(result).includes("budget"), false);
  for (const forbidden of ["putObject", "deleteObject", "putRelation", "indexedDB"]) {
    assert.equal(forbidden in kernel, false);
  }
});

test("second independently constructed read facade can reproduce same projection", async () => {
  const original = fixture();
  const first = await read(original.kernel);
  const second = fixture();
  second.data.objects = structuredClone(original.data.objects);
  second.data.events = structuredClone(original.data.events);
  second.data.outgoing = structuredClone(original.data.outgoing);
  assert.deepEqual(first, await read(second.kernel));
});

test("all four read grants are checked before any source read", async () => {
  for (const op of operations) {
    const { kernel, counts } = fixture();
    kernel.hasOperation = (requested) => requested !== op;
    await assert.rejects(read(kernel), { code: "OPERATION_NOT_GRANTED" });
    assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 0);
  }
});

test("read-only mode is acceptable; reads cannot call writer", async () => {
  const { kernel } = fixture();
  kernel.sessionInfo = { ...kernel.sessionInfo, mode: "read-only" };
  assert.equal((await read(kernel)).nodes.length, 2);
});

test("different T2 Runtime contract is rejected", async () => {
  const { kernel } = fixture();
  kernel.sessionInfo = { ...kernel.sessionInfo, contract_version: "1.2.0" };
  await assert.rejects(read(kernel), { code: "INCOMPATIBLE_T2_FACADE" });
});

test("workspace missing or deleted is not projected", async () => {
  const source = fixture();
  source.data.workspace = null;
  await assert.rejects(read(source.kernel), { code: "WORKSPACE_NOT_ACTIVE" });
  source.data.workspace = { workspace_id: workspaceId, deleted_at: "2026-11-10T11:00:00Z" };
  await assert.rejects(read(source.kernel), { code: "WORKSPACE_NOT_ACTIVE" });
});

test("cross-workspace object supplied by reader fails closed", async () => {
  const { kernel, data } = fixture();
  data.objects.push(makeObject("foreign:5", "d06.order", {}, 1, "other"));
  await assert.rejects(read(kernel), { code: "CROSS_WORKSPACE_SOURCE" });
});

test("cross-workspace event supplied by reader fails closed", async () => {
  const { kernel, data } = fixture();
  data.events.push({ ...event, event_id: "event:foreign", workspace_id: "other" });
  await assert.rejects(read(kernel), { code: "CROSS_WORKSPACE_SOURCE" });
});

test("cross-workspace relation supplied by reader fails closed", async () => {
  const { kernel, data } = fixture();
  data.outgoing.get("order:42").push({ ...relation, workspace_id: "other" });
  await assert.rejects(read(kernel), { code: "CROSS_WORKSPACE_SOURCE" });
});

test("getObject revision drift is detected", async () => {
  const { kernel } = fixture();
  const base = kernel.getObject;
  kernel.getObject = async (ws, id) => {
    const info = await base(ws, id);
    if (id === "order:42") info.object = { ...info.object, revision: 9 };
    return info;
  };
  await assert.rejects(read(kernel), { code: "SOURCE_CHANGED_DURING_READ" });
});

test("new T2 event during read invalidates the projection, never fake freshness", async () => {
  const { kernel, data } = fixture();
  const base = kernel.listEventsSince;
  kernel.listEventsSince = async (ws) => {
    const current = await base(ws);
    if (data.events.length === 1) {
      data.events.push({ ...event, event_id: "event:later" });
      return current.slice(0, 1);
    }
    return current;
  };
  await assert.rejects(read(kernel), { code: "SOURCE_CHANGED_DURING_READ" });
});

test("workspace changed during read invalidates projection", async () => {
  const { kernel } = fixture();
  const base = kernel.getWorkspace;
  let calls = 0;
  kernel.getWorkspace = async (id) => {
    calls += 1;
    const original = await base(id);
    return calls === 1 ? original : { ...original, updated_at: "2026-11-10T11:00:00Z" };
  };
  await assert.rejects(read(kernel), { code: "SOURCE_CHANGED_DURING_READ" });
});

test("deleted T2 object is not an active dependency or event target", async () => {
  const { kernel, data } = fixture();
  data.objects[0] = {
    ...data.objects[0], deleted: true, deleted_at: "2026-11-10T12:00:00Z",
    revision: 2,
  };
  const view = await read(kernel);
  assert.deepEqual(view.nodes.map((row) => row.object_id), ["order:42"]);
  assert.equal(view.relations.length, 0);
  assert.ok(view.unresolved.some((row) => row.reason === "deleted_ref"));
});

test("unmapped relation stays unknown instead of being a derived process", async () => {
  const { kernel } = fixture();
  const view = await read(kernel, {
    bindings: { objects: bindings.objects, events: bindings.events },
  });
  assert.deepEqual(view.unmapped.relation_ids, ["relation:1"]);
  assert.equal(view.relations.length, 1);
});

test("duplicate relation IDs with conflicting values are rejected", async () => {
  const { kernel, data } = fixture();
  data.outgoing.get("order:42").push({ ...relation, to_object_id: "other" });
  await assert.rejects(read(kernel), { code: "CONFLICTING_RELATION_ID" });
});

test("malformed T2 getObject cannot be silently skipped", async () => {
  const { kernel } = fixture();
  kernel.getObject = async () => null;
  await assert.rejects(read(kernel), { code: "SOURCE_CHANGED_DURING_READ" });
});

test("maximum source limits are explicit instead of truncating records", async () => {
  const { kernel } = fixture();
  await assert.rejects(read(kernel, { max_objects: 1 }), { code: "SOURCE_LIMIT_EXCEEDED" });
  await assert.rejects(read(kernel, { max_events: 0 }), { code: "INVALID_BOUND" });
});

test("live T2 reader accepts exact read grants and rejects every non-read package or unknown grant", async () => {
  const readGrants = [
    "t0.validate", "t1.listWorkspaces", "t1.getWorkspace", "t1.listObjects",
    "t1.getObject", "t1.listAssets", "t1.getAsset", "t1.listEventsSince",
  ];
  const source = fixture();
  const makeBootstrap = (grants) => ({
    async connect({ service_id }) {
      assert.equal(service_id, "iwxa.t2.qualification.reader");
      return {
        contract_version: "1.3.0",
        runtime_version: "0.3.6",
        service: { service_id },
        granted_operations: grants,
        t1: source.kernel,
      };
    },
  });
  const options = {
    service_id: "iwxa.t2.qualification.reader",
    workspace_id: workspaceId, bindings,
  };
  const projected = await readFromLiveT2Kernel({
    ...options, bootstrap: makeBootstrap(readGrants),
  });
  assert.equal(projected.view.nodes.length, 2);
  assert.equal(projected.view.relations.length, 2);

  const readsBefore = { ...source.counts };
  for (const operation of [
    "t1.commitObjectGraph", "t2.exportPreview", "t2.exportPackage",
    "t2.confirmExport", "t2.importPreview", "t2.importCommit",
    "t2.importCancel", "t3.futureWrite",
  ]) {
    await assert.rejects(readFromLiveT2Kernel({
      ...options, bootstrap: makeBootstrap([...readGrants, operation]),
    }), { code: "T2_READER_HAS_WRITE_AUTHORITY" });
    assert.deepEqual(source.counts, readsBefore, "rejected grant must not read source");
  }
});

test("D2 in T3 Host reads the actually selected T2 Workspace without separate Kernel",async()=>{
  const {kernel,counts}=fixture();
  const selected={workspace_id:workspaceId};
  const context={kernel,currentWorkspace:{get:()=>selected}};
  const view=await readActivityFromWorkspaceContext(context,{bindings});
  assert.equal(view.workspace_id,workspaceId);
  assert.equal(view.nodes.length,2);
  assert.equal(view.events.length,1);
  assert.equal(counts.listObjects,2);
});
test("D2 Host refuses foreign requested Workspace before the inherited Kernel reads",async()=>{
  const {kernel,counts}=fixture();
  const context={kernel,currentWorkspace:{get:()=>({workspace_id:workspaceId})}};
  await assert.rejects(readActivityFromWorkspaceContext(context,{
    workspace_id:"workspace:foreign",bindings,
  }),{code:"T3_ACTIVITY_SELECTED_WORKSPACE_MISMATCH"});
  assert.equal(Object.values(counts).reduce((a,b)=>a+b,0),0);
});
test("D2 Host refuses to read when no T2 Workspace is selected",async()=>{
  const {kernel,counts}=fixture();
  await assert.rejects(readActivityFromWorkspaceContext({
    kernel,currentWorkspace:{get:()=>null},
  },{bindings}),{code:"T3_ACTIVITY_WORKSPACE_NOT_SELECTED"});
  assert.equal(Object.values(counts).reduce((a,b)=>a+b,0),0);
});
test("D2 Host does not return stale activity if selection changes during T2 read",async()=>{
  const {kernel}=fixture();
  let selected=workspaceId;
  const base=kernel.listObjects;
  kernel.listObjects=async query=>{
    const result=await base(query);
    selected="workspace:foreign";
    return result;
  };
  const context={kernel,currentWorkspace:{get:()=>({workspace_id:selected})}};
  await assert.rejects(readActivityFromWorkspaceContext(context,{bindings}),{
    code:"T3_ACTIVITY_WORKSPACE_CHANGED_DURING_READ",
  });
});

test("D1 signed owner permits only authorized Activity reads through the original T2 Kernel",async()=>{
  const {kernel,counts}=fixture();
  const listeners=new Set();
  const selection={workspace_id:workspaceId};
  const currentWorkspace={
    get:()=>selection,
    subscribe:listener=>{listeners.add(listener);return ()=>listeners.delete(listener);},
  };
  const ownerContext={kind:"PERSONAL",context_id:"context:person",actor_id:"person:1",
    principal_id:"person:1",role_id:"role:member",grant_id:"grant:person",
    realm_id:"realm:person",audience:"host:t3",resource:workspaceId,
    purpose:"activity.read",workspace_id:workspaceId,
    scope_revision:1,organization_id:null};
  const hash=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
  let status="ACTIVE", decisions=0;
  const now=Date.now();
  const signedAccess=createSignedAccessHostPort({
    currentContext:()=>ownerContext,
    actionFor:()=> "activity.read",
    operationDigest:({operation,input,context})=>hash({operation,input,context}),
    canonicalDigest:hash,
    clock:()=>now,
    personal:{check:request=>{
      decisions+=1;
      return {schema:"IWXA_T3_AUTHORIZATION_DECISION/1",
        allowed:status==="ACTIVE",outcome:status==="ACTIVE"?"PERMITTED":"DENIED",
        evidenceOnly:true,requestDigest:hash(request),policyDigest:hash("policy"),
        evaluatedAt:new Date(now).toISOString(),statusObservedAt:new Date(now).toISOString(),
        validUntil:new Date(now+60000).toISOString(),
        statusSequence:1,authorityPath:[{grantId:request.grantId}]};
    }},
  });
  const context={kernel,currentWorkspace};
  const accepted=await readActivityFromWorkspaceContext(context,{bindings,signedAccess});
  assert.equal(accepted.workspace_id,workspaceId);
  assert.equal(accepted.nodes.length,2);
  assert.equal(decisions,Object.values(counts).reduce((sum,count)=>sum+count,0),
    "every inherited Kernel read must have exactly one signed Access decision");
  assert.equal(listeners.size,0,"focus listener is released after the read");
  const before={...counts};
  status="REVOKED";
  await assert.rejects(readActivityFromWorkspaceContext(context,{bindings,signedAccess}),{
    code:"T3_ACCESS_NOT_PERMITTED",
  });
  assert.deepEqual(counts,before,"a revoked grant must not reach Kernel");
  assert.equal(listeners.size,0);
});

test("Activity does not return A after an observed A → B → A context switch",async()=>{
  const {kernel}=fixture();
  const listeners=new Set();
  const first={workspace_id:workspaceId};
  let current=first;
  const notify=next=>{current=next;for(const listener of listeners)listener(next);};
  const context={kernel,currentWorkspace:{
    get:()=>current,
    subscribe:listener=>{listeners.add(listener);return ()=>listeners.delete(listener);},
  }};
  const original=kernel.listObjects;
  kernel.listObjects=async query=>{
    const result=await original(query);
    notify({workspace_id:"workspace:foreign"});
    notify(first);
    return result;
  };
  await assert.rejects(readActivityFromWorkspaceContext(context,{bindings}),{
    code:"T3_ACTIVITY_WORKSPACE_CHANGED_DURING_READ",
  });
  assert.equal(current,first,"the final ID alone would not detect this switch");
  assert.equal(listeners.size,0);
});

test("signed Activity read refuses a context without the original focus subscription",async()=>{
  const {kernel,counts}=fixture();
  const fake={currentContext:()=>({workspace_id:workspaceId})};
  await assert.rejects(readActivityFromWorkspaceContext({
    kernel,currentWorkspace:{get:()=>({workspace_id:workspaceId})},
  },{bindings,signedAccess:fake}),{
    code:"T3_SIGNED_WORKSPACE_SELECTION_SUBSCRIPTION_REQUIRED",
  });
  assert.equal(Object.values(counts).reduce((a,b)=>a+b,0),0);
});
