/**
 * Export flow state machine (PROMPT 23 §2, §3, §5, §6, §7).
 *
 * Canonical states:
 *   idle → loading-workspaces → ready → previewing → preview-ready
 *        → packaging → package-ready → download-initiated
 *        → confirming → confirmed
 *   * → error
 *
 * Freshness rule (§3): any option change while past `ready` snaps the
 * machine back to `ready` and discards `preview`, `artifact`,
 * `receipt`, and health acknowledgement. The kernel is NEVER called
 * with stale options.
 */

import type {
  ExportOptions,
  ExportPreview,
  PackageArtifact,
  ConfirmExportReceipt,
} from "@/kernel-client/contracts/runtime-1.3.0";
import type { WorkspaceRecord } from "@/kernel-client";

export type ExportStatus =
  | "idle"
  | "loading-workspaces"
  | "ready"
  | "previewing"
  | "preview-ready"
  | "packaging"
  | "package-ready"
  | "download-initiated"
  | "confirming"
  | "confirmed"
  | "error";

export interface ExportSelection {
  readonly workspaces: ReadonlyArray<string>;
  readonly include_history: boolean;
  readonly include_assets: boolean;
  readonly include_relations: boolean;
  readonly include_schemas: boolean;
}

export interface ExportState {
  readonly status: ExportStatus;
  readonly catalog: ReadonlyArray<WorkspaceRecord>;
  readonly selection: ExportSelection;
  readonly ackSensitive: boolean;
  readonly preview: ExportPreview | null;
  readonly artifact: PackageArtifact | null;
  readonly receipt: ConfirmExportReceipt | null;
  readonly error: string | null;
  /** §3 — snapshot of options at the time preview was requested. */
  readonly previewSnapshot: ExportSelection | null;
  /** §3 — snapshot of options at the time the archive was built. */
  readonly packageSnapshot: ExportSelection | null;
}

export const INITIAL_SELECTION: ExportSelection = Object.freeze({
  workspaces: Object.freeze([]) as ReadonlyArray<string>,
  include_history: true,
  include_assets: true,
  include_relations: true,
  include_schemas: true,
});

export const INITIAL_EXPORT_STATE: ExportState = Object.freeze({
  status: "idle",
  catalog: Object.freeze([]) as ReadonlyArray<WorkspaceRecord>,
  selection: INITIAL_SELECTION,
  ackSensitive: false,
  preview: null,
  artifact: null,
  receipt: null,
  error: null,
  previewSnapshot: null,
  packageSnapshot: null,
});

export type ExportEvent =
  | { type: "load-workspaces" }
  | { type: "workspaces-loaded"; catalog: ReadonlyArray<WorkspaceRecord>; initialWorkspaces: ReadonlyArray<string> }
  | { type: "workspaces-failed"; error: string }
  | { type: "set-selection"; selection: Partial<ExportSelection> }
  | { type: "ack-sensitive"; value: boolean }
  | { type: "preview-started" }
  | { type: "preview-succeeded"; preview: ExportPreview }
  | { type: "preview-failed"; error: string }
  | { type: "package-started" }
  | { type: "package-succeeded"; artifact: PackageArtifact }
  | { type: "package-failed"; error: string }
  | { type: "download-initiated" }
  | { type: "confirm-started" }
  | { type: "confirm-succeeded"; receipt: ConfirmExportReceipt }
  | { type: "confirm-failed"; error: string }
  | { type: "reset" };

function invalidate(state: ExportState, next: Partial<ExportState>): ExportState {
  return {
    ...state,
    ...next,
    preview: null,
    artifact: null,
    receipt: null,
    ackSensitive: false,
    previewSnapshot: null,
    packageSnapshot: null,
    status: state.catalog.length === 0 ? "idle" : "ready",
    error: null,
  };
}

function sameWorkspaceIdSet(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  if (setA.size !== a.length) return false;
  const setB = new Set(b);
  if (setB.size !== b.length) return false;
  for (const w of setB) if (!setA.has(w)) return false;
  return true;
}

export function selectionsEqual(a: ExportSelection, b: ExportSelection): boolean {
  if (a === b) return true;
  if (a.include_history !== b.include_history) return false;
  if (a.include_assets !== b.include_assets) return false;
  if (a.include_relations !== b.include_relations) return false;
  if (a.include_schemas !== b.include_schemas) return false;
  return sameWorkspaceIdSet(a.workspaces, b.workspaces);
}

export function toExportOptions(selection: ExportSelection): ExportOptions {
  return {
    workspaces: [...selection.workspaces],
    include_history: selection.include_history,
    include_assets: selection.include_assets,
    include_relations: selection.include_relations,
    include_schemas: selection.include_schemas,
  };
}

export function exportReducer(state: ExportState, event: ExportEvent): ExportState {
  switch (event.type) {
    case "load-workspaces":
      return { ...state, status: "loading-workspaces", error: null };
    case "workspaces-loaded":
      if (state.status !== "loading-workspaces") return state;
      return {
        ...state,
        status: "ready",
        catalog: event.catalog,
        selection: { ...state.selection, workspaces: event.initialWorkspaces },
        preview: null,
        artifact: null,
        receipt: null,
        ackSensitive: false,
        error: null,
      };
    case "workspaces-failed":
      if (state.status !== "loading-workspaces") return state;
      return { ...state, status: "error", error: event.error };
    case "set-selection": {
      const nextSelection: ExportSelection = { ...state.selection, ...event.selection };
      if (selectionsEqual(state.selection, nextSelection)) return state;
      return invalidate(state, { selection: nextSelection });
    }
    case "ack-sensitive":
      if (state.ackSensitive === event.value) return state;
      // Ack changes while packaging/confirming invalidate that in-flight
      // result as well as any unconfirmed artifact. A late completion is
      // ignored by the state guards below and must be explicitly repeated.
      if (state.status === "packaging" || (state.artifact && state.status !== "confirmed")) {
        return {
          ...state,
          ackSensitive: event.value,
          artifact: null,
          receipt: null,
          packageSnapshot: null,
          status: state.preview
            ? "preview-ready"
            : state.catalog.length === 0 ? "idle" : "ready",
          error: null,
        };
      }
      return { ...state, ackSensitive: event.value };
    case "preview-started":
      if (!["ready", "error"].includes(state.status)) return state;
      if (state.selection.workspaces.length === 0) return state;
      return {
        ...state, status: "previewing", error: null, artifact: null, receipt: null,
        previewSnapshot: state.selection, packageSnapshot: null,
      };
    case "preview-succeeded":
      if (state.status !== "previewing") return state;
      return { ...state, status: "preview-ready", preview: event.preview, error: null };
    case "preview-failed":
      if (state.status !== "previewing") return state;
      return { ...state, status: "error", error: event.error };
    case "package-started":
      if (state.status !== "preview-ready" || !state.preview) return state;
      // §3 — freshness: refuse to package if selection drifted from preview snapshot.
      if (state.previewSnapshot && !selectionsEqual(state.previewSnapshot, state.selection)) {
        return state;
      }
      return {
        ...state, status: "packaging", error: null, artifact: null, receipt: null,
        packageSnapshot: state.selection,
      };
    case "package-succeeded":
      if (state.status !== "packaging") return state;
      return { ...state, status: "package-ready", artifact: event.artifact, error: null };
    case "package-failed":
      if (state.status !== "packaging") return state;
      return { ...state, status: "error", error: event.error };
    case "download-initiated":
      if (state.status !== "package-ready" || !state.artifact) return state;
      return { ...state, status: "download-initiated" };
    case "confirm-started":
      if (state.status !== "download-initiated" || !state.artifact) return state;
      return { ...state, status: "confirming", error: null };
    case "confirm-succeeded":
      if (state.status !== "confirming" || !state.artifact) return state;
      if (
        event.receipt.package_digest !== state.artifact.package_digest ||
        typeof event.receipt.confirmed_at !== "string" ||
        !Number.isFinite(Date.parse(event.receipt.confirmed_at)) ||
        !Number.isInteger(event.receipt.confirmations) ||
        event.receipt.confirmations < 1 ||
        !state.packageSnapshot ||
        !sameWorkspaceIdSet(event.receipt.workspace_ids, state.packageSnapshot.workspaces)
      ) {
        return { ...state, status: "download-initiated", receipt: null, error: "EXPORT_CONFIRM_RECEIPT_IDENTITY_MISMATCH" };
      }
      return { ...state, status: "confirmed", receipt: event.receipt, error: null };
    case "confirm-failed":
      if (state.status !== "confirming") return state;
      return { ...state, status: "download-initiated", error: event.error };
    case "reset":
      return { ...state, status: state.catalog.length === 0 ? "idle" : "ready",
               preview: null, artifact: null, receipt: null, ackSensitive: false,
               previewSnapshot: null, packageSnapshot: null, error: null };
    default:
      return state;
  }
}
