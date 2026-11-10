/**
 * Only Host mounts PanelContribution components. Modules receive the
 * scoped panels.open/close facade, never loaders or an independent portal.
 */
import {
  Component, Suspense, lazy, useEffect, useMemo, useState,
  type ComponentType, type ErrorInfo, type ReactNode,
} from "react";
import type { PanelContribution } from "@/workspace-contract";
import type { RegistryEntry } from "../registries/RegistryBase";
import type { HostRouteMatch } from "../router";
import { useWorkspaceHostRuntimeHandle } from "../runtime/WorkspaceHostRuntimeProvider";
import { ModuleRuntimeProvider, type ModuleRuntimeSnapshot } from "./ModuleRenderContext";
import type { HostPanelsState } from "../context/create-panels-facade";

const lazyPanels = new WeakMap<object, ComponentType<Record<string, never>>>();
const EMPTY = Object.freeze([] as string[]);

type PanelSlot = PanelContribution["slot"];

class PanelErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // A broken contributed panel must not break the rest of the workspace.
  }
  render(): ReactNode {
    return this.state.failed
      ? <p role="alert" className="text-sm text-rose-200">Не удалось отобразить панель.</p>
      : this.props.children;
  }
}

function PanelItem({ entry, match, onClose }: {
  entry: RegistryEntry<PanelContribution>;
  match: HostRouteMatch;
  onClose: () => void;
}) {
  const runtime = useWorkspaceHostRuntimeHandle();
  const Panel = useMemo(() => {
    let cached = lazyPanels.get(entry.contribution);
    if (!cached) {
      cached = lazy(entry.contribution.loader as never);
      lazyPanels.set(entry.contribution, cached);
    }
    return cached;
  }, [entry.contribution]);
  const context = useMemo(
    () => runtime?.contextProvider.createContext(entry.ownerModuleId) ?? null,
    [runtime?.contextProvider, entry.ownerModuleId],
  );
  if (!context) return null;
  const snapshot: ModuleRuntimeSnapshot = Object.freeze({
    moduleId: entry.ownerModuleId,
    context,
    routeRef: match.binding.routeRef,
    params: match.params,
    hostProfileId: context.profile.id,
    profileFallback: context.profile.fallback,
  });
  return (
    <section
      data-testid={`host-panel-${entry.contributionId}`}
      data-module-id={entry.ownerModuleId}
      className="p-3 border border-slate-700 rounded space-y-2"
    >
      <div className="flex justify-end">
        <button
          type="button"
          aria-label="Закрыть панель"
          onClick={onClose}
          className="px-3 py-2 min-h-[44px] rounded text-sm text-slate-200 hover:bg-slate-700"
        >Закрыть</button>
      </div>
      <PanelErrorBoundary>
        <Suspense fallback={<p role="status">Загрузка панели…</p>}>
          <ModuleRuntimeProvider value={snapshot}>
            <Panel />
          </ModuleRuntimeProvider>
        </Suspense>
      </PanelErrorBoundary>
    </section>
  );
}

export function HostPanelSurface({ slot }: { slot: PanelSlot }) {
  const runtime = useWorkspaceHostRuntimeHandle();
  const [ids, setIds] = useState<readonly string[]>(EMPTY);
  const [match, setMatch] = useState<HostRouteMatch | null>(null);

  useEffect(() => {
    if (!runtime) {
      setIds(EMPTY);
      setMatch(null);
      return;
    }
    const state: HostPanelsState = runtime.panelsState;
    setIds(state.openIds());
    setMatch(runtime.router.currentMatch());
    const offState = state.subscribe(() => setIds(state.openIds()));
    const offRouter = runtime.router.subscribe((next) => setMatch(next));
    return () => { offState(); offRouter(); };
  }, [runtime]);

  if (!runtime || !match) return null;
  const granted = new Set<string>(runtime.grantedOperations);
  const capabilities = new Set<string>(runtime.activeCapabilities);
  const permitted = ids.map((id) => runtime.hub.panels.get(id)).filter((entry) =>
    entry !== null && entry.contribution.slot === slot &&
    entry.requiredOperations.every((op) => granted.has(op)) &&
    entry.requiredCapabilitiesAll.every((cap) => capabilities.has(cap)) &&
    (entry.requiredCapabilitiesAny.length === 0 ||
      entry.requiredCapabilitiesAny.some((cap) => capabilities.has(cap)))
  );
  if (permitted.length === 0) return null;
  return (
    <aside aria-label="Дополнительные панели" data-testid={`host-panel-surface-${slot}`}
      className="p-3 space-y-3">
      {permitted.map((entry) => (
        <PanelItem
          key={entry!.contributionId}
          entry={entry!}
          match={match}
          onClose={() => runtime.panelsState.request(entry!.contributionId, "close")}
        />
      ))}
    </aside>
  );
}
