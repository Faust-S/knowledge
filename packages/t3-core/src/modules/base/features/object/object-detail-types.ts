/**
 * Types for the ObjectView data controller (`useObjectDetail`).
 *
 * Baseline 1.2 — the parent workspace is a `WorkspaceRecord`. There is
 * no "summary" wrapper and no aggregate counts on the record.
 */
import type {
  EventRecord,
  ObjectWithRelations,
  WorkspaceRecord,
} from "../../../../kernel-client";
import type { WorkspaceProfileState } from "../workspace/workspace-profile";

export type ObjectViewStatus =
  | "idle"
  | "loading-workspace"
  | "profile-blocked"
  | "profile-error"
  | "workspace-unavailable"
  | "workspace-not-found"
  | "workspace-error"
  | "object-unavailable"
  | "loading-object"
  | "ready"
  | "not-found"
  | "object-error";

export type EventsStatus =
  | "idle"
  | "loading"
  | "ready"
  | "unavailable"
  | "error";

export interface ObjectDetailController {
  status: ObjectViewStatus;
  /**
   * `WorkspaceRecord` for the parent workspace, or `null` when it has
   * not yet loaded / does not exist / failed to load. Distinguish these
   * cases via `status`; never treat `null` as "empty workspace".
   */
  workspace: WorkspaceRecord | null;
  workspaceError: string | null;
  profile: WorkspaceProfileState;
  detail: ObjectWithRelations | null;
  objectError: string | null;

  eventsStatus: EventsStatus;
  events: readonly EventRecord[];
  eventsError: string | null;

  refreshObject: () => Promise<void>;
  refreshEvents: () => Promise<void>;
}
