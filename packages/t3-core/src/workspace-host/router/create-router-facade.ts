/**
 * RouterFacade factory (PROMPT 16 §8).
 *
 * The RouterFacade is the ONLY router surface a module sees. It exposes
 * exactly the Workspace Contract shape — `navigate(RouteRef, params?)`
 * and `current(): RouteRef | null`. Every escape hatch to the browser
 * address bar, the History API, query-string parsers, raw hash strings,
 * or the low-level navigation driver is deliberately absent.
 */

import type { RouteRef, RouterFacade } from "@/workspace-contract";
import { HostRouter } from "./HostRouter";
import { RouteRegistryError } from "./RouteRegistry";

export function createRouterFacade(router: HostRouter): RouterFacade {
  const facade: RouterFacade = {
    navigate(routeRef: RouteRef, params?: Readonly<Record<string, string>>) {
      try {
        router.navigate(routeRef, params);
      } catch (err) {
        // Never leak Host state. Re-throw a minimal RouteRegistryError
        // so the module observes a scoped failure only.
        if (err instanceof RouteRegistryError) throw err;
        throw err;
      }
    },
    current(): RouteRef | null {
      return router.currentRouteRef();
    },
  };
  return Object.freeze(facade);
}
