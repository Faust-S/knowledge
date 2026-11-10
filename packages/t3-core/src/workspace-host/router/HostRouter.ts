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
    this.lastMatch = this.pickMatch(this.driver.current());
    this.unsubscribeDriver = this.driver.subscribe((loc) => {
      this.refreshMatch(loc);
    });
    this.unsubscribeRegistry = this.registry.subscribeActive(() => {
      this.refreshMatch(this.driver.current());
    });
  }

  currentLocation(): HostLocation {
    return this.driver.current();
  }

  currentMatch(): HostRouteMatch | null {
    return this.lastMatch;
  }

  currentRouteRef(): RouteRef | null {
    return this.lastMatch ? this.lastMatch.binding.routeRef : null;
  }

  subscribe(listener: (m: HostRouteMatch | null) => void): () => void {
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
    this.unsubscribeDriver();
    this.unsubscribeRegistry();
    this.listeners.clear();
  }

  private refreshMatch(loc: HostLocation): void {
    const next = this.pickMatch(loc);
    const previousId = this.lastMatch?.binding.routeRef.id ?? null;
    const nextId = next?.binding.routeRef.id ?? null;
    const previousParams = JSON.stringify(this.lastMatch?.params ?? {});
    const nextParams = JSON.stringify(next?.params ?? {});
    if (previousId === nextId && previousParams === nextParams) return;
    this.lastMatch = next;
    for (const listener of [...this.listeners]) listener(this.lastMatch);
  }

  private pickMatch(loc: HostLocation): HostRouteMatch | null {
    return this.enforceActive
      ? this.registry.matchActive(loc)
      : this.registry.match(loc);
  }
}

function splitUrl(url: string): HostLocation {
  const idx = url.indexOf("#");
  if (idx === -1) return { pathname: url, hash: "" };
  return { pathname: url.slice(0, idx), hash: url.slice(idx) };
}
