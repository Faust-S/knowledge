/**
 * tests/module-registry-rollback.test.ts — PROMPT 15 §4/§5/§8/§9.
 */
import { describe, expect, it, vi } from "vitest";
import { ModuleRegistry } from "@/workspace-host/modules";
import { createRouteRef } from "@/workspace-contract";
import {
  buildDeclarations,
  buildRuntimeView,
  fakeContextProvider,
  makeModule,
} from "./helpers/module-registry-helpers";

describe("ModuleRegistry rollback", () => {
  it("calls deactivate() after failed contribution validation", async () => {
    const deactivate = vi.fn(async () => {});
    const registry = new ModuleRegistry();
    const snap = await registry.start({
      declarations: buildDeclarations([{ id: "m", state: "active" }]),
      loaderTable: {
        m: async () => ({
          default: makeModule("m", {
            deactivate,
            activate: () => ({
              contributions: {
                routes: [
                  {
                    kind: "route",
                    id: "dup",
                    moduleId: "m",
                    requiredOperations: [],
                    routeRef: createRouteRef("dup"),
                    loader: async () => ({ default: () => null }),
                  },
                  {
                    kind: "route",
                    id: "dup",
                    moduleId: "m",
                    requiredOperations: [],
                    routeRef: createRouteRef("dup"),
                    loader: async () => ({ default: () => null }),
                  },
                ],
              },
            }),
          }),
        }),
      },
      runtime: buildRuntimeView(),
      contextProvider: fakeContextProvider(),
    });
    expect(snap[0]?.status).toBe("contribution-invalid");
    expect(deactivate).toHaveBeenCalledTimes(1);
    expect(registry.contributions.size()).toBe(0);
  });

  it("calls best-effort deactivate() when activate() throws", async () => {
    const deactivate = vi.fn(async () => {});
    const registry = new ModuleRegistry();
    await registry.start({
      declarations: buildDeclarations([{ id: "m", state: "active" }]),
      loaderTable: {
        m: async () => ({
          default: makeModule("m", {
            deactivate,
            activate: () => {
              throw new Error("boom");
            },
          }),
        }),
      },
      runtime: buildRuntimeView(),
      contextProvider: fakeContextProvider(),
    });
    expect(deactivate).toHaveBeenCalledTimes(1);
  });

  it("treats an activate() diagnostic with severity 'error' as fatal + rollback", async () => {
    const deactivate = vi.fn(async () => {});
    const registry = new ModuleRegistry();
    const snap = await registry.start({
      declarations: buildDeclarations([{ id: "m", state: "active" }]),
      loaderTable: {
        m: async () => ({
          default: makeModule("m", {
            deactivate,
            activate: () => ({
              diagnostics: [
                { code: "boot-failed", message: "cannot boot", severity: "error" },
              ],
            }),
          }),
        }),
      },
      runtime: buildRuntimeView(),
      contextProvider: fakeContextProvider(),
    });
    expect(snap[0]?.status).toBe("activation-error");
    expect(deactivate).toHaveBeenCalledTimes(1);
  });

  it("keeps `activated` when activate() returns only warnings", async () => {
    const registry = new ModuleRegistry();
    const snap = await registry.start({
      declarations: buildDeclarations([{ id: "m", state: "active" }]),
      loaderTable: {
        m: async () => ({
          default: makeModule("m", {
            activate: () => ({
              contributions: {
                routes: [
                  {
                    kind: "route",
                    id: "m-root",
                    moduleId: "m",
                    requiredOperations: [],
                    routeRef: createRouteRef("m-root"),
                    loader: async () => ({ default: () => null }),
                  },
                ],
              },
              diagnostics: [
                { code: "info", message: "hello", severity: "warning" },
                { code: "info", message: "no severity" },
              ],
            }),
          }),
        }),
      },
      runtime: buildRuntimeView(),
      contextProvider: fakeContextProvider(),
    });
    expect(snap[0]?.status).toBe("activated");
    const codes = snap[0]!.diagnostics.map((d) => d.code);
    expect(codes.filter((c) => c === "module-reported").length).toBe(2);
  });

  it("clears started + records when start() throws unexpectedly", async () => {
    const registry = new ModuleRegistry();
    const boom: unknown = new Error("provider exploded");
    await expect(
      registry.start({
        declarations: buildDeclarations([{ id: "m", state: "active" }]),
        loaderTable: { m: async () => ({ default: makeModule("m") }) },
        runtime: buildRuntimeView(),
        contextProvider: {
          createContext: () => {
            throw boom;
          },
        },
      }),
    ).resolves.toBeDefined();
    // First path: createContext throwing is CAUGHT and turns into
    // context-invalid — that's the graceful path. The unexpected-error
    // path uses a broken provider that returns bad shape THEN we throw
    // from the store.
    // Simulate an unexpected throw by monkey-patching:
    const registry2 = new ModuleRegistry();
    const contextProvider = fakeContextProvider();
    const orig = contextProvider.createContext.bind(contextProvider);
    let firstOk = true;
    contextProvider.createContext = (id: string) => {
      if (!firstOk) throw new Error("unexpected!");
      firstOk = false;
      return orig(id);
    };
    // Force startImpl to hit an unexpected error by overriding a private
    // method via prototype: use a bad loaderTable that returns null and
    // then we make the definition rejection re-throw. Simpler: override
    // store to throw.
    const registry3 = new ModuleRegistry();
    const originalStore = registry3.contributions;
    Object.defineProperty(originalStore, "addModuleContributions", {
      value: () => {
        throw new Error("store crashed");
      },
      writable: true,
    });
    await expect(
      registry3.start({
        declarations: buildDeclarations([{ id: "m", state: "active" }]),
        loaderTable: { m: async () => ({ default: makeModule("m") }) },
        runtime: buildRuntimeView(),
        contextProvider: fakeContextProvider(),
      }),
    ).rejects.toThrow();
    expect(registry3.isStarted()).toBe(false);
    expect(registry3.snapshot()).toEqual([]);
  });
});
