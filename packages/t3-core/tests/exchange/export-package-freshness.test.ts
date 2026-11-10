/** §3 — package-started refuses when selection drifted from preview snapshot. */
import { describe, expect, it } from "vitest";
import {
  INITIAL_EXPORT_STATE, exportReducer,
} from "@/modules/exchange/features/state/export-machine";
import type { WorkspaceRecord } from "@/kernel-client";
import type { ExportPreview, PackageArtifact } from "@/kernel-client/contracts/v1";

const ws = (id: string) => ({ workspace_id: id, profile: "generic", deleted_at: null } as unknown as WorkspaceRecord);
const preview: ExportPreview = {
  workspaces: ["a"],
  counts: { workspaces: 1, objects: 0, events: 0, relations: 0, assets: 0, schemas: 0 },
  approx_bytes: 0,
  summary: {
    included: { workspaces: 1, objects: 0, events: 0, relations: 0, assets: 0, schemas: 0 },
    excluded_by_permission: { workspaces: 0, objects: 0, events: 0, relations: 0, assets: 0, schemas: 0 },
    scope_mode: "workspace",
  },
  unsupported: [], conflicts: [],
};

describe("Package freshness (§3)", () => {
  it("package-started is a no-op when preview snapshot mismatches current selection", () => {
    let s = exportReducer(INITIAL_EXPORT_STATE, { type: "load-workspaces" });
    s = exportReducer(s,
      { type: "workspaces-loaded", catalog: [ws("a"), ws("b")], initialWorkspaces: ["a"] });
    s = exportReducer(s, { type: "preview-started" });
    s = exportReducer(s, { type: "preview-succeeded", preview });
    // drift the selection *without* re-preview (simulated by direct force via set-selection reset)
    // set-selection would clear preview, so force via low-level mutation isn't allowed —
    // instead invalidate ratio by toggling then re-priming (only preview state is cleared).
    const before = s.status;
    // Force a mismatch by manually stitching a state (only the reducer's freshness matters).
    const hacked = { ...s, selection: { ...s.selection, workspaces: ["a", "b"] } };
    const next = exportReducer(hacked, { type: "package-started" });
    expect(next).toBe(hacked);
    expect(before).toBe("preview-ready");
  });
});


it("sensitive acknowledgment drift invalidates an unconfirmed package artifact but preserves preview", () => {
  const artifact = {
    filename: "a.iwxa",
    bytes: new Uint8Array(),
    size: 0,
    package_digest: "d",
    semantic_digest: "sd",
    manifest: { workspaces: ["a"] },
  } as unknown as PackageArtifact;
  let s = exportReducer(INITIAL_EXPORT_STATE, { type: "load-workspaces" });
  s = exportReducer(s,
    { type: "workspaces-loaded", catalog: [ws("a")], initialWorkspaces: ["a"] });
  s = exportReducer(s, { type: "preview-started" });
  s = exportReducer(s, { type: "preview-succeeded", preview });
  s = exportReducer(s, { type: "ack-sensitive", value: true });
  s = exportReducer(s, { type: "package-started" });
  s = exportReducer(s, { type: "package-succeeded", artifact });
  expect(s.artifact).toBe(artifact);
  s = exportReducer(s, { type: "ack-sensitive", value: false });
  expect(s.status).toBe("preview-ready");
  expect(s.preview).toBe(preview);
  expect(s.artifact).toBeNull();
  expect(s.packageSnapshot).toBeNull();
});
