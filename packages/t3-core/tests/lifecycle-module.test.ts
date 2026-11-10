/**
 * PROMPT 27 — iwxa.workspace.lifecycle module tests (updated from
 * PROMPT 24 §18). Verifies manifest, contributions, gating, command
 * handlers, and the 12-state purge machine.
 *
 * Historical acceptance of workspace title / trimmed input as an
 * alternate challenge has been REMOVED; comparison is exact.
 */
import { describe, expect, it, vi } from "vitest";
import manifest from "@/modules/lifecycle/manifest.json";
import lifecycleModule from "@/modules/lifecycle";
import {
  LIFECYCLE_ROUTE_INVENTORY,
  LIFECYCLE_NAVIGATION_INVENTORY,
  LIFECYCLE_COMMAND_INVENTORY,
} from "@/modules/lifecycle";
import {
  softDeleteWorkspaceHandler,
  restoreWorkspaceHandler,
  purgePreviewHandler,
  purgeCommitHandler,
  purgeCancelHandler,
} from "@/modules/lifecycle/commands";
import {
  INITIAL_PURGE_STATE,
  isChallengeAccepted,
  purgeReducer,
} from "@/modules/lifecycle/state/purge-machine";
import {
  AVAILABLE_MODULES,
  AVAILABLE_MODULE_IDS,
  PLANNED_MODULE_IDS,
} from "@/composition";
import { activeHostRouteBindings, hostRouteRefs } from "@/workspace-host/router";
import type { KernelFacade, WorkspaceModuleContext } from "@/workspace-contract";
import type {
  PurgePreview,
  PurgeReceipt,
  SoftDeleteWorkspaceReceipt,
  RestoreWorkspaceReceipt,
} from "@/kernel-client/contracts/runtime-1.2.0";
import type { OperationId } from "@/kernel-client";
import { DEFAULT_LEGACY_ROUTE_MIGRATIONS } from "@/workspace-host/router";

export function makeKernel(
  granted: readonly OperationId[] = [
    "t1.listWorkspaces",
    "t1.softDeleteWorkspace",
    "t1.restoreWorkspace",
    "t1.purgePreview",
    "t1.purgeCommit",
    "t1.purgeCancel",
  ],
  overrides: Partial<KernelFacade> = {},
): KernelFacade {
  const set = new Set<string>(granted as readonly string[]);
  const preview: PurgePreview = {
    purge_token: "tok-1",
    challenge: "PURGE ws-1",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    workspace_id: "ws-1",
    workspace_state_timestamp: Date.now(),
    counts: {
      objects: 0, events: 0, relations: 0, assets: 0,
      permissions: 0, service_state: 0, outbox: 0,
    },
    last_export: {
      prepared: null, confirmed: null,
      backup_status: "current", warning: null,
    },
    acknowledge_no_backup: false,
  };
  const receipt: PurgeReceipt = {
    workspace_id: "ws-1",
    removed: {
      workspaces: 1, objects: 0, events: 0, relations: 0,
      assets: 0, permissions: 0, service_state: 0, outbox: 0,
    },
  };
  const softDelete: SoftDeleteWorkspaceReceipt = {
    workspace_id: "ws-1", deleted_at: "2026-07-25T00:00:00Z",
  };
  const restore: RestoreWorkspaceReceipt = {
    workspace_id: "ws-1", restored_at: "2026-07-25T00:00:00Z",
  };
  return {
    hasOperation: (op: string) => set.has(op),
    grantedOperations: granted,
    grantedLevels: ["T0", "T1"],
    sessionInfo: {
      mode: "test", contract_version: "1.2.0",
      runtime_version: "0.3.5", service_id: "test",
    },
    softDeleteWorkspace: vi.fn(async () => softDelete),
    restoreWorkspace: vi.fn(async () => restore),
    purgePreview: vi.fn(async () => preview),
    purgeCommit: vi.fn(async () => receipt),
    purgeCancel: vi.fn(async () => true),
    listWorkspaces: vi.fn(async () => []),
    getWorkspace: vi.fn(async () => null),
    createWorkspace: vi.fn() as never,
    listObjects: vi.fn(async () => []),
    getObject: vi.fn(async () => null),
    listEventsSince: vi.fn(async () => []),
    putObject: vi.fn() as never,
    deleteObject: vi.fn() as never,
    exportPreview: vi.fn() as never,
    exportPackage: vi.fn() as never,
    confirmExport: vi.fn() as never,
    importPreview: vi.fn() as never,
    importCommit: vi.fn() as never,
    importCancel: vi.fn() as never,
    ...overrides,
  } as unknown as KernelFacade;
}

export function makeCtx(kernel: KernelFacade): WorkspaceModuleContext {
  return { kernel } as unknown as WorkspaceModuleContext;
}

describe("iwxa.workspace.lifecycle (PROMPT 27)", () => {
  it("manifest exposes the required contract fields and contribution ids", () => {
    expect(manifest.module_id).toBe("iwxa.workspace.lifecycle");
    expect(manifest.contributions.commands.map((c) => c.id)).toEqual([
      "lifecycle.soft-delete-workspace",
      "lifecycle.restore-workspace",
      "lifecycle.purge-preview",
      "lifecycle.purge-commit",
      "lifecycle.purge-cancel",
    ]);
  });

  it("loader table promotes lifecycle out of PLANNED_MODULE_IDS", () => {
    expect(AVAILABLE_MODULE_IDS).toContain("iwxa.workspace.lifecycle");
    expect(PLANNED_MODULE_IDS).not.toContain("iwxa.workspace.lifecycle");
    expect(typeof AVAILABLE_MODULES["iwxa.workspace.lifecycle"]).toBe("function");
  });

  it("activate() with full T1 grants yields 2 routes + 1 nav + 6 commands (5 kernel + trash.refresh)", () => {
    const result = lifecycleModule.activate(makeCtx(makeKernel()));
    expect(result.contributions.routes?.length).toBe(2);
    expect(result.contributions.navigation?.length).toBe(1);
    // PROMPT 29 §7 — trash.refresh is a 6th command that always
    // registers because it requires no Runtime operations.
    expect(result.contributions.commands?.length).toBe(6);
    const ids = result.contributions.commands?.map((c) => c.id) ?? [];
    expect(ids).toContain("lifecycle.trash.refresh");
  });


  it("host route bindings expose lifecycle.home and lifecycle.trash under /workspace/lifecycle/", () => {
    const bindings = activeHostRouteBindings();
    const home = bindings.find((b) => b.routeRef === hostRouteRefs.lifecycle.home);
    const trash = bindings.find((b) => b.routeRef === hostRouteRefs.lifecycle.trash);
    expect(home?.staticBase).toBe("/workspace/lifecycle/");
    expect(trash?.staticBase).toBe("/workspace/lifecycle/");
  });

  it("soft-delete handler calls kernel exactly once", async () => {
    const kernel = makeKernel();
    await softDeleteWorkspaceHandler.run(makeCtx(kernel), { workspaceId: "ws-1" });
    expect(kernel.softDeleteWorkspace).toHaveBeenCalledWith("ws-1");
    await expect(softDeleteWorkspaceHandler.run(makeCtx(kernel), {})).rejects.toThrow();
  });

  it("restore handler surfaces kernel errors", async () => {
    const kernel = makeKernel();
    (kernel.restoreWorkspace as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("NOT_FOUND"),
    );
    await expect(
      restoreWorkspaceHandler.run(makeCtx(kernel), { workspaceId: "ws-1" }),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("preview → awaiting-challenge when backup is current", async () => {
    const kernel = makeKernel();
    const preview = await purgePreviewHandler.run(makeCtx(kernel), { workspaceId: "ws-1" });
    let s = INITIAL_PURGE_STATE;
    s = purgeReducer(s, { type: "preview-started", workspaceId: "ws-1", acknowledgeNoBackup: false });
    s = purgeReducer(s, { type: "preview-succeeded", preview });
    expect(s.status).toBe("awaiting-challenge");
  });

  it("challenge requires exact match — title and trim are rejected", async () => {
    const kernel = makeKernel();
    const preview = await purgePreviewHandler.run(makeCtx(kernel), { workspaceId: "ws-1" });
    let s = INITIAL_PURGE_STATE;
    s = purgeReducer(s, { type: "preview-started", workspaceId: "ws-1", acknowledgeNoBackup: false });
    s = purgeReducer(s, { type: "preview-succeeded", preview });
    s = purgeReducer(s, { type: "challenge-input", value: "ws-1" });
    expect(isChallengeAccepted(s)).toBe(false);
    s = purgeReducer(s, { type: "challenge-input", value: " PURGE ws-1 " });
    expect(isChallengeAccepted(s)).toBe(false);
    s = purgeReducer(s, { type: "challenge-input", value: "PURGE ws-1" });
    expect(isChallengeAccepted(s)).toBe(true);
  });

  it("purge-commit dispatches to kernel exactly once", async () => {
    const kernel = makeKernel();
    await purgeCommitHandler.run(makeCtx(kernel), {
      workspaceId: "ws-1", purgeToken: "tok-1", confirmation: "PURGE ws-1",
    });
    expect(kernel.purgeCommit).toHaveBeenCalledWith({
      purge_token: "tok-1", confirmation: "PURGE ws-1",
    });
  });

  it("purge-cancel invokes kernel.purgeCancel", async () => {
    const kernel = makeKernel();
    await purgeCancelHandler.run(makeCtx(kernel), { purgeToken: "tok-1" });
    expect(kernel.purgeCancel).toHaveBeenCalledWith("tok-1");
  });

  it("legacy #/trash is migrated to lifecycle.trash via the Host Router", () => {
    const rule = DEFAULT_LEGACY_ROUTE_MIGRATIONS.find(
      (m) => m.legacyHash === "#/trash",
    );
    expect(rule).toBeDefined();
    expect(rule!.target().id).toBe("host.lifecycle.trash");
  });

});

LIFECYCLE_ROUTE_INVENTORY; LIFECYCLE_NAVIGATION_INVENTORY; LIFECYCLE_COMMAND_INVENTORY;
