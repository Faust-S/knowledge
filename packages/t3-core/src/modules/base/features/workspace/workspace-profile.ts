/**
 * Presentation model for the actual profile of a Workspace record.
 *
 * The Workspace shell must not assume the domain-level `workspace_profile`
 * matches every stored Workspace: the catalog can hold Workspaces created
 * under other profiles (e.g. imports). This module resolves the effective
 * profile for a single Workspace.
 */
import type { WorkspaceProfileDefinition } from "../../../../profiles/definition";
import {
  WORKSPACE_PROFILES,
  type WorkspaceProfileId,
} from "../../../../config/domain-config";

export type WorkspaceProfileStatus =
  | "idle"
  | "loading"
  | "ready"
  | "fallback"
  | "error";

export interface WorkspaceProfileState {
  status: WorkspaceProfileStatus;
  /** Raw `profile` string as stored on the WorkspaceRecord. */
  requestedProfile: string | null;
  /** Actual profile id used by the shell (generic on fallback). */
  activeProfileId: WorkspaceProfileId | null;
  definition: WorkspaceProfileDefinition | null;
  error: string | null;
}

export function isKnownWorkspaceProfileId(
  value: string,
): value is WorkspaceProfileId {
  return (WORKSPACE_PROFILES as readonly string[]).includes(value);
}

export const IDLE_WORKSPACE_PROFILE_STATE: WorkspaceProfileState = {
  status: "idle",
  requestedProfile: null,
  activeProfileId: null,
  definition: null,
  error: null,
};
