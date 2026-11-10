/**
 * tests/host-router-cross-base.test.ts — PROMPT 19 §3.
 *
 * Cross-base navigation is Host-driven; the driver receives
 * `crossBase: true` and performs a full-document navigation. Refs
 * whose staticBase is not on the reserved list are refused.
 */

import { describe, expect, it, vi } from "vitest";
import { createRouteRef } from "@/workspace-contract";
import {
  HostRouter,
  RouteRegistry,
  type HostRouteBinding,
} from "@/workspace-host/router";
import type {
  HostLocation,
  HostNavigationDriver,
  HostRouteNavigationOptions,
} from "@/workspace-host/router";

function driver(initial: HostLocation): HostNavigationDriver & {
  calls: { target: HostLocation; opts?: HostRouteNavigationOptions }[];
} {
  let loc = { ...initial };
  const calls: { target: HostLocation; opts?: HostRouteNavigationOptions }[] = [];
  const listeners = new Set<(l: HostLocation) => void>();
  return {
    current: () => loc,
    navigate(target, opts) {
      calls.push({ target: { ...target }, opts });
      // In real life a cross-base call replaces the document, but for
      // tests we simply record it and stay on the same location.
      if (!opts?.crossBase) {
        loc = { ...target };
        for (const l of listeners) l(loc);
      }
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    calls,
  };
}

const base: HostRouteBinding = {
  routeRef: createRouteRef("host.base.home"),
  ownerModuleId: "workspace-host",
  mode: "static",
  staticBase: "/workspace/",
  allowedParams: [],
  opaqueIdParams: [],
};
const exchange: HostRouteBinding = {
  routeRef: createRouteRef("host.exchange.home"),
  ownerModuleId: "workspace-host",
  mode: "static",
  staticBase: "/workspace/exchange/",
  allowedParams: [],
  opaqueIdParams: [],
};

describe("HostRouter cross-base (PROMPT 19 §3)", () => {
  it("marks navigation to a different staticBase as crossBase=true", () => {
    const registry = new RouteRegistry();
    registry.registerMany([base, exchange]);
    const d = driver({ pathname: "/workspace/", hash: "" });
    const router = new HostRouter({
      registry,
      driver: d,
      reservedStaticBases: ["/workspace/exchange/"],
    });
    router.navigate(exchange.routeRef);
    expect(d.calls.at(-1)?.opts?.crossBase).toBe(true);
    expect(d.calls.at(-1)?.target.pathname).toBe("/workspace/exchange/");
  });

  it("refuses a cross-base navigation to an unreserved static base", () => {
    const registry = new RouteRegistry();
    registry.registerMany([base, exchange]);
    const d = driver({ pathname: "/workspace/", hash: "" });
    const router = new HostRouter({ registry, driver: d });
    expect(() => router.navigate(exchange.routeRef)).toThrow(/not permitted/i);
  });

  it("passes replace flag through to the driver", () => {
    const registry = new RouteRegistry();
    registry.registerMany([base, exchange]);
    const d = driver({ pathname: "/workspace/", hash: "" });
    const spy = vi.spyOn(d, "navigate");
    const router = new HostRouter({
      registry,
      driver: d,
      reservedStaticBases: ["/workspace/exchange/"],
    });
    router.navigate(exchange.routeRef, undefined, { replace: true });
    expect(spy).toHaveBeenLastCalledWith(
      { pathname: "/workspace/exchange/", hash: "" },
      { replace: true, crossBase: true },
    );
  });
});
