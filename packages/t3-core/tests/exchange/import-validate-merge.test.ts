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
});
