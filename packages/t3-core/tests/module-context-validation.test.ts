/**
 * tests/module-context-validation.test.ts — PROMPT 15 §7.
 */
import { describe, expect, it, vi } from "vitest";
import { ModuleRegistry } from "@/workspace-host/modules";
import type { WorkspaceModuleContext } from "@/workspace-contract";
import {
  buildDeclarations,
  buildRuntimeView,
  fakeContextProvider,
  makeModule,
} from "./helpers/module-registry-helpers";

describe("module context validation", () => {
  it("blocks a forbidden context key and never calls activate()", async () => {
    const activate = vi.fn();
    const base = fakeContextProvider();
    const badProvider = {
      createContext(id: string): WorkspaceModuleContext {
        const ctx = base.createContext(id) as unknown as Record<string, unknown>;
        ctx.session = { token: "leak" };
        return ctx as unknown as WorkspaceModuleContext;
      },
    };
    const registry = new ModuleRegistry();
    const snap = await registry.start({
      declarations: buildDeclarations([{ id: "m", state: "active" }]),
      loaderTable: {
        m: async () => ({ default: makeModule("m", { activate }) }),
      },
      runtime: buildRuntimeView(),
      contextProvider: badProvider,
    });
    expect(snap[0]?.status).toBe("context-invalid");
    expect(snap[0]?.diagnostics[0]?.code).toBe("context-invalid");
    expect(activate).not.toHaveBeenCalled();
  });

  it("blocks any unexpected top-level context key", async () => {
    const base = fakeContextProvider();
    const badProvider = {
      createContext(id: string): WorkspaceModuleContext {
        const ctx = base.createContext(id) as unknown as Record<string, unknown>;
        ctx.extraSurface = { hello: "world" };
        return ctx as unknown as WorkspaceModuleContext;
      },
    };
    const registry = new ModuleRegistry();
    const snap = await registry.start({
      declarations: buildDeclarations([{ id: "m", state: "active" }]),
      loaderTable: { m: async () => ({ default: makeModule("m") }) },
      runtime: buildRuntimeView(),
      contextProvider: badProvider,
    });
    expect(snap[0]?.status).toBe("context-invalid");
  });

  it("freezes the context handed to activate()", async () => {
    let seen: WorkspaceModuleContext | null = null;
    const registry = new ModuleRegistry();
    await registry.start({
      declarations: buildDeclarations([{ id: "m", state: "active" }]),
      loaderTable: {
        m: async () => ({
          default: makeModule("m", {
            activate: (ctx) => {
              seen = ctx;
            },
          }),
        }),
      },
      runtime: buildRuntimeView(),
      contextProvider: fakeContextProvider(),
    });
    expect(seen).not.toBeNull();
    expect(Object.isFrozen(seen)).toBe(true);
    expect(Object.isFrozen(seen!.kernel)).toBe(true);
    expect(Object.isFrozen(seen!.kernel.grantedOperations)).toBe(true);
    expect(Object.isFrozen(seen!.kernel.grantedLevels)).toBe(true);
  });
});
