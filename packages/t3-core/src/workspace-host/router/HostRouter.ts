/**
 * HostRouter — the runtime seam between the RouteRegistry and a
 * navigation driver.
 *
 * PROMPT 16 §5 + §8, extended in PROMPT 19 §3 to support cross-base
 * navigation (Exchange / Lifecycle) and PROMPT 19 §1 activation
 * gating (only refs marked active in the registry are resolvable /
 * matchable when `enforceActive` is on).
 */

import type { RouteRef } from "@/workspace-contract";
import { RouteRegistry, RouteRegistryError } from "./RouteRegistry";
import type {
  HostLocation,
  HostNavigationDriver,
  HostRouteMatch,
  HostRouteNavigationOptions,
} from "./host-route-state";

export interface HostRouterOptions {
  registry: RouteRegistry;
  driver: HostNavigationDriver;
  /**
   * Reserved static bases the Host is willing to hand to the driver
   * for cross-base navigation. Defaults to `[driver.current().pathname]`
   * which effectively disables cross-base until the caller opts in.
   */
  reservedStaticBases?: readonly string[];
  /**
   * When true, `resolve()` refuses inactive refs and `match()` skips
   * inactive bindings. Default: false (back-compat with existing
   * consumers that never called activateOwnerRoutes).
   */
  enforceActive?: boolean;
}

export class HostRouter {
  readonly registry: RouteRegistry;
  private readonly driver: HostNavigationDriver;
  private readonly reservedStaticBases: ReadonlySet<string>;
  private readonly enforceActive: boolean;
  private lastMatch: HostRouteMatch | null;
  private lastDeclaredMatch: HostRouteMatch | null;
  private disposed = false;
  private readonly listeners = new Set<(m: HostRouteMatch | null) => void>();
  private readonly unsubscribeDriver: () => void;
  private readonly unsubscribeRegistry: () => void;

  constructor(opts: HostRouterOptions) {
    this.registry = opts.registry;
    this.driver = opts.driver;
    this.enforceActive = opts.enforceActive === true;
    const bases = new Set<string>(opts.reservedStaticBases ?? []);
    bases.add(this.driver.current().pathname);
    this.reservedStaticBases = bases;
    const initialLocation = this.driver.current();
    this.lastMatch = freezeMatch(this.pickMatch(initialLocation));
    this.lastDeclaredMatch = freezeMatch(this.registry.match(initialLocation));
    this.unsubscribeDriver = this.driver.subscribe((loc) => {
      this.refreshMatch(loc);
    });
    this.unsubscribeRegistry = this.registry.subscribeActive(() => {
      this.refreshMatch(this.driver.current());
    });
    // Reconcile any change during installation of either subscription.
    this.refreshMatch(this.driver.current());
  }

  currentLocation(): HostLocation {
    return this.driver.current();
  }

  currentMatch(): HostRouteMatch | null {
    return this.lastMatch;
  }

  /** Diagnostic projection only: never authorizes navigation or a loader. */
  currentDeclaredMatch(): HostRouteMatch | null {
    return this.lastDeclaredMatch;
  }

  currentRouteRef(): RouteRef | null {
    return this.lastMatch ? this.lastMatch.binding.routeRef : null;
  }

  subscribe(listener: (m: HostRouteMatch | null) => void): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  navigate(
    ref: RouteRef,
    params?: Readonly<Record<string, string>>,
    opts?: HostRouteNavigationOptions,
  ): void {
    if (this.disposed) {
      throw new RouteRegistryError("route-inactive", "HostRouter is disposed");
    }
    if (this.enforceActive && !this.registry.isActive(ref)) {
      throw new RouteRegistryError(
        "route-inactive",
        `RouteRef "${ref?.id ?? "<anon>"}" is not currently active`,
        { routeRefId: ref?.id },
      );
    }
    const url = this.registry.resolve(ref, params);
    const { pathname, hash } = splitUrl(url);
    const currentPath = this.driver.current().pathname;
    if (pathname !== currentPath) {
      if (!this.reservedStaticBases.has(pathname)) {
        // Not a reserved workspace surface — refuse.
        throw new RouteRegistryError(
          "invalid-static-base",
          `Cross-base navigation to "${pathname}" is not permitted`,
          { routeRefId: ref.id },
        );
      }
      this.driver.navigate(
        { pathname, hash },
        { replace: opts?.replace, crossBase: true },
      );
      return;
    }
    this.driver.navigate({ pathname, hash }, { replace: opts?.replace });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lastMatch = null;
    this.lastDeclaredMatch = null;
    this.unsubscribeDriver();
    this.unsubscribeRegistry();
    this.listeners.clear();
  }

  private refreshMatch(loc: HostLocation): void {
    if (this.disposed) return;
    const next = this.pickMatch(loc);
    const declared = this.registry.match(loc);
    const same = (a: HostRouteMatch | null, b: HostRouteMatch | null) =>
      a?.binding === b?.binding &&
      JSON.stringify(a?.params ?? {}) === JSON.stringify(b?.params ?? {});
    const activeChanged = !same(this.lastMatch, next);
    const declaredChanged = !same(this.lastDeclaredMatch, declared);
    if (!activeChanged && !declaredChanged) return;
    if (activeChanged) this.lastMatch = freezeMatch(next);
    if (declaredChanged) this.lastDeclaredMatch = freezeMatch(declared);
    for (const listener of [...this.listeners]) listener(this.lastMatch);
  }

  private pickMatch(loc: HostLocation): HostRouteMatch | null {
    return this.enforceActive
      ? this.registry.matchActive(loc)
      : this.registry.match(loc);
  }
}

function freezeMatch(match: HostRouteMatch | null): HostRouteMatch | null {
  return match ? Object.freeze(match) : null;
}

function splitUrl(url: string): HostLocation {
  const idx = url.indexOf("#");
  if (idx === -1) return { pathname: url, hash: "" };
  return { pathname: url.slice(0, idx), hash: url.slice(idx) };
}
