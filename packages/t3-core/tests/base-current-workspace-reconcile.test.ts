/**
 * PROMPT 29 §13 — the base-owned `workspace.catalog.refresh` command
 * reconciles Host currentWorkspace after a mutation. When the focused
 * workspace disappears (soft-deleted or purged) the base module — the
 * sole legal owner per PROMPT 28 §9 — must release the focus.
 */
import { describe, it, expect, vi } from "vitest";
import {
  buildBaseCommandContributions,
  CATALOG_REFRESH_COMMAND_ID,
} from "@/modules/base/commands";
import type {
  CurrentWorkspaceFacade,
  KernelFacade,
  WorkspaceModuleContext,
} from "@/workspace-contract";
import { makeWorkspace } from "./lifecycle/_helpers";
import { catalogRefreshService } from "@/modules/base/services/catalog-refresh-service";

interface StubKernel {
  kernel: KernelFacade;
  getWorkspaceMock: ReturnType<typeof vi.fn>;
}

function makeKernel(
  hasOp: boolean,
  getResult: unknown | Error,
): StubKernel {
  const getWorkspaceMock = vi.fn(async () => {
    if (getResult instanceof Error) throw getResult;
    return getResult;
  });
  const kernel = {
    hasOperation: (op: string) => hasOp && op === "t1.getWorkspace",
    getWorkspace: getWorkspaceMock,
  } as unknown as KernelFacade;
  return { kernel, getWorkspaceMock };
}

function makeCurrentWorkspace(
  focused: ReturnType<typeof makeWorkspace> | null,
): { facade: CurrentWorkspaceFacade; release: ReturnType<typeof vi.fn> } {
  const release = vi.fn();
  const facade: CurrentWorkspaceFacade = {
    get: () => focused,
    subscribe: () => () => {},
    claim: () => {},
    release,
  };
  return { facade, release };
}

async function runHandler(ctx: WorkspaceModuleContext, reason: string) {
  const [contribution] = buildBaseCommandContributions();
  const handler = await contribution.loader();
  return handler.run(ctx, { reason });
}

describe("workspace.catalog.refresh reconciles currentWorkspace (PROMPT 29 §13)", () => {
  it("releases focus when the focused workspace is gone from the kernel", async () => {
    catalogRefreshService.activate();
    const { kernel } = makeKernel(true, null);
    const { facade, release } = makeCurrentWorkspace(makeWorkspace("ws-42"));
    const ctx = { kernel, currentWorkspace: facade } as unknown as WorkspaceModuleContext;
    const receipt = (await runHandler(ctx, "lifecycle.purge")) as {
      releasedCurrentWorkspaceId?: string;
    };
    expect(release).toHaveBeenCalledTimes(1);
    expect(receipt.releasedCurrentWorkspaceId).toBe("ws-42");
  });

  it("releases focus when the focused workspace is soft-deleted", async () => {
    const { kernel } = makeKernel(true, makeWorkspace("ws-7", { deletedAt: "2026-07-25T00:00:00Z" }));
    const { facade, release } = makeCurrentWorkspace(makeWorkspace("ws-7"));
    const ctx = { kernel, currentWorkspace: facade } as unknown as WorkspaceModuleContext;
    await runHandler(ctx, "lifecycle.soft-delete");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("keeps focus when the focused workspace still exists", async () => {
    const { kernel } = makeKernel(true, makeWorkspace("ws-1"));
    const { facade, release } = makeCurrentWorkspace(makeWorkspace("ws-1"));
    const ctx = { kernel, currentWorkspace: facade } as unknown as WorkspaceModuleContext;
    const receipt = (await runHandler(ctx, "exchange.import")) as {
      releasedCurrentWorkspaceId?: string;
    };
    expect(release).not.toHaveBeenCalled();
    expect(receipt.releasedCurrentWorkspaceId).toBeUndefined();
  });

  it("degrades to a pure notify when getWorkspace is not granted", async () => {
    const { kernel, getWorkspaceMock } = makeKernel(false, null);
    const { facade, release } = makeCurrentWorkspace(makeWorkspace("ws-1"));
    const ctx = { kernel, currentWorkspace: facade } as unknown as WorkspaceModuleContext;
    await runHandler(ctx, "unknown");
    expect(getWorkspaceMock).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it("never throws when the kernel getWorkspace lookup fails", async () => {
    const { kernel } = makeKernel(true, new Error("adapter-boom"));
    const { facade, release } = makeCurrentWorkspace(makeWorkspace("ws-9"));
    const ctx = { kernel, currentWorkspace: facade } as unknown as WorkspaceModuleContext;
    await expect(runHandler(ctx, "lifecycle.purge")).resolves.toMatchObject({
      notified: true,
    });
    expect(release).not.toHaveBeenCalled();
  });

  it("is registered under the exact base-owned command id", () => {
    const [c] = buildBaseCommandContributions();
    expect(c.id).toBe(CATALOG_REFRESH_COMMAND_ID);
    expect(c.moduleId).toBe("iwxa.workspace.base");
    expect(c.requiredOperations).toEqual([]);
  });
});
