import { describe, expect, it } from "vitest";
import { DEFAULT_TERMINOLOGY, term } from "../src/workspace-host/shell/terminology";
import { RouteRegistry, activeHostRouteBindings, hostRouteRefs } from "../src/workspace-host/router";

describe("browser-reported Host UI regressions", () => {
  it("resolves all built-in navigation IDs to human-readable labels", () => {
    expect(DEFAULT_TERMINOLOGY["base.nav.home"]).toBe("Обзор");
    for (const id of ["base.nav.home", "base.nav.activity", "base.nav.diagnostics", "exchange.nav.home"]) {
      const label = term({}, id);
      expect(label).not.toBe(id);
      expect(label).not.toMatch(/\.nav\./);
    }
    expect(term({ "base.nav.home": "Start" }, "base.nav.home")).toBe("Start");
  });

  it("routes hashless lifecycle and exchange entries to active module landing pages", () => {
    const registry = new RouteRegistry();
    expect(registry.registerMany(activeHostRouteBindings()).ok).toBe(true);
    const refs = [hostRouteRefs.base.home, hostRouteRefs.exchange.home, hostRouteRefs.lifecycle.home];
    expect(registry.activateOwnerRoutes("test", refs).ok).toBe(true);
    expect(registry.matchActive({ pathname: "/workspace/", hash: "" })?.binding.routeRef.id)
      .toBe(hostRouteRefs.base.home.id);
    expect(registry.matchActive({ pathname: "/workspace/exchange/", hash: "" })?.binding.routeRef.id)
      .toBe(hostRouteRefs.exchange.home.id);
    expect(registry.matchActive({ pathname: "/workspace/lifecycle/", hash: "" })?.binding.routeRef.id)
      .toBe(hostRouteRefs.lifecycle.home.id);
    expect(registry.matchActive({ pathname: "/workspace/lifecycle/", hash: "#/not-found" })).toBeNull();
  });

  it("never activates a disabled module route by hashless navigation", () => {
    const registry = new RouteRegistry();
    registry.registerMany(activeHostRouteBindings());
    registry.activateOwnerRoutes("test", [hostRouteRefs.base.home]);
    expect(registry.matchActive({ pathname: "/workspace/lifecycle/", hash: "" })).toBeNull();
  });
});
