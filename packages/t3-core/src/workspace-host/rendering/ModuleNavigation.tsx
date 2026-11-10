/**
 * ModuleNavigation (PROMPT 20 §7).
 *
 * Renders module navigation contributions from the HostContributionHub's
 * NavigationRegistry:
 *   - source: `hub.navigation.visibleEntries(session.granted_operations)`;
 *   - labels routed through terminology;
 *   - active item derived from `HostRouter.currentRouteRef()`;
 *   - dispatch through `HostRouter.navigate(routeRef)` — never a raw URL;
 *   - missing operations hide the item automatically (visibleEntries
 *     already filters);
 *   - planned modules never contribute (they don't activate).
 */

import { useEffect, useState } from "react";
import type { RouteRef } from "@/workspace-contract";
import { useWorkspaceHostRuntimeHandle } from "../runtime/WorkspaceHostRuntimeProvider";

export interface ModuleNavigationProps {
  /** Terminology resolver — same one used by the runtime. */
  termResolver: (key: string, fallback?: string) => string;
}

interface NavEntry {
  contributionId: string;
  labelKey: string;
  routeRef: RouteRef;
  placement: "primary" | "utility";
  order: number;
}

export function ModuleNavigation(props: ModuleNavigationProps) {
  const runtime = useWorkspaceHostRuntimeHandle();
  const [activeRefId, setActiveRefId] = useState<string | null>(
    runtime ? runtime.router.currentRouteRef()?.id ?? null : null,
  );
  const [, setRouteActivityEpoch] = useState(0);

  useEffect(() => {
    if (!runtime) {
      setActiveRefId(null);
      return;
    }
    setActiveRefId(runtime.router.currentRouteRef()?.id ?? null);
    const unsubscribeRouter = runtime.router.subscribe((m) =>
      setActiveRefId(m?.binding.routeRef.id ?? null),
    );
    const unsubscribeActivity = runtime.router.registry.subscribeActive(() =>
      setRouteActivityEpoch((value) => value + 1),
    );
    return () => {
      unsubscribeRouter();
      unsubscribeActivity();
    };
  }, [runtime]);

  if (!runtime) return null;

  const entries: readonly NavEntry[] = runtime.hub.navigation
    .visibleEntries(
      runtime.grantedOperations,
      runtime.activeCapabilities,
      (routeRef) => runtime.router.registry.isActive(routeRef),
    )
    .map((e) => ({
      contributionId: e.contributionId,
      labelKey: e.contribution.labelKey,
      routeRef: e.contribution.routeRef,
      placement: e.contribution.placement,
      order: e.contribution.order,
    }));

  if (entries.length === 0) return null;

  return (
    <nav
      aria-label="Разделы модуля рабочей области"
      data-testid="module-navigation"
      data-t2-ui="navigation"
      className="border-b md:border-b-0 md:border-r border-slate-800 p-2 md:p-3 flex md:block gap-1 md:gap-0 md:space-y-1 flex-wrap overflow-x-auto"
    >
      {entries.map((e) => {
        const active = e.routeRef.id === activeRefId;
        return (
          <button
            key={e.contributionId}
            type="button"
            data-testid={`module-nav-item-${e.contributionId}`}
            data-route-ref={e.routeRef.id}
            data-t2-ui="navigation-item"
            aria-current={active ? "page" : undefined}
            onClick={() => {
              try {
                runtime.router.navigate(e.routeRef);
              } catch {
                // Silent — an inactive/missing route is a diagnostic
                // condition surfaced elsewhere; navigation must not
                // crash the shell.
              }
            }}
            className={`text-left px-3 py-2 rounded text-sm min-h-[44px] min-w-[44px] md:block md:w-full ${
              active
                ? "bg-slate-800 text-slate-100"
                : "text-slate-300 hover:bg-slate-800/50"
            }`}
          >
            {props.termResolver(e.labelKey, e.labelKey)}
          </button>
        );
      })}
    </nav>
  );
}
