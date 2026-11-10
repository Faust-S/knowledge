/**
 * ModuleRouteOutlet (PROMPT 20 §1).
 *
 * Host-owned rendering surface for module route contributions:
 *   1. subscribes to the HostRouter's current match;
 *   2. resolves the active RouteContribution via HostContributionHub;
 *   3. builds a scoped WorkspaceModuleContext for the owning module;
 *   4. lazily loads the module component;
 *   5. wraps the component in Suspense + ModuleRouteBoundary + a
 *      ModuleRuntimeProvider carrying ONLY the values enumerated in §2.
 *
 * A single module route failure never breaks the Domain Shell.
 */

import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from "react";
import type { WorkspaceModuleContext } from "@/workspace-contract";
import { useWorkspaceHostRuntimeHandle } from "../runtime/WorkspaceHostRuntimeProvider";
import type { HostRouteMatch } from "../router";
import { ModuleRouteBoundary } from "./ModuleRouteBoundary";
import { ModuleRouteLoading } from "./ModuleRouteLoading";
import { ModuleRouteNotFound } from "./ModuleRouteNotFound";
import {
  ModuleRuntimeProvider,
  type ModuleRuntimeSnapshot,
} from "./ModuleRenderContext";

export interface ModuleRouteOutletProps {
  /** Currently active workspace profile id (from Host config). */
  hostProfileId: string;
  /** Whether the profile is a fallback (unknown profile requested). */
  profileFallback: boolean;
  presentation?: "host" | "product";
  /** Optional sink for boundary-caught errors (diagnostics wiring). */
  onModuleError?: (routeRefId: string, error: Error) => void;
}

/**
 * Cache of `lazy(loader)` wrappers keyed by route ref id — one lazy
 * component per route contribution. Re-running `lazy()` on every render
 * would defeat Suspense caching.
 */
const lazyByRouteRefId = new WeakMap<
  object,
  ComponentType<Record<string, never>>
>();

export function ModuleRouteOutlet(props: ModuleRouteOutletProps) {
  const runtime = useWorkspaceHostRuntimeHandle();
  const [match, setMatch] = useState<HostRouteMatch | null>(
    runtime ? runtime.router.currentMatch() : null,
  );

  useEffect(() => {
    if (!runtime) {
      setMatch(null);
      return;
    }
    setMatch(runtime.router.currentMatch());
    return runtime.router.subscribe((m) => setMatch(m));
  }, [runtime]);

  if (!runtime) {
    return <ModuleRouteLoading presentation={props.presentation} />;
  }
  if (!match) {
    return <ModuleRouteNotFound />;
  }

  const routeRefId = match.binding.routeRef.id;
  const found = runtime.hub.getRouteContribution(routeRefId);
  if (!found) {
    return <ModuleRouteNotFound routeRefId={routeRefId} />;
  }

  return (
    <ActiveModuleRoute
      routeRefId={routeRefId}
      match={match}
      hostProfileId={props.hostProfileId}
      profileFallback={props.profileFallback}
      presentation={props.presentation}
      onModuleError={props.onModuleError}
    />
  );
}

interface ActiveModuleRouteProps {
  routeRefId: string;
  match: HostRouteMatch;
  hostProfileId: string;
  profileFallback: boolean;
  presentation?: "host" | "product";
  onModuleError?: (routeRefId: string, error: Error) => void;
}

function ActiveModuleRoute(props: ActiveModuleRouteProps) {
  const runtime = useWorkspaceHostRuntimeHandle();
  const found = runtime?.hub.getRouteContribution(props.routeRefId) ?? null;

  const context: WorkspaceModuleContext | null = useMemo(() => {
    if (!runtime || !found) return null;
    return runtime.contextProvider.createContext(found.moduleId);
  }, [runtime, found]);

  const LazyComponent = useMemo(() => {
    if (!found) return null;
    let existing = lazyByRouteRefId.get(found.contribution);
    if (!existing) {
      existing = lazy(found.contribution.loader as never);
      lazyByRouteRefId.set(found.contribution, existing);
    }
    return existing;
  }, [found]);

  if (!runtime || !found || !context || !LazyComponent) {
    return <ModuleRouteNotFound routeRefId={props.routeRefId} />;
  }

  const snapshot: ModuleRuntimeSnapshot = Object.freeze({
    moduleId: found.moduleId,
    context,
    routeRef: props.match.binding.routeRef,
    params: props.match.params,
    hostProfileId: props.hostProfileId,
    profileFallback: props.profileFallback,
  });

  return (
    <ModuleRouteBoundary
      routeRefId={props.routeRefId}
      moduleId={found.moduleId}
      onError={(err) => props.onModuleError?.(props.routeRefId, err)}
    >
      <Suspense fallback={<ModuleRouteLoading presentation={props.presentation} />}>
        <ModuleRuntimeProvider value={snapshot}>
          <LazyComponent />
        </ModuleRuntimeProvider>
      </Suspense>
    </ModuleRouteBoundary>
  );
}
