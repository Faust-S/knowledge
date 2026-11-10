/** Product-first presentation policy: no new route or authority mechanism. */
import type { RouteRef } from "@/workspace-contract";
import { hostRouteRefs } from "./host-route-refs";
import type { HostLocation } from "./host-route-state";

export interface ProductFirstLandingInput {
  enabled: boolean;
  location: HostLocation;
  isActive: (ref: RouteRef) => boolean;
}

/** Only a bare Workspace URL is rewritten; explicit bookmarks are retained. */
export function resolveProductFirstLanding(input: ProductFirstLandingInput): RouteRef | null {
  if (!input.enabled || input.location.pathname !== "/workspace/" ||
      (input.location.hash !== "" && input.location.hash !== "#")) return null;
  if (input.isActive(hostRouteRefs.domain.home)) return hostRouteRefs.domain.home;
  if (input.isActive(hostRouteRefs.base.home)) return hostRouteRefs.base.home;
  return null;
}
