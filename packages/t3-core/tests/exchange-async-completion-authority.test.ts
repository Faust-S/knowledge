import { describe, expect, it } from "vitest";
import {
  INITIAL_IMPORT_STATE,
  importReducer,
  type ImportPreviewHandle,
} from "@/modules/exchange/features/state/import-machine";
import {
  INITIAL_EXPORT_STATE,
  exportReducer,
} from "@/modules/exchange/features/state/export-machine";
import type {
  ConfirmExportReceipt,
  ExportPreview,
  ImportReceipt,
  PackageArtifact,
  WorkspaceRecord,
} from "@/kernel-client/contracts/runtime-1.2.0";

const workspace = { workspace_id: "w", profile: "generic" } as WorkspaceRecord;
const exportPreview = {
  workspaces: ["w"],
  counts: { workspaces: 1, objects: 0, events: 0, relations: 0, assets: 0, schemas: 0 },
  approx_bytes: 1,
  summary: {
    included: { workspaces: 1, objects: 0, events: 0, relations: 0, assets: 0, schemas: 0 },
    excluded_by_permission: { workspaces: 0, objects: 0, events: 0, relations: 0, assets: 0, schemas: 0 },
    scope_mode: "workspace",
  },
  unsupported: [],
  conflicts: [],
} as ExportPreview;
const artifact = {
  package_digest: "pkg",
  semantic_digest: "sem",
  filename: "x.iwxa",
  bytes: new Uint8Array([1]),
  size: 1,
} as PackageArtifact;
const confirmReceipt = {
  confirmed_at: "2026-09-21T00:00:00Z",
  package_digest: "pkg",
  workspace_ids: ["w"],
  confirmations: 1,
} as ConfirmExportReceipt;

const importHandle = {
  preview_token: "tok",
  package_digest: "pkg",
  semantic_digest: "sem",
  expires_at: "2026-09-22T00:00:00Z",
  allowed_modes: ["selective"],
  preview: {
    workspaces: [{ workspace_id: "w" }],
    objects: [],
  },
} as unknown as ImportPreviewHandle;
const importReceipt = {
  import_id: "i",
  format: "iwxa.import.receipt",
  format_version: "1.0",
  package_digest: "pkg",
  semantic_digest: "sem",
  mode: "selective",
  conflict_policy: "fail",
  committed_at: "2026-09-21T00:00:00Z",
  applied: {
    workspaces: 1, objects_inserted: 0, objects_updated: 0, objects_skipped: 0,
    events: 0, relations: 0, assets: 0, schemas_inserted: 0, schemas_reused: 0, schemas_rejected: 0,
  },
  skipped_conflicts: [],
  workspace_id_map: {},
  excluded_by_permission: {},
} as unknown as ImportReceipt;

describe("exchange async completion authority", () => {
  it("ignores an export preview that completes after selection invalidated the request", () => {
    let state = exportReducer(INITIAL_EXPORT_STATE, { type: "load-workspaces" });
    state = exportReducer(state, { type: "workspaces-loaded", catalog: [workspace], initialWorkspaces: ["w"] });
    state = exportReducer(state, { type: "preview-started" });
    state = exportReducer(state, { type: "set-selection", selection: { include_assets: false } });
    state = exportReducer(state, { type: "preview-succeeded", preview: exportPreview });
    expect(state.status).toBe("ready");
    expect(state.preview).toBeNull();
  });

  it("invalidates packaging when sensitive acknowledgement changes and ignores its late result", () => {
    let state = exportReducer(INITIAL_EXPORT_STATE, { type: "load-workspaces" });
    state = exportReducer(state, { type: "workspaces-loaded", catalog: [workspace], initialWorkspaces: ["w"] });
    state = exportReducer(state, { type: "preview-started" });
    state = exportReducer(state, { type: "preview-succeeded", preview: exportPreview });
    state = exportReducer(state, { type: "ack-sensitive", value: true });
    state = exportReducer(state, { type: "package-started" });
    expect(state.status).toBe("packaging");
    state = exportReducer(state, { type: "ack-sensitive", value: false });
    expect(state.status).toBe("preview-ready");
    state = exportReducer(state, { type: "package-succeeded", artifact });
    expect(state.artifact).toBeNull();
  });

  it("rejects a confirm receipt whose authority identity differs from the built artifact", () => {
    let state = exportReducer(INITIAL_EXPORT_STATE, { type: "load-workspaces" });
    state = exportReducer(state, { type: "workspaces-loaded", catalog: [workspace], initialWorkspaces: ["w"] });
    state = exportReducer(state, { type: "preview-started" });
    state = exportReducer(state, { type: "preview-succeeded", preview: exportPreview });
    state = exportReducer(state, { type: "ack-sensitive", value: true });
    state = exportReducer(state, { type: "package-started" });
    state = exportReducer(state, { type: "package-succeeded", artifact });
    state = exportReducer(state, { type: "download-initiated" });
    state = exportReducer(state, { type: "ack-file-saved", value: true });
    state = exportReducer(state, { type: "confirm-started" });
    state = exportReducer(state, { type: "confirm-succeeded", receipt: { ...confirmReceipt, package_digest: "other" } });
    expect(state.status).toBe("download-initiated");
    expect(state.receipt).toBeNull();
    expect(state.error).toBe("EXPORT_CONFIRM_RECEIPT_IDENTITY_MISMATCH");
  });

  it("ignores an import preview that completes after cancellation", () => {
    let state = importReducer(INITIAL_IMPORT_STATE, { type: "preview-started" });
    state = importReducer(state, { type: "cancel", reason: "new-file" });
    state = importReducer(state, { type: "preview-succeeded", handle: importHandle });
    expect(state.status).toBe("cancelled");
    expect(state.handle).toBeNull();
  });

  it("locks the import plan once commit validation has started", () => {
    let state = importReducer(INITIAL_IMPORT_STATE, { type: "preview-started" });
    state = importReducer(state, { type: "preview-succeeded", handle: importHandle });
    state = importReducer(state, { type: "validate-plan" });
    state = importReducer(state, { type: "commit-started" });
    const before = state.plan;
    state = importReducer(state, { type: "set-plan", plan: { conflict: "overwrite" } });
    expect(state.status).toBe("committing");
    expect(state.plan).toEqual(before);
  });

  it("fails closed when an import receipt does not match preview digest or committed plan", () => {
    let state = importReducer(INITIAL_IMPORT_STATE, { type: "preview-started" });
    state = importReducer(state, { type: "preview-succeeded", handle: importHandle });
    state = importReducer(state, { type: "validate-plan" });
    state = importReducer(state, { type: "commit-started" });
    state = importReducer(state, { type: "commit-succeeded", receipt: { ...importReceipt, package_digest: "other" } });
    expect(state.status).toBe("error");
    expect(state.receipt).toBeNull();
    expect(state.error).toBe("IMPORT_RECEIPT_IDENTITY_MISMATCH");
  });

  it("keeps retryable import lock failures on the same preview but ignores generic late failures", () => {
    let state = importReducer(INITIAL_IMPORT_STATE, { type: "preview-started" });
    state = importReducer(state, { type: "preview-succeeded", handle: importHandle });
    state = importReducer(state, { type: "validate-plan" });
    state = importReducer(state, { type: "commit-started" });
    state = importReducer(state, { type: "commit-retryable", error: "locked" });
    expect(state.status).toBe("preview-ready");
    expect(state.handle?.preview_token).toBe("tok");
    const cancelled = importReducer(state, { type: "cancel", reason: "explicit" });
    const lateFailure = importReducer(cancelled, { type: "commit-failed", error: "late" });
    expect(lateFailure.status).toBe("cancelled");
  });
});
