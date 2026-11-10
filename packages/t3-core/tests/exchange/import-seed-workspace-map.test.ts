/** §11 — switching to new-workspace seeds workspace_id_map from preview. */
import { describe, expect, it } from "vitest";
import {
  INITIAL_IMPORT_STATE, importReducer,
} from "@/modules/exchange/features/state/import-machine";
import type { SecureImportPreview } from "@/kernel-client/contracts/v1";

const secure: SecureImportPreview = {
  preview_token: "tok", package_digest: "d", semantic_digest: "sd",
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  allowed_modes: ["selective", "new-workspace"],
  preview: {
    workspaces: [
      { workspace_id: "src-a", exists_locally: false, incoming_objects: 0,
        incoming_events: 0, incoming_relations: 0, incoming_assets: 0 },
      { workspace_id: "src-b", exists_locally: false, incoming_objects: 0,
        incoming_events: 0, incoming_relations: 0, incoming_assets: 0 },
    ],
  } as unknown as SecureImportPreview["preview"],
};

describe("workspace_id_map seeding (§11)", () => {
  it("switching to new-workspace seeds default targets", () => {
    let s = importReducer(INITIAL_IMPORT_STATE, { type: "preview-started" });
    s = importReducer(s, { type: "preview-succeeded", handle: secure });
    s = importReducer(s, { type: "set-plan", plan: { mode: "new-workspace" } });
    expect(s.plan.workspace_id_map).toEqual({
      "src-a": "src-a-imported",
      "src-b": "src-b-imported",
    });
  });

  it("seeds targets immediately when new-workspace is the only authorized mode", () => {
    const onlyNewWorkspace = { ...secure, allowed_modes: ["new-workspace"] as const };
    let s = importReducer(INITIAL_IMPORT_STATE, { type: "preview-started" });
    s = importReducer(s, { type: "preview-succeeded", handle: onlyNewWorkspace });
    expect(s.plan.mode).toBe("new-workspace");
    expect(s.plan.include_workspaces).toEqual(["src-a", "src-b"]);
    expect(s.plan.workspace_id_map).toEqual({
      "src-a": "src-a-imported", "src-b": "src-b-imported",
    });
  });
});
