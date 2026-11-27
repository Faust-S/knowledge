/**
 * useHostRouteFocus (PROMPT 28 §4).
 *
 * Focuses the given `<main>` element whenever the HostRouter's active
 * RouteRef changes. The initial mount does NOT steal focus. Focus is
 * scheduled inside `requestAnimationFrame` so the module's route
 * component has time to mount.
 */

import { useEffect, type RefObject } from "react";
import type { HostRouter } from "./HostRouter";

export function useHostRouteFocus(
  router: HostRouter | null,
  mainRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!router) return;
    let frame: number | null = null;
    // Initial mount does not steal focus; a real subsequent route change does.
    let prevId = router.currentRouteRef()?.id ?? null;
    const unsubscribe = router.subscribe((m) => {
      const nextId = m?.binding.routeRef.id ?? null;
      if (nextId === prevId) return;
      prevId = nextId;
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      if (!nextId) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        mainRef.current?.focus({ preventScroll: false });
      });
    });
    return () => {
      unsubscribe();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [router, mainRef]);
}
