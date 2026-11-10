/**
 * tests/module-definition-brand.test.ts — PROMPT 15 §6.
 */
import { describe, expect, it } from "vitest";
import { ModuleRegistry } from "@/workspace-host/modules";
import {
  defineWorkspaceModule,
  isVerifiedWorkspaceModule,
  WORKSPACE_MODULE_BRAND,
} from "@/workspace-contract";
import {
  buildDeclarations,
  buildRuntimeView,
  fakeContextProvider,
  makeManifest,
} from "./helpers/module-registry-helpers";

describe("WORKSPACE_MODULE_BRAND", () => {
  it("marks definitions returned by defineWorkspaceModule as verified", () => {
    const def = defineWorkspaceModule({
      manifest: makeManifest("branded"),
      activate: () => {},
    });
    expect(isVerifiedWorkspaceModule(def)).toBe(true);
  });

  it("rejects hand-crafted look-alike definitions", () => {
    const fake = {
      manifest: makeManifest("faked"),
      activate: () => {},
    };
    expect(isVerifiedWorkspaceModule(fake)).toBe(false);
  });

  it("the brand does not appear in Object.keys or JSON output", () => {
    const def = defineWorkspaceModule({
      manifest: makeManifest("hidden"),
      activate: () => {},
    });
    expect(Object.keys(def)).not.toContain(String(WORKSPACE_MODULE_BRAND));
    const json = JSON.stringify(def, (_k, v) =>
      typeof v === "function" ? undefined : v,
    );
    expect(json).not.toContain("workspace-module-definition");
  });

  it("ModuleRegistry blocks an unbranded definition with definition-unverified", async () => {
    const registry = new ModuleRegistry();
    const fake = {
      manifest: makeManifest("m"),
      activate: () => {},
    };
    const snap = await registry.start({
      declarations: buildDeclarations([{ id: "m", state: "active" }]),
      loaderTable: {
        m: async () =>
          ({ default: fake as never }) as { default: never },
      },
      runtime: buildRuntimeView(),
      contextProvider: fakeContextProvider(),
    });
    expect(snap[0]?.status).toBe("definition-unverified");
    expect(snap[0]?.diagnostics[0]?.code).toBe("definition-unverified");
    expect(registry.contributions.size()).toBe(0);
  });
});
