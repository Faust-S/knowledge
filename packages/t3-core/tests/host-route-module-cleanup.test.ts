/**
 * tests/host-route-module-cleanup.test.ts — PROMPT 16 §5 removeOwner.
 */
import { describe, expect, it } from "vitest";
import { createRouteRef } from "@/workspace-contract";
import {
  RouteRegistry,
  hostRouteRefs,
  activeHostRouteBindings,
  type HostRouteBinding,
} from "@/workspace-host/router";

describe("removeOwner cleanup", () => {
  it("does not touch bindings owned by other modules", () => {
    const r = new RouteRegistry();
    r.registerMany(activeHostRouteBindings());
    const modA: HostRouteBinding = {
      routeRef: createRouteRef("mod.a.route"),
      ownerModuleId: "mod-a",
      mode: "static",
      staticBase: "/workspace/",
      allowedParams: [],
      opaqueIdParams: [],
    };
    r.register(modA);
    r.removeOwner("mod-a");
    expect(r.hasRef({ id: "mod.a.route" })).toBe(false);
    // Host bindings remain intact.
    expect(r.hasRef(hostRouteRefs.base.home)).toBe(true);
    expect(r.hasRef(hostRouteRefs.base.workspaces)).toBe(true);
  });

  it("is a no-op for unknown owner", () => {
    const r = new RouteRegistry();
    r.registerMany(activeHostRouteBindings());
    const before = r.list().length;
    r.removeOwner("does-not-exist");
    expect(r.list().length).toBe(before);
  });

  it("frees the id so it can be re-registered by a new owner", () => {
    const r = new RouteRegistry();
    const bind: HostRouteBinding = {
      routeRef: createRouteRef("shared.id"),
      ownerModuleId: "mod-a",
      mode: "static",
      staticBase: "/workspace/",
      allowedParams: [],
      opaqueIdParams: [],
    };
    r.register(bind);
    r.removeOwner("mod-a");
    expect(() =>
      r.register({ ...bind, ownerModuleId: "mod-b" }),
    ).not.toThrow();
    expect(r.get({ id: "shared.id" })?.ownerModuleId).toBe("mod-b");
  });
});
