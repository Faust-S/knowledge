/**
 * tests/module-deactivation.test.ts — PROMPT 13 §8.
 */
import { describe, expect, it, vi } from "vitest";
import { ModuleRegistry } from "@/workspace-host/modules";
import { buildDeclarations, buildRuntimeView, fakeContextProvider, makeModule } from "./helpers/module-registry-helpers";

describe("ModuleRegistry deactivation", () => {
  it("calls deactivate() on stop and removes contributions", async () => {
    const deactivate = vi.fn(async () => {});
    const registry = new ModuleRegistry();
    await registry.start({
      declarations: buildDeclarations([{ id: "m", state: "active" }]),
      loaderTable: { m: async () => ({ default: makeModule("m", { deactivate }) }) },
      runtime: buildRuntimeView(),
      contextProvider: fakeContextProvider(),
    });
    expect(registry.contributions.size()).toBeGreaterThan(0);
    await registry.stop();
    expect(deactivate).toHaveBeenCalledTimes(1);
    expect(registry.contributions.size()).toBe(0);
  });

  it("isolates a throwing deactivate but still removes contributions", async () => {
    const registry = new ModuleRegistry();
    await registry.start({
      declarations: buildDeclarations([{ id: "m", state: "active" }]),
      loaderTable: {
        m: async () =>
          ({
            default: makeModule("m", {
              deactivate: () => {
                throw new Error("boom");
              },
            }),
          }),
      },
      runtime: buildRuntimeView(),
      contextProvider: fakeContextProvider(),
    });
    const diags = await registry.stop();
    expect(diags.some((d) => d.code === "deactivation-error")).toBe(true);
    expect(registry.contributions.size()).toBe(0);
  });
});
