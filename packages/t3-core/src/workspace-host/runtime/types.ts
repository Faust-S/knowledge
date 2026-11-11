/**
 * WorkspaceHostRuntime types (PROMPT 19 §4-§6, PROMPT 20 §1).
 */

import type { KernelSession } from "@/kernel-client/types";
import type { OperationId } from "@/kernel-client";
import type {
  ModuleStatusRecord,
  ModuleContextProvider,
  ModuleLoaderTable,
} from "../modules";
import type { CompositionDiagnostic } from "@/composition";
import type { RegistryDiagnostic } from "../modules/module-diagnostics";
import type { HostRouter } from "../router";
import type { HostContributionHub } from "../registries";
import type { ModuleRegistry } from "../modules";
import type { CurrentWorkspaceStore } from "../context";
import type { DashboardRefreshState } from "../context/create-dashboard-facade";
import type { HostPanelsState } from "../context/create-panels-facade";
import type { T3ActivityReadOptions, T3ActivityProjection, T3SignedActivityAccess } from "../../t3/index.mjs";

export type WorkspaceHostRuntimeStatus =
  | "idle"
  | "starting"
  | "ready"
  | "error"
  | "stopping";

export interface WorkspaceHostRuntimeDiagnostics {
  readonly composition: readonly CompositionDiagnostic[];
  readonly modules: readonly RegistryDiagnostic[];
}

export interface WorkspaceHostRuntimeHandle {
  readonly router: HostRouter;
  readonly hub: HostContributionHub;
  readonly moduleRegistry: ModuleRegistry;
  readonly moduleSnapshot: readonly ModuleStatusRecord[];
  readonly currentWorkspaceStore: CurrentWorkspaceStore;
  readonly dashboardState: DashboardRefreshState;
  readonly panelsState: HostPanelsState;
  readonly contextProvider: ModuleContextProvider;
  readonly grantedOperations: readonly OperationId[];
  /** Host defense-in-depth snapshot; Kernel authorization remains authoritative. */
  readonly activeCapabilities: readonly string[];
  readonly diagnostics: WorkspaceHostRuntimeDiagnostics;
  /** Selected Workspace Activity via existing signed D1 owner, not new Store. */
  readonly readAuthorizedActivity: (options: T3ActivityReadOptions) => Promise<T3ActivityProjection>;
  readonly dispose: () => Promise<void>;
}

export type WorkspaceHostRuntimeState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "ready"; runtime: WorkspaceHostRuntimeHandle }
  | { status: "error"; error: Error; diagnostics: WorkspaceHostRuntimeDiagnostics }
  | { status: "stopping" };

export interface CreateWorkspaceHostRuntimeInput {
  session: KernelSession;
  /** Existing signed D1 Access owner, installed by the trusted embedding Host only. */
  signedActivityAccess?: T3SignedActivityAccess;
  /** Read-only capability snapshot for module/contribution visibility guards. */
  activeCapabilities?: readonly string[];
  workspaceConfig: { modules: readonly Record<string, unknown>[] };
  /**
   * Optional modules statically imported by the embedding Host build.
   * Workspace configuration may select these ids but can never supply
   * or change their loader implementation.
   */
  compileTimeModuleLoaders?: ModuleLoaderTable;
  termResolver: (key: string, fallback?: string) => string;
  /**
   * Active workspace profile facade — handed to every module context.
   * Optional in tests; the runtime substitutes a minimal generic
   * fallback so mock harnesses can boot without wiring a profile.
   */
  profile?: import("@/workspace-contract").ProfileFacade;
  /**
   * When true, the runtime binds an actual `createLegacyHashDriver`
   * against `window`. Tests may pass `false` and provide `hostRouter`
   * externally in future extensions.
   */
  bindLegacyHashDriver?: boolean;
  /** Site-owned landing on an active compiled domain, without changing permissions. */
  preferDomainLanding?: boolean;
}


