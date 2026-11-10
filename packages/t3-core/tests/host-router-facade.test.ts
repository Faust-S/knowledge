/**
 * tests/host-router-facade.test.ts — PROMPT 16 §8.
 */
import { describe, expect, it, vi } from "vitest";
import { createRouteRef } from "@/workspace-contract";
import {
  HostRouter,
  RouteRegistry,
  activeHostRouteBindings,
  createRouterFacade,
  hostRouteRefs,
  type HostLocation,
  type HostNavigationDriver,
} from "@/workspace-host/router";

function makeDriver(initial: HostLocation): HostNavigationDriver & {
  emit(loc: HostLocation): void;
  navigations: HostLocation[];
} {
  let loc = { ...initial };
  const listeners = new Set<(l: HostLocation) => void>();
  const nav: HostLocation[] = [];
  return {
    current: () => loc,
    navigate(target) {
      loc = { ...target };
      nav.push({ ...target });
      for (const l of listeners) l(loc);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(l) {
      loc = { ...l };
      for (const cb of listeners) cb(loc);
    },
    navigations: nav,
  };
}

function buildRouter() {
  const registry = new RouteRegistry();
  registry.registerMany(activeHostRouteBindings());
  const driver = makeDriver({ pathname: "/workspace/", hash: "" });
  const router = new HostRouter({ registry, driver });
  return { registry, driver, router, facade: createRouterFacade(router) };
}

describe("RouterFacade", () => {
  it("exposes only navigate + current", () => {
    const { facade } = buildRouter();
    expect(Object.keys(facade).sort()).toEqual(["current", "navigate"]);
  });

  it("does not expose window.location or history accessors", () => {
    const { facade } = buildRouter();
    for (const forbidden of [
      "hash",
      "history",
      "location",
      "URLSearchParams",
      "navigateHash",
      "raw",
      "driver",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(facade, forbidden)).toBe(false);
    }
  });

  it("current() returns the RouteRef, not a URL", () => {
    const { facade, driver } = buildRouter();
    driver.emit({ pathname: "/workspace/", hash: "#/workspaces" });
    expect(facade.current()).toEqual(hostRouteRefs.base.workspaces);
  });

  it("navigate(ref, params) rewrites location via the driver", () => {
    const { facade, driver } = buildRouter();
    facade.navigate(hostRouteRefs.base.workspace, { workspaceId: "ws-9" });
    expect(driver.navigations.at(-1)).toEqual({
      pathname: "/workspace/",
      hash: "#/workspace/ws-9",
    });
  });

  it("navigate() throws when given an unregistered RouteRef", () => {
    const { facade } = buildRouter();
    expect(() =>
      facade.navigate(createRouteRef("host.ghost.route")),
    ).toThrow(/not registered/i);
  });

  it("subscribers on HostRouter are called on driver changes", () => {
    const { router, driver } = buildRouter();
    const cb = vi.fn();
    router.subscribe(cb);
    driver.emit({ pathname: "/workspace/", hash: "#/activity" });
    expect(cb).toHaveBeenCalled();
    expect(router.currentRouteRef()).toEqual(hostRouteRefs.base.activity);
  });
});
