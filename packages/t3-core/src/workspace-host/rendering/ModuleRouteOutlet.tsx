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
  useMemo,
  type ComponentType,
} from "react";
import type { WorkspaceModuleContext } from "@/workspace-contract";
import type { WorkspaceHostRuntimeHandle } from "../runtime/types";
import { BASE_ROUTE_INVENTORY } from "@/modules/base/routes";
import { EXCHANGE_ROUTE_INVENTORY } from "@/modules/exchange/routes";
import { LIFECYCLE_ROUTE_INVENTORY } from "@/modules/lifecycle/routes";
import { useWorkspaceHostRuntimeHandle } from "../runtime/WorkspaceHostRuntimeProvider";
import type { HostRouteMatch } from "../router";
import { useHostRouteMatch } from "../router/use-host-route-match";
import { ModuleRouteBoundary } from "./ModuleRouteBoundary";
import { ModuleRouteLoading } from "./ModuleRouteLoading";
import { ModuleRouteNotFound, type RouteUnavailableReason } from "./ModuleRouteNotFound";
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

/** Classify only from the original declared route inventories and current
 * module status; never infer an access denial from an arbitrary missing URL.
 * These reasons are presentation only. The active registry still owns access.
 */
function unavailableReason(runtime: WorkspaceHostRuntimeHandle, routeRefId: string): RouteUnavailableReason {
  const base = BASE_ROUTE_INVENTORY.find(r => r.routeRef.id === routeRefId);
  const exchange = EXCHANGE_ROUTE_INVENTORY.find(r => r.routeRef.id === routeRefId);
  const lifecycle = LIFECYCLE_ROUTE_INVENTORY.find(r => r.routeRef.id === routeRefId);
  // Multiple compiled domain modules may share the same URL base but
  // contribute different surfaces. Do not guess ownership from module count.
  const exact = (runtime.moduleSnapshot ?? []).flatMap(module =>
    module.diagnostics.filter(d =>
      (d.details as { routeRefId?: string } | undefined)?.routeRefId === routeRefId));
  if (exact.some(d => ["route-operation-missing", "route-capability-missing"].includes(
    (d.details as { hubCode?: string } | undefined)?.hubCode ?? ""))) return "forbidden";
  if (exact.length) return "module-error";
  const owner = base ? "iwxa.workspace.base"
    : exchange ? "iwxa.workspace.exchange"
    : lifecycle ? "iwxa.workspace.lifecycle" : undefined;
  if (runtime.diagnostics?.modules.some(d => String(d.code) === "module-registry-start-failed")) return "module-error";
  const status = owner ? runtime.moduleRegistry?.getStatus(owner) : null;
  if (!status || status.status === "planned" || status.status === "disabled") return "unavailable";
  if (["missing-level", "missing-operation", "missing-capability"].includes(status.status)) return "forbidden";
  if (status.status !== "activated") {
    if (status.diagnostics.some(d => ["route-operation-missing", "route-capability-missing"].includes(
      (d.details as { hubCode?: string } | undefined)?.hubCode ?? ""))) return "forbidden";
    return "module-error";
  }
  const granted = new Set(runtime.grantedOperations);
  if ((base && !base.requiredOperations.every(op => granted.has(op))) ||
      (exchange && !exchange.requiredOperations.some(op => granted.has(op))) ||
      (lifecycle && !lifecycle.anyOperations.some(op => granted.has(op)))) return "forbidden";
  return "unavailable";
}

export function ModuleRouteOutlet(props: ModuleRouteOutletProps) {
  const runtime = useWorkspaceHostRuntimeHandle();
  const match = useHostRouteMatch(runtime?.router ?? null, true);

  if (!runtime) {
    return <ModuleRouteLoading presentation={props.presentation} />;
  }
  if (!match) {
    return <ModuleRouteNotFound />;
  }

  const routeRefId = match.binding.routeRef.id;
  // A declared but inactive route can explain a failure, never render it.
  if (!runtime.router.currentMatch()) {
    return <ModuleRouteNotFound routeRefId={routeRefId} reason={unavailableReason(runtime, routeRefId)} />;
  }
  const found = runtime.hub.getRouteContribution(routeRefId);
  if (!found) {
    return <ModuleRouteNotFound routeRefId={routeRefId} reason="module-error" />;
  }

  return (
    <ModuleRouteBoundary
      routeRefId={routeRefId}
      moduleId={found.moduleId}
      contextIdentity={runtime}
      onError={(err) => props.onModuleError?.(routeRefId, err)}
    >
      <ActiveModuleRoute
        runtime={runtime}
        found={found}
        match={match}
        hostProfileId={props.hostProfileId}
        profileFallback={props.profileFallback}
        presentation={props.presentation}
      />
    </ModuleRouteBoundary>
  );
}

interface ActiveModuleRouteProps {
  runtime: WorkspaceHostRuntimeHandle;
  found: NonNullable<ReturnType<WorkspaceHostRuntimeHandle["hub"]["getRouteContribution"]>>;
  match: HostRouteMatch;
  hostProfileId: string;
  profileFallback: boolean;
  presentation?: "host" | "product";
}

function ActiveModuleRoute(props: ActiveModuleRouteProps) {
  const { runtime, found } = props;

  const context: WorkspaceModuleContext = useMemo(() =>
    runtime.contextProvider.createContext(found.moduleId), [runtime, found.moduleId]);

  const LazyComponent = useMemo(() => {
    let existing = lazyByRouteRefId.get(found.contribution);
    if (!existing) {
      existing = lazy(found.contribution.loader as never);
      lazyByRouteRefId.set(found.contribution, existing);
    }
    return existing;
  }, [found]);

  const snapshot: ModuleRuntimeSnapshot = Object.freeze({
    moduleId: found.moduleId,
    context,
    routeRef: props.match.binding.routeRef,
    params: props.match.params,
    hostProfileId: props.hostProfileId,
    profileFallback: props.profileFallback,
  });

  return (
    <Suspense fallback={<ModuleRouteLoading presentation={props.presentation} />}>
      <ModuleRuntimeProvider value={snapshot}>
        <LazyComponent />
      </ModuleRuntimeProvider>
    </Suspense>
  );
}
