import { describe, expect, it } from "vitest";
import { INITIAL_PLAN, validateImportPlan, validateImportScope, validateRestorationReceipt, toKernelImportPlan, importReducer, INITIAL_IMPORT_STATE } from "@/modules/exchange/features/state/import-machine";
import type { ImportPreview, SecureImportPreview, ImportReceipt } from "@/kernel-client/contracts/runtime-1.3.0";

const counts = (overrides: Record<string, number> = {}) => ({
  workspaces: 1, objects: 2, events: 3, relations: 1, assets: 0, schemas: 2, ...overrides,
});

function makePreview(included = counts(), excluded = counts({
  workspaces: 0, objects: 0, events: 0, relations: 0, schemas: 0,
})): ImportPreview {
  return {
    totals: { files: 8, ...counts() },
    workspaces: [{
      workspace_id: "source", exists_locally: false, incoming_objects: 2,
      incoming_events: 3, incoming_relations: 1, incoming_assets: 0,
    }],
    objects: [], schemas: [], conflicts: [], unsupported: [], warnings: [],
    included, excluded_by_permission: excluded,
  } as unknown as ImportPreview;
}

describe("Exchange scope gating for real Kernel previews", () => {
  const plan = { ...INITIAL_PLAN, mode: "new-workspace" as const, include_workspaces: ["source"] };

  it("prevents import when Kernel excludes every package item", () => {
    const preview = makePreview(
      counts({ workspaces: 0, objects: 0, events: 0, relations: 0, schemas: 0 }),
      counts(),
    );
    const issues = validateImportScope(preview, plan);
    expect(issues).toEqual(expect.arrayContaining([
      expect.stringContaining("Ни один объект"),
      expect.stringContaining("рабочих областей"),
    ]));
    const handle = {
      preview_token: "not-logged", package_digest: "digest", semantic_digest: "semantic",
      expires_at: "2099-01-01T00:00:00Z", allowed_modes: ["new-workspace"], preview,
    } as SecureImportPreview;
    const ready = importReducer(
      importReducer(INITIAL_IMPORT_STATE, { type: "preview-started" }),
      { type: "preview-succeeded", handle },
    );
    expect(ready.plan.include_workspaces).toEqual([]);
    expect(ready.plan.workspace_id_map).toEqual({});
  });

  it("blocks silent loss of events while history is requested", () => {
    const preview = makePreview(
      counts({ events: 0 }),
      counts({ workspaces: 0, objects: 0, events: 3, relations: 0, schemas: 0 }),
    );
    expect(validateImportScope(preview, plan)).toContain("3 событий истории недоступны для импорта.");
    // Explicit data-only selective import may omit history. A new-workspace
    // restore with archived events must not silently drop the event lineage.
    expect(validateImportScope(preview, { ...plan, mode: "selective", include_history: false })).toEqual([]);
  });

  it("allows a complete writable_objects preview without expanding scope", () => {
    expect(validateImportScope(makePreview(), plan)).toEqual([]);
  });

  it("blocks malformed scoped previews without authorization totals", () => {
    const broken = { ...makePreview(), included: undefined, scope_mode: "writable_objects" } as unknown as ImportPreview;
    expect(validateImportScope(broken, plan)).toContain(
      "Kernel не вернул обязательный состав разрешённых данных для импорта.",
    );
  });

  it("discards a rejected plan and displays its true error", () => {
    const handle = {
      preview_token: "not-logged", package_digest: "digest", semantic_digest: "semantic",
      expires_at: "2099-01-01T00:00:00Z", allowed_modes: ["new-workspace"],
      preview: makePreview(),
    } as SecureImportPreview;
    let state = importReducer(INITIAL_IMPORT_STATE, { type: "preview-started" });
    state = importReducer(state, { type: "preview-succeeded", handle });
    state = importReducer(state, { type: "validate-plan", localWorkspaceIds: [] });
    state = importReducer(state, { type: "commit-started" });
    state = importReducer(state, { type: "commit-invalid", error: "PLAN_NOT_IN_PREVIEW" });
    expect(state.status).toBe("error");
    expect(state.handle).toBeNull();
    expect(state.error).toContain("PLAN_NOT_IN_PREVIEW");
  });
  it("rejects invalid archive records despite full declared permissions", () => {
    const preview = { ...makePreview(), invalid: {
      envelopes: 0, dependencies: 1, schema_validation: 0, schema_conflicts: 0,
    } } as ImportPreview;
    expect(validateImportScope(preview, plan)).toEqual(
      expect.arrayContaining([expect.stringContaining("недопустимые записи")]),
    );
  });

  it("accepts supported unknown extension fields, but not unknown schemas", () => {
    const ext = { ...makePreview(), unsupported: [
      { kind: "extension_field", path: "data.extra", sample: "value" },
    ] } as ImportPreview;
    expect(validateImportScope(ext, plan)).toEqual([]);
    const invalidSchema = { ...makePreview(), unsupported: [
      { kind: "unknown_schema", schema_id: "unregistered", schema_version: "1.0.0", object_count: 1 },
    ] } as ImportPreview;
    expect(validateImportScope(invalidSchema, plan)).toEqual(
      expect.arrayContaining([expect.stringContaining("неподдерживаемыми схемами")]),
    );
  });

  it("rejects a receipt that skipped objects or lost the domain event history", () => {
    const receipt = {
      cancelled: false,
      applied: {
        workspaces: 1, objects_inserted: 2, objects_updated: 0, objects_skipped: 0,
        events: 3, relations: 1, assets: 0,
        schemas_inserted: 2, schemas_reused: 0, schemas_rejected: 0,
      },
    } as ImportReceipt;
    expect(validateRestorationReceipt(makePreview(), plan, receipt)).toEqual([]);
    expect(validateRestorationReceipt(makePreview(), plan, {
      ...receipt, applied: { ...receipt.applied, objects_inserted: 0, objects_skipped: 2 },
    })).toEqual(expect.arrayContaining([expect.stringContaining("Объекты восстановлены не полностью")]));
    expect(validateRestorationReceipt(makePreview(), plan, {
      ...receipt, applied: { ...receipt.applied, events: 0 },
    })).toEqual(expect.arrayContaining([expect.stringContaining("История восстановлена не полностью")]));
  });

  it("retains the real receipt and completed writes after an incomplete import", () => {
    const handle: SecureImportPreview = {
      preview_token: "token", package_digest: "digest", semantic_digest: "semantic",
      expires_at: "2099-01-01T00:00:00Z", allowed_modes: ["new-workspace"],
      preview: makePreview(),
    };
    let state = importReducer(INITIAL_IMPORT_STATE, { type: "preview-started" });
    state = importReducer(state, { type: "preview-succeeded", handle });
    state = importReducer(state, { type: "validate-plan", localWorkspaceIds: [] });
    expect(state.status).toBe("validating");
    state = importReducer(state, { type: "commit-started" });
    const receipt = {
      package_digest: "digest", semantic_digest: "semantic",
      mode: "new-workspace", conflict_policy: "fail", cancelled: false,
      applied: { workspaces: 1, objects_inserted: 2, objects_updated: 0,
        objects_skipped: 0, events: 0, relations: 1, assets: 0,
        schemas_inserted: 2, schemas_reused: 0, schemas_rejected: 0 },
    } as ImportReceipt;
    const issues = validateRestorationReceipt(handle.preview, state.plan, receipt);
    expect(issues).toEqual(expect.arrayContaining([
      expect.stringContaining("История восстановлена не полностью"),
    ]));
    state = importReducer(state, {
      type: "commit-incomplete", receipt, error: issues.join(" "),
    });
    expect(state.status).toBe("incomplete");
    expect(state.receipt).toBe(receipt);
    expect(state.handle).toBeNull();
    expect(state.error).toContain("История восстановлена не полностью");
    expect(importReducer(state, { type: "commit-started" })).toBe(state);
  });

  it("blocks new-workspace and full restore if archived domain history is disabled", () => {
    const withHistory = { ...plan, include_history: true };
    expect(validateImportScope(makePreview(), withHistory)).toEqual([]);
    for (const mode of ["new-workspace", "full"] as const) {
      const incomplete = { ...withHistory, mode, include_history: false };
      const issues = validateImportScope(makePreview(), incomplete);
      expect(issues).toEqual(expect.arrayContaining([
        expect.stringContaining("требует историю событий"),
      ]));
    }
    const partial = { ...withHistory, mode: "selective" as const, include_history: false };
    expect(validateImportScope(makePreview(), partial)).toEqual([]);
  });

  it("blocks complete restoration without packaged relations and assets", () => {
    const preview = { ...makePreview(), totals: { ...makePreview().totals, assets: 1 },
      included: { ...makePreview().included, assets: 1 } } as ImportPreview;
    const incomplete = {
      ...plan, include_history: true, include_relations: false, include_assets: false,
    };
    const issues = validateImportScope(preview, incomplete);
    expect(issues).toEqual(expect.arrayContaining([
      expect.stringContaining("требует связи объектов"),
      expect.stringContaining("требует вложения"),
    ]));
  });

  it("preserves the true history flag all the way into the Kernel import plan", () => {
    // Exchange must not silently convert a complete backup import to data-only.
    const complete = { ...plan, include_history: true };
    const partial = { ...plan, include_history: false };
    expect(toKernelImportPlan(complete).include_history).toBe(true);
    expect(toKernelImportPlan(partial).include_history).toBe(false);
    expect(validateImportScope(makePreview(), complete)).toEqual([]);
    expect(validateImportScope(makePreview(), partial)).not.toEqual([]);
  });

  it("does not claim missing events when history was intentionally excluded", () => {
    const receipt = {
      cancelled: false,
      applied: { workspaces: 1, objects_inserted: 2, objects_updated: 0,
        objects_skipped: 0, events: 0, relations: 1, assets: 0,
        schemas_inserted: 2, schemas_reused: 0, schemas_rejected: 0 },
    } as ImportReceipt;
    expect(validateRestorationReceipt(makePreview(), { ...plan, include_history: false }, receipt)).toEqual([]);
  });

  it("accepts Kernel workspace identifiers containing a colon", () => {
    const issues = validateImportPlan({
      ...plan, workspace_id_map: { source: "d06:restored" },
    }, ["new-workspace"], ["source"], [], []);
    expect(issues).toEqual([]);
  });

});
