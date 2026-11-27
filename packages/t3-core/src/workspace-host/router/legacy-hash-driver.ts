/**
 * Legacy hash navigation driver (PROMPT 16 §7).
 *
 * Bridges the new HostRouter to the existing `window.location.hash`
 * seam that today drives `src/shell/routing.ts` and `useHashRoute`.
 * The bridge is Host-internal: it is NEVER handed to a module and is
 * NEVER exposed through the RouterFacade.
 */

import type {
  HostLocation,
  HostNavigationDriver,
  HostRouteNavigationOptions,
} from "./host-route-state";

export interface LegacyHashDriverOptions {
  /** Injectable window for unit tests. Defaults to `globalThis.window`. */
  readonly window?: Window | null;
}

export function createLegacyHashDriver(
  options: LegacyHashDriverOptions = {},
): HostNavigationDriver {
  const win = options.window === undefined
    ? (typeof window !== "undefined" ? window : null)
    : options.window;

  const read = (): HostLocation => {
    if (!win) return { pathname: "/workspace/", hash: "" };
    return {
      pathname: win.location.pathname,
      hash: win.location.hash ?? "",
    };
  };

  const listeners = new Set<(loc: HostLocation) => void>();
  const emit = () => {
    const loc = read();
    for (const l of listeners) l(loc);
  };

  return {
    current: read,
    navigate(target: HostLocation, opts?: HostRouteNavigationOptions) {
      if (!win) return;
      if (opts?.crossBase) {
        // Defence-in-depth: only allow cross-base to same-origin paths
        // under the workspace surface.
        if (!target.pathname.startsWith("/workspace/")) return;
        const url = `${target.pathname}${target.hash ?? ""}`;
        if (opts.replace) {
          try { win.location.replace(url); } catch { /* ignore */ }
        } else {
          try { win.location.assign(url); } catch { /* ignore */ }
        }
        return;
      }
      const currentHash = win.location.hash ?? "";
      if (target.hash === currentHash) return;
      if (opts?.replace && typeof win.history?.replaceState === "function") {
        const url = `${win.location.pathname}${win.location.search}${target.hash}`;
        win.history.replaceState(null, "", url);
        emit();
        return;
      }
      win.location.hash = target.hash;
      emit();
    },
    subscribe(listener) {
      if (listeners.size === 0 && win) {
        win.addEventListener("hashchange", emit);
        win.addEventListener("popstate", emit);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && win) {
          win.removeEventListener("hashchange", emit);
          win.removeEventListener("popstate", emit);
        }
      };
    },
  };
}
