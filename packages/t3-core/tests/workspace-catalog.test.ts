import { describe, expect, it, vi, beforeEach } from "vitest";
import { createDevMockClient } from "../src/kernel-client/dev-mock";
import { capabilities as computeCapabilities } from "../src/kernel-client/capabilities";
import { adapter } from "../src/kernel-client/adapter";
import { createKernelFacade } from "../src/workspace-host/context/create-kernel-facade";
import { loadWorkspaceCatalog } from "../src/modules/base/features/workspaces/catalog-loader";
import type { WorkspaceRecord } from "../src/kernel-client";

function seed(): WorkspaceRecord[] {
  return [
    {
      workspace_id: "alpha",
      profile: "generic",
      capabilities: [],
      read_only: false,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-05T00:00:00Z",
    },
    {
      workspace_id: "bravo",
      profile: "learning",
      capabilities: [],
      read_only: true,
      created_at: "2026-01-02T00:00:00Z",
      updated_at: "2026-01-10T00:00:00Z",
    },
    {
      workspace_id: "charlie",
      profile: "generic",
      capabilities: [],
      read_only: false,
      created_at: "2026-01-03T00:00:00Z",
      updated_at: "2026-01-04T00:00:00Z",
      deleted_at: "2026-01-06T00:00:00Z",
    },
  ];
}

describe("loadWorkspaceCatalog (Baseline 1.2)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("throws when listWorkspaces capability is missing", async () => {
    const session = createDevMockClient({ seedWorkspaces: seed(), grantedOperations: [] });
    const caps = computeCapabilities(session);
    await expect(loadWorkspaceCatalog(createKernelFacade({ session }))).rejects.toThrow(/listWorkspaces/);
  });

  it("excludes deleted workspaces, keeps read-only and cross-profile, sorted by updated_at desc", async () => {
    const session = createDevMockClient({ seedWorkspaces: seed() });
    const caps = computeCapabilities(session);
    const items = await loadWorkspaceCatalog(createKernelFacade({ session }));
    expect(items.map((i) => i.workspace.workspace_id)).toEqual(["bravo", "alpha"]);
    // Catalog items expose ONLY WorkspaceRecord — no synthetic wrappers.
    expect(items.every((i) => Object.keys(i).length === 1 && "workspace" in i)).toBe(true);
  });

  it("does not call getWorkspace / listEventsSince / listObjects (N+1 forbidden)", async () => {
    const session = createDevMockClient({ seedWorkspaces: seed() });
    const caps = computeCapabilities(session);
    const gw = vi.spyOn(adapter, "getWorkspace");
    const le = vi.spyOn(adapter, "listEventsSince");
    const lo = vi.spyOn(adapter, "listObjects");
    await loadWorkspaceCatalog(createKernelFacade({ session }));
    expect(gw).not.toHaveBeenCalled();
    expect(le).not.toHaveBeenCalled();
    expect(lo).not.toHaveBeenCalled();
  });

  it("propagates listWorkspaces failure as catalog error", async () => {
    const session = createDevMockClient({ seedWorkspaces: seed() });
    const caps = computeCapabilities(session);
    vi.spyOn(adapter, "listWorkspaces").mockRejectedValueOnce(new Error("list-fail"));
    await expect(loadWorkspaceCatalog(createKernelFacade({ session }))).rejects.toThrow(/list-fail/);
  });
});

describe("workspace catalog creation contract", () => {
  it("createWorkspace passes only workspace_id and profile, returns WorkspaceRecord", async () => {
    const session = createDevMockClient({ seedWorkspaces: [] });
    const caps = computeCapabilities(session);
    const spy = vi.spyOn(adapter, "createWorkspace");
    const { generateWorkspaceId } = await import("../src/modules/base/features/workspaces/workspace-id");
    const id = generateWorkspaceId();
    expect(caps.canCreateWorkspace).toBe(true);
    const created = await adapter.createWorkspace(session, { workspace_id: id, profile: "learning" });
    expect(spy).toHaveBeenCalledWith(session, { workspace_id: id, profile: "learning" });
    // Baseline 1.2 — return type is a bare WorkspaceRecord (no counts / no summary wrapper).
    expect(created.workspace_id).toBe(id);
    expect(created.profile).toBe("learning");
    expect("counts" in created).toBe(false);
    expect("last_event_at" in created).toBe(false);
    const items = await loadWorkspaceCatalog(createKernelFacade({ session }));
    expect(items.map((i) => i.workspace.workspace_id)).toContain(id);
    expect(items.find((i) => i.workspace.workspace_id === id)!.workspace.profile).toBe("learning");
  });

  it("createWorkspace is denied when capability is missing", async () => {
    const session = createDevMockClient({
      seedWorkspaces: [],
      grantedOperations: ["t1.listWorkspaces", "t1.getWorkspace"],
    });
    const caps = computeCapabilities(session);
    expect(caps.canCreateWorkspace).toBe(false);
    expect(() =>
      adapter.createWorkspace(session, { workspace_id: "ws-x", profile: "learning" }),
    ).toThrow(/t1\.createWorkspace/);
  });
});
