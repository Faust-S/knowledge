/**
 * Shared test helpers for PROMPT 27 lifecycle test suite.
 * Includes DOM helper that wraps `LifecycleTrashRoute` in the
 * ModuleRuntimeProvider with a minimal WorkspaceModuleContext stub.
 */
import { render, type RenderResult } from "@testing-library/react";
import { vi } from "vitest";
import LifecycleTrashRoute from "@/modules/lifecycle/routes/LifecycleTrashRoute";
import { trashRefreshService } from "@/modules/lifecycle/services/trash-refresh-service";
import { ModuleRuntimeProvider } from "@/workspace-host/rendering/ModuleRenderContext";
import type { RouteRef, WorkspaceModuleContext } from "@/workspace-contract";
import type { KernelFacade } from "@/workspace-contract";
import type { OperationId } from "@/kernel-client";
import type {
  PurgeBackupStatus,
  PurgePreview,
  PurgeReceipt,
  RestoreWorkspaceReceipt,
  SoftDeleteWorkspaceReceipt,
  WorkspaceRecord,
} from "@/kernel-client/contracts/runtime-1.2.0";
import { hostRouteRefs } from "@/workspace-host/router";

export const ALL_LIFECYCLE_OPS: readonly OperationId[] = [
  "t1.listWorkspaces",
  "t1.softDeleteWorkspace",
  "t1.restoreWorkspace",
  "t1.purgePreview",
  "t1.purgeCommit",
  "t1.purgeCancel",
];

export function makePreview(
  workspaceId = "ws-1",
  opts: {
    backup?: PurgeBackupStatus;
    acknowledged?: boolean;
    expiresInMs?: number;
    challenge?: string;
    token?: string;
  } = {},
): PurgePreview {
  const backup = opts.backup ?? "current";
  return {
    purge_token: opts.token ?? `tok-${workspaceId}`,
    challenge: opts.challenge ?? `PURGE ${workspaceId}`,
    expires_at: new Date(Date.now() + (opts.expiresInMs ?? 60_000)).toISOString(),
    workspace_id: workspaceId,
    workspace_state_timestamp: Date.now(),
    counts: {
      objects: 3, events: 12, relations: 2, assets: 1,
      permissions: 4, service_state: 1, outbox: 0,
    },
    last_export: {
      prepared: null,
      confirmed: backup === "current"
        ? { at: new Date().toISOString(), package_digest: "sha256:x", filename: "b.iwxa" }
        : null,
      backup_status: backup,
      warning: backup === "stale" ? "workspace changed after export" : null,
    },
    acknowledge_no_backup: opts.acknowledged ?? false,
  };
}

export function makeReceipt(workspaceId = "ws-1"): PurgeReceipt {
  return {
    workspace_id: workspaceId,
    removed: {
      workspaces: 1, objects: 3, events: 12, relations: 2,
      assets: 1, permissions: 4, service_state: 1, outbox: 0,
    },
  };
}

export function makeSoftDeleteReceipt(workspaceId = "ws-1"): SoftDeleteWorkspaceReceipt {
  return { workspace_id: workspaceId, deleted_at: new Date().toISOString() };
}

export function makeRestoreReceipt(workspaceId = "ws-1"): RestoreWorkspaceReceipt {
  return { workspace_id: workspaceId, restored_at: new Date().toISOString() };
}

export function makeWorkspace(
  workspaceId: string,
  opts: { deletedAt?: string | null; profile?: string; readOnly?: boolean } = {},
): WorkspaceRecord {
  return {
    workspace_id: workspaceId,
    profile: opts.profile ?? "generic",
    capabilities: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    ...(opts.deletedAt !== undefined && opts.deletedAt !== null
      ? { deleted_at: opts.deletedAt }
      : {}),
    ...(opts.readOnly ? { read_only: true } : {}),
  };
}

export interface KernelStubOptions {
  granted?: readonly OperationId[];
  workspaces?: readonly WorkspaceRecord[];
  preview?: PurgePreview;
  previewImpl?: (input: { workspace_id: string; acknowledge_no_backup?: boolean }) => Promise<PurgePreview>;
  commit?: PurgeReceipt;
  commitImpl?: (input: { purge_token: string; confirmation: string }) => Promise<PurgeReceipt>;
  cancelImpl?: (token: string) => Promise<boolean>;
  softDeleteImpl?: (id: string) => Promise<SoftDeleteWorkspaceReceipt>;
  restoreImpl?: (id: string) => Promise<RestoreWorkspaceReceipt>;
}

export function makeKernel(opts: KernelStubOptions = {}): KernelFacade {
  const granted = opts.granted ?? ALL_LIFECYCLE_OPS;
  const set = new Set<string>(granted as readonly string[]);
  const workspaces = opts.workspaces ?? [];
  const previewImpl = opts.previewImpl ?? (async () => opts.preview ?? makePreview());
  const commitImpl = opts.commitImpl ?? (async () => opts.commit ?? makeReceipt());
  const cancelImpl = opts.cancelImpl ?? (async () => true);
  const softDeleteImpl = opts.softDeleteImpl ?? (async (id) => makeSoftDeleteReceipt(id));
  const restoreImpl = opts.restoreImpl ?? (async (id) => makeRestoreReceipt(id));
  return {
    hasOperation: (op: string) => set.has(op),
    grantedOperations: granted,
    grantedLevels: ["T0", "T1"],
    sessionInfo: {
      mode: "test", contract_version: "1.2.0",
      runtime_version: "0.3.5", service_id: "test",
    },
    listWorkspaces: vi.fn(async () => [...workspaces]),
    getWorkspace: vi.fn(async () => null),
    createWorkspace: vi.fn() as never,
    listObjects: vi.fn(async () => []),
    getObject: vi.fn(async () => null),
    listEventsSince: vi.fn(async () => []),
    putObject: vi.fn() as never,
    deleteObject: vi.fn() as never,
    softDeleteWorkspace: vi.fn(softDeleteImpl),
    restoreWorkspace: vi.fn(restoreImpl),
    purgePreview: vi.fn(previewImpl),
    purgeCommit: vi.fn(commitImpl),
    purgeCancel: vi.fn(cancelImpl),
    exportPreview: vi.fn() as never,
    exportPackage: vi.fn() as never,
    confirmExport: vi.fn() as never,
    importPreview: vi.fn() as never,
    importCommit: vi.fn() as never,
    importCancel: vi.fn() as never,
  } as unknown as KernelFacade;
}

/**
 * Minimal WorkspaceModuleContext stub — only kernel and router are
 * exercised by LifecycleTrashRoute; the rest are inert placeholders.
 */
export function makeModuleContext(
  kernel: KernelFacade,
  navigate: (ref: RouteRef, params?: Record<string, string>) => void = () => {},
): WorkspaceModuleContext {
  return {
    kernel,
    router: {
      navigate,
      current: () => null,
    } as unknown as WorkspaceModuleContext["router"],
    commands: {
      has: (id: string) =>
        id === "lifecycle.restore-workspace" ||
        id === "lifecycle.purge-preview" ||
        id === "lifecycle.purge-commit" ||
        id === "lifecycle.purge-cancel" ||
        id === "lifecycle.soft-delete-workspace" ||
        id === "workspace.catalog.refresh" ||
        id === "lifecycle.trash.refresh",
      invoke: async (id: string, args?: unknown) => {
        if (id === "lifecycle.restore-workspace") {
          const wsId = (args as { workspaceId: string }).workspaceId;
          return kernel.restoreWorkspace(wsId);
        }
        if (id === "lifecycle.soft-delete-workspace") {
          const wsId = (args as { workspaceId: string }).workspaceId;
          return kernel.softDeleteWorkspace(wsId);
        }
        if (id === "lifecycle.purge-preview") {
          const a = args as { workspaceId: string; acknowledgeNoBackup?: boolean };
          return kernel.purgePreview({
            workspace_id: a.workspaceId,
            acknowledge_no_backup: !!a.acknowledgeNoBackup,
          });
        }
        if (id === "lifecycle.purge-commit") {
          const a = args as { purgeToken: string; confirmation: string };
          return kernel.purgeCommit({
            purge_token: a.purgeToken,
            confirmation: a.confirmation,
          });
        }
        if (id === "lifecycle.purge-cancel") {
          const a = args as { purgeToken: string };
          return kernel.purgeCancel(a.purgeToken);
        }
        return undefined;
      },
    } as unknown as WorkspaceModuleContext["commands"],

    views: { resolve: () => false } as unknown as WorkspaceModuleContext["views"],
    panels: { open: () => {}, close: () => {} } as unknown as WorkspaceModuleContext["panels"],
    dashboard: { refresh: () => {} } as unknown as WorkspaceModuleContext["dashboard"],
    terminology: {
      term: (_key: string, fallback?: string) => fallback ?? _key,
    } as unknown as WorkspaceModuleContext["terminology"],
    diagnostics: {
      report: () => {},
    } as unknown as WorkspaceModuleContext["diagnostics"],
    currentWorkspace: {
      get: () => null,
      subscribe: () => () => {},
    } as unknown as WorkspaceModuleContext["currentWorkspace"],
    profile: {
      id: "generic",
      definition: { id: "generic", label: "Generic", description: "", accent: "#888" },
      fallback: false,
    },
  };
}

/**
 * Render `LifecycleTrashRoute` inside the ModuleRuntimeProvider used
 * by the Host. Returns the render result plus the navigate spy.
 */
export function renderTrash(
  kernel: KernelFacade,
  opts: { navigate?: (ref: RouteRef, params?: Record<string, string>) => void } = {},
): RenderResult {
  trashRefreshService.activate();
  const context = makeModuleContext(kernel, opts.navigate);
  const snapshot = {
    moduleId: "iwxa.workspace.lifecycle",
    context,
    routeRef: hostRouteRefs.lifecycle.trash,
    params: {} as Readonly<Record<string, string>>,
    hostProfileId: "generic",
    profileFallback: false,
  };
  return render(
    <ModuleRuntimeProvider value={snapshot}>
      <LifecycleTrashRoute />
    </ModuleRuntimeProvider>,
  );
}
