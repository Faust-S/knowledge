/**
 * tests/module-dependency-runtime-failure.test.ts — PROMPT 15 §1/§2.
 */
import { describe, expect, it, vi } from "vitest";
import { ModuleRegistry } from "@/workspace-host/modules";
import {
  buildDeclarations,
  buildRuntimeView,
  fakeContextProvider,
  makeModule,
} from "./helpers/module-registry-helpers";

describe("dependency runtime failures", () => {
  it("propagates static dependency failure transitively (A→B→C)", async () => {
    const registry = new ModuleRegistry();
    const snap = await registry.start({
      declarations: buildDeclarations([
        { id: "a", state: "active", dependencies: ["missing"] },
        { id: "b", state: "active", dependencies: ["a"] },
        { id: "c", state: "active", dependencies: ["b"] },
      ]),
      loaderTable: {
        a: async () => ({ default: makeModule("a") }),
        b: async () => ({ default: makeModule("b") }),
        c: async () => ({ default: makeModule("c") }),
      },
      runtime: buildRuntimeView(),
      contextProvider: fakeContextProvider(),
    });
    const byId = new Map(snap.map((r) => [r.moduleId, r]));
    expect(byId.get("a")?.status).toBe("dependency-error");
    expect(byId.get("b")?.status).toBe("dependency-error");
    expect(byId.get("c")?.status).toBe("dependency-error");
    const cDiags = byId.get("c")!.diagnostics.map((d) => d.code);
    expect(cDiags).toContain("dependency-unavailable");
  });

  it("dependent loader is not invoked when dependency activate() fails", async () => {
    const depLoader = vi.fn();
    const registry = new ModuleRegistry();
    const snap = await registry.start({
      declarations: buildDeclarations([
        { id: "bad", state: "active" },
        { id: "dep", state: "active", dependencies: ["bad"] },
      ]),
      loaderTable: {
        bad: async () => ({
          default: makeModule("bad", {
            activate: () => {
              throw new Error("boom");
            },
          }),
        }),
        dep: async () => {
          depLoader();
          return { default: makeModule("dep") };
        },
      },
      runtime: buildRuntimeView(),
      contextProvider: fakeContextProvider(),
    });
    expect(depLoader).not.toHaveBeenCalled();
    const byId = new Map(snap.map((r) => [r.moduleId, r]));
    expect(byId.get("bad")?.status).toBe("activation-error");
    expect(byId.get("dep")?.status).toBe("dependency-error");
  });

  it("dependent loader is not invoked when dependency loader fails", async () => {
    const depLoader = vi.fn();
    const registry = new ModuleRegistry();
    const snap = await registry.start({
      declarations: buildDeclarations([
        { id: "bad", state: "active" },
        { id: "dep", state: "active", dependencies: ["bad"] },
      ]),
      loaderTable: {
        bad: async () => {
          throw new Error("import failure");
        },
        dep: async () => {
          depLoader();
          return { default: makeModule("dep") };
        },
      },
      runtime: buildRuntimeView(),
      contextProvider: fakeContextProvider(),
    });
    expect(depLoader).not.toHaveBeenCalled();
    const byId = new Map(snap.map((r) => [r.moduleId, r]));
    expect(byId.get("bad")?.status).toBe("loader-failed");
    expect(byId.get("dep")?.status).toBe("dependency-error");
  });
});
