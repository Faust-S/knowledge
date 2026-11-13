import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useKernel,
  type KernelBootstrap,
  type KernelSession,
} from "../kernel-client";
import type {
  DomainConfigDoc,
  DomainShellDoc,
  WorkspaceConfigDoc,
  HostConfigResult,
} from "../config/host-config";
import type { WorkspaceProfileDefinition } from "../profiles/definition";
import type { WorkspaceProfileId } from "../config/workspace-profiles";
import { Header } from "./Header";
import { KernelStatus } from "../components/KernelStatus";
import { ActionBar } from "./ActionBar";
import {
  DomainShellProvider,
  DomainFooter,
  Breadcrumbs,
  useDomainShell,
} from "../workspace-host/shell";
import { ConfigurationDiagnosticsPanel } from "../workspace-host/diagnostics/ConfigurationDiagnosticsPanel";
import { WorkspaceHostRuntimeDiagnosticsSection } from "../workspace-host/diagnostics/WorkspaceHostRuntimeDiagnosticsSection";
import {
  WorkspaceHostRuntimeProvider,
  useWorkspaceHostRuntime,
  useWorkspaceHostRuntimeHandle,
  type CreateWorkspaceHostRuntimeInput,
  type SignedAccessInvalidationSubscription,
} from "../workspace-host/runtime";
import { ModuleRouteOutlet } from "../workspace-host/rendering/ModuleRouteOutlet";
import { HostDashboardSurface } from "../workspace-host/rendering/HostDashboardSurface";
import { HostPanelSurface } from "../workspace-host/rendering/HostPanelSurface";
import { HostModuleNavigation } from "../workspace-host/rendering/HostModuleNavigation";
import { createKernelFacade } from "../workspace-host/context/create-kernel-facade";
import { FirstRunWorkspaceGate } from "../workspace-host/bootstrap/FirstRunWorkspaceGate";
import { SignedSelectedWorkspaceGate } from "../workspace-host/bootstrap/SignedSelectedWorkspaceGate";
import type { KernelFacade, ProfileFacade } from "../workspace-contract";
import {
  hostRouteMatchToBreadcrumbRoute,
  hostRouteRefs,
  useHostRouteFocus,
  useLegacyRouteMigrations,
} from "../workspace-host/router";
import { useHostRouteMatch } from "../workspace-host/router/use-host-route-match";
import { PRODUCT_MODULE_EXTENSIONS } from "../composition/product-module-extensions";

export interface AppShellProps {
  host: HostConfigResult;
  hostDomain: DomainConfigDoc;
  hostShell: DomainShellDoc;
  hostWorkspace: WorkspaceConfigDoc;
  profileId: WorkspaceProfileId;
  profileDefinition: WorkspaceProfileDefinition;
  profileFallback: boolean;
  devBootstrap?: KernelBootstrap;
  /** Only the original signed Control entrypoint may supply a Kernel realm. */
  trustedKernelBootstrap?: KernelBootstrap;
  /** If true, no raw same-origin T2 loader fallback is ever permitted. */
  isolatedKernelRequired?: boolean;
  trustedSelectedContext?: (operation:string)=>Promise<{
    kind:"CORP";workspace_id:string;resource:string;
  }|null>;
  /** Trusted entrypoint opts into signed D1 as a non-downgradeable requirement. */
  requireSignedOwner?: boolean;
  /** Trusted, compile-time D1 owner. Never extracted from the page or archive. */
  signedKernelAccess?: CreateWorkspaceHostRuntimeInput["signedKernelAccess"];
  signedActivityAccess?: CreateWorkspaceHostRuntimeInput["signedActivityAccess"];
  subscribeSignedAccessInvalidation?: SignedAccessInvalidationSubscription;
}

/**
 * AppShell — pure Domain Shell surface (PROMPT 28).
 *
 * Responsibilities are strictly Host-owned:
 *   1. own the kernel session lifecycle;
 *   2. provide DomainShell + WorkspaceHostRuntime contexts;
 *   3. delegate all screen rendering to `HostShellContent`, which in
 *      turn defers to the HostRouter + `ModuleRouteOutlet`.
 *
 * AppShell does NOT parse hash routes, know module screens, own a
 * `MAIN_NAV_VIEWS` list, or perform Exchange/Lifecycle navigation by
 * hand. Legacy `#/packages` and `#/trash` URLs are migrated inside the
 * Host Router via `useLegacyRouteMigrations`.
 */
const MISSING_REQUIRED_SIGNED_OWNER = () => null;
const MISSING_ISOLATED_KERNEL_BOOTSTRAP: KernelBootstrap = Object.freeze({
  version: 1,
  async connect() {
    throw Object.assign(new Error("T3_D1_ORIGINAL_KERNEL_REALM_REQUIRED"),
      { code: "T3_D1_ORIGINAL_KERNEL_REALM_REQUIRED" });
  },
});

export function AppShell(props: AppShellProps) {
  const {
    host,
    hostDomain,
    hostShell,
    hostWorkspace,
    profileId,
    profileDefinition,
    profileFallback,
    devBootstrap,
    trustedKernelBootstrap,
    isolatedKernelRequired = false,
    trustedSelectedContext,
    requireSignedOwner = false,
    signedKernelAccess,
    signedActivityAccess,
    subscribeSignedAccessInvalidation,
  } = props;
  // Absence of a required original signed owner is a DENIED state, never an
  // invitation to use an unsigned T2 facade. The binding itself remains the
  // same original D1 Access owner, supplied by the trusted compiled Host.
  // The original signed JIT lives behind the isolated RPC port. Never
  // wrap its already-authorized T2 session with an unsigned UI-side owner.
  const selectedSignedKernelAccess = isolatedKernelRequired
    ? undefined : signedKernelAccess ??
      (requireSignedOwner ? MISSING_REQUIRED_SIGNED_OWNER : undefined);
  const signedOwnerRequired = requireSignedOwner || isolatedKernelRequired ||
    selectedSignedKernelAccess !== undefined;

  const serviceId = hostWorkspace.workspace_service_id;
  // This explicit trusted-Host flag prevents a failed isolated connection from
  // downgrading into the public same-origin original T2 window.IWXA loader.
  const bootstrap = isolatedKernelRequired
    ? trustedKernelBootstrap ?? MISSING_ISOLATED_KERNEL_BOOTSTRAP
    : undefined;
  const { state, retry } = useKernel(
    useMemo(() => ({ serviceId, devBootstrap, trustedBootstrap: bootstrap }),
      [serviceId, devBootstrap, bootstrap]),
  );

  const session: KernelSession | null =
    state.status === "ready" || state.status === "limited" || state.status === "read-only"
      ? state.session
      : null;

  const profileFacade: ProfileFacade = useMemo(
    () => Object.freeze({
      id: profileId,
      definition: profileDefinition,
      fallback: profileFallback,
    }),
    [profileId, profileDefinition, profileFallback],
  );

  return (
    <DomainShellProvider
      hostDomain={hostDomain}
      hostShell={hostShell}
      hostWorkspace={hostWorkspace}
      fixture={host.fixture}
    >
      <AppShellRuntimeBridge
        session={session}
        hostWorkspace={hostWorkspace}
        profile={profileFacade}
        signedKernelAccess={selectedSignedKernelAccess}
        signedActivityAccess={signedActivityAccess}
        subscribeSignedAccessInvalidation={subscribeSignedAccessInvalidation}
      >
        <HostShellContent
          host={host}
          hostDomain={hostDomain}
          hostWorkspace={hostWorkspace}
          devBootstrap={devBootstrap}
          state={state}
          onRetry={retry}
          profileId={profileId}
          profileDefinition={profileDefinition}
          profileFallback={profileFallback}
          signedOwnerRequired={signedOwnerRequired}
          signedKernelAccess={selectedSignedKernelAccess}
          trustedSelectedContext={trustedSelectedContext}
        />
      </AppShellRuntimeBridge>
    </DomainShellProvider>
  );
}

interface HostShellContentProps {
  host: HostConfigResult;
  hostDomain: DomainConfigDoc;
  hostWorkspace: WorkspaceConfigDoc;
  devBootstrap?: KernelBootstrap;
  state: ReturnType<typeof useKernel>["state"];
  onRetry: () => void;
  profileId: WorkspaceProfileId;
  profileDefinition: WorkspaceProfileDefinition;
  profileFallback: boolean;
  signedOwnerRequired: boolean;
  signedKernelAccess?: CreateWorkspaceHostRuntimeInput["signedKernelAccess"];
  trustedSelectedContext?: (operation:string)=>Promise<{
    kind:"CORP";workspace_id:string;resource:string;
  }|null>;
}

/**
 * HostShellContent (PROMPT 28 §2). Renders the Domain Shell chrome:
 * Header, module navigation, the module route outlet, ActionBar,
 * diagnostics and DomainFooter. Reads everything runtime-related
 * through `useWorkspaceHostRuntimeHandle` — no legacy routing state.
 */
function HostShellContent(props: HostShellContentProps) {
  const { host, hostDomain, hostWorkspace, devBootstrap, state, onRetry, profileId, profileDefinition, profileFallback, signedOwnerRequired, signedKernelAccess, trustedSelectedContext } = props;
  const runtimeState = useWorkspaceHostRuntime();
  const runtime = runtimeState.status === "ready" ? runtimeState.runtime : null;
  const { terminology, layout, accessibility } = useDomainShell();

  const mainRef = useRef<HTMLElement | null>(null);
  useHostRouteFocus(runtime?.router ?? null, mainRef);
  useLegacyRouteMigrations(runtime?.router ?? null);

  const match = useHostRouteMatch(runtime?.router ?? null);
  const breadcrumbRoute = hostRouteMatchToBreadcrumbRoute(match);

  // The selected Workspace follows the active Host route, not a second
  // domain-specific focus store. Kernel authorizes each read before claiming.
  const focusedWorkspaceId =
    match?.binding.routeRef.id === hostRouteRefs.base.workspace.id ||
    match?.binding.routeRef.id === hostRouteRefs.base.object.id
      ? match.params.workspaceId ?? null
      : null;
  useEffect(() => {
    if (!runtime) return;
    const context = runtime.contextProvider.createContext("iwxa.workspace.base");
    const focus = context.currentWorkspace;
    focus.release();
    if (!focusedWorkspaceId || !context.kernel.hasOperation("t1.getWorkspace")) return;
    let cancelled = false;
    void context.kernel.getWorkspace(focusedWorkspaceId)
      .then((workspace) => {
        if (cancelled) return;
        if (workspace && workspace.workspace_id === focusedWorkspaceId &&
            !workspace.deleted_at) {
          focus.claim(workspace);
        }
      })
      .catch(() => {
        // A failed or denied read must never publish a stale focus.
        if (!cancelled) focus.release();
      });
    return () => { cancelled = true; focus.release(); };
  }, [runtime, focusedWorkspaceId]);

  const session =
    state.status === "ready" || state.status === "limited" || state.status === "read-only"
      ? state.session
      : null;
  const kernel: KernelFacade | null = useMemo(
    () => runtime
      ? runtime.contextProvider.createContext("iwxa.workspace.base").kernel
      : signedOwnerRequired ? null : session ? createKernelFacade({ session }) : null,
    [runtime, session, signedOwnerRequired],
  );

  const termResolver = useCallback(
    (key: string, fallback?: string) => {
      const map = terminology as unknown as Record<string, string>;
      if (typeof map[key] === "string") return map[key];
      return fallback ?? key;
    },
    [terminology],
  );

  // A site-owned shell inherits its palette and accent from the site.
  // The legacy integrated shell keeps its existing profile accent.
  const siteOwned = layout.workspaceChrome === "site-owned";
  // Suppress the technical shell while the product route initializes.
  const productConfigured = Array.isArray(hostWorkspace.modules) && hostWorkspace.modules.some((module) =>
    typeof module.module_id === "string" && module.module_id.startsWith("iwxa.domain.") && module.state === "active"
  );
  const productFirst = siteOwned && productConfigured &&
    (!runtime || runtime.router.registry.isActive(hostRouteRefs.domain.home));
  const showKernelStatus = state.status !== "ready" && state.status !== "loading";
  const accentStyle = siteOwned
    ? undefined
    : ({ ["--workspace-accent"]: profileDefinition.accent } as React.CSSProperties);

  const shellDataAttrs = {
    "data-content-width": layout.contentWidth,
    "data-density": layout.density,
    "data-workspace-chrome": layout.workspaceChrome,
    "data-mobile-navigation": layout.mobileNavigation,
    "data-product-first": productFirst ? "true" : "false",
    "data-min-contrast": accessibility.minimumContrast,
  } as Record<string, string>;

  return (
    <div
      className={siteOwned ? "flex flex-col min-w-0" : "min-h-dvh flex flex-col"}
      data-t2-ui="workspace"
      style={accentStyle}
      {...shellDataAttrs}
    >
      <a href="#main-content" className="skip-link">Перейти к содержимому</a>

      {/* External site header/footer live outside #root and must not be
          duplicated. Host routing, sidebar and Kernel stay mounted. */}
      {!siteOwned && (
        <Header
          state={state}
          onRetry={onRetry}
          profileDefinition={profileDefinition}
          profileFallback={profileFallback}
          route={breadcrumbRoute}
        />
      )}

      <div
        data-shell-content
        data-t2-ui="layout"
        data-content-width={shellDataAttrs["data-content-width"]}
        className={productFirst ? "flex-1 min-w-0 min-h-0" : "flex-1 grid grid-cols-1 md:grid-cols-[220px_1fr] min-h-0"}
      >
        {!productFirst && <div data-t2-ui="sidebar" className="border-b md:border-b-0 md:border-r border-slate-800">
          <HostModuleNavigation termResolver={termResolver} />
          <HostPanelSurface slot="sidebar" />
        </div>}
        <main
          ref={mainRef}
          id="main-content"
          data-t2-ui="content"
          tabIndex={-1}
          className={productFirst ? "min-w-0 w-full outline-none" : "min-w-0 outline-none"}
        >
          {siteOwned && (showKernelStatus || !productFirst) && (
            <div data-t2-ui="host-status" data-testid="site-owned-host-status" className="px-3 sm:px-4 pt-2">
              {showKernelStatus && <KernelStatus state={state} onRetry={onRetry} />}
              {!productFirst && <Breadcrumbs route={breadcrumbRoute} />}
            </div>
          )}
          <FirstRunWorkspaceGate
            session={session}
            domain={hostDomain}
            workspaceServiceId={hostWorkspace.workspace_service_id}
            profileId={profileId}
            profileFallback={profileFallback}
            devBootstrap={devBootstrap}
            signedOwnerRequired={signedOwnerRequired}
          >
            {runtimeState.status === "error" ? (
              <div role="alert" className="p-4" data-t2-ui="product-error">
                {signedOwnerRequired &&
                  runtimeState.error.message === "T3_D1_CONTROL_INVALIDATION_UNAVAILABLE" ? (
                  <p data-testid="t3-signed-control-reconnect">
                    Подписанный доступ к Control недоступен. Откройте Workspace
                    повторно из локального Control после выбора организации.
                    Повторная загрузка этой страницы не восстанавливает полномочия.
                  </p>
                ) : (
                  <>
                    Не удалось открыть рабочую область.
                    <button className="ml-3 underline" type="button" onClick={() => window.location.reload()}>Повторить</button>
                  </>
                )}
              </div>
            ) : (
              <SignedSelectedWorkspaceGate required={signedOwnerRequired} kernel={kernel}
                profile={profileId} signedKernelAccess={signedKernelAccess}
                 trustedSelectedContext={trustedSelectedContext}>
                {productFirst && <HostPanelSurface slot="sidebar" />}
                <HostDashboardSurface />
                <ModuleRouteOutlet
                  hostProfileId={profileId}
                  profileFallback={profileFallback}
                  presentation={productFirst ? "product" : "host"}
                />
              </SignedSelectedWorkspaceGate>
            )}
            <HostPanelSurface slot="inspector" />
          </FirstRunWorkspaceGate>
        </main>
      </div>

      <HostPanelSurface slot="footer" />
      {!productFirst && <ActionBar kernel={kernel} asFooter={!siteOwned} />}

      {!productFirst && match?.binding.routeRef.id === hostRouteRefs.base.diagnostics.id && <div className="px-3 sm:px-4 py-3 border-t border-slate-800 space-y-2">
        <ConfigurationDiagnosticsPanel
          host={host}
          profileId={profileId}
          fallback={profileFallback}
        />
        <WorkspaceHostRuntimeDiagnosticsSection />
      </div>}

      {!siteOwned && <DomainFooter />}
    </div>
  );
}

interface RuntimeBridgeProps {
  session: KernelSession | null;
  hostWorkspace: WorkspaceConfigDoc;
  profile: ProfileFacade;
  signedKernelAccess?: CreateWorkspaceHostRuntimeInput["signedKernelAccess"];
  signedActivityAccess?: CreateWorkspaceHostRuntimeInput["signedActivityAccess"];
  subscribeSignedAccessInvalidation?: SignedAccessInvalidationSubscription;
  children: React.ReactNode;
}

function AppShellRuntimeBridge({
  session, hostWorkspace, profile, signedKernelAccess, signedActivityAccess,
  subscribeSignedAccessInvalidation, children,
}: RuntimeBridgeProps) {
  const { terminology, layout } = useDomainShell();
  const [activeCapabilities, setActiveCapabilities] = useState<readonly string[]>([]);
  const receiveCapabilities = useCallback((next: readonly string[]) => {
    setActiveCapabilities((previous) => previous.length === next.length && previous.every((cap, i) => cap === next[i]) ? previous : Object.freeze([...next]));
  }, []);
  useEffect(() => { receiveCapabilities([]); }, [session, receiveCapabilities]);
  const workspaceConfig = useMemo(
    () => ({
      modules: (Array.isArray(hostWorkspace.modules)
        ? hostWorkspace.modules
        : []) as readonly Record<string, unknown>[],
    }),
    [hostWorkspace],
  );
  const termResolver = useCallback(
    (key: string, fallback?: string) => {
      const map = terminology as unknown as Record<string, string>;
      if (typeof map[key] === "string") return map[key];
      return fallback ?? key;
    },
    [terminology],
  );
  return (
    <WorkspaceHostRuntimeProvider
      session={session}
      workspaceConfig={workspaceConfig}
      termResolver={termResolver}
      profile={profile}
      activeCapabilities={activeCapabilities}
      compileTimeModuleLoaders={PRODUCT_MODULE_EXTENSIONS}
      preferDomainLanding={layout.workspaceChrome === "site-owned"}
      signedKernelAccess={signedKernelAccess}
      signedActivityAccess={signedActivityAccess}
      subscribeSignedAccessInvalidation={subscribeSignedAccessInvalidation}
    >
      <WorkspaceCapabilityWatcher session={session} onChange={receiveCapabilities} />
      {children}
    </WorkspaceHostRuntimeProvider>
  );
}

/** Live Kernel snapshot for the Workspace selected by the Host router. */
function WorkspaceCapabilityWatcher({ session, onChange }: {
  session: KernelSession | null;
  onChange: (capabilities: readonly string[]) => void;
}) {
  const runtime = useWorkspaceHostRuntimeHandle();
  const currentScopeRef = useRef<string | null>(null);
  useEffect(() => {
    if (!session || !runtime) { if (!session) { currentScopeRef.current = null; onChange([]); } return; }
    let cancelled = false;
    let generation = 0;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    // The live Host ModuleContext is the authority-bound façade. Reading
    // capabilities through a new unsigned session façade would bypass D1.
    const kernel = runtime.contextProvider.createContext("iwxa.workspace.base").kernel;
    const refresh = async () => {
      const ticket = ++generation;
      if (expiryTimer) clearTimeout(expiryTimer);
      expiryTimer = undefined;
      // Match declared routes even before capability-gated modules activate.
      const match = runtime.router.registry.match(runtime.router.currentLocation());
      const routeId = match?.binding.routeRef.id;
      const id = routeId === hostRouteRefs.base.workspace.id || routeId === hostRouteRefs.base.object.id
        ? match?.params.workspaceId : null;
      if (currentScopeRef.current !== id) { currentScopeRef.current = id ?? null; onChange([]); }
      if (!id || !kernel.hasOperation("t1.getWorkspace")) return;
      try {
        const view = await kernel.authorizationForWorkspace(id);
        if (cancelled || ticket !== generation) return;
        const expires = view.valid_until ? Date.parse(view.valid_until) : Number.NaN;
        const isCurrent = view.decision === "ACTIVE" && view.workspace_id === id &&
          view.audience_service_id === kernel.sessionInfo.service_id &&
          Number.isFinite(expires) && expires > Date.now();
        const allowed = isCurrent ? [...new Set(view.effective_capabilities)].filter((cap) => typeof cap === "string" && cap.length > 0).sort() : [];
        onChange(allowed);
        if (isCurrent) {
          expiryTimer = setTimeout(() => { void refresh(); }, Math.max(1, Math.min(30_000, expires - Date.now())));
        }
      } catch {
        if (!cancelled && ticket === generation) onChange([]);
      }
    };
    const unsubscribe = runtime.router.subscribe(() => { void refresh(); });
    void refresh();
    return () => { cancelled = true; ++generation; unsubscribe(); if (expiryTimer) clearTimeout(expiryTimer); };
  }, [session, runtime, onChange]);
  return null;
}
