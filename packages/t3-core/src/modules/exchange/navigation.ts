/**
 * Exchange module navigation contributions (PROMPT 21 §4).
 *
 * Single "Перенос данных" entry pointing at `exchange.home`. Placement
 * is `primary` so the Domain Shell surfaces it alongside base entries.
 */
import type { NavigationContribution } from "@/workspace-contract";
import type { OperationId } from "@/kernel-client";
import { hostRouteRefs } from "@/workspace-host/router";
import { MODULE_ID } from "./module-id";

/**
 * PROMPT 22b — any T2 operation surfaces the nav entry (previously the
 * list only included the preview ops).
 */
const REQUIRED_OPS: readonly OperationId[] = [
  "t2.exportPreview",
  "t2.exportPackage",
  "t2.confirmExport",
  "t2.importPreview",
  "t2.importCommit",
  "t2.importCancel",
];

export interface ExchangeNavSpec {
  id: string;
  labelKey: string;
  routeRef: NavigationContribution["routeRef"];
  requiredOperations: readonly OperationId[];
  placement: NavigationContribution["placement"];
  order: number;
}

export const EXCHANGE_NAVIGATION_INVENTORY: readonly ExchangeNavSpec[] =
  Object.freeze([
    {
      id: "exchange.nav.home",
      labelKey: "exchange.nav.home",
      routeRef: hostRouteRefs.exchange.home,
      requiredOperations: REQUIRED_OPS,
      placement: "primary",
      order: 40,
    },
  ]);

export function buildExchangeNavigationContributions(
  hasOperation: (op: OperationId) => boolean,
): readonly NavigationContribution[] {
  if (!REQUIRED_OPS.some(hasOperation)) {
    return Object.freeze([]);
  }

  return Object.freeze([
    {
      kind: "navigation",
      id: "exchange.nav.home",
      moduleId: MODULE_ID,
      requiredOperations: Object.freeze([]),
      labelKey: "exchange.nav.home",
      routeRef: hostRouteRefs.exchange.home,
      placement: "primary",
      order: 40,
    },
  ]);
}
