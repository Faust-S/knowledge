/**
 * Exchange module route contributions (PROMPT 21 §3).
 *
 * Contributes exactly one route — `exchange.home` — bound to
 * `hostRouteRefs.exchange.home` (owned by the Host). The route is
 * gated by the T2 export/import operations; if none are granted the
 * contribution is omitted entirely and the Host Router does not
 * activate the binding.
 */
import type {
  ComponentLoader,
  RouteContribution,
} from "@/workspace-contract";
import type { OperationId } from "@/kernel-client";
import { hostRouteRefs } from "@/workspace-host/router";
import { MODULE_ID } from "./module-id";

/**
 * PROMPT 22b — exchange.home is gated by ANY of the four T2 operations.
 * Previously the list only included the preview ops, so a session that
 * granted only `t2.exportPackage` (unusual but permitted by the Runtime
 * Contract) would incorrectly hide the whole surface.
 */
const REQUIRED_OPS: readonly OperationId[] = [
  "t2.exportPreview",
  "t2.exportPackage",
  "t2.confirmExport",
  "t2.importPreview",
  "t2.importCommit",
  "t2.importCancel",
];

function loader(): ComponentLoader {
  return () => import("./routes/ExchangeHomeRoute");
}

export interface ExchangeRouteSpec {
  id: string;
  routeRef: RouteContribution["routeRef"];
  requiredOperations: readonly OperationId[];
}

export const EXCHANGE_ROUTE_INVENTORY: readonly ExchangeRouteSpec[] =
  Object.freeze([
    {
      id: "exchange.home",
      routeRef: hostRouteRefs.exchange.home,
      requiredOperations: REQUIRED_OPS,
    },
  ]);

export function buildExchangeRouteContributions(
  hasOperation: (op: OperationId) => boolean,
): readonly RouteContribution[] {
  if (!REQUIRED_OPS.some(hasOperation)) {
    return Object.freeze([]);
  }

  return Object.freeze([
    {
      kind: "route",
      id: "exchange.home",
      moduleId: MODULE_ID,
      requiredOperations: Object.freeze([]),
      routeRef: hostRouteRefs.exchange.home,
      loader: loader(),
    },
  ]);
}
