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
import type {
  T3ActivityReadOptions, T3ActivityProjection, T3SignedActivityAccess,
  T3OriginalReconcilerOwner,
  createTrustedReconciliationAdmission, createTrustedReconciliationKernelApply,
  createTrustedNativeContinuation, type T3NativeContinuationOwner,
} from "../../t3/index.mjs";

/** Existing private recipient Reconciler, signed Access and owner review.
 * This is a Host-only capability, never a second authority or public module. */
export interface T3TrustedReconciliationOwner {
  readonly reconciler:T3OriginalReconcilerOwner;
  readonly signedAccess:T3SignedActivityAccess;
  readonly recipientForContext:(context:unknown)=>string|Promise<string>;
  readonly confirmHumanReview:(review:unknown)=>boolean|Promise<boolean>;
  readonly apply?:Readonly<{
    stageFromOriginalOwner:(query:unknown)=>unknown|Promise<unknown>;
    confirmSeparateApply:(decision:unknown)=>boolean|Promise<boolean>;
  }>;
}
export type T3ReconciliationHostPort =
  ReturnType<typeof createTrustedReconciliationAdmission> &
  Partial<ReturnType<typeof createTrustedReconciliationKernelApply>>;


/** Original Access/Control owner invalidation signal, supplied by the
 * trusted compiled Host. No new authority or polling is implemented here. */
export type SignedAccessInvalidationSubscription =
  (listener: (reason?: "unavailable") => void) => () => void;

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
  /** Optional original D3 owner. Null until installed by a trusted product. */
  readonly reconciliation: T3ReconciliationHostPort | null;
  /** Optional D6 continuation into an already-installed signed native owner. */
  readonly nativeContinuation: ReturnType<typeof createTrustedNativeContinuation> | null;
  /** Immediately invalidate signed ModuleContext and Activity access on session loss.
   * Module deactivation still runs later through the original serialized teardown. */
  readonly invalidate: () => void;
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
  signedActivityAccess?: T3SignedActivityAccess |
    (() => T3SignedActivityAccess | null | Promise<T3SignedActivityAccess | null>);
  /** Existing owner for signed authority on all inherited T1/T2 module calls.
   * Explicitly separate from Activity-specific DATA consent. */
  signedKernelAccess?: T3SignedActivityAccess |
    ((operation: string) => T3SignedActivityAccess | null | Promise<T3SignedActivityAccess | null>);
  /** Installed original recipient Reconciler and signed owner, never portable JSON. */
  reconciliationOwner?: T3TrustedReconciliationOwner;
  /** Already checked native D3 port on the existing isolated Control carrier. */
  reconciliationPort?: T3ReconciliationHostPort;
  /** Only the trusted installed product may supply these callbacks. */
  nativeContinuationOwner?: T3NativeContinuationOwner;
  confirmNativeContinuation?: Parameters<typeof createTrustedNativeContinuation>[0]["confirmHuman"];
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


