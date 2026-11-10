import "fake-indexeddb/auto";
import FDBFactory from "fake-indexeddb/lib/FDBFactory";
import { describe, expect, it, vi } from "vitest";
import { LocalStore } from "../src/local-store/LocalStore";
import { STORES } from "../src/local-store/types";
import { ScopedWorkspaceApi } from "../src/workspace-api/ScopedWorkspaceApi";
import { buildPassportRegistry } from "./helpers/build-passport-registry";
import { computeGrantedOperations } from "../src/runtime/public-api";
import type { ServicePassport, CommitObjectGraphInput } from "../src/public-contract";
import type { CapabilityRuntimeAuthority } from "../src/capability/authority";
import { CapabilityDeniedError } from "../src/capability/errors";
import { purgeWorkspaceStores } from "../src/workspace-api/lifecycle";

const passport: ServicePassport = {
  service_id: "svc.writer", service_version: "1.0.0", base_path: "/writer/", supported_levels: ["T0", "T1"], input_object_types: ["thing"], output_object_types: ["thing"],
  schemas: { thing: { schema_version: "1.0.0", preserve_unknown: true, json_schema: { type: "object" }, embedded: {} } },
  permissions: { operations: ["t1.commitObjectGraph"], workspace: { list: true, read: true, create: true, soft_delete: true, restore: true, purge: true }, objects: { read: ["thing"], write: ["thing"], delete: ["thing"] }, events: { read_scope: "workspace" }, packages: { export: false, import: false, export_scope: "readable_objects", import_scope: "writable_objects" } },
};
const input = (): CommitObjectGraphInput => ({ workspace_id: "ws", idempotency_key: "graph-1", object: { object_id: "result", schema_id: "thing", schema_version: "1.0.0", data: { a: 1, b: 2 }, base_revision: 0 }, relation_puts: [{ relation_id: "new-rel", from_object_id: "result", to_object_id: "b", kind: "derived" }], relation_deletes: [{ relation_id: "old-rel" }], event: { event_type: "result.graph.committed", payload: { a: 1, b: 2 } } });
async function fresh() {
  const factory = new FDBFactory() as unknown as IDBFactory;
  const store = await LocalStore.connect({ factory });
  const registry = await buildPassportRegistry([passport]);
  const api = ScopedWorkspaceApi.forService(store, passport, "iwxa:test", registry);
  await api.createWorkspace({ workspace_id: "ws", profile: "test" });
  for (const object_id of ["a", "b"]) await api.putObject({ workspace_id: "ws", object_id, schema_id: "thing", schema_version: "1.0.0", data: {}, event: { event_type: "seed" } });
  await api.putRelation({ workspace_id: "ws", relation_id: "old-rel", from_object_id: "a", to_object_id: "b", kind: "old", event: { event_type: "seed" } });
  const snapshot = () => store.transact([STORES.workspaces, STORES.objects, STORES.relations, STORES.events, STORES.graph_commits], "readonly", async tx => {
    const rows = await Promise.all([STORES.workspaces, STORES.objects, STORES.relations, STORES.events, STORES.graph_commits].map(name => new Promise(resolve => { const req = tx.objectStore(name).getAll(); req.onsuccess = () => resolve(req.result); req.onerror = () => { throw req.error; }; })));
    return rows;
  });
  return { store, api, registry, snapshot, factory };
}
describe("Kernel atomic graph successor", () => {
  it("commits object, puts, deletes, one event and receipt together", async () => {
    const { api, store } = await fresh(); const before = await store.listEventsSince("ws", "");
    const receipt = await api.commitObjectGraph(input());
    expect(receipt).toMatchObject({ workspace_id: "ws", deduplicated: false, object: { revision: 1 }, relation_ids_deleted: ["old-rel"] });
    expect(receipt.transaction_id).toBeTruthy(); expect(receipt.object).not.toHaveProperty("base_revision");
    expect(await store.getObject("ws", "result")).toEqual(receipt.object);
    expect(await store.getRelation("ws", "old-rel")).toBeNull();
    expect(await store.getRelation("ws", "new-rel")).toEqual(receipt.relations_put[0]);
    expect((await store.listEventsSince("ws", "")).length).toBe(before.length + 1);
  });
  it.each([
    ["revision conflict", (v: CommitObjectGraphInput) => { v.object.base_revision = 99; }, "CONFLICT"],
    ["missing endpoint", (v: CommitObjectGraphInput) => { v.relation_puts![0].to_object_id = "missing"; }, "OBJECT_NOT_FOUND"],
    ["cross-workspace object envelope", (v: CommitObjectGraphInput) => { Object.assign(v.object, { workspace_id: "other" }); }, "CONFIG_INVALID"],
    ["duplicate puts", (v: CommitObjectGraphInput) => { v.relation_puts!.push(v.relation_puts![0]); }, "CONFLICT"],
    ["put/delete same id", (v: CommitObjectGraphInput) => { v.relation_deletes!.push({ relation_id: "new-rel" }); }, "CONFLICT"],
    ["existing relation id", (v: CommitObjectGraphInput) => { v.relation_puts![0].relation_id = "old-rel"; v.relation_deletes = []; }, "CONFLICT"],
    ["missing delete", (v: CommitObjectGraphInput) => { v.relation_deletes![0].relation_id = "missing"; }, "RELATION_NOT_FOUND"],
    ["missing key", (v: CommitObjectGraphInput) => { v.idempotency_key = ""; }, "CONFIG_INVALID"],
    ["non-json data", (v: CommitObjectGraphInput) => { v.object.data = { date: new Date() }; }, "CONFIG_INVALID"],
  ])("%s leaves zero mutation", async (_name, mutate, code) => {
    const { api, snapshot } = await fresh(); const before = await snapshot(); const v = input(); mutate(v);
    await expect(api.commitObjectGraph(v)).rejects.toMatchObject({ code }); expect(await snapshot()).toEqual(before);
  });
  it.each(["foreign", "deleted"])("rejects %s endpoint without mutation", async kind => {
    const { api, store, snapshot } = await fresh();
    if (kind === "foreign") { await api.createWorkspace({ workspace_id: "other", profile: "test" }); await api.putObject({ workspace_id: "other", object_id: "foreign", schema_id: "thing", schema_version: "1.0.0", data: {}, event: { event_type: "seed" } }); }
    else await api.deleteObject({ workspace_id: "ws", object_id: "b", event: { event_type: "delete" } });
    const before = await snapshot(); const v = input(); if (kind === "foreign") v.relation_puts![0].to_object_id = "foreign";
    await expect(api.commitObjectGraph(v)).rejects.toMatchObject({ code: "OBJECT_NOT_FOUND" }); expect(await snapshot()).toEqual(before); store.close();
  });
  it("old operation permissions never grant composite authority", async () => {
    const { store, registry, snapshot } = await fresh(); const p = structuredClone(passport); delete p.permissions.operations;
    expect(computeGrantedOperations(["T1"], "full", p.permissions)).not.toContain("t1.commitObjectGraph");
    const api = ScopedWorkspaceApi.forService(store, p, "iwxa:test", registry); const before = await snapshot();
    await expect(api.commitObjectGraph(input())).rejects.toMatchObject({ code: "CAPABILITY_DENIED" }); expect(await snapshot()).toEqual(before);
  });
  it("capability denial checks the new operation before mutation", async () => {
    const { store, registry, snapshot } = await fresh();
    const authorizeOperation = vi.fn(async () => { throw new CapabilityDeniedError("denied"); });
    const api = ScopedWorkspaceApi.forService(store, passport, "iwxa:test", registry, { authorizeOperation } as unknown as CapabilityRuntimeAuthority);
    const before = await snapshot(); await expect(api.commitObjectGraph(input())).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
    expect(authorizeOperation).toHaveBeenCalledWith("ws", "t1.commitObjectGraph", "thing"); expect(await snapshot()).toEqual(before);
  });
  it.each([[STORES.objects, "put", true], [STORES.relations, "add", true], [STORES.relations, "delete", true], [STORES.events, "add", true], [STORES.graph_commits, "add", true], [STORES.workspaces, "put", true], [STORES.events, "add", false]] as const)("rolls back injected %s.%s (after staging=%s)", async (name, method, after) => {
    const { store, api, snapshot } = await fresh(); const before = await snapshot(); const original = store.transact.bind(store);
    store.transact = ((stores, mode, fn) => original(stores, mode, tx => {
      const objectStore = tx.objectStore.bind(tx);
      tx.objectStore = ((n: string) => {
        const os = objectStore(n); if (n === name) {
          const write = os[method].bind(os) as (v: unknown) => IDBRequest;
          Object.assign(os, { [method]: (v: unknown) => { if (after) write(v); throw new Error("injected storage failure"); } });
        } return os;
      }) as typeof tx.objectStore; return fn(tx);
    })) as typeof store.transact;
    try { await expect(api.commitObjectGraph(input())).rejects.toBeDefined(); } finally { store.transact = original; }
    expect(await snapshot()).toEqual(before);
  });
  it("replays original receipt across key order, later updates and reopened store", async () => {
    const { store, api, registry, snapshot, factory } = await fresh(); const first = await api.commitObjectGraph(input());
    await api.putObject({ workspace_id: "ws", object_id: "result", schema_id: "thing", schema_version: "1.0.0", data: { later: true }, event: { event_type: "later" } });
    const before = await snapshot(); const v = input(); v.object.data = { b: 2, a: 1 }; v.event.payload = { b: 2, a: 1 };
    const replay = await api.commitObjectGraph(v); expect(replay).toEqual({ ...first, deduplicated: true }); expect(await snapshot()).toEqual(before);
    // Logical replay must never be reconstructed from current object state.
    expect(replay.object.revision).toBe(1); expect((await store.getObject("ws", "result"))?.revision).toBe(2);
    store.close();
    const reopened = await LocalStore.connect({ factory });
    const reopenedApi = ScopedWorkspaceApi.forService(reopened, passport, "iwxa:test", registry);
    expect(await reopenedApi.commitObjectGraph(v)).toEqual({ ...first, deduplicated: true });
    reopened.close();
  });
  it("concurrent identical replays create one event and one identity", async () => {
    const { api, store } = await fresh(); const before = (await store.listEventsSince("ws", "")).length;
    const rows = await Promise.all([api.commitObjectGraph(input()), api.commitObjectGraph(input())]);
    expect(new Set(rows.map(r => r.transaction_id)).size).toBe(1); expect(rows.map(r => r.deduplicated).sort()).toEqual([false, true]); expect((await store.listEventsSince("ws", "")).length).toBe(before + 1);
  });
  it("idempotency payload mismatch fails closed", async () => {
    const { api, snapshot } = await fresh(); await api.commitObjectGraph(input()); const before = await snapshot(); const v = input(); v.object.data = { different: true };
    await expect(api.commitObjectGraph(v)).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "idempotency_payload_mismatch" } }); expect(await snapshot()).toEqual(before);
  });
  it("explicit graph upsert revives own tombstone like putObject", async () => {
    const { api } = await fresh(); await api.deleteObject({ workspace_id: "ws", object_id: "a", event: { event_type: "delete" } }); const v = input(); v.object.object_id = "a"; v.object.base_revision = 2; v.relation_puts![0].from_object_id = "a";
    const result = await api.commitObjectGraph(v); expect(result.object).toMatchObject({ deleted: false, revision: 3 });
  });
  it("purge clears replay state atomically", async () => {
    const { api, store } = await fresh(); await api.commitObjectGraph(input()); await purgeWorkspaceStores(store, "ws");
    const count = await store.transact([STORES.graph_commits], "readonly", tx => new Promise<number>(resolve => { const r = tx.objectStore(STORES.graph_commits).count(); r.onsuccess = () => resolve(r.result); })); expect(count).toBe(0);
  });
});
