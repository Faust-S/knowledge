import { describe, it, expect } from "vitest";
import {
  HostContributionHub,
  NavigationRegistry,
} from "@/workspace-host/registries";
import {
  RouteRegistry,
  activeHostRouteBindings,
  hostRouteRefs,
} from "@/workspace-host/router";
import type { NavigationContribution } from "@/workspace-contract";
import { ALL_OPERATIONS } from "@/kernel-client";

function n(moduleId: string, id: string): NavigationContribution {
  return {
    kind: "navigation",
    id,
    moduleId,
    requiredOperations: [],
    labelKey: "workspaces",
    routeRef: hostRouteRefs.base.workspaces,
    placement: "primary",
    order: 10,
  };
}

describe("Registry cleanup on owner removal", () => {
  it("removeOwner drops every entry owned by the module (per-registry)", () => {
    const reg = new NavigationRegistry();
    reg.registerMany("m", [
      {
        contributionId: "a",
        ownerModuleId: "m",
        requiredOperations: [],
        contribution: n("m", "a"),
      },
      {
        contributionId: "b",
        ownerModuleId: "m",
        requiredOperations: [],
        contribution: n("m", "b"),
      },
    ]);
    reg.registerMany("other", [
      {
        contributionId: "c",
        ownerModuleId: "other",
        requiredOperations: [],
        contribution: n("other", "c"),
      },
    ]);
    expect(reg.size()).toBe(3);
    reg.removeOwner("m");
    expect(reg.size()).toBe(1);
    expect(reg.has("c")).toBe(true);
  });

  it("HostContributionHub.removeModule cleans routes and every other group", () => {
    const rr = new RouteRegistry();
    rr.registerMany(activeHostRouteBindings());
    const hub = new HostContributionHub({
      routeRegistry: rr,
      hostRouteBindings: activeHostRouteBindings(),
      grantedOperations: [...ALL_OPERATIONS],
    });
    hub.registerModule("m", {
      routes: [
        {
          kind: "route",
          id: "r1",
          moduleId: "m",
          requiredOperations: [],
          routeRef: hostRouteRefs.base.workspaces,
          loader: async () => ({ default: () => null }),
        },
      ],
      navigation: [n("m", "n1")],
      commands: [
        {
          kind: "command",
          id: "cmd1",
          moduleId: "m",
          requiredOperations: [],
          labelKey: "x",
          loader: async () => ({ run: () => {} }),
        },
      ],
    });
    expect(hub.navigation.size()).toBe(1);
    expect(hub.commands.size()).toBe(1);
    hub.removeModule("m");
    expect(hub.navigation.size()).toBe(0);
    expect(hub.commands.size()).toBe(0);
  });

  it("visibleEntries hides contributions with ungranted required ops", () => {
    const reg = new NavigationRegistry();
    reg.registerMany("m", [
      {
        contributionId: "n-open",
        ownerModuleId: "m",
        requiredOperations: [],
        contribution: n("m", "n-open"),
      },
      {
        contributionId: "n-gated",
        ownerModuleId: "m",
        requiredOperations: ["t1.putObject"],
        contribution: {
          ...n("m", "n-gated"),
          requiredOperations: ["t1.putObject"],
        },
      },
    ]);
    const visible = reg.visibleEntries([]);
    expect(visible.map((v) => v.contributionId)).toEqual(["n-open"]);
    const both = reg.visibleEntries(["t1.putObject"]);
    expect(both.map((v) => v.contributionId).sort()).toEqual([
      "n-gated",
      "n-open",
    ]);
  });

  it("visibleEntries can exclude navigation whose target route is inactive", () => {
    const reg = new NavigationRegistry();
    reg.registerMany("m", [{
      contributionId: "n-route-gated",
      ownerModuleId: "m",
      requiredOperations: [],
      contribution: n("m", "n-route-gated"),
    }]);
    expect(reg.visibleEntries([], [], () => false)).toEqual([]);
    expect(reg.visibleEntries([], [], () => true).map((entry) => entry.contributionId))
      .toEqual(["n-route-gated"]);
  });

  it("HostContributionHub.removeModule removes route lookup by routeRef id, not contribution id", () => {
    const rr = new RouteRegistry();
    rr.registerMany(activeHostRouteBindings());
    const hub = new HostContributionHub({
      routeRegistry: rr,
      hostRouteBindings: activeHostRouteBindings(),
      grantedOperations: [...ALL_OPERATIONS],
    });
    const result = hub.registerModule("route-owner", {
      routes: [{
        kind: "route",
        id: "contribution-id-differs",
        moduleId: "route-owner",
        requiredOperations: [],
        routeRef: hostRouteRefs.base.workspaces,
        loader: async () => ({ default: () => null }),
      }],
    });
    expect(result.ok).toBe(true);
    expect(hub.getRouteContribution(hostRouteRefs.base.workspaces.id)).not.toBeNull();
    expect(rr.isActive(hostRouteRefs.base.workspaces)).toBe(true);

    hub.removeModule("route-owner");

    expect(hub.getRouteContribution(hostRouteRefs.base.workspaces.id)).toBeNull();
    expect(rr.isActive(hostRouteRefs.base.workspaces)).toBe(false);
  });
});
