/**
 * PROMPT 18 §10 — isolated production activation harness.
 *
 * Exercises `resolveConfiguredModules` on the canonical fixtures and
 * feeds the result into a real `ModuleRegistry`. Verifies the base
 * module activates end-to-end while planned modules are recognised
 * without being loaded.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ModuleRegistry } from "@/workspace-host/modules";
import { AVAILABLE_MODULES, composeAvailableModules, resolveConfiguredModules } from "@/composition";
import { PRODUCT_MODULE_EXTENSIONS } from "@/composition/product-module-extensions";
import {
  buildRuntimeView,
  fakeContextProvider,
} from "./helpers/module-registry-helpers";

function loadFixture(name: "generic" | "learning") {
  const path = resolve(
    __dirname,
    "..",
    "fixtures",
    "host-configs",
    name,
    "workspace.config.json",
  );
  return JSON.parse(readFileSync(path, "utf8")) as {
    modules: Record<string, unknown>[];
  };
}

describe("Production module composition", () => {
  it("accepts statically imported domain loaders while preserving config-only selection", () => {
    const domainLoader = vi.fn(async () => ({ default: {} as never }));
    const available = composeAvailableModules({
      "ru.example.sales": domainLoader,
    });
    const res = resolveConfiguredModules(
      { modules: [{ module_id: "ru.example.sales", state: "active" }] },
      available,
    );
    expect(res.loaderTable["ru.example.sales"]).toBe(domainLoader);
    expect(res.diagnostics).toEqual([]);
    expect(available["iwxa.workspace.base"]).toBe(AVAILABLE_MODULES["iwxa.workspace.base"]);
  });

  it("never permits an extension to replace a built-in loader", () => {
    expect(() => composeAvailableModules({
      "iwxa.workspace.base": async () => ({ default: {} as never }),
    })).toThrow("COMPILE_TIME_MODULE_ID_RESERVED:iwxa.workspace.base");
  });


  it("keeps the canonical Host free of bundled business domains", () => {
    expect(Object.keys(PRODUCT_MODULE_EXTENSIONS)).toEqual([]);
    expect(Object.keys(composeAvailableModules(PRODUCT_MODULE_EXTENSIONS)).sort())
      .toEqual(Object.keys(AVAILABLE_MODULES).sort());
  });

  it("resolves the generic fixture into base+exchange+lifecycle+view-state active", () => {
    const cfg = loadFixture("generic");
    const res = resolveConfiguredModules(cfg, AVAILABLE_MODULES);
    const ids = res.declarations.map((d) => d.moduleId).sort();
    expect(ids).toEqual([
      "iwxa.workspace.base",
      "iwxa.workspace.exchange",
      "iwxa.workspace.lifecycle",
      "iwxa.workspace.view-state",
    ]);
    const active = res.declarations
      .filter((d) => d.state === "active")
      .map((d) => d.moduleId)
      .sort();
    expect(active).toEqual([
      "iwxa.workspace.base",
      "iwxa.workspace.exchange",
      "iwxa.workspace.lifecycle",
      "iwxa.workspace.view-state",
    ]);
    expect(Object.keys(res.loaderTable).sort()).toEqual([
      "iwxa.workspace.base",
      "iwxa.workspace.exchange",
      "iwxa.workspace.lifecycle",
      "iwxa.workspace.view-state",
    ]);
    expect(res.diagnostics).toEqual([]);
  });

  it("end-to-end: composition → ModuleRegistry.start activates base+exchange+lifecycle+view-state", async () => {
    const cfg = loadFixture("learning");
    const res = resolveConfiguredModules(cfg, AVAILABLE_MODULES);

    const baseLoader = vi.fn(AVAILABLE_MODULES["iwxa.workspace.base"]!);
    const loaderTable = { ...res.loaderTable, "iwxa.workspace.base": baseLoader };

    const registry = new ModuleRegistry();
    const snap = await registry.start({
      declarations: [...res.declarations],
      loaderTable,
      runtime: buildRuntimeView({ contractVersion: "1.3.0" }),
      contextProvider: fakeContextProvider(),
    });

    const byId = new Map(snap.map((r) => [r.moduleId, r]));
    expect(byId.get("iwxa.workspace.base")?.status).toBe("activated");
    expect(byId.get("iwxa.workspace.exchange")?.status).toBe("activated");
    expect(byId.get("iwxa.workspace.lifecycle")?.status).toBe("activated");
    expect(byId.get("iwxa.workspace.view-state")?.status).toBe("activated");
    expect(baseLoader).toHaveBeenCalledTimes(1);
  });
});
