/**
 * PROMPT 18 §13 — base module activation semantics.
 *
 * The base module MUST activate against a full-grant runtime and
 * publish its routes and navigation without a technical status card. A restricted
 * (T0-only) runtime MUST still activate the module — capability-gated
 * contributions are simply omitted.
 */
import { describe, it, expect, vi } from "vitest";
import { ModuleRegistry } from "@/workspace-host/modules";
import { AVAILABLE_MODULES } from "@/composition";
import {
  buildDeclarations,
  buildRuntimeView,
  fakeContextProvider,
} from "./helpers/module-registry-helpers";
import baseModuleDef from "@/modules/base";
import type { ModuleContextProvider } from "@/workspace-host/modules";
import type { OperationId } from "@/kernel-client";

function fakeContextProviderWithOps(
  grantedOps: readonly OperationId[],
): ModuleContextProvider {
  const base = fakeContextProvider();
  const opSet = new Set<string>(grantedOps as readonly string[]);
  return {
    createContext(moduleId: string) {
      const ctx = base.createContext(moduleId);
      // Rebuild kernel facade so hasOperation reflects grantedOps.
      const patched = {
        ...ctx,
        kernel: {
          ...ctx.kernel,
          grantedOperations: [...grantedOps],
          hasOperation: (op: OperationId) => opSet.has(op),
        },
      };
      return Object.freeze(patched) as typeof ctx;
    },
  };
}

describe("iwxa.workspace.base — activation", () => {
  it("activates cleanly under a full-grant runtime and publishes all contributions", async () => {
    const registry = new ModuleRegistry();
    const snap = await registry.start({
      declarations: buildDeclarations([
        { id: "iwxa.workspace.base", state: "active" },
      ]),
      loaderTable: AVAILABLE_MODULES,
      runtime: buildRuntimeView(),
      contextProvider: fakeContextProvider(),
    });
    const row = snap.find((r) => r.moduleId === "iwxa.workspace.base");
    expect(row?.status).toBe("activated");
    expect(registry.contributions.listByGroup("routes")).toHaveLength(6);
    expect(registry.contributions.listByGroup("navigation")).toHaveLength(4);
    expect(registry.contributions.listByGroup("dashboard_cards")).toHaveLength(0);
  });

  it("stays activated when only T0 is granted; T1/T2-only contributions are omitted", async () => {
    const registry = new ModuleRegistry();
    const snap = await registry.start({
      declarations: buildDeclarations([
        { id: "iwxa.workspace.base", state: "active" },
      ]),
      loaderTable: AVAILABLE_MODULES,
      runtime: buildRuntimeView({
        grantedLevels: ["T0"],
        grantedOperations: [],
      }),
      contextProvider: fakeContextProviderWithOps([]),
    });
    const row = snap.find((r) => r.moduleId === "iwxa.workspace.base");
    expect(row?.status).toBe("activated");
    // Only base.home + base.diagnostics require no operation.
    const routeIds = registry.contributions
      .listByGroup("routes")
      .map((c) => c.id)
      .sort();
    expect(routeIds).toEqual(["base.diagnostics", "base.home"]);
    const navIds = registry.contributions
      .listByGroup("navigation")
      .map((c) => c.id)
      .sort();
    expect(navIds).toEqual(["base.nav.diagnostics", "base.nav.home"]);
  });

  it("activate() never calls Runtime data operations", async () => {
    // Any invocation of a t1/t2 method during activate() would throw
    // from fakeContextProvider (asyncNoop rejects). Successful start
    // is the proof.
    const provider = fakeContextProvider();
    const spy = vi.spyOn(provider, "createContext");
    const registry = new ModuleRegistry();
    const snap = await registry.start({
      declarations: buildDeclarations([
        { id: "iwxa.workspace.base", state: "active" },
      ]),
      loaderTable: AVAILABLE_MODULES,
      runtime: buildRuntimeView(),
      contextProvider: provider,
    });
    expect(snap[0]?.status).toBe("activated");
    expect(spy).toHaveBeenCalledTimes(1);
    // Verify the module is branded and exports the canonical id.
    expect(baseModuleDef.manifest.module_id).toBe("iwxa.workspace.base");
  });
});
