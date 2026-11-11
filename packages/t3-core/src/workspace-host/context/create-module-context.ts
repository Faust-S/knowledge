/**
 * createModuleContext — production `ModuleContextProvider` (PROMPT 17
 * §7 + §11 + §12).
 *
 * Assembles a scoped, frozen `WorkspaceModuleContext` for one module:
 *   - kernel: capability-checked adapter façade;
 *   - router: Host Router-backed facade (opaque RouteRef only);
 *   - commands / views / panels / dashboard: registry-backed facades;
 *   - terminology: DomainShellProvider-backed lookup;
 *   - diagnostics: sink stamped with the module id;
 *   - currentWorkspace: read-only view of the Host in-memory store.
 *
 * The result is `Object.freeze`d and `assertNoForbiddenContextKeys`ed
 * before being handed to the ModuleRegistry.
 */

import {
  ALLOWED_MODULE_CONTEXT_KEYS,
  assertNoForbiddenContextKeys,
  type CurrentWorkspaceFacade,
  type TerminologyFacade,
  type WorkspaceModuleContext,
} from "@/workspace-contract";
import type { OperationId } from "@/kernel-client";
import type { KernelSession } from "@/kernel-client/types";
import type { WorkspaceRecord } from "@/kernel-client/contracts/runtime-1.3.0";
import type { HostRouter } from "../router";
import { createRouterFacade } from "../router";
import type { HostContributionHub } from "../registries";
import type { ModuleContextProvider } from "../modules/module-types";
import { CurrentWorkspaceStore } from "./current-workspace-store";
import { createKernelFacade } from "./create-kernel-facade";
import type { T3SignedActivityAccess } from "@/t3/index.mjs";
import { createCommandsFacade } from "./create-commands-facade";
import { createViewsFacade } from "./create-views-facade";
import { createPanelsFacade, type PanelsState } from "./create-panels-facade";
import {
  createDashboardFacade,
  type DashboardState,
} from "./create-dashboard-facade";
import {
  createDiagnosticsFacade,
  type DiagnosticSink,
} from "./create-diagnostics-facade";

export interface ModuleContextFactoryInput {
  session: KernelSession;
  /** Host-owned signed authority for the complete inherited Kernel facade. */
  signedKernelAccess?: T3SignedActivityAccess |
    (() => T3SignedActivityAccess | null | Promise<T3SignedActivityAccess | null>);
  router: HostRouter;
  hub: HostContributionHub;
  currentWorkspaceStore: CurrentWorkspaceStore;
  /** Host defense-in-depth capability snapshot; never a portable authority. */
  activeCapabilities?: readonly string[];
  /** Resolver for `terminology.term(key, fallback?)`. */
  termResolver: (key: string, fallback?: string) => string;
  /** Host-owned panel state controller. */
  panelsState: PanelsState;
  /** Host-owned dashboard state controller. */
  dashboardState: DashboardState;
  /** Host diagnostic sink. */
  diagnosticsSink: DiagnosticSink;
  /** Active workspace profile (id, definition, fallback flag). Optional in tests. */
  profile?: import("@/workspace-contract").ProfileFacade;
}

export function createModuleContextProvider(
  input: ModuleContextFactoryInput,
): ModuleContextProvider {
  const grantedOperations = Object.freeze(
    [...(input.session.granted_operations ?? [])],
  ) as readonly OperationId[];
  const activeCapabilities = Object.freeze([...(input.activeCapabilities ?? [])]);
  // Signed D1 state (only original T2 import/purge preview tokens) must remain
  // coherent across the modules of one Host, without copying the T2 session.
  const signedKernel = input.signedKernelAccess
    ? createKernelFacade({session: input.session, signedKernelAccess: input.signedKernelAccess})
    : null;

  /**
   * Internal factory — same shape as the public `createContext`, but
   * also accepts the current command `invocationStack` so that
   * `context.commands` handed to a running command handler carries
   * the parent chain forward (PROMPT 29 §4).
   */
  function build(
    moduleId: string,
    invocationStack: readonly string[],
  ): WorkspaceModuleContext {
    const kernel = signedKernel ?? createKernelFacade({ session: input.session });
    const router = createRouterFacade(input.router);
    const commands = createCommandsFacade({
      moduleId,
      registry: input.hub.commands,
      grantedOperations,
      activeCapabilities,
      contextResolver: (ownerModuleId, stack) => build(ownerModuleId, stack),
      invocationStack,
    });
    const views = createViewsFacade(input.hub.viewers, grantedOperations, activeCapabilities);
    const panels = createPanelsFacade({
      registry: input.hub.panels,
      state: input.panelsState,
      grantedOperations,
      activeCapabilities,
    });
    const dashboard = createDashboardFacade({
      registry: input.hub.dashboard,
      state: input.dashboardState,
      grantedOperations,
      activeCapabilities,
    });
    const terminology: TerminologyFacade = Object.freeze({
      term(key: string, fallback?: string) {
        return input.termResolver(key, fallback);
      },
    });
    const diagnostics = createDiagnosticsFacade({
      moduleId,
      sink: input.diagnosticsSink,
    });
    const CURRENT_WORKSPACE_OWNER = "iwxa.workspace.base";
    const currentWorkspace: CurrentWorkspaceFacade = Object.freeze({
      get: () => input.currentWorkspaceStore.get(),
      subscribe: (l: (w: WorkspaceRecord | null) => void) =>
        input.currentWorkspaceStore.subscribe(l),
      claim: (ws: WorkspaceRecord | null) => {
        if (moduleId !== CURRENT_WORKSPACE_OWNER) {
          input.diagnosticsSink.report({
            code: "current-workspace-claim-denied", moduleId,
            message: `Module "${moduleId}" cannot claim currentWorkspace — owner is ${CURRENT_WORKSPACE_OWNER}`,
          });
          return;
        }
        input.currentWorkspaceStore.set(ws);
      },
      release: () => {
        if (moduleId !== CURRENT_WORKSPACE_OWNER) {
          input.diagnosticsSink.report({
            code: "current-workspace-release-denied", moduleId,
            message: `Module "${moduleId}" cannot release currentWorkspace — owner is ${CURRENT_WORKSPACE_OWNER}`,
          });
          return;
        }
        input.currentWorkspaceStore.set(null);
      },
    });


    const ctx: WorkspaceModuleContext = {
      kernel,
      router,
      commands,
      views,
      panels,
      dashboard,
      terminology,
      diagnostics,
      currentWorkspace,
      profile: input.profile ?? Object.freeze({
        id: "generic",
        definition: Object.freeze({ id: "generic", label: "Generic", description: "", accent: "#64748b" }),
        fallback: true,
      }),
    };

    // Assert the shape — no extra keys, no forbidden keys.
    const keys = Object.keys(ctx);
    const allowed = new Set<string>(ALLOWED_MODULE_CONTEXT_KEYS);
    for (const k of keys) {
      if (!allowed.has(k)) {
        throw new Error(
          `ModuleContext for "${moduleId}" carries unknown key "${k}".`,
        );
      }
    }
    assertNoForbiddenContextKeys(ctx);

    return Object.freeze(ctx);
  }

  return {
    createContext(moduleId: string): WorkspaceModuleContext {
      return build(moduleId, []);
    },
  };
}
