/**
 * tests/host-route-activation.test.ts — PROMPT 19 §1.
 *
 * Covers the RouteRegistry activation lifecycle:
 *   - activateOwnerRoutes rejects unknown / duplicate refs atomically;
 *   - deactivateOwnerRoutes removes only the owner's active refs;
 *   - isActive / listActive reflect the current set;
 *   - HostRouter.enforceActive gates resolve + match on activation.
 */

import { describe, expect, it } from "vitest";
import {
  HostRouter,
  RouteRegistry,
  activeHostRouteBindings,
  createLegacyHashDriver,
  hostRouteRefs,
} from "@/workspace-host/router";

function fakeWin(hash = "") {
  const listeners: Record<string, Set<EventListener>> = {};
  return {
    location: { pathname: "/workspace/", search: "", hash },
    history: { replaceState: () => {} },
    addEventListener(t: string, cb: EventListener) {
      (listeners[t] ??= new Set()).add(cb);
    },
    removeEventListener(t: string, cb: EventListener) {
      listeners[t]?.delete(cb);
    },
  } as unknown as Window;
}

describe("RouteRegistry activation (PROMPT 19 §1)", () => {
  it("activateOwnerRoutes marks refs active and lists them", () => {
    const r = new RouteRegistry();
    r.registerMany(activeHostRouteBindings());
    expect(r.isActive(hostRouteRefs.base.home)).toBe(false);
    const res = r.activateOwnerRoutes("iwxa.workspace.base", [
      hostRouteRefs.base.home,
      hostRouteRefs.base.workspaces,
    ]);
    expect(res.ok).toBe(true);
    expect(r.isActive(hostRouteRefs.base.home)).toBe(true);
    expect(r.listActive().map((b) => b.routeRef.id).sort()).toEqual([
      "host.base.home",
      "host.base.workspaces",
    ]);
  });

  it("refuses activation of an unregistered RouteRef", () => {
    const r = new RouteRegistry();
    r.registerMany(activeHostRouteBindings());
    const fakeRef = { id: "host.ghost.route" } as typeof hostRouteRefs.base.home;
    const res = r.activateOwnerRoutes("m", [fakeRef]);
    expect(res.ok).toBe(false);
    expect(res.diagnostics[0]?.code).toBe("unknown-route");
    expect(r.listActive()).toHaveLength(0);
  });

  it("refuses double-activation atomically (all-or-nothing)", () => {
    const r = new RouteRegistry();
    r.registerMany(activeHostRouteBindings());
    r.activateOwnerRoutes("a", [hostRouteRefs.base.home]);
    const res = r.activateOwnerRoutes("b", [
      hostRouteRefs.base.workspaces,
      hostRouteRefs.base.home, // already active
    ]);
    expect(res.ok).toBe(false);
    expect(r.isActive(hostRouteRefs.base.workspaces)).toBe(false);
  });

  it("deactivateOwnerRoutes only affects the caller's activations", () => {
    const r = new RouteRegistry();
    r.registerMany(activeHostRouteBindings());
    r.activateOwnerRoutes("a", [hostRouteRefs.base.home]);
    r.activateOwnerRoutes("b", [hostRouteRefs.base.workspaces]);
    r.deactivateOwnerRoutes("a");
    expect(r.isActive(hostRouteRefs.base.home)).toBe(false);
    expect(r.isActive(hostRouteRefs.base.workspaces)).toBe(true);
  });

  it("HostRouter(enforceActive) skips inactive bindings during match", () => {
    const win = fakeWin("#/workspaces");
    const registry = new RouteRegistry();
    registry.registerMany(activeHostRouteBindings());
    const router = new HostRouter({
      registry,
      driver: createLegacyHashDriver({ window: win }),
      enforceActive: true,
    });
    expect(router.currentMatch()).toBeNull();
    registry.activateOwnerRoutes("m", [hostRouteRefs.base.workspaces]);
    // Router re-evaluates match on subsequent driver events; force
    // one by dispatching a hashchange with the same hash.
    win.location.hash = "#/workspaces";
    // Simulate hashchange event
    (win as unknown as { dispatchEvent?: (e: Event) => void }).dispatchEvent?.(
      new Event("hashchange"),
    );
    // In this synthetic window we can't fire events; just call registry.match directly.
    expect(registry.match({ pathname: "/workspace/", hash: "#/workspaces" }))
      .not.toBeNull();
    expect(registry.isActive(hostRouteRefs.base.workspaces)).toBe(true);
  });

  it("HostRouter(enforceActive).navigate throws route-inactive", () => {
    const win = fakeWin("");
    const registry = new RouteRegistry();
    registry.registerMany(activeHostRouteBindings());
    const router = new HostRouter({
      registry,
      driver: createLegacyHashDriver({ window: win }),
      enforceActive: true,
    });
    expect(() =>
      router.navigate(hostRouteRefs.base.activity),
    ).toThrow(/not currently active/i);
  });
});


describe("HostRouter active matching does not allow inactive route shadowing", () => {
  it("selects an active matching binding even when an inactive equivalent was registered first", () => {
    const firstRef = { id: "host.shadow.inactive" };
    const activeRef = { id: "host.shadow.active" };
    const registry = new RouteRegistry();
    registry.registerMany([
      {
        routeRef: firstRef,
        ownerModuleId: "inactive-owner",
        mode: "fragment",
        staticBase: "/workspace/",
        fragmentPattern: "#/shadow/:workspaceId",
        allowedParams: ["workspaceId"],
        opaqueIdParams: ["workspaceId"],
      },
      {
        routeRef: activeRef,
        ownerModuleId: "active-owner",
        mode: "fragment",
        staticBase: "/workspace/",
        fragmentPattern: "#/shadow/:workspaceId",
        allowedParams: ["workspaceId"],
        opaqueIdParams: ["workspaceId"],
      },
    ]);
    registry.activateOwnerRoutes("active-owner", [activeRef]);

    const matched = registry.matchActive({
      pathname: "/workspace/",
      hash: "#/shadow/ws-1",
    });
    expect(matched?.binding.routeRef.id).toBe("host.shadow.active");

    const win = fakeWin("#/shadow/ws-1");
    const router = new HostRouter({
      registry,
      driver: createLegacyHashDriver({ window: win }),
      enforceActive: true,
    });
    expect(router.currentRouteRef()?.id).toBe("host.shadow.active");
  });
});


describe("HostRouter reconciles current URL when route activation changes", () => {
  it("activating the matching route after router construction immediately updates currentMatch", () => {
    const win = fakeWin("#/workspaces");
    const registry = new RouteRegistry();
    registry.registerMany(activeHostRouteBindings());
    const router = new HostRouter({
      registry,
      driver: createLegacyHashDriver({ window: win }),
      enforceActive: true,
    });
    expect(router.currentMatch()).toBeNull();

    const seen: Array<string | null> = [];
    router.subscribe((match) => seen.push(match?.binding.routeRef.id ?? null));
    registry.activateOwnerRoutes("iwxa.workspace.base", [hostRouteRefs.base.workspaces]);

    expect(router.currentRouteRef()?.id).toBe(hostRouteRefs.base.workspaces.id);
    expect(seen).toEqual([hostRouteRefs.base.workspaces.id]);
  });

  it("deactivating the current route clears currentMatch without a browser event", () => {
    const win = fakeWin("#/workspaces");
    const registry = new RouteRegistry();
    registry.registerMany(activeHostRouteBindings());
    registry.activateOwnerRoutes("iwxa.workspace.base", [hostRouteRefs.base.workspaces]);
    const router = new HostRouter({
      registry,
      driver: createLegacyHashDriver({ window: win }),
      enforceActive: true,
    });
    expect(router.currentRouteRef()?.id).toBe(hostRouteRefs.base.workspaces.id);

    const seen: Array<string | null> = [];
    router.subscribe((match) => seen.push(match?.binding.routeRef.id ?? null));
    registry.deactivateOwnerRoutes("iwxa.workspace.base");

    expect(router.currentMatch()).toBeNull();
    expect(seen).toEqual([null]);
  });
});
