/**
 * PROMPT 32 §2 — validateImportPlan checks include_objects against the
 * preview's real object inventory and against the local workspace list
 * for new-workspace targets.
 */
import { describe, expect, it } from "vitest";
import {
  INITIAL_PLAN,
  validateImportPlan,
} from "@/modules/exchange/features/state/import-machine";

describe("import object inventory (PROMPT 32 §2)", () => {
  it("flags include_objects that are absent from the preview inventory", () => {
    const issues = validateImportPlan(
      {
        ...INITIAL_PLAN,
        mode: "selective",
        include_workspaces: ["a"],
        include_objects: ["a/o-missing"],
      },
      ["selective"],
      ["a"],
      ["a/o-real"],
    );
    expect(
      issues.some((v) => v.includes("a/o-missing") && v.includes("отсутствует")),
    ).toBe(true);
  });

  it("passes when include_objects match preview keys and the workspace is selected", () => {
    const issues = validateImportPlan(
      {
        ...INITIAL_PLAN,
        mode: "selective",
        include_workspaces: ["a"],
        include_objects: ["a/o1"],
      },
      ["selective"],
      ["a"],
      ["a/o1", "a/o2"],
    );
    expect(issues.length).toBe(0);
  });

  it("flags new-workspace targets that collide with an existing local workspace", () => {
    const issues = validateImportPlan(
      {
        ...INITIAL_PLAN,
        mode: "new-workspace",
        workspace_id_map: { src: "already-here" },
      },
      ["new-workspace"],
      ["src"],
      [],
      ["already-here"],
    );
    expect(issues.some((v) => v.includes("уже существует"))).toBe(true);
  });

  it("flags new-workspace targets with an invalid workspace_id shape", () => {
    const issues = validateImportPlan(
      {
        ...INITIAL_PLAN,
        mode: "new-workspace",
        workspace_id_map: { src: "-bad id!" },
      },
      ["new-workspace"],
      ["src"],
      [],
      [],
    );
    expect(issues.some((v) => v.includes("некорректный"))).toBe(true);
  });
});
