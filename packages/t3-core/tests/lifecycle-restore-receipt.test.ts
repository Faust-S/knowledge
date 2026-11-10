import { describe, it, expect } from "vitest";
import { restoreWorkspaceHandler } from "@/modules/lifecycle/commands";
import type { WorkspaceModuleContext } from "@/workspace-contract";
import { makeKernel, makeRestoreReceipt } from "./lifecycle/_helpers";
import { catalogRefreshService } from "@/modules/base/services/catalog-refresh-service";
import { trashRefreshService } from "@/modules/lifecycle/services/trash-refresh-service";

function makeCtxWithCommands(kernel: unknown): WorkspaceModuleContext {
  return {
    kernel,
    commands: {
      has: (id: string) =>
        id === "workspace.catalog.refresh" || id === "lifecycle.trash.refresh",
      invoke: async (id: string, args?: unknown) => {
        if (id === "workspace.catalog.refresh") {
          const r = (args as { reason?: string })?.reason ?? "unspecified";
          catalogRefreshService.notify(r);
        }
        if (id === "lifecycle.trash.refresh") {
          const r = (args as { reason?: string })?.reason ?? "unspecified";
          trashRefreshService.notify(r);
        }
        return undefined;
      },
    },
  } as unknown as WorkspaceModuleContext;
}

describe("lifecycle.restore handler (PROMPT 29 §2, §5, §11)", () => {
  it("verifies receipt shape, returns it verbatim, and fans out via commands", async () => {
    catalogRefreshService.activate();
    trashRefreshService.activate();
    const kernel = makeKernel({
      restoreImpl: async (id) => makeRestoreReceipt(id),
    });
    let cat = 0, life = 0;
    catalogRefreshService.subscribe(() => { cat++; });
    trashRefreshService.subscribe(() => { life++; });
    const r = await restoreWorkspaceHandler.run(
      makeCtxWithCommands(kernel),
      { workspaceId: "ws-9" },
    );
    expect(r.workspace_id).toBe("ws-9");
    expect(typeof r.restored_at).toBe("string");
    expect(cat).toBe(1);
    expect(life).toBe(1);
  });
});
