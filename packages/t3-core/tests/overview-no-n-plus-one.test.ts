import { describe, expect, it, vi } from "vitest";
import { createDevMockClient } from "../src/kernel-client/dev-mock";
import { capabilities as computeCapabilities } from "../src/kernel-client/capabilities";
import { adapter } from "../src/kernel-client/adapter";
import { createKernelFacade } from "../src/workspace-host/context/create-kernel-facade";
import { loadWorkspaceCatalog } from "../src/modules/base/features/workspaces/catalog-loader";
import type { WorkspaceRecord } from "../src/kernel-client";

/**
 * PROMPT_04 — Overview aggregate section must be free of N+1 calls.
 * With 25 workspaces seeded, listWorkspaces is invoked once and no
 * per-workspace kernel call fires from the catalog surface.
 */
describe("overview — no N+1 across many workspaces", () => {
  it("listWorkspaces is called exactly once and no per-workspace kernel op fires", async () => {
    const many: WorkspaceRecord[] = Array.from({ length: 25 }, (_, i) => ({
      workspace_id: `w-${String(i).padStart(2, "0")}`,
      profile: "generic",
      capabilities: [],
      read_only: false,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: `2026-02-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
    }));
    const session = createDevMockClient({ seedWorkspaces: many });
    const caps = computeCapabilities(session);
    const list = vi.spyOn(adapter, "listWorkspaces");
    const gw = vi.spyOn(adapter, "getWorkspace");
    const lo = vi.spyOn(adapter, "listObjects");
    const le = vi.spyOn(adapter, "listEventsSince");
    const items = await loadWorkspaceCatalog(createKernelFacade({ session }));
    expect(items.length).toBe(25);
    expect(list).toHaveBeenCalledTimes(1);
    expect(gw).not.toHaveBeenCalled();
    expect(lo).not.toHaveBeenCalled();
    expect(le).not.toHaveBeenCalled();
  });
});
