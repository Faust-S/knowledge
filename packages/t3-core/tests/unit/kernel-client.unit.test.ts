/**
 * Unit tests for the kernel-client — run against the dev-mock, NOT the
 * real kernel build. The dev-mock exists only to exercise the React
 * shell in isolation; nothing here is a live-kernel contract test.
 *
 * Contract shape validated here matches Domain Kernel v1:
 *   - `contract_version`, `runtime_version` at top level (no nested runtime)
 *   - `granted_levels` (not `levels`)
 *   - `granted_operations` gates every UI action string-for-string
 *   - `t0` / `t1` / `t2` are plain method-bag objects (NOT callable)
 */
import { describe, expect, it } from "vitest";
import { createDevMockBootstrap, createDevMockClient } from "../../src/kernel-client/dev-mock";
import { connectKernel } from "../../src/kernel-client/connect";
import { capabilities } from "../../src/kernel-client/capabilities";
import { adapter } from "../../src/kernel-client/adapter";
import {
  CONTRACT_VERSION,
  SUPPORTED_CONTRACT_VERSION,
} from "../../src/kernel-client";

describe("dev-mock respects the frozen contract shape", () => {
  it("returns an IWXAClient with the current top-level fields and non-callable tier objects", () => {
    const client = createDevMockClient({ mode: "full" });
    expect(client.contract_version).toBe(SUPPORTED_CONTRACT_VERSION);
    expect(typeof client.runtime_version).toBe("string");
    expect(client.runtime_version.length).toBeGreaterThan(0);
    expect(client.granted_levels).toEqual(["T0", "T1", "T2"]);
    expect(Array.isArray(client.granted_operations)).toBe(true);
    // Tier surfaces are plain objects, never functions.
    expect(typeof client.t0).toBe("object");
    expect(typeof client.t1).toBe("object");
    expect(typeof client.t2).toBe("object");
    expect(typeof (client.t1 as { listWorkspaces: unknown }).listWorkspaces).toBe("function");
  });
});

describe("connect handshake validation", () => {
  it("emits config-invalid when serviceId is empty", async () => {
    const state = await connectKernel({ serviceId: "" });
    expect(state.status).toBe("config-invalid");
  });

  it("rejects the obsolete Runtime 1.2.0, even when the mock has a matching surface", async () => {
    const client = createDevMockClient({ contractVersion: "1.2.0" });
    const state = await connectKernel({ serviceId: "iwxa.dev.mock", bootstrap: {version: 1, connect: async () => client} });
    expect(state.status).toBe("update-required");
  });

  it("never advertises an unimplemented atomic graph operation in the development mock", () => {
    const client = createDevMockClient();
    expect(client.granted_operations).not.toContain("t1.commitObjectGraph");
  });

  it("emits update-required on contract_version mismatch (runtime_version is diagnostic only)", async () => {
    const bogus = {
      version: 1,
      connect: async () => ({
        ...createDevMockClient(),
        contract_version: "9.9.9",
      }),
    };
    const state = await connectKernel({
      serviceId: "iwxa.dev.mock",
      bootstrap: bogus,
    });
    expect(state.status).toBe("update-required");
  });

  it("does NOT reject just because runtime_version differs from any pinned value", async () => {
    const bootstrap = createDevMockBootstrap({ runtimeVersion: "kernel-2026.11.15" });
    const state = await connectKernel({
      serviceId: "iwxa.dev.mock",
      bootstrap,
    });
    expect(state.status).toBe("ready");
  });

  it("emits update-required when the kernel reports mode=update-required", async () => {
    const bootstrap = createDevMockBootstrap({ mode: "update-required" });
    const state = await connectKernel({
      serviceId: "iwxa.dev.mock",
      bootstrap,
    });
    expect(state.status).toBe("update-required");
  });

  it("refuses to connect when a required level is missing from granted_levels", async () => {
    const bootstrap = createDevMockBootstrap({ grantedLevels: ["T0"] });
    const state = await connectKernel({
      serviceId: "iwxa.dev.mock",
      requiredLevels: ["T1"],
      bootstrap,
    });
    expect(state.status).toBe("kernel-unavailable");
  });

  it("returns 'ready' on successful full-mode handshake", async () => {
    const bootstrap = createDevMockBootstrap({ mode: "full" });
    const state = await connectKernel({
      serviceId: "iwxa.dev.mock",
      bootstrap,
    });
    expect(state.status).toBe("ready");
  });
});

describe("capabilities derive availability from granted_levels + granted_operations", () => {
  it("full mode with default ops grants writes, import, export AND recovery in Baseline 1.2", () => {
    const c = capabilities(createDevMockClient({ mode: "full" }));
    expect(c).toMatchObject({
      hasT1: true, hasT2: true,
      canWrite: true, canCreateWorkspace: true, canWriteObject: true,
      canImport: true, canImportPackage: true,
      canExport: true,
      recoveryContract: "available",
      canRestore: true, canPurge: true,
    });
  });

  it("read-only mode never allows writes, import, restore or purge", () => {
    const c = capabilities(createDevMockClient({ mode: "read-only" }));
    expect(c.canWrite).toBe(false);
    expect(c.canWriteObject).toBe(false);
    expect(c.canCreateWorkspace).toBe(false);
    expect(c.canExport).toBe(false);
    expect(c.canImport).toBe(false);
    expect(c.canImportPackage).toBe(false);
    expect(c.canRestore).toBe(false);
    expect(c.canPurge).toBe(false);
  });

  it("limited mode is NOT automatically writable, even though T1/T2 may be granted", () => {
    const c = capabilities(createDevMockClient({ mode: "limited" }));
    expect(c.canWrite).toBe(false);
    expect(c.canWriteObject).toBe(false);
    expect(c.canCreateWorkspace).toBe(false);
    expect(c.canImport).toBe(false);
    expect(c.canImportPackage).toBe(false);
    expect(c.canRestore).toBe(false);
    expect(c.canPurge).toBe(false);
    expect(c.canRead).toBe(true);
  });

  it("emergency-export exposes exportPackage only when granted_operations explicitly lists it", () => {
    const withExport = capabilities(createDevMockClient({ mode: "emergency-export" }));
    expect(withExport.canExport).toBe(true);
    const withoutExport = capabilities(
      createDevMockClient({
        mode: "emergency-export",
        grantedOperations: ["t1.listWorkspaces"],
      }),
    );
    expect(withoutExport.canExport).toBe(false);
  });
});

describe("adapter is a passthrough with no invented methods", () => {
  it("full round-trip: create workspace, put + read object, export + import preview", async () => {
    const session = createDevMockClient({ mode: "full" });

    const ws = await adapter.createWorkspace(session, {
      workspace_id: "unit-ws",
      profile: "demo",
    });
    expect(ws.workspace_id).toBe("unit-ws");

    await adapter.putObject(session, {
      workspace_id: "unit-ws",
      object_id: "n1",
      schema_id: "iwxa.demo.note",
      schema_version: "1.0.0",
      data: { title: "hi" },
      base_revision: 0,
      event: { event_type: "note.created", payload: { object_id: "n1" } },
    });
    const list = await adapter.listObjects(session, { workspace_id: "unit-ws" });
    expect(list).toHaveLength(1);
    expect(list[0].object_id).toBe("n1");
    // Identity is (workspace_id, object_id) — verify the record carries both
    // and NOT a legacy `id` alias.
    expect(list[0].workspace_id).toBe("unit-ws");
    expect((list[0] as unknown as { id?: string }).id).toBeUndefined();

    const single = await adapter.getObject(session, "unit-ws", "n1");
    expect(single?.object.data).toEqual({ title: "hi" });

    const pkg = await adapter.exportPackage(session, { workspaces: ["unit-ws"] });
    expect(pkg.bytes.byteLength).toBeGreaterThan(0);
    expect(pkg.package_digest).toBeTruthy();
    expect(pkg.semantic_digest).toBeTruthy();
    expect(pkg.size).toBe(pkg.bytes.byteLength);

    const preview = await adapter.importPreview(session, pkg.bytes);
    expect(preview.preview_token).toBeTruthy();
    expect(preview.package_digest).toBe(pkg.package_digest);
    expect(preview.preview.workspaces).toHaveLength(1);
    expect(preview.allowed_modes).toContain("selective");
  });


  it("blocks write on read-only session", () => {
    const session = createDevMockClient({ mode: "read-only" });
    expect(() =>
      adapter.putObject(session, {
        workspace_id: "demo",
        object_id: "x",
        schema_id: "iwxa.demo.note",
        schema_version: "1.0.0",
        data: {},
        base_revision: 0,
        event: { event_type: "note.created", payload: { object_id: "x" } },
      }),
    ).toThrow(/t1\.putObject/);
  });

  // Canonical identity contract: (workspace_id, object_id). Two objects
  // that share an object_id across two workspaces must coexist and never
  // be conflated by the shell OR the store key.
  it("workspace-a/object-1 and workspace-b/object-1 coexist and stay isolated", async () => {
    const session = createDevMockClient({ mode: "full" });

    await adapter.createWorkspace(session, { workspace_id: "workspace-a", profile: "demo" });
    await adapter.createWorkspace(session, { workspace_id: "workspace-b", profile: "demo" });

    const putIn = async (ws: string, title: string) => {
      await adapter.putObject(session, {
        workspace_id: ws,
        object_id: "object-1",
        schema_id: "iwxa.demo.note",
        schema_version: "1.0.0",
        data: { title },
        base_revision: 0,
        event: { event_type: "note.created", payload: { object_id: "object-1" } },
      });
    };
    await putIn("workspace-a", "hello from A");
    await putIn("workspace-b", "hello from B");

    // Independent reads: each workspace returns exactly one record with the
    // shared object_id but its OWN data.
    const listA = await adapter.listObjects(session, { workspace_id: "workspace-a" });
    const listB = await adapter.listObjects(session, { workspace_id: "workspace-b" });
    expect(listA).toHaveLength(1);
    expect(listB).toHaveLength(1);
    expect(listA[0].object_id).toBe("object-1");
    expect(listB[0].object_id).toBe("object-1");
    expect((listA[0].data as { title: string }).title).toBe("hello from A");
    expect((listB[0].data as { title: string }).title).toBe("hello from B");

    // getObject requires BOTH ids and returns the correct scoped record.
    const a = await adapter.getObject(session, "workspace-a", "object-1");
    const b = await adapter.getObject(session, "workspace-b", "object-1");
    expect(a?.object.workspace_id).toBe("workspace-a");
    expect(b?.object.workspace_id).toBe("workspace-b");
    expect(a?.object.data).not.toEqual(b?.object.data);

    // A shell-safe React key composed as `${workspace_id}:${object_id}` is
    // unique across the union of both workspaces.
    const keys = new Set([...listA, ...listB].map((o) => `${o.workspace_id}:${o.object_id}`));
    expect(keys.size).toBe(2);

    // Mutating one workspace's copy does not affect the other's revision.
    await adapter.putObject(session, {
      workspace_id: "workspace-a",
      object_id: "object-1",
      schema_id: "iwxa.demo.note",
      schema_version: "1.0.0",
      data: { title: "A v2" },
      base_revision: 1,
      event: { event_type: "note.updated", payload: { object_id: "object-1" } },
    });
    const a2 = await adapter.getObject(session, "workspace-a", "object-1");
    const b2 = await adapter.getObject(session, "workspace-b", "object-1");
    expect(a2?.object.revision).toBe(2);
    expect(b2?.object.revision).toBe(1);
  });
});

describe("frozen contract manifest", () => {
  it("advertises the exact methods the shell uses", async () => {
    const { CONTRACT_MANIFEST } = await import("../../src/kernel-client");
    expect(CONTRACT_MANIFEST.contract_version).toBe("1.3.0");
    expect(CONTRACT_MANIFEST.runtime_compatibility).toMatch(/0\.3\.6/);
    expect(CONTRACT_MANIFEST.files.length).toBeGreaterThan(0);
    expect(CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(SUPPORTED_CONTRACT_VERSION).toBe("1.3.0");
  });
});

// ---------------------------------------------------------------------------
// Two-phase, token-based import flow
// ---------------------------------------------------------------------------
describe("importPreview → selection → importCommit → repeat commit rejected", () => {
  it("consumes the preview_token exactly once and blocks the second commit", async () => {
    const source = createDevMockClient({ mode: "full" });
    await adapter.createWorkspace(source, { workspace_id: "src-ws", profile: "demo" });
    await adapter.putObject(source, {
      workspace_id: "src-ws",
      object_id: "obj-1",
      schema_id: "iwxa.demo.note",
      schema_version: "1.0.0",
      data: { title: "packed" },
      base_revision: 0,
      event: { event_type: "note.created", payload: { object_id: "obj-1" } },
    });
    const pkg = await adapter.exportPackage(source, {
      workspaces: ["src-ws"],
      include_history: true,
      include_assets: true,
      include_relations: true,
      include_schemas: true,
    });

    // Fresh target session — imports into an empty store.
    const target = createDevMockClient({ mode: "full" });
    const secure = await adapter.importPreview(target, pkg.bytes);
    expect(secure.preview_token).toBeTruthy();
    expect(secure.expires_at).toMatch(/T.*Z$/);
    expect(secure.allowed_modes.length).toBeGreaterThan(0);

    const receipt = await adapter.importCommit(target, {
      preview_token: secure.preview_token,
      package_digest: secure.package_digest,
      plan: {
        mode: "selective",
        include_workspaces: ["src-ws"],
        include_history: true,
        include_assets: true,
        include_relations: true,
      },
    });
    expect(receipt.import_id).toBeTruthy();
    expect(receipt.package_digest).toBe(secure.package_digest);
    expect(receipt.mode).toBe("selective");
    expect(receipt.applied.objects_inserted).toBe(1);

    // Kernel side of rule #8: second commit with the same token must be rejected.
    await expect(
      adapter.importCommit(target, {
        preview_token: secure.preview_token,
        package_digest: secure.package_digest,
        plan: { mode: "selective", include_workspaces: ["src-ws"] },
      }),
    ).rejects.toMatchObject({ code: "preview_token_invalid" });
  });

  it("importPreview throws PackageCorruptedError on unreadable bytes (no `corrupted` field)", async () => {
    const { PackageCorruptedError } = await import(
      "../../src/kernel-client/errors"
    );
    const session = createDevMockClient({ mode: "full" });
    await expect(
      adapter.importPreview(session, new Uint8Array([0xff, 0x00, 0x13, 0x37])),
    ).rejects.toBeInstanceOf(PackageCorruptedError);
  });

  it("importCancel releases the token so a later commit is rejected", async () => {
    const source = createDevMockClient({ mode: "full" });
    await adapter.createWorkspace(source, { workspace_id: "src-ws", profile: "demo" });
    const pkg = await adapter.exportPackage(source, { workspaces: ["src-ws"] });

    const target = createDevMockClient({ mode: "full" });
    const secure = await adapter.importPreview(target, pkg.bytes);
    await adapter.importCancel(target, secure.preview_token);

    await expect(
      adapter.importCommit(target, {
        preview_token: secure.preview_token,
        package_digest: secure.package_digest,
        plan: { mode: "selective", include_workspaces: ["src-ws"] },
      }),
    ).rejects.toMatchObject({ code: "preview_token_invalid" });
  });
});
