/** §11 — toKernelImportPlan emits mode-specific fields only. */
import { describe, expect, it } from "vitest";
import {
  INITIAL_PLAN, toKernelImportPlan,
} from "@/modules/exchange/features/state/import-machine";

describe("toKernelImportPlan mode-specific fields (§11)", () => {
  it("selective without include_objects omits the field", () => {
    const p = toKernelImportPlan({
      ...INITIAL_PLAN, mode: "selective", include_workspaces: ["a"],
    });
    expect((p as Record<string, unknown>).include_objects).toBeUndefined();
  });
  it("selective with include_objects passes through", () => {
    const p = toKernelImportPlan({
      ...INITIAL_PLAN, mode: "selective", include_workspaces: ["a"],
      include_objects: ["a/o1"],
    });
    expect((p as Record<string, unknown>).include_objects).toEqual(["a/o1"]);
  });
  it("new-workspace emits workspace_id_map", () => {
    const p = toKernelImportPlan({
      ...INITIAL_PLAN, mode: "new-workspace",
      workspace_id_map: { a: "x" },
    });
    expect((p as Record<string, unknown>).workspace_id_map).toEqual({ a: "x" });
    expect((p as Record<string, unknown>).target_workspace).toBeUndefined();
  });
  it("merge emits target_workspace", () => {
    const p = toKernelImportPlan({
      ...INITIAL_PLAN, mode: "merge", target_workspace: "local-x",
    });
    expect((p as Record<string, unknown>).target_workspace).toBe("local-x");
    expect((p as Record<string, unknown>).workspace_id_map).toBeUndefined();
  });
});
