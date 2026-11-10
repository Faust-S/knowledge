import { describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { LocalStore } from "../src/local-store/LocalStore";
import { DB_NAME, DB_VERSION, STORES } from "../src/local-store/types";

function deleteDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("delete blocked"));
  });
}

describe("iwxa-local v6 security persistence", () => {
  it("adds security state/targets/decision stores without removing legacy stores", async () => {
    await deleteDb();
    const store = await LocalStore.connect();
    expect(LocalStore.physicalVersion).toBe(7);
    store.close();

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    for (const name of [
      STORES.workspaces,
      STORES.objects,
      STORES.capability_instances,
      STORES.capability_grants,
      STORES.capability_bindings,
      STORES.security_state,
      STORES.security_targets,
      STORES.authorization_decisions,
    ]) expect(db.objectStoreNames.contains(name)).toBe(true);
    const tx = db.transaction([STORES.security_state, STORES.security_targets, STORES.authorization_decisions], "readonly");
    expect(tx.objectStore(STORES.security_state).indexNames.contains("by_snapshot")).toBe(true);
    expect(tx.objectStore(STORES.security_targets).indexNames.contains("by_semantic")).toBe(true);
    expect(tx.objectStore(STORES.authorization_decisions).indexNames.contains("by_workspace_service")).toBe(true);
    db.close();
    await deleteDb();
  });
});
