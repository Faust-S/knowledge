/** §11 — merge requires target_workspace. */
import { describe, expect, it } from "vitest";
import {
  INITIAL_PLAN, validateImportPlan,
} from "@/modules/exchange/features/state/import-machine";

describe("merge validation (§11)", () => {
  it("flags missing target_workspace", () => {
    const issues = validateImportPlan(
      { ...INITIAL_PLAN, mode: "merge", target_workspace: null },
      ["merge"], ["a"], [],
    );
    expect(issues.some((v) => v.includes("target_workspace"))).toBe(true);
  });
  it("passes when target_workspace is provided", () => {
    const issues = validateImportPlan(
      { ...INITIAL_PLAN, mode: "merge", target_workspace: "local-x" },
      ["merge"], ["a"], [],
    );
    expect(issues.length).toBe(0);
  });
  it("prefers real selected local Workspace when a foreign .iwxa supports merge", async () => {
    const { INITIAL_IMPORT_STATE, importReducer } = await import(
      "@/modules/exchange/features/state/import-machine"
    );
    const preview = {
      preview_token: "t", package_digest: "d", semantic_digest: "sd",
      expires_at: new Date(Date.now() + 60000).toISOString(),
      allowed_modes: ["selective", "merge"] as const,
      preview: {
        workspaces: [{ workspace_id: "sender-other", exists_locally: false }],
        objects: [], included: { workspaces: 1 },
      },
    };
    const ready = importReducer(
      importReducer(INITIAL_IMPORT_STATE, { type: "preview-started" }),
      { type: "preview-succeeded", handle: preview as never,
        preferredTargetWorkspaceId: "recipient-selected" },
    );
    expect(ready.plan.mode).toBe("merge");
    expect(ready.plan.include_workspaces).toEqual(["sender-other"]);
    expect(ready.plan.target_workspace).toBe("recipient-selected");
    expect(ready.plan.workspace_id_map).toEqual({});
  });
});
