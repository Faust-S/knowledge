/** §3 — preview-started captures a snapshot of current selection. */
import { describe, expect, it } from "vitest";
import {
  INITIAL_EXPORT_STATE, exportReducer,
} from "@/modules/exchange/features/state/export-machine";
import type { WorkspaceRecord } from "@/kernel-client";

const ws = (id: string) => ({ workspace_id: id, profile: "generic", deleted_at: null } as unknown as WorkspaceRecord);

describe("Export snapshots (§3)", () => {
  it("previewSnapshot is populated on preview-started and cleared on set-selection", () => {
    let s = exportReducer(INITIAL_EXPORT_STATE, { type: "load-workspaces" });
    s = exportReducer(s,
      { type: "workspaces-loaded", catalog: [ws("a")], initialWorkspaces: ["a"] });
    s = exportReducer(s, { type: "preview-started" });
    expect(s.previewSnapshot).not.toBeNull();
    expect(s.previewSnapshot!.workspaces).toEqual(["a"]);
    s = exportReducer(s, { type: "set-selection", selection: { include_history: false } });
    expect(s.previewSnapshot).toBeNull();
  });
});
