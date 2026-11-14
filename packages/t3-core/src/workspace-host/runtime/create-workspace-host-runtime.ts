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
import {
  readActivityFromWorkspaceContext, createTrustedReconciliationAdmission,
  createTrustedReconciliationKernelApply, createTrustedNativeContinuation,
} from "@/t3/index.mjs";
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
import { CurrentWorkspaceStore, createModuleContextProvider, createKernelFacade } from "../context";
import { DashboardRefreshState } from "../context/create-dashboard-facade";
import { HostPanelsState } from "../context/create-panels-facade";
import type {
  CreateWorkspaceHostRuntimeInput,
  WorkspaceHostRuntimeHandle,
  WorkspaceHostRuntimeDiagnostics,
  T3ReconciliationHostPort,
} from "./types";

export async function createWorkspaceHostRuntime(
  input: CreateWorkspaceHostRuntimeInput,
): Promise<WorkspaceHostRuntimeHandle> {
  // Reject ambiguous D3 ownership BEFORE activating inherited modules.
  if(input.reconciliationOwner&&input.reconciliationPort)
    throw new Error("T3_D3_MULTIPLE_RECIPIENT_OWNERS_FORBIDDEN");
  if(input.nativeContinuationOwner &&
      (!input.confirmNativeContinuation || !input.signedKernelAccess))
    throw new Error("T3_D6_TRUSTED_SIGNED_NATIVE_OWNER_REQUIRED");
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

  // Signed ModuleContext calls must not outlive their originating Host.
  // The same lifecycle flag also governs readAuthorizedActivity.
  let disposed = false;
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
    isHostActive: () => !disposed,
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

  // Activity is a trusted Host operation, not a module-level shortcut.
  // This is the ORIGINAL T2 facade on the same KernelSession and Store;
  // module consumers only receive the signed ModuleContext facade below.
  // Activity's separate DATA consent is applied through the existing D1
  // binding on this facade, so normal workspace.read never implies Activity.
  const activityT2Kernel = createKernelFacade({session: input.session});
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
      // A multi-organization Host obtains the original signed DATA grant
      // after each context selection/status update. This selector is NOT a
      // new T2 operation: it only asks the existing Access owner for its
      // activity.read port; ModuleContext.kernel remains the normal T2 API.
      const activity = input.signedActivityAccess;
      const source = input.signedKernelAccess;
      const signedAccess = activity !== undefined
        ? typeof activity === "function" ? await activity() : activity
        : typeof source === "function" ? await source("activity.read") : source;
      if (disposed) reject("T3_HOST_DISPOSED");
      if (!signedAccess) return reject("T3_D1_ACCESS_OWNER_REQUIRED");
      if (await signedAccess.actionFor("t1.listObjects") !== "activity.read")
        return reject("T3_ACTIVITY_EXPLICIT_DATA_GRANT_REQUIRED");
      if (disposed) reject("T3_HOST_DISPOSED");
      // Only the one original T2 session performs the read. The Activity
      // binding adds its OWN signed DATA JIT once per original operation;
      // the standard module's workspace.read grant is neither borrowed nor
      // unnecessarily rechecked. No second Kernel, Store or registry.
      const result = await readActivityFromWorkspaceContext(
        {
          kernel: activityT2Kernel,
          currentWorkspace: contextProvider.createContext("iwxa.workspace.base").currentWorkspace,
        },
        { ...options, signedAccess },
      );
      if (disposed) reject("T3_HOST_DISPOSED");
      return result;
    };
  // D6 is opt-in: only the installed Host can supply a native owner and the
  // original signed D1 Access port. The original T2 Kernel performs each read.
  const nativeContinuation: WorkspaceHostRuntimeHandle["nativeContinuation"] =
    input.nativeContinuationOwner && input.confirmNativeContinuation
      ? createTrustedNativeContinuation({
        kernel:activityT2Kernel,
        accessForRead:async operation=>{
          const source=input.signedKernelAccess;
          return typeof source==="function" ? await source(operation) : source ?? null;
        },
        currentWorkspace:currentWorkspaceStore,
        nativeOwner:input.nativeContinuationOwner,
        confirmHuman:input.confirmNativeContinuation,
        isHostActive:()=>!disposed,
      }) : null;
  // D3 is executed by one ORIGINAL owner. Installed split-origin products
  // forward to the native recipient over the existing signed Control channel.
  const remoteD3=input.reconciliationPort;
  const remoteCall=async(method:string,call:()=>Promise<unknown>)=>{
    if(disposed)throw Object.assign(new Error("T3_HOST_DISPOSED"),{code:"T3_HOST_DISPOSED"});
    const result=await call();
    if(disposed){
      const uncertain=["receive","accept","reject","applyAccepted"].includes(method);
      const code=uncertain?"T3_D3_OWNER_CONTEXT_CHANGED_OUTCOME_UNKNOWN":"T3_HOST_DISPOSED";
      throw Object.assign(new Error(code),{code});
    }
    return result;
  };
  const reconciliation:WorkspaceHostRuntimeHandle["reconciliation"] =
    remoteD3 ? Object.freeze({
      receive:(bytes:Uint8Array)=>remoteCall("receive",()=>remoteD3.receive(bytes)),
      preview:(digest:string)=>remoteCall("preview",()=>remoteD3.preview(digest)),
      receipt:(operationId:string,packageSha256:string)=>remoteCall("receipt",
        ()=>remoteD3.receipt(operationId,packageSha256)),
      accept:(data:Parameters<T3ReconciliationHostPort["accept"]>[0])=>
        remoteCall("accept",()=>remoteD3.accept(data)),
      reject:(data:Parameters<T3ReconciliationHostPort["reject"]>[0])=>
        remoteCall("reject",()=>remoteD3.reject(data)),
      inspectAcceptedApplication:(data:Parameters<T3ReconciliationHostPort["inspectAcceptedApplication"]>[0])=>
        remoteCall("inspectAcceptedApplication",()=>remoteD3.inspectAcceptedApplication(data)),
      ...(remoteD3.applyAccepted?{applyAccepted:(data:{
        acceptanceId:string;revisionIds:string[];target:Record<string,unknown>})=>
          remoteCall("applyAccepted",()=>remoteD3.applyAccepted!(data))}:{}),
    }) : input.reconciliationOwner ? (()=>{
      const original=input.reconciliationOwner;
      const admission=createTrustedReconciliationAdmission({
        reconciler:original.reconciler,
        currentContext:()=>original.signedAccess.currentContext(),
        recipientForContext:original.recipientForContext,
        confirmHumanReview:original.confirmHumanReview,
        isHostActive:()=>!disposed,
      });
      const apply=original.apply ? createTrustedReconciliationKernelApply({
        admission,kernel:activityT2Kernel,access:original.signedAccess,
        stageFromOriginalOwner:original.apply.stageFromOriginalOwner,
        confirmSeparateApply:original.apply.confirmSeparateApply,
        isHostActive:()=>!disposed,
      }):null;
      return Object.freeze({
        ...admission,...(apply?{applyAccepted:apply.applyAccepted}:{}),
      });
    })() : null;
  // Revoke access synchronously, BEFORE the serialized asynchronous module
  // shutdown. A retained signed KernelFacade must stop accepting calls on
  // logout, replacement or unmount even if the old module has a slow stop().
  const invalidate = () => { disposed = true; };
  const dispose = async () => {
    invalidate();
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
    reconciliation,
    nativeContinuation,
    invalidate,
    dispose,
  };
}
