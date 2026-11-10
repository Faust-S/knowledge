/** §3 — packageSnapshot mirrors selection at package-started. */
import { describe, expect, it } from "vitest";
import {
  INITIAL_EXPORT_STATE, exportReducer,
} from "@/modules/exchange/features/state/export-machine";
import type { WorkspaceRecord } from "@/kernel-client";
import type { ExportPreview } from "@/kernel-client/contracts/v1";

const ws = (id: string) => ({ workspace_id: id, profile: "generic", deleted_at: null } as unknown as WorkspaceRecord);
const preview = {
  workspaces: ["a"],
  counts: { workspaces: 1, objects: 0, events: 0, relations: 0, assets: 0, schemas: 0 },
  approx_bytes: 0,
  summary: {
    included: { workspaces: 1, objects: 0, events: 0, relations: 0, assets: 0, schemas: 0 },
    excluded_by_permission: { workspaces: 0, objects: 0, events: 0, relations: 0, assets: 0, schemas: 0 },
    scope_mode: "workspace" as const,
  },
  unsupported: [], conflicts: [],
} as unknown as ExportPreview;

describe("Package snapshot (§3)", () => {
  it("packageSnapshot equals selection at package-started", () => {
    let s = exportReducer(INITIAL_EXPORT_STATE, { type: "load-workspaces" });
    s = exportReducer(s,
      { type: "workspaces-loaded", catalog: [ws("a")], initialWorkspaces: ["a"] });
    s = exportReducer(s, { type: "preview-started" });
    s = exportReducer(s, { type: "preview-succeeded", preview });
    s = exportReducer(s, { type: "package-started" });
    expect(s.packageSnapshot?.workspaces).toEqual(["a"]);
  });
});
