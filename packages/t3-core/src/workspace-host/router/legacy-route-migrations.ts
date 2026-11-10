/**
 * legacy-route-migrations (PROMPT 28 §6).
 *
 * Host-owned URL migrations for legacy `#/packages` and `#/trash`
 * hashes still reachable via bookmarks. Both are rewritten via the
 * HostRouter with `replace` semantics so the history stack never
 * contains a legacy entry. Runs once on mount and reacts to
 * `hashchange` — modules are never involved.
 */

import { useEffect } from "react";
import { hostRouteRefs } from "./host-route-refs";
import type { HostRouter } from "./HostRouter";

export interface LegacyRouteMigration {
  /** Static base under which the legacy hash is recognised. */
  base: string;
  /** Exact fragment to migrate (leading `#`). */
  legacyHash: string;
  /** Target RouteRef to redirect to via router.navigate(). */
  target: () => import("@/workspace-contract").RouteRef;
}

export const DEFAULT_LEGACY_ROUTE_MIGRATIONS: readonly LegacyRouteMigration[] =
  Object.freeze([
    {
      base: "/workspace/",
      legacyHash: "#/packages",
      target: () => hostRouteRefs.exchange.home,
    },
    {
      base: "/workspace/",
      legacyHash: "#/trash",
      target: () => hostRouteRefs.lifecycle.trash,
    },
  ]);

/**
 * Applies migrations against the current window location and any
 * subsequent hashchange. Silent when the location does not match any
 * legacy rule; safe when `router` is null (unmounted).
 */
export function useLegacyRouteMigrations(
  router: HostRouter | null,
  migrations: readonly LegacyRouteMigration[] = DEFAULT_LEGACY_ROUTE_MIGRATIONS,
): void {
  useEffect(() => {
    if (!router || typeof window === "undefined") return;
    const check = () => {
      const path = window.location.pathname;
      const hash = window.location.hash;
      for (const m of migrations) {
        if (path === m.base && hash === m.legacyHash) {
          try {
            router.navigate(m.target(), undefined, { replace: true });
          } catch {
            /* migration is best-effort */
          }
          return;
        }
      }
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [router, migrations]);
}
