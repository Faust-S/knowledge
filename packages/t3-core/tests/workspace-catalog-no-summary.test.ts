import { describe, expect, it, vi } from "vitest";
import { createDevMockClient } from "../src/kernel-client/dev-mock";
import { capabilities as computeCapabilities } from "../src/kernel-client/capabilities";
import { adapter } from "../src/kernel-client/adapter";
import { createKernelFacade } from "../src/workspace-host/context/create-kernel-facade";
import { loadWorkspaceCatalog } from "../src/modules/base/features/workspaces/catalog-loader";
import type { WorkspaceRecord } from "../src/kernel-client";

/**
 * PROMPT_04 — catalog surface reads WorkspaceRecord ONLY.
 * No summary wrappers, no aggregate counts, no N+1 kernel calls.
 */
describe("catalog surface — no WorkspaceSummary, no N+1", () => {
  const seed: WorkspaceRecord[] = [
    { workspace_id: "a", profile: "generic", capabilities: [], read_only: false,
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" },
    { workspace_id: "b", profile: "generic", capabilities: [], read_only: false,
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-03T00:00:00Z" },
  ];

  it("catalog item exposes ONLY workspace (no summary / summaryState / counts)", async () => {
    const session = createDevMockClient({ seedWorkspaces: seed });
    const caps = computeCapabilities(session);
    const items = await loadWorkspaceCatalog(createKernelFacade({ session }));
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(["workspace"]);
      const rec = item.workspace as unknown as Record<string, unknown>;
      expect("counts" in rec).toBe(false);
      expect("last_event_at" in rec).toBe(false);
    }
  });

  it("loading the catalog does not call getWorkspace / listObjects / listEventsSince", async () => {
    const session = createDevMockClient({ seedWorkspaces: seed });
    const caps = computeCapabilities(session);
    const gw = vi.spyOn(adapter, "getWorkspace");
    const lo = vi.spyOn(adapter, "listObjects");
    const le = vi.spyOn(adapter, "listEventsSince");
    await loadWorkspaceCatalog(createKernelFacade({ session }));
    expect(gw).not.toHaveBeenCalled();
    expect(lo).not.toHaveBeenCalled();
    expect(le).not.toHaveBeenCalled();
  });
});
