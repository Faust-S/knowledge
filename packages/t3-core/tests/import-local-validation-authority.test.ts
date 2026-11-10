import { describe, expect, it } from "vitest";
import {
  INITIAL_IMPORT_STATE,
  importReducer,
  type ImportPreviewHandle,
} from "@/modules/exchange/features/state/import-machine";

function handle(): ImportPreviewHandle {
  return {
    preview_token: "tok",
    package_digest: "pkg",
    semantic_digest: "sem",
    expires_at: "2026-09-22T00:00:00Z",
    allowed_modes: ["new-workspace"],
    preview: {
      workspaces: [{ workspace_id: "src" }],
      objects: [],
    },
  } as unknown as ImportPreviewHandle;
}

describe("import local validation authority", () => {
  it("keeps new-workspace local-id collisions in preview-ready and blocks commit-started", () => {
    let state = importReducer(INITIAL_IMPORT_STATE, { type: "preview-started" });
    state = importReducer(state, { type: "preview-succeeded", handle: handle() });
    state = importReducer(state, {
      type: "set-plan",
      plan: { mode: "new-workspace", workspace_id_map: { src: "already-here" } },
    });
    state = importReducer(state, { type: "validate-plan", localWorkspaceIds: ["already-here"] });
    expect(state.status).toBe("preview-ready");
    expect(state.planValidation.some((issue) => issue.includes("уже существует"))).toBe(true);
    const afterCommit = importReducer(state, { type: "commit-started" });
    expect(afterCommit.status).toBe("preview-ready");
  });
});
