/**
 * Host route runtime state (PROMPT 16 §5, §7, §8).
 *
 * Types used by RouteRegistry.match() and by the navigation driver
 * abstraction. Modules never see any of these types.
 */

import type { HostRouteBinding } from "./route-binding";

export interface HostLocation {
  /** Same-origin pathname, e.g. `/workspace/`. Never carries a query. */
  pathname: string;
  /** Fragment including the leading `#`, or "" when none. */
  hash: string;
}

export interface HostRouteMatch {
  binding: HostRouteBinding;
  /** Decoded, safe opaque-id params in the order defined by the binding. */
  params: Readonly<Record<string, string>>;
}

export interface HostRouteNavigationOptions {
  /** When true, replace the current entry instead of pushing a new one. */
  replace?: boolean;
  /**
   * When true, the target pathname differs from the current shell base
   * and the driver must perform a full document navigation. Host-owned
   * — never surfaced through the RouterFacade.
   */
  crossBase?: boolean;
}

/**
 * Low-level navigation driver. Only the Host may hold a reference.
 * The Legacy Hash Driver (§7) implements this against
 * `window.location.hash`.
 */
export interface HostNavigationDriver {
  current(): HostLocation;
  navigate(target: HostLocation, opts?: HostRouteNavigationOptions): void;
  subscribe(listener: (loc: HostLocation) => void): () => void;
}
