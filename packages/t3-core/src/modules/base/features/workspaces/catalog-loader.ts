/**
 * Pure loader for the workspace catalog.
 *
 * Baseline 1.2 rule — the catalog surface reads through EXACTLY one
 * kernel operation: `t1.listWorkspaces`. It never calls `getWorkspace`
 * for the list items (N+1), never asks for events, and never derives
 * counts. Per-workspace aggregates are not part of the Runtime Contract;
 * they belong to the open-workspace surface after `listObjects` /
 * `listEventsSince` succeed.
 *
 * PROMPT 22c-1 — the loader now consumes a `KernelFacade` directly.
 * `KernelSession` / `Capabilities` / raw `adapter` are no longer visible
 * to base module code.
 */
import type { WorkspaceRecord } from "../../../../kernel-client";
import type { KernelFacade } from "../../../../workspace-contract";
import type { WorkspaceCatalogItem } from "./catalog-types";
import { compareWorkspaceDatesDesc, compareWorkspaceIds } from "./workspace-format";

export class WorkspaceCatalogCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceCatalogCapabilityError";
  }
}

/**
 * "Newest first" ordering with a stable tie-breaker by `workspace_id` so
 * ambiguous or equal `updated_at` values never produce a flapping list.
 */
function compareUpdatedDesc(a: WorkspaceRecord, b: WorkspaceRecord): number {
  const d = compareWorkspaceDatesDesc(a.updated_at, b.updated_at);
  if (d !== 0) return d;
  return compareWorkspaceIds(a.workspace_id, b.workspace_id);
}

export async function loadWorkspaceCatalog(
  kernel: KernelFacade,
): Promise<WorkspaceCatalogItem[]> {
  if (!kernel.hasOperation("t1.listWorkspaces")) {
    throw new WorkspaceCatalogCapabilityError(
      "t1.listWorkspaces is not granted by the kernel",
    );
  }

  const raw = await kernel.listWorkspaces({ include_deleted: false });
  // Defensive filter — the kernel may still return `deleted_at` records
  // if the option is ignored by a permissive runtime.
  const alive = raw.filter((w) => w.deleted_at == null);
  alive.sort(compareUpdatedDesc);
  return alive.map((workspace) => ({ workspace }));
}
