/**
 * Lifecycle module navigation contributions (PROMPT 27 §14).
 *
 * Single utility entry pointing at `lifecycle.trash`. Surfaces when
 * ANY lifecycle op is granted so a read-only viewer still reaches the
 * trash listing.
 */
import type { NavigationContribution } from "@/workspace-contract";
import type { OperationId } from "@/kernel-client";
import { hostRouteRefs } from "@/workspace-host/router";
import { MODULE_ID } from "./module-id";
import { LIFECYCLE_ANY_OPS } from "./routes";

export interface LifecycleNavSpec {
  id: string;
  labelKey: string;
  routeRef: NavigationContribution["routeRef"];
  anyOperations: readonly OperationId[];
  placement: NavigationContribution["placement"];
  order: number;
}

export const LIFECYCLE_NAVIGATION_INVENTORY: readonly LifecycleNavSpec[] =
  Object.freeze([
    {
      id: "lifecycle.nav.trash",
      labelKey: "trash",
      routeRef: hostRouteRefs.lifecycle.trash,
      anyOperations: LIFECYCLE_ANY_OPS,
      placement: "utility",
      order: 60,
    },
  ]);

export function buildLifecycleNavigationContributions(
  hasOperation: (op: OperationId) => boolean,
): readonly NavigationContribution[] {
  const out: NavigationContribution[] = [];
  for (const spec of LIFECYCLE_NAVIGATION_INVENTORY) {
    if (!spec.anyOperations.some((op) => hasOperation(op))) continue;
    out.push({
      kind: "navigation",
      id: spec.id,
      moduleId: MODULE_ID,
      requiredOperations: [],
      labelKey: spec.labelKey,
      routeRef: spec.routeRef,
      placement: spec.placement,
      order: spec.order,
    });
  }
  return Object.freeze(out);
}
