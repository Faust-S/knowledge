import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { LocalStore, DB_NAME, DB_VERSION, STORES } from "../src/local-store";

function openV3(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      const tx = req.transaction!;
      // Minimal v1..v3 shape covering only what this test seeds/reads.
      db.createObjectStore(STORES.meta, { keyPath: "key" });
      const ws = db.createObjectStore(STORES.workspaces, {
        keyPath: "workspace_id",
      });
      ws.createIndex("by_profile", "profile", { unique: false });
      db.createObjectStore(STORES.permissions, { keyPath: "permission_id" });
      db.createObjectStore(STORES.service_state, {
        keyPath: ["workspace_id", "service_id"],
      });
      const assets = db.createObjectStore(STORES.assets, { keyPath: "asset_id" });
      assets.createIndex("by_workspace", "workspace_id", { unique: false });
      assets.createIndex("by_service", ["workspace_id", "service_id"], {
        unique: false,
      });
      db.createObjectStore(STORES.outbox, { keyPath: "outbox_id" });
      db.createObjectStore(STORES.migrations, { keyPath: "id" });

      const objs = db.createObjectStore(STORES.objects, {
        keyPath: ["workspace_id", "object_id"],
      });
      objs.createIndex("by_workspace", "workspace_id", { unique: false });
      objs.createIndex("by_schema", ["workspace_id", "schema_id"], {
        unique: false,
      });
      objs.createIndex(
        "by_created_by_service",
        ["workspace_id", "created_by_service"],
        { unique: false },
      );
      objs.createIndex(
        "by_updated_by_service",
        ["workspace_id", "updated_by_service"],
        { unique: false },
      );
      objs.createIndex("by_updated_at", "updated_at", { unique: false });
      objs.createIndex(
        "by_revision",
        ["workspace_id", "object_id", "revision"],
        { unique: true },
      );

      const rel = db.createObjectStore(STORES.relations, { keyPath: "relation_id" });
      rel.createIndex("by_workspace", "workspace_id", { unique: false });
      rel.createIndex("by_from", ["workspace_id", "from_object_id"], {
        unique: false,
      });
      rel.createIndex("by_to", ["workspace_id", "to_object_id"], { unique: false });

      const ev = db.createObjectStore(STORES.events, { keyPath: "event_id" });
      ev.createIndex("by_workspace", "workspace_id", { unique: false });
      ev.createIndex("by_service", ["workspace_id", "service_id"], { unique: false });
      ev.createIndex("by_object", ["workspace_id", "object_id"], { unique: false });
      ev.createIndex("by_correlation", "correlation_id", { unique: false });
      ev.createIndex(
        "by_idempotency",
        ["workspace_id", "service_id", "idempotency_key"],
        { unique: true },
      );

      tx.objectStore(STORES.migrations).put({
        id: 3,
        description: "seeded v3",
        applied_at: new Date().toISOString(),
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx1<T = unknown>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

describe("LocalStore — migration 3 → 4", () => {
  it("adds schemas store + assets.by_object index and preserves prior records", async () => {
    const factory = new IDBFactory();
    const iso = "2026-01-01T00:00:00.000Z";

    // 1. Create a v3 database and seed one of each kind.
    const v3 = await openV3(factory);
    await new Promise<void>((resolve, reject) => {
      const tx = v3.transaction(
        [STORES.workspaces, STORES.objects, STORES.events, STORES.assets],
        "readwrite",
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      tx.objectStore(STORES.workspaces).put({
        workspace_id: "ws-1",
        profile: "default",
        capabilities: ["read"],
        created_at: iso,
        updated_at: iso,
      });
      tx.objectStore(STORES.objects).put({
        workspace_id: "ws-1",
        object_id: "obj-1",
        schema_id: "career.role",
        schema_version: "1.0.0",
        created_by_service: "career",
        updated_by_service: "career",
        created_at: iso,
        updated_at: iso,
        revision: 1,
        data: { title: "Engineer" },
        extensions: {},
      });
      tx.objectStore(STORES.events).put({
        event_id: "evt-1",
        event_type: "object.created",
        workspace_id: "ws-1",
        service_id: "career",
        object_id: "obj-1",
        occurred_at: iso,
        payload: {},
      });
      tx.objectStore(STORES.assets).put({
        asset_id: "asset-1",
        workspace_id: "ws-1",
        service_id: "career",
        mime: "text/plain",
        size: 3,
        blob: new Uint8Array([1, 2, 3]),
        created_at: iso,
      });
    });
    v3.close();

    // 2. Re-open through LocalStore → runs migration to v4.
    const store = await LocalStore.connect({ factory });
    try {
      expect(DB_VERSION).toBe(7);

      const stores = await store.transact(
        [
          STORES.workspaces,
          STORES.objects,
          STORES.events,
          STORES.assets,
          STORES.schemas,
        ],
        "readonly",
        async (tx) => {
          const ws = await tx1(tx.objectStore(STORES.workspaces).get("ws-1"));
          const obj = await tx1(
            tx.objectStore(STORES.objects).get(["ws-1", "obj-1"]),
          );
          const evt = await tx1(tx.objectStore(STORES.events).get("evt-1"));
          const asset = await tx1(tx.objectStore(STORES.assets).get("asset-1"));

          const schemasStore = tx.objectStore(STORES.schemas);
          const assetsStore = tx.objectStore(STORES.assets);

          return {
            ws,
            obj,
            evt,
            asset,
            schemasKeyPath: schemasStore.keyPath,
            schemasIndexes: Array.from(schemasStore.indexNames),
            assetsIndexes: Array.from(assetsStore.indexNames),
          };
        },
      );

      // 1. Old records survive.
      expect(stores.ws).toBeTruthy();
      expect(stores.obj).toBeTruthy();
      expect(stores.evt).toBeTruthy();
      expect(stores.asset).toBeTruthy();

      // 2. Current DB_VERSION == 6; v4 remains the schema-store migration under test while v5/v6 append later stores.
      expect(DB_VERSION).toBe(7);

      // 3. schemas keyPath.
      expect(stores.schemasKeyPath).toEqual(["schema_id", "schema_version"]);

      // 4–7. schemas indexes.
      expect(stores.schemasIndexes).toEqual(
        expect.arrayContaining([
          "by_schema_id",
          "by_source",
          "by_source_service",
          "by_package",
        ]),
      );

      // 8. assets.by_object.
      expect(stores.assetsIndexes).toContain("by_object");

      // 9. Old workspace-level asset (no object_id) remains readable.
      const readable = await store.getAsset("ws-1", "asset-1");
      expect(readable?.asset_id).toBe("asset-1");
      const wsAssets = await store.listAssets({ workspace_id: "ws-1" });
      expect(wsAssets).toHaveLength(1);
      expect(wsAssets[0].object_id).toBeUndefined();
    } finally {
      store.close();
    }
  });
});
