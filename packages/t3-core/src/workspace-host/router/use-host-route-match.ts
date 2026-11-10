/**
 * useHostRouteMatch (PROMPT 28 §4/§5).
 *
 * Small React hook that subscribes to the HostRouter's `currentMatch`
 * so consumers (breadcrumbs, HostShellContent) re-render on route
 * changes without touching `window.location.hash` directly.
 */

import { useEffect, useState } from "react";
import type { HostRouter } from "./HostRouter";
import type { HostRouteMatch } from "./host-route-state";

export function useHostRouteMatch(router: HostRouter | null): HostRouteMatch | null {
  const [match, setMatch] = useState<HostRouteMatch | null>(
    router ? router.currentMatch() : null,
  );

  useEffect(() => {
    if (!router) {
      setMatch(null);
      return;
    }
    setMatch(router.currentMatch());
    return router.subscribe((m) => setMatch(m));
  }, [router]);

  return match;
}
