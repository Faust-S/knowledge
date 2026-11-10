/**
 * Lifecycle module route contributions (PROMPT 27 §14).
 *
 * Two routes bound to Host-owned RouteRefs at the `/workspace/lifecycle/`
 * static base:
 *   - `lifecycle.home`  — landing surface
 *   - `lifecycle.trash` — soft-deleted workspaces, restore, purge flow
 *
 * The routes are contributed when the session holds ANY lifecycle
 * operation (`t1.listWorkspaces` OR any of soft-delete/restore/purge
 * preview/commit/cancel). Absence of a single fine-grained op (e.g.
 * `t1.purgeCommit`) hides the specific control, not the whole module.
 */
import type {
  ComponentLoader,
  RouteContribution,
} from "@/workspace-contract";
import type { OperationId } from "@/kernel-client";
import { hostRouteRefs } from "@/workspace-host/router";
import { MODULE_ID } from "./module-id";

function loaderFor(surface: "home" | "trash"): ComponentLoader {
  switch (surface) {
    case "home":
      return () => import("./routes/LifecycleHomeRoute");
    case "trash":
      return () => import("./routes/LifecycleTrashRoute");
  }
}

/** Operations that qualify a session for the lifecycle module. */
export const LIFECYCLE_ANY_OPS: readonly OperationId[] = Object.freeze([
  "t1.listWorkspaces",
  "t1.softDeleteWorkspace",
  "t1.restoreWorkspace",
  "t1.purgePreview",
  "t1.purgeCommit",
  "t1.purgeCancel",
]);

interface LifecycleRouteSpec {
  id: string;
  routeRef: RouteContribution["routeRef"];
  /** Route surfaces if ANY of these ops is granted. */
  anyOperations: readonly OperationId[];
  surface: "home" | "trash";
}

export const LIFECYCLE_ROUTE_INVENTORY: readonly LifecycleRouteSpec[] =
  Object.freeze([
    {
      id: "lifecycle.home",
      routeRef: hostRouteRefs.lifecycle.home,
      anyOperations: LIFECYCLE_ANY_OPS,
      surface: "home",
    },
    {
      id: "lifecycle.trash",
      routeRef: hostRouteRefs.lifecycle.trash,
      anyOperations: LIFECYCLE_ANY_OPS,
      surface: "trash",
    },
  ]);

export function buildLifecycleRouteContributions(
  hasOperation: (op: OperationId) => boolean,
): readonly RouteContribution[] {
  const out: RouteContribution[] = [];
  for (const spec of LIFECYCLE_ROUTE_INVENTORY) {
    if (!spec.anyOperations.some((op) => hasOperation(op))) continue;
    out.push({
      kind: "route",
      id: spec.id,
      moduleId: MODULE_ID,
      // Reported `requiredOperations` is empty because gating is
      // ANY-of; the Host router activates the binding as long as at
      // least one qualifying op is present.
      requiredOperations: [],
      routeRef: spec.routeRef,
      loader: loaderFor(spec.surface),
    });
  }
  return Object.freeze(out);
}
