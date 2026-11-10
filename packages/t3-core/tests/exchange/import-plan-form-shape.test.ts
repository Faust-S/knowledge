/** §11 — INITIAL_PLAN exposes new fields as documented. */
import { describe, expect, it } from "vitest";
import { INITIAL_PLAN } from "@/modules/exchange/features/state/import-machine";

describe("ImportPlanForm shape (§11)", () => {
  it("has include_objects, workspace_id_map, target_workspace defaults", () => {
    expect(INITIAL_PLAN.include_objects).toEqual([]);
    expect(INITIAL_PLAN.workspace_id_map).toEqual({});
    expect(INITIAL_PLAN.target_workspace).toBeNull();
  });
});
