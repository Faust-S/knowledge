/**
 * Static workspace route inventory (PROMPT 16 §11).
 *
 * The Host explicitly reserves a small, closed set of static bases under
 * `/workspace/`. Anything outside this list is REJECTED by the Host
 * Router — modules never contribute a base of their own, and there is no
 * ambient "fall-through" route.
 *
 * At this stage only `/workspace/` is ACTIVE. `exchange/` and `lifecycle/`
 * are reserved so their bindings can be registered later without ever
 * expanding the base grammar again.
 */

export const STATIC_WORKSPACE_ROUTE_BASES = [
  "/workspace/",
  "/workspace/exchange/",
  "/workspace/lifecycle/",
] as const;

export type StaticWorkspaceRouteBase =
  (typeof STATIC_WORKSPACE_ROUTE_BASES)[number];

/**
 * Bases whose `index.html` is currently built and served. `lifecycle/`
 * is intentionally excluded; the Host may add it once its module is
 * activated. `exchange/` is active as of PROMPT 21.
 */
export const ACTIVE_WORKSPACE_ROUTE_BASES: readonly StaticWorkspaceRouteBase[] = [
  "/workspace/",
  "/workspace/exchange/",
  "/workspace/lifecycle/",
];

/** Returns the subset of reserved bases that currently accept traffic. */
export function activeStaticRouteBases(): readonly StaticWorkspaceRouteBase[] {
  return ACTIVE_WORKSPACE_ROUTE_BASES;
}

export function isReservedStaticRouteBase(
  value: string,
): value is StaticWorkspaceRouteBase {
  return (STATIC_WORKSPACE_ROUTE_BASES as readonly string[]).includes(value);
}

export function isActiveStaticRouteBase(
  value: string,
): value is StaticWorkspaceRouteBase {
  return (ACTIVE_WORKSPACE_ROUTE_BASES as readonly string[]).includes(value);
}
