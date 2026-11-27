// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import { createRouteRef } from "@/workspace-contract";
import { HostRouter } from "@/workspace-host/router/HostRouter";
import { RouteRegistry } from "@/workspace-host/router/RouteRegistry";
import { useHostRouteFocus } from "@/workspace-host/router/use-host-route-focus";
import type { HostLocation } from "@/workspace-host/router/host-route-state";
import { Breadcrumbs } from "../src/workspace-host/shell";
import { RenderWithShell, makeShell } from "./helpers/domain-shell-harness";

describe("Accessibility policy + breadcrumb flag (PROMPT 11 §8, §9)", () => {
  it("breadcrumbs render when navigation.breadcrumbs === true", () => {
    const shell = makeShell({
      navigation: {
        active_route_strategy: "longest-prefix",
        breadcrumbs: true,
        primary: [],
        utility: [],
      },
    });
    render(
      <RenderWithShell shell={shell}>
        <Breadcrumbs route={{ view: "overview" }} />
      </RenderWithShell>,
    );
    expect(screen.getByTestId("domain-breadcrumbs")).toBeInTheDocument();
  });

  it("breadcrumbs are ABSENT when navigation.breadcrumbs === false", () => {
    const shell = makeShell({
      navigation: {
        active_route_strategy: "longest-prefix",
        breadcrumbs: false,
        primary: [],
        utility: [],
      },
    });
    const { container } = render(
      <RenderWithShell shell={shell}>
        <Breadcrumbs route={{ view: "overview" }} />
      </RenderWithShell>,
    );
    expect(container.querySelector('[data-testid="domain-breadcrumbs"]')).toBeNull();
  });

  it("global stylesheet declares :focus-visible and prefers-reduced-motion rules", async () => {
    const fs = await import("node:fs");
    const css = fs.readFileSync("src/styles/a11y.css", "utf8");
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
});

it("preserves initial focus, focuses main on the first real route change, and cancels obsolete frames", () => {
  const registry = new RouteRegistry();
  const owner = "workspace-host";
  const first = createRouteRef("host.test.focus-first");
  const next = createRouteRef("host.test.focus-next");
  registry.register({ routeRef: first, ownerModuleId: owner, mode: "static",
    staticBase: "/workspace/", allowedParams: [], opaqueIdParams: [] });
  registry.register({ routeRef: next, ownerModuleId: owner, mode: "static",
    staticBase: "/workspace/exchange/", allowedParams: [], opaqueIdParams: [] });
  expect(registry.activateOwnerRoutes(owner, [first, next]).ok).toBe(true);
  let location: HostLocation = { pathname: "/workspace/", hash: "" };
  const listeners = new Set<(value: HostLocation) => void>();
  const router = new HostRouter({
    registry, enforceActive: true, reservedStaticBases: ["/workspace/exchange/"],
    driver: {
      current: () => location,
      navigate(target) { location = target; for (const notify of listeners) notify(location); },
      subscribe(notify) { listeners.add(notify); return () => { listeners.delete(notify); }; },
    },
  });
  const button = document.createElement("button");
  const main = document.createElement("main");
  main.tabIndex = -1;
  document.body.append(button, main);
  button.focus();
  const ref = { current: main };
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => {
    frames.set(++id, callback);
    return id;
  });
  const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(frame => {
    frames.delete(frame);
  });
  const view = renderHook(() => useHostRouteFocus(router, ref));
  try {
    expect(document.activeElement).toBe(button);
    expect(frames.size).toBe(0);
    act(() => router.navigate(next));
    expect(frames.size).toBe(1);
    const frame = id;
    const callback = frames.get(frame)!;
    frames.delete(frame);
    act(() => callback(performance.now()));
    expect(document.activeElement).toBe(main);
    act(() => router.navigate(next));
    expect(frames.size).toBe(0);
    act(() => router.navigate(first));
    expect(frames.size).toBe(1);
    act(() => router.navigate(next));
    expect(cancel).toHaveBeenCalledWith(id - 1);
    expect(frames.size).toBe(1);
    view.unmount();
    expect(frames.size).toBe(0);
    expect(cancel).toHaveBeenCalledWith(id);
  } finally {
    view.unmount();
    router.dispose();
    raf.mockRestore();
    cancel.mockRestore();
    button.remove();
    main.remove();
  }
});
