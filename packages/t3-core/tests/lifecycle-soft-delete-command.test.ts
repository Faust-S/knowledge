import { describe, it, expect } from "vitest";
import { softDeleteWorkspaceHandler } from "@/modules/lifecycle/commands";
import type { WorkspaceModuleContext } from "@/workspace-contract";
import { makeKernel, makeSoftDeleteReceipt } from "./lifecycle/_helpers";
import { catalogRefreshService } from "@/modules/base/services/catalog-refresh-service";
import { trashRefreshService } from "@/modules/lifecycle/services/trash-refresh-service";

function makeCtx(kernel: unknown): WorkspaceModuleContext {
  return {
    kernel,
    commands: {
      has: (id: string) =>
        id === "workspace.catalog.refresh" || id === "lifecycle.trash.refresh",
      invoke: async (id: string, args?: unknown) => {
        const r = (args as { reason?: string })?.reason ?? "unspecified";
        if (id === "workspace.catalog.refresh") catalogRefreshService.notify(r);
        if (id === "lifecycle.trash.refresh") trashRefreshService.notify(r);
        return undefined;
      },
    },
  } as unknown as WorkspaceModuleContext;
}

describe("lifecycle.soft-delete handler fans out through commands (PROMPT 29 §5, §9)", () => {
  it("passes exact workspaceId, returns receipt, invokes both refresh commands", async () => {
    catalogRefreshService.activate();
    trashRefreshService.activate();
    const kernel = makeKernel({
      softDeleteImpl: async (id) => makeSoftDeleteReceipt(id),
    });
    let catalog = 0, lifecycle = 0;
    catalogRefreshService.subscribe(() => { catalog++; });
    trashRefreshService.subscribe(() => { lifecycle++; });
    const receipt = await softDeleteWorkspaceHandler.run(
      makeCtx(kernel),
      { workspaceId: "ws-42" },
    );
    expect(receipt.workspace_id).toBe("ws-42");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((kernel as any).softDeleteWorkspace).toHaveBeenCalledWith("ws-42");
    expect(catalog).toBe(1);
    expect(lifecycle).toBe(1);
  });

  it("rejects invalid receipt identity and does not fan out", async () => {
    catalogRefreshService.activate();
    trashRefreshService.activate();
    const kernel = makeKernel({
      softDeleteImpl: async () => ({ workspace_id: "other" }) as never,
    });
    let n = 0;
    trashRefreshService.subscribe(() => { n++; });
    await expect(softDeleteWorkspaceHandler.run(
      makeCtx(kernel),
      { workspaceId: "ws-1" },
    )).rejects.toThrow("LIFECYCLE_RECEIPT_IDENTITY_MISMATCH");
    expect(n).toBe(0);
  });
});
