/**
 * tests/module-registry-activation-order.test.ts — PROMPT 15 §3.
 */
import { describe, expect, it, vi } from "vitest";
import { ModuleRegistry } from "@/workspace-host/modules";
import {
  buildDeclarations,
  buildRuntimeView,
  fakeContextProvider,
  makeModule,
} from "./helpers/module-registry-helpers";

describe("ModuleRegistry activation order", () => {
  it("stops modules in reverse activation order (dependents first)", async () => {
    const events: string[] = [];
    const mk = (id: string) =>
      makeModule(id, {
        deactivate: () => {
          events.push(`deact:${id}`);
        },
      });
    const registry = new ModuleRegistry();
    await registry.start({
      declarations: buildDeclarations([
        { id: "a", state: "active" },
        { id: "b", state: "active", dependencies: ["a"] },
        { id: "c", state: "active", dependencies: ["b"] },
      ]),
      loaderTable: {
        a: async () => ({ default: mk("a") }),
        b: async () => ({ default: mk("b") }),
        c: async () => ({ default: mk("c") }),
      },
      runtime: buildRuntimeView(),
      contextProvider: fakeContextProvider(),
    });
    expect(registry.getActivationOrder()).toEqual(["a", "b", "c"]);
    await registry.stop();
    expect(events).toEqual(["deact:c", "deact:b", "deact:a"]);
  });

  it("blocks removeModule when active dependents exist", async () => {
    const registry = new ModuleRegistry();
    await registry.start({
      declarations: buildDeclarations([
        { id: "a", state: "active" },
        { id: "b", state: "active", dependencies: ["a"] },
      ]),
      loaderTable: {
        a: async () => ({ default: makeModule("a") }),
        b: async () => ({ default: makeModule("b") }),
      },
      runtime: buildRuntimeView(),
      contextProvider: fakeContextProvider(),
    });
    const diags = await registry.removeModule("a");
    expect(diags.length).toBe(1);
    expect(diags[0]?.code).toBe("active-dependents");
    // Module 'a' still activated.
    expect(registry.getStatus("a")?.status).toBe("activated");
  });

  it("cascade removal succeeds when internalCascade is set", async () => {
    const deactivate = vi.fn();
    const registry = new ModuleRegistry();
    await registry.start({
      declarations: buildDeclarations([
        { id: "a", state: "active" },
        { id: "b", state: "active", dependencies: ["a"] },
      ]),
      loaderTable: {
        a: async () => ({ default: makeModule("a", { deactivate }) }),
        b: async () => ({ default: makeModule("b") }),
      },
      runtime: buildRuntimeView(),
      contextProvider: fakeContextProvider(),
    });
    const diags = await registry.removeModule("a", { internalCascade: true });
    expect(diags).toEqual([]);
    expect(deactivate).toHaveBeenCalled();
    expect(registry.getStatus("a")).toBeNull();
  });
});
