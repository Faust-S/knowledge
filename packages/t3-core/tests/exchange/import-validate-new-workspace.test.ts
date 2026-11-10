/** §11 — new-workspace requires a full workspace_id_map with unique values. */
import { describe, expect, it } from "vitest";
import {
  INITIAL_PLAN, validateImportPlan,
} from "@/modules/exchange/features/state/import-machine";

describe("new-workspace validation (§11)", () => {
  it("flags missing target for each preview workspace", () => {
    const issues = validateImportPlan(
      { ...INITIAL_PLAN, mode: "new-workspace", workspace_id_map: {} },
      ["new-workspace"], ["a", "b"], [],
    );
    expect(issues.some((v) => v.includes(`"a"`))).toBe(true);
    expect(issues.some((v) => v.includes(`"b"`))).toBe(true);
  });
  it("flags duplicate target workspace_id", () => {
    const issues = validateImportPlan(
      { ...INITIAL_PLAN, mode: "new-workspace",
        workspace_id_map: { a: "x", b: "x" } },
      ["new-workspace"], ["a", "b"], [],
    );
    expect(issues.some((v) => v.includes("дважды"))).toBe(true);
  });
  it("passes when every source has a unique target", () => {
    const issues = validateImportPlan(
      { ...INITIAL_PLAN, mode: "new-workspace",
        workspace_id_map: { a: "x", b: "y" } },
      ["new-workspace"], ["a", "b"], [],
    );
    expect(issues.length).toBe(0);
  });
});
