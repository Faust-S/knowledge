/**
 * Host-owned RouteRef inventory (PROMPT 16 §6).
 *
 * Every screen the Host renders is addressed by a stable opaque
 * `RouteRef` declared here. Modules import these refs by value; they
 * cannot mint their own. The associated {@link HostRouteBinding}s
 * describe URL shape — data the module never sees.
 *
 * At this stage bindings are registered ONLY for surfaces the Host
 * actually ships (`base.*`). `exchange.*` and `lifecycle.*` refs are
 * reserved for future activation and intentionally left unregistered.
 */

import { createRouteRef, type RouteRef } from "@/workspace-contract";
import type { HostRouteBinding } from "./route-binding";

export const HOST_ROUTER_OWNER_ID = "workspace-host";

export const hostRouteRefs = {
  base: {
    home: createRouteRef("host.base.home"),
    workspaces: createRouteRef("host.base.workspaces"),
    workspace: createRouteRef("host.base.workspace"),
    object: createRouteRef("host.base.object"),
    activity: createRouteRef("host.base.activity"),
    diagnostics: createRouteRef("host.base.diagnostics"),
  },
  exchange: {
    home: createRouteRef("host.exchange.home"),
  },
  // One universal, compile-time-only route for the configured domain module.
  // The Host owns the URL; the module may only contribute this opaque ref.
  domain: {
    home: createRouteRef("host.domain.home"),
  },
  lifecycle: {
    home: createRouteRef("host.lifecycle.home"),
    trash: createRouteRef("host.lifecycle.trash"),
  },
} as const;

/**
 * The subset of Host RouteRefs whose bindings are currently registered.
 * Reserved refs (`exchange.*`, `lifecycle.*`) are NOT included until the
 * corresponding modules are activated.
 */
export function activeHostRouteBindings(): readonly HostRouteBinding[] {
  const base = "/workspace/";
  const exchangeBase = "/workspace/exchange/";
  const lifecycleBase = "/workspace/lifecycle/";
  const owner = HOST_ROUTER_OWNER_ID;
  return Object.freeze([
    {
      routeRef: hostRouteRefs.base.home,
      ownerModuleId: owner,
      mode: "fragment",
      staticBase: base,
      fragmentPattern: "#/overview",
      allowedParams: [],
      opaqueIdParams: [],
    },
    {
      routeRef: hostRouteRefs.base.workspaces,
      ownerModuleId: owner,
      mode: "fragment",
      staticBase: base,
      fragmentPattern: "#/workspaces",
      allowedParams: [],
      opaqueIdParams: [],
    },
    {
      routeRef: hostRouteRefs.base.workspace,
      ownerModuleId: owner,
      mode: "fragment",
      staticBase: base,
      fragmentPattern: "#/workspace/:workspaceId",
      allowedParams: ["workspaceId"],
      opaqueIdParams: ["workspaceId"],
    },
    {
      routeRef: hostRouteRefs.base.object,
      ownerModuleId: owner,
      mode: "fragment",
      staticBase: base,
      fragmentPattern: "#/workspace/:workspaceId/object/:objectId",
      allowedParams: ["workspaceId", "objectId"],
      opaqueIdParams: ["workspaceId", "objectId"],
    },
    {
      routeRef: hostRouteRefs.base.activity,
      ownerModuleId: owner,
      mode: "fragment",
      staticBase: base,
      fragmentPattern: "#/activity",
      allowedParams: [],
      opaqueIdParams: [],
    },
    {
      routeRef: hostRouteRefs.base.diagnostics,
      ownerModuleId: owner,
      mode: "fragment",
      staticBase: base,
      fragmentPattern: "#/diagnostics",
      allowedParams: [],
      opaqueIdParams: [],
    },
    // Domain user product route. Registration and execution require an
    // explicitly configured, trusted compile-time domain module; otherwise
    // this binding has no contribution and renders the Host 404 surface.
    {
      routeRef: hostRouteRefs.domain.home,
      ownerModuleId: owner,
      mode: "fragment",
      staticBase: base,
      fragmentPattern: "#/domain",
      allowedParams: [],
      opaqueIdParams: [],
    },
    // PROMPT 21 §5 — exchange.home is bound at a distinct static base.
    // The Host router's cross-base navigation delegates to the driver
    // via `location.assign('/workspace/exchange/')` when active.
    {
      routeRef: hostRouteRefs.exchange.home,
      ownerModuleId: owner,
      mode: "fragment",
      staticBase: exchangeBase,
      fragmentPattern: "#/home",
      allowedParams: [],
      opaqueIdParams: [],
    },
    // PROMPT 24 §3, §16 — lifecycle module owns two routes under its
    // own static base. `lifecycle.trash` is the target of the legacy
    // `#/trash` redirect performed by AppShell.
    {
      routeRef: hostRouteRefs.lifecycle.home,
      ownerModuleId: owner,
      mode: "fragment",
      staticBase: lifecycleBase,
      fragmentPattern: "#/home",
      allowedParams: [],
      opaqueIdParams: [],
    },
    {
      routeRef: hostRouteRefs.lifecycle.trash,
      ownerModuleId: owner,
      mode: "fragment",
      staticBase: lifecycleBase,
      fragmentPattern: "#/trash",
      allowedParams: [],
      opaqueIdParams: [],
    },
  ] as HostRouteBinding[]);
}

/**
 * All Host RouteRefs, flat (including reserved ones). Used by static
 * checks and diagnostics inventories.
 */
export function allHostRouteRefs(): readonly RouteRef[] {
  return Object.freeze([
    hostRouteRefs.base.home,
    hostRouteRefs.base.workspaces,
    hostRouteRefs.base.workspace,
    hostRouteRefs.base.object,
    hostRouteRefs.base.activity,
    hostRouteRefs.base.diagnostics,
    hostRouteRefs.domain.home,
    hostRouteRefs.exchange.home,
    hostRouteRefs.lifecycle.home,
    hostRouteRefs.lifecycle.trash,
  ]);
}

