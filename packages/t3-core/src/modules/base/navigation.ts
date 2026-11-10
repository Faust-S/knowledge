/**
 * Base module navigation contributions (PROMPT 18 §4).
 *
 * Nav entries are declared via terminology keys + opaque RouteRefs.
 * The base module does NOT contribute Exchange / Lifecycle entries —
 * those are reserved for future modules and stay absent from the
 * shell navigation until their modules are activated.
 */

import type {
  NavigationContribution,
} from "@/workspace-contract";
import type { OperationId } from "@/kernel-client";
import { hostRouteRefs } from "@/workspace-host/router";
import { MODULE_ID } from "./module-id";

interface BaseNavSpec {
  id: string;
  labelKey: string;
  routeRef: NavigationContribution["routeRef"];
  requiredOperations: readonly OperationId[];
  placement: NavigationContribution["placement"];
  order: number;
}

const BASE_NAV_SPECS: readonly BaseNavSpec[] = Object.freeze([
  {
    id: "base.nav.home",
    labelKey: "base.nav.home",
    routeRef: hostRouteRefs.base.home,
    requiredOperations: [],
    placement: "primary",
    order: 10,
  },
  {
    id: "base.nav.workspaces",
    labelKey: "workspaces",
    routeRef: hostRouteRefs.base.workspaces,
    requiredOperations: ["t1.listWorkspaces"],
    placement: "primary",
    order: 20,
  },
  {
    id: "base.nav.activity",
    labelKey: "base.nav.activity",
    routeRef: hostRouteRefs.base.activity,
    requiredOperations: ["t1.listEventsSince"],
    placement: "primary",
    order: 30,
  },
  {
    id: "base.nav.diagnostics",
    labelKey: "base.nav.diagnostics",
    routeRef: hostRouteRefs.base.diagnostics,
    requiredOperations: [],
    placement: "utility",
    order: 50,
  },
]);

export function buildBaseNavigationContributions(
  hasOperation: (op: OperationId) => boolean,
): readonly NavigationContribution[] {
  const out: NavigationContribution[] = [];
  for (const spec of BASE_NAV_SPECS) {
    if (spec.requiredOperations.some((op) => !hasOperation(op))) continue;
    out.push({
      kind: "navigation",
      id: spec.id,
      moduleId: MODULE_ID,
      requiredOperations: spec.requiredOperations,
      labelKey: spec.labelKey,
      routeRef: spec.routeRef,
      placement: spec.placement,
      order: spec.order,
    });
  }
  return Object.freeze(out);
}

export const BASE_NAVIGATION_INVENTORY = BASE_NAV_SPECS;
