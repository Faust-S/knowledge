import { describe, it, expect } from "vitest";
import {
  CurrentWorkspaceStore,
  createModuleContextProvider,
} from "@/workspace-host/context";
import { HostContributionHub } from "@/workspace-host/registries";
import {
  HostRouter,
  RouteRegistry,
  activeHostRouteBindings,
} from "@/workspace-host/router";
import type { KernelSession } from "@/kernel-client/types";

function baseInputs() {
  const session = {
    granted_operations: [],
    granted_levels: [],
    t1: {} as never,
    t2: {} as never,
  } as unknown as KernelSession;
  const routeRegistry = new RouteRegistry();
  routeRegistry.registerMany(activeHostRouteBindings());
  const router = new HostRouter({
    registry: routeRegistry,
    driver: {
      current: () => ({ pathname: "/workspace/", hash: "" }),
      navigate: () => {},
      subscribe: () => () => {},
    },
  });
  const hub = new HostContributionHub({
    routeRegistry,
    hostRouteBindings: activeHostRouteBindings(),
    grantedOperations: [],
  });
  return {
    session,
    router,
    hub,
    currentWorkspaceStore: new CurrentWorkspaceStore(),
    termResolver: (_k: string, f?: string) => f ?? "",
    panelsState: { request: () => {} },
    dashboardState: { refresh: () => {} },
    diagnosticsSink: { report: () => {} },
  };
}

describe("Production ModuleContext isolation", () => {
  it("does not expose registries or the raw session anywhere on the context", () => {
    const provider = createModuleContextProvider(baseInputs());
    const ctx = provider.createContext("m1") as unknown as Record<string, unknown>;
    for (const value of Object.values(ctx)) {
      expect(value).not.toHaveProperty("session");
      expect(value).not.toHaveProperty("adapter");
      expect(value).not.toHaveProperty("hub");
      expect(value).not.toHaveProperty("registry");
    }
  });

  it("router facade exposes only navigate/current", () => {
    const provider = createModuleContextProvider(baseInputs());
    const ctx = provider.createContext("m1");
    expect(Object.keys(ctx.router).sort()).toEqual(["current", "navigate"]);
    expect(Object.isFrozen(ctx.router)).toBe(true);
  });

  it("panels/dashboard facades no-op when contribution id is unknown", () => {
    const inputs = baseInputs();
    let panelCalls = 0;
    let dashboardCalls = 0;
    inputs.panelsState = { request: () => panelCalls++ };
    inputs.dashboardState = { refresh: () => dashboardCalls++ };
    const provider = createModuleContextProvider(inputs);
    const ctx = provider.createContext("m1");
    ctx.panels.open("does-not-exist");
    ctx.panels.close("does-not-exist");
    ctx.dashboard.refresh("does-not-exist");
    expect(panelCalls).toBe(0);
    expect(dashboardCalls).toBe(0);
  });

  it("views facade is boolean-only — no loader escape", () => {
    const provider = createModuleContextProvider(baseInputs());
    const ctx = provider.createContext("m1");
    expect(Object.keys(ctx.views)).toEqual(["resolve"]);
    const r = ctx.views.resolve({
      profileId: "generic",
      schemaId: "note",
      schemaVersion: "1.0.0",
      surface: "detail",
    });
    expect(typeof r).toBe("boolean");
  });

  it("currentWorkspace lives only in memory — creating a fresh store yields null", () => {
    const provider = createModuleContextProvider(baseInputs());
    const ctx = provider.createContext("m1");
    expect(ctx.currentWorkspace.get()).toBeNull();
  });
});
