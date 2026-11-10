import { describe, it, expect } from "vitest";
import {
  CurrentWorkspaceStore,
  createModuleContextProvider,
} from "@/workspace-host/context";
import {
  HostContributionHub,
  type PanelsState,
  type DashboardState,
} from "@/workspace-host/registries";
import type { DiagnosticSink } from "@/workspace-host/context";
import {
  HostRouter,
  RouteRegistry,
  activeHostRouteBindings,
} from "@/workspace-host/router";
import {
  ALLOWED_MODULE_CONTEXT_KEYS,
  FORBIDDEN_MODULE_CONTEXT_KEYS,
} from "@/workspace-contract";
import type { KernelSession } from "@/kernel-client/types";

function makeSession(): KernelSession {
  const stub = () => Promise.reject(new Error("not wired"));
  return {
    granted_operations: [],
    granted_levels: ["T1"],
    t1: {
      listWorkspaces: stub,
      getWorkspace: stub,
      createWorkspace: stub,
      listObjects: stub,
      getObject: stub,
      listEventsSince: stub,
      putObject: stub,
      deleteObject: stub,
      softDeleteWorkspace: stub,
      restoreWorkspace: stub,
      purgePreview: stub,
      purgeCommit: stub,
      purgeCancel: stub,
    },
    t2: {
      exportPreview: stub,
      exportPackage: stub,
      confirmExport: stub,
      importPreview: stub,
      importCommit: stub,
      importCancel: stub,
    },
  } as unknown as KernelSession;
}

function makeProvider() {
  const session = makeSession();
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
  const store = new CurrentWorkspaceStore();
  const panelsState: PanelsState = { request: () => {} };
  const dashboardState: DashboardState = { refresh: () => {} };
  const sink: DiagnosticSink = { report: () => {} };
  const provider = createModuleContextProvider({
    session,
    router,
    hub,
    currentWorkspaceStore: store,
    termResolver: (_k, f) => f ?? "",
    panelsState,
    dashboardState,
    diagnosticsSink: sink,
  });
  return { provider, store, hub, session };
}

describe("Production ModuleContext factory", () => {
  it("exposes exactly the allow-listed keys, frozen", () => {
    const { provider } = makeProvider();
    const ctx = provider.createContext("test-module");
    const keys = Object.keys(ctx).sort();
    expect(keys).toEqual([...ALLOWED_MODULE_CONTEXT_KEYS].sort());
    expect(Object.isFrozen(ctx)).toBe(true);
  });

  it("carries no forbidden top-level keys", () => {
    const { provider } = makeProvider();
    const ctx = provider.createContext("test-module") as unknown as Record<
      string,
      unknown
    >;
    for (const k of FORBIDDEN_MODULE_CONTEXT_KEYS) {
      expect(ctx[k]).toBeUndefined();
    }
  });

  it("currentWorkspace reads live from the Host store and notifies subscribers", () => {
    const { provider, store } = makeProvider();
    const ctx = provider.createContext("m");
    const seen: (string | null)[] = [];
    const unsubscribe = ctx.currentWorkspace.subscribe((w) =>
      seen.push(w?.workspace_id ?? null),
    );
    expect(ctx.currentWorkspace.get()).toBeNull();
    store.set({ workspace_id: "ws-1" } as never);
    expect(ctx.currentWorkspace.get()).not.toBeNull();
    expect(seen).toEqual(["ws-1"]);
    unsubscribe();
  });

  it("diagnostics.report stamps the owning module id and sanitizes forbidden detail keys", () => {
    const session = makeSession();
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
    const received: {
      code: string;
      moduleId: string;
      details?: unknown;
    }[] = [];
    const provider = createModuleContextProvider({
      session,
      router,
      hub,
      currentWorkspaceStore: new CurrentWorkspaceStore(),
      termResolver: (_k, f) => f ?? "",
      panelsState: { request: () => {} },
      dashboardState: { refresh: () => {} },
      diagnosticsSink: { report: (d) => received.push(d) },
    });
    const ctx = provider.createContext("m-x");
    ctx.diagnostics.report({
      code: "test",
      message: "hi",
      details: { safe: 1, session: "leak", secrets: { k: 1 } },
    });
    expect(received).toHaveLength(1);
    expect(received[0]!.moduleId).toBe("m-x");
    const d = received[0]!.details as Record<string, unknown>;
    expect(d.safe).toBe(1);
    expect(d.session).toBeUndefined();
    expect(d.secrets).toBeUndefined();
  });
});
