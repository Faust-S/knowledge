/**
 * ModuleRenderContext (PROMPT 20 §2; finalized in PROMPT 25).
 *
 * Scoped, read-only render context handed to a lazily-loaded module
 * route component. It carries ONLY the values enumerated in the spec —
 * a module route component never receives raw session, adapter,
 * Capabilities, HostContributionHub, ModuleRegistry, window.location,
 * or the full host config.
 *
 * The transitional `LegacyBridgeBag` was removed in PROMPT 25. Modules
 * now consume kernel, router, commands, profile and terminology via
 * `context: WorkspaceModuleContext`; catalog state and cross-base
 * navigation live inside the modules themselves.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { RouteRef, WorkspaceModuleContext } from "@/workspace-contract";

export interface ModuleRuntimeSnapshot {
  readonly moduleId: string;
  readonly context: WorkspaceModuleContext;
  readonly routeRef: RouteRef;
  readonly params: Readonly<Record<string, string>>;
  readonly hostProfileId: string;
  readonly profileFallback: boolean;
}

const ModuleRuntimeContext = createContext<ModuleRuntimeSnapshot | null>(null);

export function useWorkspaceModuleRuntime(): ModuleRuntimeSnapshot {
  const v = useContext(ModuleRuntimeContext);
  if (!v) {
    throw new Error(
      "useWorkspaceModuleRuntime() must be used inside a ModuleRouteOutlet-rendered component.",
    );
  }
  return v;
}

export function ModuleRuntimeProvider(props: {
  value: ModuleRuntimeSnapshot;
  children: ReactNode;
}) {
  return (
    <ModuleRuntimeContext.Provider value={props.value}>
      {props.children}
    </ModuleRuntimeContext.Provider>
  );
}
