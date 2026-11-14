import { describe, expect, it } from "vitest";
import {
  INITIAL_IMPORT_STATE,
  importReducer,
  INITIAL_PLAN,
  validateImportScope,
  type ImportPreviewHandle,
} from "@/modules/exchange/features/state/import-machine";
import type { ImportPreview } from "@/kernel-client/contracts/runtime-1.3.0";

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
  it("blocks an incompatible original schema declaration without requiring an unsupported row", () => {
    const counts = { workspaces: 1, objects: 0, events: 0, relations: 0, assets: 0, schemas: 1 };
    const preview = {
      workspaces: [{ workspace_id: "src" }], totals: { ...counts, files: 1 },
      included: counts,
      excluded_by_permission: { workspaces: 0, objects: 0, events: 0,
        relations: 0, assets: 0, schemas: 0 },
      invalid: { envelopes: 0, dependencies: 0, schema_validation: 0, schema_conflicts: 0 },
      unsupported: [],
      schemas: [{ schema_id: "domain:invoice", schema_version: "1.0.0",
        object_count: 1, status: "missing" }],
    } as unknown as ImportPreview;
    const plan = { ...INITIAL_PLAN, mode: "full" as const };
    expect(validateImportScope(preview, plan).some((issue) =>
      issue.includes("domain:invoice@1.0.0") && issue.includes("отсутствует"))).toBe(true);
    preview.schemas[0].status = "embedded_equal";
    expect(validateImportScope(preview, plan)).toEqual([]);
  });
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
