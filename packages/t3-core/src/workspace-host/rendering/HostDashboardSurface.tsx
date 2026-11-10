import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from "react";
import type { DashboardCardContribution } from "@/workspace-contract";
import type { RegistryEntry } from "../registries/RegistryBase";
import { hostRouteRefs, type HostRouteMatch } from "../router";
import { useWorkspaceHostRuntimeHandle } from "../runtime/WorkspaceHostRuntimeProvider";
import { ModuleRuntimeProvider, type ModuleRuntimeSnapshot } from "./ModuleRenderContext";

const lazyCards = new WeakMap<object, ComponentType<Record<string, never>>>();

const SIZE_CLASS: Record<DashboardCardContribution["size"], string> = {
  small: "sm:col-span-1",
  medium: "sm:col-span-2",
  large: "sm:col-span-2 xl:col-span-3",
};

interface BoundaryProps {
  cardId: string;
  moduleId: string;
  /** Stable across ordinary rerenders; changes on Host Kernel context replacement. */
  contextRef: unknown;
  children: ReactNode;
}
interface BoundaryState { error: Error | null; }

class DashboardCardBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Host-owned containment: one failed dashboard card never breaks Overview.
  }

  componentDidUpdate(prev: BoundaryProps): void {
    if (this.state.error && (
      prev.cardId !== this.props.cardId ||
      prev.moduleId !== this.props.moduleId ||
      prev.contextRef !== this.props.contextRef
    )) {
      // A recovered/reprovisioned Kernel context must not leave the owner
      // card permanently trapped in an error from the previous session.
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          data-testid="dashboard-card-error"
          data-dashboard-card-id={this.props.cardId}
          data-module-id={this.props.moduleId}
          className="p-3 border border-rose-800/60 rounded text-xs text-rose-200"
        >
          Карточка панели временно недоступна.
        </div>
      );
    }
    return this.props.children;
  }
}

function DashboardCard({
  entry,
  match,
  refreshVersion,
}: {
  entry: RegistryEntry<DashboardCardContribution>;
  match: HostRouteMatch;
  refreshVersion: number;
}) {
  const runtime = useWorkspaceHostRuntimeHandle();
  const LazyCard = useMemo(() => {
    let existing = lazyCards.get(entry.contribution);
    if (!existing) {
      existing = lazy(entry.contribution.loader as never);
      lazyCards.set(entry.contribution, existing);
    }
    return existing;
  }, [entry.contribution]);

  // The owner-specific context wraps the current Kernel session. Rebuild it
  // only when the Host changes the context provider or the owning module.
  // A dashboard render/refresh alone must not manufacture a new kernel
  // facade: module effects depend on its identity to read Workspaces safely.
  const context = useMemo(
    () => runtime?.contextProvider.createContext(entry.ownerModuleId) ?? null,
    [runtime?.contextProvider, entry.ownerModuleId],
  );

  if (!runtime || !context) return null;

  const snapshot: ModuleRuntimeSnapshot = Object.freeze({
    moduleId: entry.ownerModuleId,
    context,
    routeRef: match.binding.routeRef,
    params: match.params,
    hostProfileId: context.profile.id,
    profileFallback: context.profile.fallback,
  });

  return (
    <div
      key={refreshVersion}
      data-testid={`dashboard-card-${entry.contributionId}`}
      data-t2-ui="dashboard-card"
      data-dashboard-card-size={entry.contribution.size}
      className={SIZE_CLASS[entry.contribution.size]}
    >
      <DashboardCardBoundary
        cardId={entry.contributionId}
        moduleId={entry.ownerModuleId}
        contextRef={context}
      >
        <Suspense fallback={<div role="status" className="p-3 text-xs text-slate-400">Загрузка карточки…</div>}>
          <ModuleRuntimeProvider value={snapshot}>
            <LazyCard />
          </ModuleRuntimeProvider>
        </Suspense>
      </DashboardCardBoundary>
    </div>
  );
}

export function HostDashboardSurface() {
  const runtime = useWorkspaceHostRuntimeHandle();
  const [match, setMatch] = useState<HostRouteMatch | null>(
    runtime ? runtime.router.currentMatch() : null,
  );
  const [, setRefreshEpoch] = useState(0);

  useEffect(() => {
    if (!runtime) {
      setMatch(null);
      return;
    }
    setMatch(runtime.router.currentMatch());
    return runtime.router.subscribe((next) => setMatch(next));
  }, [runtime]);

  useEffect(() => {
    if (!runtime) return;
    return runtime.dashboardState.subscribe(() => {
      setRefreshEpoch((value) => value + 1);
    });
  }, [runtime]);

  if (!runtime || !match || match.binding.routeRef.id !== hostRouteRefs.base.home.id) {
    return null;
  }

  const entries = runtime.hub.dashboard.visibleEntries(
    runtime.grantedOperations,
    runtime.activeCapabilities,
  );
  if (entries.length === 0) return null;

  return (
    <section
      aria-label="Панель рабочей области"
      data-testid="host-dashboard-surface"
      data-t2-ui="dashboard"
      className="px-4 pt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
    >
      {entries.map((entry) => (
        <DashboardCard
          key={entry.contributionId}
          entry={entry}
          match={match}
          refreshVersion={runtime.dashboardState.version(entry.contributionId)}
        />
      ))}
    </section>
  );
}
