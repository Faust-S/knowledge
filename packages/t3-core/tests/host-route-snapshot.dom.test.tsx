// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createRouteRef } from "@/workspace-contract";
import { HostRouter } from "@/workspace-host/router/HostRouter";
import { RouteRegistry } from "@/workspace-host/router/RouteRegistry";
import { useHostRouteMatch } from "@/workspace-host/router/use-host-route-match";
import type { HostLocation } from "@/workspace-host/router/host-route-state";

const mock = vi.hoisted(() => ({ runtime: null as unknown }));
vi.mock("@/workspace-host/runtime/WorkspaceHostRuntimeProvider", () => ({
  useWorkspaceHostRuntimeHandle: () => mock.runtime,
}));
import { ModuleRouteOutlet } from "@/workspace-host/rendering/ModuleRouteOutlet";

const owner = "workspace-host";
const disposals: (() => void)[] = [];
afterEach(() => {
  cleanup();
  mock.runtime = null;
  for (const dispose of disposals.splice(0)) dispose();
  vi.restoreAllMocks();
});

function fixture(id: string, active = true) {
  const registry = new RouteRegistry();
  const ref = createRouteRef("host.test." + id);
  registry.register({
    routeRef: ref, ownerModuleId: owner, mode: "static",
    staticBase: "/workspace/", allowedParams: [], opaqueIdParams: [],
  });
  if (active) expect(registry.activateOwnerRoutes(owner, [ref]).ok).toBe(true);
  let location: HostLocation = { pathname: "/workspace/", hash: "" };
  const listeners = new Set<(l: HostLocation) => void>();
  const router = new HostRouter({
    registry, enforceActive: true,
    driver: {
      current: () => location,
      navigate(target) { location = target; for (const notify of listeners) notify(location); },
      subscribe(notify) { listeners.add(notify); return () => { listeners.delete(notify); }; },
    },
  });
  disposals.push(() => router.dispose());
  const lookups: string[] = [];
  const contribution = { loader: async () => ({
    default: () => <div data-testid="route-content">{id}</div>,
  }) };
  const runtime = {
    router, hub: { getRouteContribution(routeId: string) {
      lookups.push(routeId);
      return routeId === ref.id ? { moduleId: owner, contribution } : null;
    } },
    contextProvider: { createContext: () => ({}) },
  };
  return { router, registry, ref, runtime, lookups };
}

function Probe({ commits }: { commits: string[] }) {
  // Layout effects observe the first committed DOM BEFORE passive effects
  // can repair a stale route match. Waiting only for the final UI misses it.
  useLayoutEffect(() => {
    commits.push(screen.queryByTestId("module-route-not-found") ? "missing" :
      screen.queryByTestId("module-route-loading") ? "loading" : "ready");
  });
  return <ModuleRouteOutlet hostProfileId="generic" profileFallback={false} />;
}

it("never commits a false unavailable route when the runtime first becomes ready", async () => {
  const first = fixture("first");
  const commits: string[] = [];
  const view = render(<Probe commits={commits} />);
  expect(commits).toEqual(["loading"]);
  mock.runtime = first.runtime;
  view.rerender(<Probe commits={commits} />);
  expect(commits).not.toContain("missing");
  expect((await screen.findByTestId("route-content")).textContent).toBe("first");
});

it("does not resolve the previous router's route against a replacement runtime", async () => {
  const first = fixture("first");
  const next = fixture("next");
  mock.runtime = first.runtime;
  const commits: string[] = [];
  const view = render(<Probe commits={commits} />);
  await screen.findByTestId("route-content");
  mock.runtime = next.runtime;
  view.rerender(<Probe commits={commits} />);
  expect(commits).not.toContain("missing");
  expect(next.lookups.length).toBeGreaterThan(0);
  expect(next.lookups.every(id => id === next.ref.id)).toBe(true);
  expect(await screen.findByText("next")).toBeVisible();
});

it("preserves genuine unavailable state, activation, deactivation and runtime loss", async () => {
  const first = fixture("first", false);
  mock.runtime = first.runtime;
  const view = render(<ModuleRouteOutlet hostProfileId="generic" profileFallback={false} />);
  expect(screen.getByTestId("module-route-not-found")).toBeInTheDocument();
  act(() => { first.registry.activateOwnerRoutes(owner, [first.ref]); });
  await screen.findByTestId("route-content");
  act(() => { first.registry.deactivateOwnerRoutes(owner); });
  expect(screen.getByTestId("module-route-not-found")).toBeInTheDocument();
  mock.runtime = null;
  view.rerender(<ModuleRouteOutlet hostProfileId="generic" profileFallback={false} />);
  expect(screen.getByTestId("module-route-loading")).toBeInTheDocument();
  expect(screen.queryByTestId("module-route-not-found")).toBeNull();
});

it("rechecks a changed original snapshot when the subscription is registered", () => {
  const first = fixture("first");
  const subscribe = first.router.subscribe.bind(first.router);
  vi.spyOn(first.router, "subscribe").mockImplementation(notify => {
    first.registry.deactivateOwnerRoutes(owner);
    return subscribe(notify);
  });
  const { result } = renderHook(() => useHostRouteMatch(first.router));
  expect(result.current).toBeNull();
});

it("unsubscribes the old router and observes only the replacement", () => {
  const first = fixture("first");
  const next = fixture("next");
  const original = first.router.subscribe.bind(first.router);
  const unsubscribed = vi.fn();
  vi.spyOn(first.router, "subscribe").mockImplementation(notify => {
    const unsubscribe = original(notify);
    return () => { unsubscribe(); unsubscribed(); };
  });
  const view = renderHook(({ router }: { router: HostRouter | null }) =>
    useHostRouteMatch(router), { initialProps: { router: first.router as HostRouter | null } });
  expect(view.result.current?.binding.routeRef.id).toBe(first.ref.id);
  view.rerender({ router: next.router });
  expect(unsubscribed).toHaveBeenCalledTimes(1);
  act(() => { first.registry.deactivateOwnerRoutes(owner); });
  expect(view.result.current?.binding.routeRef.id).toBe(next.ref.id);
  act(() => { next.registry.deactivateOwnerRoutes(owner); });
  expect(view.result.current).toBeNull();
  view.rerender({ router: null });
  expect(view.result.current).toBeNull();
});
