import { describe, expect, it, vi } from "vitest";
import { HostPanelsState, createPanelsFacade } from "../src/workspace-host/context/create-panels-facade";
import { PanelRegistry } from "../src/workspace-host/registries/PanelRegistry";
import type { PanelContribution } from "../src/workspace-contract";

const makePanel = (id: string, ops: readonly ("t1.getWorkspace")[] = []): PanelContribution => ({
  id, moduleId: "fixture.panel", kind: "panel", slot: "inspector",
  requiredOperations: ops,
  loader: async () => ({ default: () => null }),
});

describe("Host panel state and scoped facade", () => {
  it("opens, closes, deduplicates and notifies subscribers", () => {
    const state = new HostPanelsState();
    const listener = vi.fn();
    const unsubscribe = state.subscribe(listener);
    state.request("test", "open");
    state.request("test", "open");
    expect(state.openIds()).toEqual(["test"]);
    expect(listener).toHaveBeenCalledTimes(1);
    state.request("test", "close");
    expect(state.openIds()).toEqual([]);
    unsubscribe();
    state.request("other", "open");
    expect(listener).toHaveBeenCalledTimes(2);
    state.clear();
    expect(state.openIds()).toEqual([]);
  });

  it("cannot open unknown or operation-denied panels", () => {
    const registry = new PanelRegistry();
    const state = new HostPanelsState();
    const contribution = makePanel("allowed", ["t1.getWorkspace"]);
    expect(registry.registerMany("fixture.panel", [{
      contributionId: contribution.id,
      ownerModuleId: contribution.moduleId,
      requiredOperations: contribution.requiredOperations,
      contribution,
    }]).ok).toBe(true);
    const noGrant = createPanelsFacade({ registry, state, grantedOperations: [] });
    noGrant.open("allowed");
    noGrant.open("missing");
    expect(state.openIds()).toEqual([]);
    const authorized = createPanelsFacade({
      registry, state, grantedOperations: ["t1.getWorkspace"],
    });
    authorized.open("allowed");
    expect(state.openIds()).toEqual(["allowed"]);
    authorized.close("allowed");
    expect(state.openIds()).toEqual([]);
  });
});
