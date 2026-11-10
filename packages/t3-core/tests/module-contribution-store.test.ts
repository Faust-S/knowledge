/**
 * tests/module-contribution-store.test.ts — PROMPT 13 §7.
 */
import { describe, expect, it } from "vitest";
import { ContributionStore } from "@/workspace-host/modules";
import type { AnyContribution, ContributionGroup } from "@/workspace-contract";
import { createRouteRef } from "@/workspace-contract";

const routeContrib = (moduleId: string, id: string): AnyContribution => ({
  kind: "route",
  id,
  moduleId,
  requiredOperations: [],
  routeRef: createRouteRef(id),
  loader: async () => ({ default: () => null }),
});

const asEntry = (c: AnyContribution) => ({ group: "routes" as ContributionGroup, contribution: c });

describe("ContributionStore", () => {
  it("adds a clean batch and lists it by group", () => {
    const store = new ContributionStore();
    const r = store.addModuleContributions("m1", [asEntry(routeContrib("m1", "a"))]);
    expect(r.ok).toBe(true);
    expect(store.listByGroup("routes").map((c) => c.id)).toEqual(["a"]);
    expect(store.findById("routes", "a")?.moduleId).toBe("m1");
  });

  it("rejects a batch containing a duplicate id and writes nothing", () => {
    const store = new ContributionStore();
    const r = store.addModuleContributions("m1", [
      asEntry(routeContrib("m1", "dup")),
      asEntry(routeContrib("m1", "dup")),
    ]);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]?.code).toBe("duplicate-contribution-id");
    expect(store.size()).toBe(0);
  });

  it("rejects mismatched owner id", () => {
    const store = new ContributionStore();
    const r = store.addModuleContributions("m1", [asEntry(routeContrib("other", "x"))]);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]?.code).toBe("contribution-invalid");
    expect(store.size()).toBe(0);
  });

  it("rejects a duplicate across modules", () => {
    const store = new ContributionStore();
    store.addModuleContributions("m1", [asEntry(routeContrib("m1", "x"))]);
    const r = store.addModuleContributions("m2", [asEntry(routeContrib("m2", "x"))]);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]?.code).toBe("duplicate-contribution-id");
    expect(store.findById("routes", "x")?.moduleId).toBe("m1");
  });

  it("removes contributions per owner without touching peers", () => {
    const store = new ContributionStore();
    store.addModuleContributions("m1", [asEntry(routeContrib("m1", "a"))]);
    store.addModuleContributions("m2", [asEntry(routeContrib("m2", "b"))]);
    store.removeModuleContributions("m1");
    expect(store.findById("routes", "a")).toBeNull();
    expect(store.findById("routes", "b")?.moduleId).toBe("m2");
  });
});
