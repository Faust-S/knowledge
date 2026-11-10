/** §11 — selective with include_objects must stay within selected workspaces. */
import { describe, expect, it } from "vitest";
import {
  INITIAL_PLAN, validateImportPlan,
} from "@/modules/exchange/features/state/import-machine";

describe("selective include_objects (§11)", () => {
  it("flags objects outside the selected workspaces", () => {
    const issues = validateImportPlan(
      { ...INITIAL_PLAN, mode: "selective",
        include_workspaces: ["a"], include_objects: ["b/o1"] },
      ["selective"], ["a", "b"], ["a/o0", "b/o1"],
    );
    expect(issues.some((v) => v.includes("b/o1"))).toBe(true);
  });
  it("passes when include_objects belong to selected workspaces", () => {
    const issues = validateImportPlan(
      { ...INITIAL_PLAN, mode: "selective",
        include_workspaces: ["a"], include_objects: ["a/o1", "a/o2"] },
      ["selective"], ["a", "b"], ["a/o1", "a/o2"],
    );
    expect(issues.length).toBe(0);
  });
});
