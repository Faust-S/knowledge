/**
 * React projection of the existing HostRouter snapshot.
 *
 * HostRouter.currentMatch() returns its cached match, and subscribe()
 * observes every subsequent change. Read the current router during render:
 * a ready replacement runtime must never render the previous router's match
 * (or a temporary null) while waiting for a passive effect.
 */
import { useCallback, useSyncExternalStore } from "react";
import type { HostRouter } from "./HostRouter";
import type { HostRouteMatch } from "./host-route-state";

export function useHostRouteMatch(router: HostRouter | null): HostRouteMatch | null {
  const subscribe = useCallback((notify: () => void) => {
    return router ? router.subscribe(notify) : () => {};
  }, [router]);
  const getSnapshot = useCallback(() => router?.currentMatch() ?? null, [router]);
  // React also rechecks the snapshot when subscribing, covering a route
  // change between the initial render and subscription registration.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
