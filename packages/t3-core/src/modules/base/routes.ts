/**
 * Base module route contributions (PROMPT 18 §3).
 *
 * The base module ONLY contributes route metadata: opaque RouteRefs
 * from `hostRouteRefs.base.*` + a lazy loader that returns a safe
 * placeholder component. The placeholder is intentionally isolated —
 * it does NOT import AppShell and is NOT wired into any legacy screen.
 *
 * UI migration (making these placeholders actually replace the current
 * AppShell rendering) is a later stage. Until then, AppShell keeps its
 * legacy direct rendering; this file simply proves the base module
 * *can* register route contributions against the Host Router.
 */

import type {
  ComponentLoader,
  RouteContribution,
} from "@/workspace-contract";
import type { OperationId } from "@/kernel-client";
import { hostRouteRefs } from "@/workspace-host/router";
import { MODULE_ID } from "./module-id";

/**
 * Real per-surface loaders — Stage D. Each Base*Route.tsx wrapper reads
 * `useBaseShellBridge()` for session/caps/callbacks and route params via
 * `useWorkspaceModuleRuntime()`. Feature views themselves are unchanged.
 */
function loaderFor(surface: string): ComponentLoader {
  switch (surface) {
    case "home":
      return () => import("./routes/BaseOverviewRoute");
    case "workspaces":
      return () => import("./routes/BaseWorkspacesRoute");
    case "workspace":
      return () => import("./routes/BaseWorkspaceRoute");
    case "object":
      return () => import("./routes/BaseObjectRoute");
    case "activity":
      return () => import("./routes/BaseActivityRoute");
    case "diagnostics":
      return () => import("./routes/BaseDiagnosticsRoute");
    default:
      return async () => ({ default: () => null });
  }
}


interface BaseRouteSpec {
  id: string;
  routeRef: RouteContribution["routeRef"];
  requiredOperations: readonly OperationId[];
  surface: string;
}

const BASE_ROUTE_SPECS: readonly BaseRouteSpec[] = Object.freeze([
  {
    id: "base.home",
    routeRef: hostRouteRefs.base.home,
    requiredOperations: [],
    surface: "home",
  },
  {
    id: "base.workspaces",
    routeRef: hostRouteRefs.base.workspaces,
    requiredOperations: ["t1.listWorkspaces"],
    surface: "workspaces",
  },
  {
    id: "base.workspace",
    routeRef: hostRouteRefs.base.workspace,
    requiredOperations: ["t1.getWorkspace"],
    surface: "workspace",
  },
  {
    id: "base.object",
    routeRef: hostRouteRefs.base.object,
    requiredOperations: ["t1.getWorkspace", "t1.getObject"],
    surface: "object",
  },
  {
    id: "base.activity",
    routeRef: hostRouteRefs.base.activity,
    requiredOperations: ["t1.listEventsSince"],
    surface: "activity",
  },
  {
    id: "base.diagnostics",
    routeRef: hostRouteRefs.base.diagnostics,
    requiredOperations: [],
    surface: "diagnostics",
  },
]);

export function buildBaseRouteContributions(
  hasOperation: (op: OperationId) => boolean,
): readonly RouteContribution[] {
  const out: RouteContribution[] = [];
  for (const spec of BASE_ROUTE_SPECS) {
    // §8 — hide contributions whose exact operations are not granted.
    // The base module itself only needs T0, so this is a per-route
    // capability gate, not a whole-module gate.
    if (spec.requiredOperations.some((op) => !hasOperation(op))) continue;
    out.push({
      kind: "route",
      id: spec.id,
      moduleId: MODULE_ID,
      requiredOperations: spec.requiredOperations,
      routeRef: spec.routeRef,
      loader: loaderFor(spec.surface),
    });
  }
  return Object.freeze(out);
}

/** Route specs exposed for tests and diagnostics — not for runtime dispatch. */
export const BASE_ROUTE_INVENTORY = BASE_ROUTE_SPECS;
