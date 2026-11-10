import { describe, it, expect } from "vitest";
import {
  HostContributionHub,
  type RegistrationResult,
} from "@/workspace-host/registries";
import {
  RouteRegistry,
  activeHostRouteBindings,
} from "@/workspace-host/router";
import {
  createRouteRef,
  type CommandContribution,
  type NavigationContribution,
  type RouteContribution,
  type ViewerContribution,
} from "@/workspace-contract";
import { hostRouteRefs } from "@/workspace-host/router";
import { ALL_OPERATIONS } from "@/kernel-client";

function makeHub(): HostContributionHub {
  const routeRegistry = new RouteRegistry();
  routeRegistry.registerMany(activeHostRouteBindings());
  return new HostContributionHub({
    routeRegistry,
    hostRouteBindings: activeHostRouteBindings(),
    grantedOperations: [...ALL_OPERATIONS],
  });
}

const nav = (
  moduleId: string,
  id: string,
  over: Partial<NavigationContribution> = {},
): NavigationContribution => ({
  kind: "navigation",
  id,
  moduleId,
  requiredOperations: [],
  labelKey: "workspaces",
  routeRef: hostRouteRefs.base.workspaces,
  placement: "primary",
  order: 10,
  ...over,
});

const cmd = (
  moduleId: string,
  id: string,
  over: Partial<CommandContribution> = {},
): CommandContribution => ({
  kind: "command",
  id,
  moduleId,
  requiredOperations: [],
  labelKey: "cmd",
  loader: async () => ({ run: () => {} }),
  ...over,
});

const viewer = (
  moduleId: string,
  id: string,
  over: Partial<ViewerContribution> = {},
): ViewerContribution => ({
  kind: "viewer",
  id,
  moduleId,
  requiredOperations: [],
  profileId: "generic",
  schemaId: "note",
  schemaVersionRange: "1.x",
  surface: "detail",
  loader: async () => ({ default: () => null }),
  ...over,
});

describe("HostContributionHub — atomic registration", () => {
  it("registers a mixed batch atomically", () => {
    const hub = makeHub();
    const res: RegistrationResult = hub.registerModule("m1", {
      navigation: [nav("m1", "m1-nav")],
      viewers: [viewer("m1", "m1-view")],
      commands: [cmd("m1", "m1-cmd")],
    });
    expect(res.ok).toBe(true);
    expect(res.accepted.navigation).toEqual(["m1-nav"]);
    expect(hub.navigation.size()).toBe(1);
    expect(hub.viewers.size()).toBe(1);
    expect(hub.commands.size()).toBe(1);
  });

  it("rolls back accepted groups when a later group rejects", () => {
    const hub = makeHub();
    // Pre-populate a command id so the second registration collides.
    hub.registerModule("existing", { commands: [cmd("existing", "shared-id")] });

    const res = hub.registerModule("m2", {
      navigation: [nav("m2", "m2-nav")],
      viewers: [viewer("m2", "m2-view")],
      commands: [cmd("m2", "shared-id")], // duplicate id — should fail
    });
    expect(res.ok).toBe(false);
    expect(hub.navigation.has("m2-nav")).toBe(false);
    expect(hub.viewers.has("m2-view")).toBe(false);
    expect(hub.commands.contributionIdsOf("m2")).toHaveLength(0);
    // Existing module untouched.
    expect(hub.commands.has("shared-id")).toBe(true);
  });

  it("rolls back accepted route contributions when a later group rejects", () => {
    const hub = makeHub();
    hub.registerModule("existing", { navigation: [nav("existing", "n-shared")] });
    const route: RouteContribution = {
      kind: "route",
      id: "r-1",
      moduleId: "m3",
      requiredOperations: [],
      routeRef: hostRouteRefs.base.workspaces,
      loader: async () => ({ default: () => null }),
    };
    const res = hub.registerModule("m3", {
      routes: [route],
      navigation: [nav("m3", "n-shared")], // collides with existing owner
    });
    expect(res.ok).toBe(false);
    // Route ownership rolled back.
    expect(res.accepted.routes).toHaveLength(0);
  });

  it("removeModule() drops every contribution the module owns", () => {
    const hub = makeHub();
    hub.registerModule("m4", {
      navigation: [nav("m4", "m4-nav")],
      viewers: [viewer("m4", "m4-view")],
      commands: [cmd("m4", "m4-cmd")],
    });
    hub.removeModule("m4");
    expect(hub.navigation.size()).toBe(0);
    expect(hub.viewers.size()).toBe(0);
    expect(hub.commands.size()).toBe(0);
  });

  it("route contributions require Host binding", () => {
    const hub = makeHub();
    const unknownRef = createRouteRef("host.base.workspace"); // valid but require param workspaceId — still bound, OK.
    // Force unknown binding by minting a private ref.
    const orphanRef = createRouteRef("host.base.does-not-exist");
    const res = hub.registerModule("m5", {
      routes: [
        {
          kind: "route",
          id: "r-orphan",
          moduleId: "m5",
          requiredOperations: [],
          routeRef: orphanRef,
          loader: async () => ({ default: () => null }),
        },
      ],
    });
    expect(res.ok).toBe(false);
    expect(res.diagnostics.some((d) => (d as { code: string }).code === "route-binding-missing")).toBe(true);
    void unknownRef;
  });
});


describe("HostContributionHub — immutable contribution snapshots", () => {
  it("does not observe command mutation after registration", async () => {
    const hub = makeHub();
    const originalRun = () => "original";
    const contribution = cmd("m-snap", "snap-cmd", {
      loader: async () => ({ run: originalRun }),
    });
    const originalLoader = contribution.loader;
    const result = hub.registerModule("m-snap", { commands: [contribution] });
    expect(result.ok).toBe(true);

    contribution.loader = async () => ({ run: () => "mutated" });
    contribution.requiredOperations = ["t1.purgeCommit"];

    const stored = hub.commands.get("snap-cmd")!;
    expect(stored.contribution).not.toBe(contribution);
    expect(stored.contribution.loader).toBe(originalLoader);
    expect(stored.requiredOperations).toEqual([]);
    expect(Object.isFrozen(stored.contribution)).toBe(true);
    expect(Object.isFrozen(stored.contribution.requiredOperations)).toBe(true);

    const value = await hub.commands.invoke(
      "snap-cmd",
      undefined,
      [],
      () => ({}),
    );
    expect(value).toBe("original");
  });

  it("copies RouteRef identity instead of retaining a mutable module-owned object", () => {
    const hub = makeHub();
    const mutableRef = { id: hostRouteRefs.base.workspaces.id };
    const contribution = nav("m-nav-snap", "nav-snap", {
      routeRef: mutableRef,
    });
    const result = hub.registerModule("m-nav-snap", { navigation: [contribution] });
    expect(result.ok).toBe(true);

    mutableRef.id = "host.base.does-not-exist";
    const stored = hub.navigation.get("nav-snap")!;
    expect(stored.contribution.routeRef.id).toBe(hostRouteRefs.base.workspaces.id);
    expect(stored.contribution.routeRef).not.toBe(mutableRef);
    expect(Object.isFrozen(stored.contribution.routeRef)).toBe(true);
  });
});
