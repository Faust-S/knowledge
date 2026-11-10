/**
 * tests/module-dependency-graph.test.ts — PROMPT 13 §4.
 */
import { describe, expect, it } from "vitest";
import { analyzeDependencies } from "@/workspace-host/modules";
import type { ModuleDeclaration } from "@/workspace-host/modules";

const decl = (
  moduleId: string,
  state: ModuleDeclaration["state"] = "active",
  dependencies: string[] = [],
): ModuleDeclaration => ({
  moduleId,
  state,
  requiredLevels: [],
  requiredOperations: [],
  dependencies,
});

describe("analyzeDependencies", () => {
  it("produces deterministic topological order (dependency-first, alpha tie-break)", () => {
    const res = analyzeDependencies([
      decl("beta", "active", ["alpha"]),
      decl("gamma", "active", ["alpha"]),
      decl("alpha"),
    ]);
    expect(res.order).toEqual(["alpha", "beta", "gamma"]);
    expect(res.failed.size).toBe(0);
  });

  it("flags a missing dependency and quarantines only the dependent", () => {
    const res = analyzeDependencies([decl("a", "active", ["missing"])]);
    expect(res.failed.has("a")).toBe(true);
    expect(res.order).not.toContain("a");
    expect(res.perModule.get("a")?.[0]?.code).toBe("missing-dependency");
  });

  it("flags a disabled or planned dependency", () => {
    const res = analyzeDependencies([
      decl("a", "active", ["b"]),
      decl("b", "disabled"),
      decl("c", "active", ["d"]),
      decl("d", "planned"),
    ]);
    expect(res.perModule.get("a")?.some((d) => d.code === "inactive-dependency")).toBe(true);
    expect(res.perModule.get("c")?.some((d) => d.code === "inactive-dependency")).toBe(true);
    expect(res.failed.has("a")).toBe(true);
    expect(res.failed.has("c")).toBe(true);
  });

  it("detects cycles and rejects every cycle participant", () => {
    const res = analyzeDependencies([
      decl("a", "active", ["b"]),
      decl("b", "active", ["c"]),
      decl("c", "active", ["a"]),
    ]);
    for (const id of ["a", "b", "c"]) {
      expect(res.failed.has(id)).toBe(true);
      expect(res.perModule.get(id)?.some((d) => d.code === "dependency-cycle")).toBe(true);
    }
    expect(res.order).toEqual([]);
  });

  it("rejects a self-dependency", () => {
    const res = analyzeDependencies([decl("solo", "active", ["solo"])]);
    expect(res.failed.has("solo")).toBe(true);
    expect(res.perModule.get("solo")?.[0]?.code).toBe("dependency-cycle");
  });

  it("reports duplicate module ids", () => {
    const res = analyzeDependencies([decl("a"), decl("a")]);
    expect(res.duplicates).toEqual(["a"]);
    expect(res.perModule.get("a")?.[0]?.code).toBe("duplicate-module-id");
  });
});
