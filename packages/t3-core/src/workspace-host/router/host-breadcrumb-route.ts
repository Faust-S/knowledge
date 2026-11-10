/**
 * host-breadcrumb-route (PROMPT 28 §5).
 *
 * Pure mapper: converts the HostRouter's currently-matched route into
 * the shape `Breadcrumbs` consumes. Host owns this — modules do not
 * see or depend on the breadcrumb shape.
 */

import type { BreadcrumbsHostRoute } from "../shell";
import type { HostRouteMatch } from "./host-route-state";

export function hostRouteMatchToBreadcrumbRoute(
  match: HostRouteMatch | null,
): BreadcrumbsHostRoute {
  if (!match) return { view: "overview", workspaceId: null, objectId: null };
  const id = match.binding.routeRef.id;
  const params = match.params;
  switch (id) {
    case "host.base.home":
    case "host.base.diagnostics":
      return { view: "overview", workspaceId: null, objectId: null };
    case "host.base.workspaces":
      return { view: "workspaces", workspaceId: null, objectId: null };
    case "host.base.workspace":
      return {
        view: "workspace",
        workspaceId: params?.workspaceId ?? null,
        objectId: null,
      };
    case "host.base.object":
      return {
        view: "object",
        workspaceId: params?.workspaceId ?? null,
        objectId: params?.objectId ?? null,
      };
    case "host.base.activity":
      return { view: "activity", workspaceId: null, objectId: null };
    case "host.exchange.home":
    case "host.lifecycle.home":
    case "host.lifecycle.trash":
      return { view: "packages", workspaceId: null, objectId: null };
    default:
      return { view: "overview", workspaceId: null, objectId: null };
  }
}
