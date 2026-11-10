/**
 * Shared in-memory types for the unified workspace catalog.
 *
 * Baseline 1.2 exposes ONLY `WorkspaceRecord` via `t1.listWorkspaces`. The
 * catalog is a presentation projection over that list — it never wraps
 * the record in a synthetic "summary" and never fabricates per-workspace
 * counts. Aggregate object/event/relation counts are NOT part of the
 * Runtime Contract; they belong to individual workspace surfaces after
 * `listObjects` / `listEventsSince` succeed.
 *
 * `WorkspaceCatalogItem` MUST NOT gain fields that imitate the removed
 * `WorkspaceSummary` (e.g. `counts`, `last_event_at`). Only UI-local
 * decoration (selection state, integrity warnings) is permitted.
 */
import type { WorkspaceRecord } from "../../../../kernel-client";

export interface WorkspaceCatalogItem {
  workspace: WorkspaceRecord;
}

export type WorkspaceCatalogStatus =
  | "idle"
  | "loading"
  | "ready"
  | "error";

export interface WorkspaceCatalogSnapshot {
  status: WorkspaceCatalogStatus;
  items: readonly WorkspaceCatalogItem[];
  error: string | null;
  loadedAt: number | null;
}

export interface CreateWorkspaceRequest {
  profile: string;
}
