/**
 * Public shapes exposed by `useWorkspaceContent`.
 *
 * Baseline 1.2 — `t1.getWorkspace` returns `WorkspaceRecord | null`;
 * there is no `WorkspaceSummary` wrapper and no aggregate counts on the
 * record. The controller surfaces the raw record; anything derived from
 * `listObjects` / `listEventsSince` is exposed on its own axis and only
 * after those requests actually succeed.
 */
import type {
  EventRecord,
  ObjectRecord,
  WorkspaceRecord,
} from "../../../../kernel-client";
import type { WorkspaceProfileState } from "./workspace-profile";

export type LoadState =
  | "idle"
  | "loading"
  | "ready"
  | "unavailable"
  | "error";

/**
 * Workspace record load status. `not-found` means `t1.getWorkspace`
 * returned `null` — the workspace does not exist for this session.
 */
export type WorkspaceRecordState =
  | "idle"
  | "loading"
  | "ready"
  | "unavailable"
  | "not-found"
  | "error";

/**
 * A record returned by listObjects that violated identity rules and was
 * therefore stripped from the catalog before any rendering.
 */
export interface ObjectIntegrityWarning {
  objectId: string;
  reason:
    | "workspace-mismatch"
    | "unsafe-object-id"
    | "duplicate-object-id";
}

export interface EventIntegrityWarning {
  eventId: string;
  reason:
    | "workspace-mismatch"
    | "unsafe-event-id"
    | "invalid-event-type"
    | "invalid-service-id"
    | "unsafe-object-id"
    | "invalid-revision"
    | "invalid-occurred-at"
    | "duplicate-event-id";
}

export interface WorkspaceContentController {
  workspaceState: WorkspaceRecordState;
  /**
   * The `WorkspaceRecord` returned by `t1.getWorkspace(workspace_id)`,
   * or `null` when the record has not yet loaded / does not exist /
   * failed to load. Callers MUST distinguish states via `workspaceState`
   * and never treat "no record" as "empty summary".
   */
  workspace: WorkspaceRecord | null;
  workspaceError: string | null;

  profile: WorkspaceProfileState;

  objectsState: LoadState;
  objects: readonly ObjectRecord[];
  objectsError: string | null;
  objectIntegrityWarnings: readonly ObjectIntegrityWarning[];

  eventsState: LoadState;
  events: readonly EventRecord[];
  eventsError: string | null;
  eventIntegrityWarnings: readonly EventIntegrityWarning[];

  refreshObjects: () => Promise<void>;
  refreshEvents: () => Promise<void>;
}
