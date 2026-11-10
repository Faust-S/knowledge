import {
  WORKSPACE_SAVED_VIEW_SCHEMA_ID,
  WORKSPACE_SAVED_VIEW_SCHEMA_VERSION,
} from "@/workspace-contract";
import { isSafeOpaqueId } from "@/shell/routing";
import { workspaceSavedViewObjectId } from "../base/features/workspace/workspace-view-state-boundary.mjs";

export { WORKSPACE_SAVED_VIEW_SCHEMA_ID, WORKSPACE_SAVED_VIEW_SCHEMA_VERSION };

export interface WorkspaceSavedViewData {
  version: 1;
  view_id: string;
  name: string;
  profile_id: string;
  logical_area_id: string | null;
  query: string;
}

export interface WorkspaceSavedViewValidationIssue {
  path: string;
  message: string;
}

export function validateWorkspaceSavedViewData(input: unknown): {
  ok: boolean;
  issues?: WorkspaceSavedViewValidationIssue[];
} {
  const issues: WorkspaceSavedViewValidationIssue[] = [];
  const value = input as Partial<WorkspaceSavedViewData> | null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, issues: [{ path: "$", message: "saved view data must be an object" }] };
  }
  if (value.version !== 1) issues.push({ path: "version", message: "version must equal 1" });
  if (typeof value.view_id !== "string" || !isSafeOpaqueId(value.view_id)) {
    issues.push({ path: "view_id", message: "view_id must be a safe opaque id" });
  } else {
    try { workspaceSavedViewObjectId(value.view_id); }
    catch { issues.push({ path: "view_id", message: "view_id cannot form a safe canonical object id" }); }
  }
  if (typeof value.name !== "string" || value.name.trim().length < 1 || value.name.trim().length > 120) {
    issues.push({ path: "name", message: "name must contain 1..120 trimmed characters" });
  }
  if (typeof value.profile_id !== "string" || value.profile_id.length < 1 || value.profile_id.length > 64) {
    issues.push({ path: "profile_id", message: "profile_id must contain 1..64 characters" });
  }
  if (value.logical_area_id !== null &&
      (typeof value.logical_area_id !== "string" || !isSafeOpaqueId(value.logical_area_id))) {
    issues.push({ path: "logical_area_id", message: "logical_area_id must be null or a safe opaque id" });
  }
  if (typeof value.query !== "string" || value.query.length > 1000) {
    issues.push({ path: "query", message: "query must be a string up to 1000 characters" });
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true };
}

export function savedViewObjectId(viewId: string): string {
  try { return workspaceSavedViewObjectId(viewId); }
  catch { throw new Error("VIEW_STATE_INVALID_VIEW_ID"); }
}
