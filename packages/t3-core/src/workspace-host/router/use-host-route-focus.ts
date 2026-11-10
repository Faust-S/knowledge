/**
 * useHostRouteFocus (PROMPT 28 §4).
 *
 * Focuses the given `<main>` element whenever the HostRouter's active
 * RouteRef changes. The initial mount does NOT steal focus. Focus is
 * scheduled inside `requestAnimationFrame` so the module's route
 * component has time to mount.
 */

import { useEffect, useRef, type RefObject } from "react";
import type { HostRouter } from "./HostRouter";

export function useHostRouteFocus(
  router: HostRouter | null,
  mainRef: RefObject<HTMLElement | null>,
): void {
  const initialRef = useRef(true);

  useEffect(() => {
    if (!router) return;
    const focusMain = () => {
      if (initialRef.current) {
        initialRef.current = false;
        return;
      }
      const el = mainRef.current;
      if (!el) return;
      const frame = window.requestAnimationFrame(() => {
        try {
          el.focus({ preventScroll: false });
        } catch {
          /* ignore */
        }
      });
      return () => window.cancelAnimationFrame(frame);
    };
    // Subscribe — only ref-id changes should refocus.
    let prevId = router.currentRouteRef()?.id ?? null;
    return router.subscribe((m) => {
      const nextId = m?.binding.routeRef.id ?? null;
      if (nextId === prevId) return;
      prevId = nextId;
      focusMain();
    });
  }, [router, mainRef]);
}
