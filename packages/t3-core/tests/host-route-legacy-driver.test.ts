/**
 * tests/host-route-legacy-driver.test.ts — PROMPT 16 §7.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createLegacyHashDriver,
  createRouterFacade,
  HostRouter,
  RouteRegistry,
  activeHostRouteBindings,
  hostRouteRefs,
} from "@/workspace-host/router";
import { WORKSPACE_MODULE_BRAND } from "@/workspace-contract";
import type { WorkspaceModuleContext } from "@/workspace-contract";

function fakeWindow(initialHash = ""): Window & {
  __listeners: Record<string, Set<EventListener>>;
} {
  const listeners: Record<string, Set<EventListener>> = {};
  const w = {
    location: {
      pathname: "/workspace/",
      search: "",
      hash: initialHash,
    },
    history: {
      replaceState: vi.fn(),
    },
    addEventListener(type: string, cb: EventListener) {
      (listeners[type] ??= new Set()).add(cb);
    },
    removeEventListener(type: string, cb: EventListener) {
      listeners[type]?.delete(cb);
    },
    __listeners: listeners,
  } as unknown as Window & { __listeners: Record<string, Set<EventListener>> };
  return w;
}

describe("legacy hash driver", () => {
  it("reads window.location.hash and pathname", () => {
    const win = fakeWindow("#/activity");
    const driver = createLegacyHashDriver({ window: win });
    expect(driver.current()).toEqual({ pathname: "/workspace/", hash: "#/activity" });
  });

  it("navigate() writes to window.location.hash", () => {
    const win = fakeWindow("");
    const driver = createLegacyHashDriver({ window: win });
    driver.navigate({ pathname: "/workspace/", hash: "#/workspaces" });
    expect(win.location.hash).toBe("#/workspaces");
  });

  it("navigate({replace:true}) uses history.replaceState", () => {
    const win = fakeWindow("#/overview");
    const driver = createLegacyHashDriver({ window: win });
    driver.navigate(
      { pathname: "/workspace/", hash: "#/workspaces" },
      { replace: true },
    );
    expect(win.history.replaceState).toHaveBeenCalled();
    expect(win.location.hash).toBe("#/overview"); // replaceState mock does not mutate
  });

  it("subscribers fire on hashchange events", () => {
    const win = fakeWindow("");
    const driver = createLegacyHashDriver({ window: win });
    const cb = vi.fn();
    driver.subscribe(cb);
    win.location.hash = "#/activity";
    for (const l of win.__listeners["hashchange"] ?? []) l(new Event("hashchange"));
    expect(cb).toHaveBeenCalled();
  });

  it("HostRouter picks up hash changes through the driver", () => {
    const win = fakeWindow("");
    const driver = createLegacyHashDriver({ window: win });
    const registry = new RouteRegistry();
    registry.registerMany(activeHostRouteBindings());
    const router = new HostRouter({ registry, driver });
    win.location.hash = "#/workspace/ws-1";
    for (const l of win.__listeners["hashchange"] ?? []) l(new Event("hashchange"));
    expect(router.currentRouteRef()).toEqual(hostRouteRefs.base.workspace);
    expect(router.currentMatch()?.params.workspaceId).toBe("ws-1");
  });

  it("legacy driver is NOT exposed through the RouterFacade or module context", () => {
    const win = fakeWindow("");
    const driver = createLegacyHashDriver({ window: win });
    const registry = new RouteRegistry();
    registry.registerMany(activeHostRouteBindings());
    const router = new HostRouter({ registry, driver });
    const facade = createRouterFacade(router);
    // Facade must be exactly { navigate, current }.
    expect(Object.keys(facade).sort()).toEqual(["current", "navigate"]);
    for (const forbidden of ["driver", "legacy", "hash", "history", "window"]) {
      expect(Object.prototype.hasOwnProperty.call(facade, forbidden)).toBe(false);
    }
    // Ensure it fits the WorkspaceModuleContext.router shape without leaking.
    const ctx: Partial<WorkspaceModuleContext> = { router: facade };
    for (const forbidden of ["driver", "hash", "history"]) {
      expect(
        Object.prototype.hasOwnProperty.call(ctx.router!, forbidden),
      ).toBe(false);
    }
    // Sanity: brand symbol exists (used elsewhere) — not exposed on facade.
    expect(
      Object.prototype.hasOwnProperty.call(facade, WORKSPACE_MODULE_BRAND),
    ).toBe(false);
  });
});
