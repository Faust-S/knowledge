/**
 * createViewsFacade (PROMPT 17 §10).
 *
 * Boolean-only surface: modules can ask "is there a viewer for this?"
 * They receive NO loader, NO component, NO registry handle.
 */

import type { OperationId } from "@/kernel-client";
import type { ViewsFacade } from "@/workspace-contract";
import type { ViewerRegistry } from "../registries/ViewerRegistry";

export function createViewsFacade(
  registry: ViewerRegistry,
  grantedOperations: readonly OperationId[] = [],
  activeCapabilities: readonly string[] = [],
): ViewsFacade {
  const facade: ViewsFacade = {
    resolve(query) {
      return registry.canResolve(query, grantedOperations, activeCapabilities);
    },
  };
  return Object.freeze(facade);
}
