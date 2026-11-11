/**
 * createWorkspaceHostRuntime (PROMPT 19 §4-§5).
 *
 * Boots the full Host runtime for a given kernel session:
 *   1. registers Host RouteRefs (compile-time bindings);
 *   2. constructs the HostRouter (with active-gating on);
 *   3. builds the HostContributionHub + registries;
 *   4. resolves configured modules from workspace.config.json;
 *   5. starts the ModuleRegistry (which will `activate` each module,
 *      register its contributions through the hub, and activate the
 *      corresponding route contributions in the RouteRegistry).
 *
 * Returns a disposable handle. Failure at any step still returns a
 * handle whose diagnostics are populated so the UI can show them.
 */

import { adapter } from "@/kernel-client/adapter";
import { readActivityFromWorkspaceContext } from "@/t3/index.mjs";
import {
  AVAILABLE_MODULES,
  composeAvailableModules,
  resolveConfiguredModules,
} from "@/composition";
import {
  ModuleRegistry,
  type ModuleContextProvider,
} from "../modules";
import { HostContributionHub } from "../registries";
import {
  RouteRegistry,
  HostRouter,
  createLegacyHashDriver,
  activeHostRouteBindings,
  resolveProductFirstLanding,
} from "../router";
import { CurrentWorkspaceStore, createModuleContextProvider } from "../context";
import { DashboardRefreshState } from "../context/create-dashboard-facade";
import { HostPanelsState } from "../context/create-panels-facade";
import type {
  CreateWorkspaceHostRuntimeInput,
  WorkspaceHostRuntimeHandle,
  WorkspaceHostRuntimeDiagnostics,
} from "./types";

export async function createWorkspaceHostRuntime(
  input: CreateWorkspaceHostRuntimeInput,
): Promise<WorkspaceHostRuntimeHandle> {
  const bindings = activeHostRouteBindings();
  const registry = new RouteRegistry();
  registry.registerMany(bindings);

  const driver = createLegacyHashDriver({
    window: input.bindLegacyHashDriver === false ? null : undefined,
  });
  // PROMPT 25 §B — enable cross-base navigation via `ctx.router.navigate`
  // to any Host-declared static base. Modules never call
  // `location.assign` directly; the Host router owns the URL swap.
  const reservedStaticBases = Array.from(
    new Set(bindings.map((b) => b.staticBase)),
  );
  const router = new HostRouter({
    registry,
    driver,
    enforceActive: true,
    reservedStaticBases,
  });

  const currentWorkspaceStore = new CurrentWorkspaceStore();
  const dashboardState = new DashboardRefreshState();
  const panelsState = new HostPanelsState();
  const activeCapabilities = Object.freeze([...(input.activeCapabilities ?? [])]);

  const hub = new HostContributionHub({
    routeRegistry: registry,
    hostRouteBindings: bindings,
    grantedOperations: (input.session.granted_operations ?? []) as never,
    activeCapabilities,
  });

  const collectedRegistryDiagnostics: {
    code: string;
    message: string;
    moduleId?: string;
    details?: unknown;
  }[] = [];

  const contextProvider: ModuleContextProvider = createModuleContextProvider({
    session: input.session,
    signedKernelAccess: input.signedKernelAccess,
    router,
    hub,
    currentWorkspaceStore,
    activeCapabilities,
    termResolver: input.termResolver,
    panelsState,
    dashboardState,
    diagnosticsSink: {
      report: (d) => collectedRegistryDiagnostics.push(d),
    },
    profile: input.profile ?? {
      id: "generic",
      definition: {
        id: "generic",
        label: "Generic",
        description: "",
        accent: "#64748b",
      },
      fallback: true,
    },
  });

  const composition = resolveConfiguredModules(
    input.workspaceConfig,
    input.compileTimeModuleLoaders
      ? composeAvailableModules(input.compileTimeModuleLoaders)
      : AVAILABLE_MODULES,
  );

  const runtimeView = {
    contractVersion: input.session.contract_version,
    grantedLevels: input.session.granted_levels ?? [],
    grantedOperations: (input.session.granted_operations ?? []) as never,
    activeCapabilities,
  };

  const moduleRegistry = new ModuleRegistry();
  let moduleSnapshot: readonly ReturnType<
    typeof moduleRegistry.snapshot
  >[number][] = [];

  try {
    moduleSnapshot = await moduleRegistry.start({
      declarations: composition.declarations,
      loaderTable: composition.loaderTable,
      runtime: runtimeView,
      contextProvider,
      hub: {
        registerModule: (moduleId, contribs) => {
          const res = hub.registerModule(
            moduleId,
            contribs as never,
          );
          return { ok: res.ok, diagnostics: res.diagnostics };
        },
        removeModule: (moduleId) => hub.removeModule(moduleId),
      },
    });
  } catch (err) {
    // Registry rolled itself back on start() failure; diagnostics
    // will surface via the snapshot the next time it's queried (empty
    // here). Downgrade to an "empty" snapshot.
    moduleSnapshot = [];
    collectedRegistryDiagnostics.push({
      code: "module-registry-start-failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // Choose the landing before publishing a ready runtime: no Host UI flash.
  const landing = resolveProductFirstLanding({
    enabled: input.preferDomainLanding === true,
    location: router.currentLocation(),
    isActive: (ref) => registry.isActive(ref),
  });
  if (landing) router.navigate(landing, undefined, { replace: true });

  const diagnostics: WorkspaceHostRuntimeDiagnostics = {
    composition: composition.diagnostics,
    modules: collectedRegistryDiagnostics as never,
  };

  let disposed = false;
  const readAuthorizedActivity: WorkspaceHostRuntimeHandle["readAuthorizedActivity"] =
    async (options) => {
      const reject = (code: string): never => {
        throw Object.assign(new Error(code), { code });
      };
      if (disposed) reject("T3_HOST_DISPOSED");
      // The signed Access owner is Host-held. An Activity caller can select
      // semantic mappings, never override the authorizer or Kernel reader.
      if (options && ("signedAccess" in options || "authorizedRead" in options)) {
        reject("T3_ACTIVITY_OWNER_OVERRIDE_FORBIDDEN");
      }
      // A multi-organization host obtains a fresh owner after each explicit
      // context selection or STATUS update. No cached port may resurrect A
      // after A -> B -> A, and the inherited Kernel session remains one.
      const source = input.signedActivityAccess;
      const signedAccess = typeof source === "function" ? await source() : source;
      if (disposed) reject("T3_HOST_DISPOSED");
      if (!signedAccess) reject("T3_D1_ACCESS_OWNER_REQUIRED");
      const result = await readActivityFromWorkspaceContext(
        contextProvider.createContext("iwxa.workspace.base"),
        { ...options, signedAccess },
      );
      if (disposed) reject("T3_HOST_DISPOSED");
      return result;
    };
  const dispose = async () => {
    disposed = true;
    try {
      await moduleRegistry.stop();
    } catch { /* best-effort */ }
    try { hub.clear(); } catch { /* ignore */ }
    try { router.dispose(); } catch { /* ignore */ }
    try { currentWorkspaceStore.clear(); } catch { /* ignore */ }
    try { dashboardState.clear(); } catch { /* ignore */ }
    try { panelsState.clear(); } catch { /* ignore */ }
    // Reference the adapter so it's known to be linked to the session
    // — the facade holds no state of its own.
    void adapter;
  };

  return {
    router,
    hub,
    moduleRegistry,
    moduleSnapshot,
    currentWorkspaceStore,
    dashboardState,
    panelsState,
    contextProvider,
    grantedOperations: (input.session.granted_operations ?? []) as never,
    activeCapabilities,
    diagnostics,
    readAuthorizedActivity,
    dispose,
  };
}
