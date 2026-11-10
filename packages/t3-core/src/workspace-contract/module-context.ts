/**
 * Scoped Host API delivered to a module's `activate(context)` function.
 *
 * DESIGN CONSTRAINTS (enforced by tests and static-check):
 *   - No `IDBDatabase`, `indexedDB`, or any raw Local Store handle.
 *   - No raw Runtime internals (no `IWXAClient`, no `window.IWXA`).
 *   - No mutable registry maps — every host surface is exposed via
 *     narrow function facets that the Host owns.
 *   - No configuration secrets (kernel URLs, tokens, project ids).
 *   - `kernel` is a capability-checked façade over the full Runtime
 *     Contract 1.0.0 tier surfaces (T1 + T2). Every method MUST check
 *     `session.granted_operations` for its exact `OperationId` before
 *     dispatching; an ungranted call throws `OperationNotGrantedError`.
 *
 * PROMPT 12 §1 — the façade now spans the full trusted surface:
 * reads, writes, workspace lifecycle (soft-delete / restore / purge)
 * and the exchange pipeline (export / import). It does NOT expose
 * `session`, `adapter`, `window.IWXA`, or Runtime internals.
 */

import type { OperationId } from "../kernel-client";
import type {
  WorkspaceRecord,
  ObjectRecord,
  ObjectWithRelations,
  EventRecord,
  ListObjectsQuery,
  ListWorkspacesOptions,
  PutObjectInput,
  DeleteObjectInput,
  CommitResult,
  PutRelationInput,
  DeleteRelationInput,
  RelationCommitResult,
  RelationDeleteResult,
  ListAssetsQuery,
  AssetRecord,
  AssetWithBytes,
  PutAssetInput,
  DeleteAssetInput,
  AssetCommitResult,
  AssetDeleteResult,
  CreateWorkspaceInput,
  Level,
  SoftDeleteWorkspaceReceipt,
  RestoreWorkspaceReceipt,
  PurgePreviewInput,
  PurgePreview,
  PurgeCommitInput,
  PurgeReceipt,
  ExportOptions,
  ExportPreview,
  PackageArtifact,
  ConfirmExportInput,
  ConfirmExportReceipt,
  SecureImportPreview,
  SecureCommitInput,
  ImportReceipt,
  CapabilityAuthorizationView,
} from "../kernel-client/contracts/runtime-1.3.0";
import type { RouteRef } from "./route-ref";

// --- Kernel façade ---------------------------------------------------------

/**
 * Capability-checked façade over the workspace adapter. Every method is
 * guaranteed to check `session.granted_operations` before dispatching; a
 * call to an ungranted operation throws `OperationNotGrantedError`.
 *
 * The set of methods mirrors Runtime Contract 1.3.0 T1 + T2 surfaces.
 * No new DTOs are declared here — every input/output type is imported
 * from the normative `runtime-1.3.0` snapshot.
 */
import type { CommitObjectGraphInput, CommitObjectGraphReceipt } from "../kernel-client/contracts/runtime-1.3.0";
export interface KernelFacade {
  /** Present only after contract + grant + method negotiation succeeds. */
  commitObjectGraph?: (input: CommitObjectGraphInput) => Promise<CommitObjectGraphReceipt>;
  /** Returns true when the operation is granted to the current session. */
  hasOperation(op: OperationId): boolean;
  /** Immutable snapshot of the granted operations, for capability checks. */
  readonly grantedOperations: readonly OperationId[];
  /** Immutable snapshot of the granted levels. */
  readonly grantedLevels: readonly Level[];
  /**
   * Read-only diagnostic snapshot of the underlying kernel session. Only
   * inert identifiers safe to render in chrome/diagnostics panels. NEVER
   * expose the raw `KernelSession` — this bag is the only sanctioned
   * surface for chrome components (ActionBar, diagnostics).
   */
  readonly sessionInfo: {
    readonly mode: string;
    readonly contract_version: string;
    readonly runtime_version: string;
    readonly service_id: string;
  };

  // ---- T1 reads -----------------------------------------------------------
  listWorkspaces(options?: ListWorkspacesOptions): Promise<WorkspaceRecord[]>;
  getWorkspace(workspaceId: string): Promise<WorkspaceRecord | null>;
  createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceRecord>;

  listObjects(query: ListObjectsQuery): Promise<ObjectRecord[]>;
  getObject(
    workspaceId: string,
    objectId: string,
  ): Promise<ObjectWithRelations | null>;
  listEventsSince(
    workspaceId: string,
    since?: string,
  ): Promise<EventRecord[]>;

  // ---- T1 writes ----------------------------------------------------------
  putObject(input: PutObjectInput): Promise<CommitResult>;
  deleteObject(input: DeleteObjectInput): Promise<CommitResult>;
  putRelation(input: PutRelationInput): Promise<RelationCommitResult>;
  deleteRelation(input: DeleteRelationInput): Promise<RelationDeleteResult>;

  // ---- T1 assets ----------------------------------------------------------
  listAssets(query: ListAssetsQuery): Promise<AssetRecord[]>;
  getAsset(workspaceId: string, assetId: string): Promise<AssetWithBytes | null>;
  putAsset(input: PutAssetInput): Promise<AssetCommitResult>;
  deleteAsset(input: DeleteAssetInput): Promise<AssetDeleteResult>;

  // ---- T1 workspace lifecycle --------------------------------------------
  softDeleteWorkspace(workspaceId: string): Promise<SoftDeleteWorkspaceReceipt>;
  restoreWorkspace(workspaceId: string): Promise<RestoreWorkspaceReceipt>;
  purgePreview(input: PurgePreviewInput): Promise<PurgePreview>;
  purgeCommit(input: PurgeCommitInput): Promise<PurgeReceipt>;
  purgeCancel(purgeToken: string): Promise<boolean>;

  // ---- T2 exchange (export/import) ---------------------------------------
  exportPreview(options: ExportOptions): Promise<ExportPreview>;
  exportPackage(options: ExportOptions): Promise<PackageArtifact>;
  confirmExport(input: ConfirmExportInput): Promise<ConfirmExportReceipt>;

  importPreview(zipBytes: Uint8Array): Promise<SecureImportPreview>;
  importCommit(input: SecureCommitInput): Promise<ImportReceipt>;
  importCancel(previewToken: string): Promise<boolean>;

  // ---- Capability authorization (read-only; grant/receipt never exposed) --
  authorizationForWorkspace(workspaceId: string): Promise<CapabilityAuthorizationView>;
  hasCapability(workspaceId: string, capabilityId: string): Promise<boolean>;
}

// --- Host surfaces ---------------------------------------------------------

/**
 * Router façade — opaque `RouteRef` only. Modules never see raw URLs,
 * hashes, or query strings. Host owns the mapping from `RouteRef` to a
 * concrete URL and may change routing strategy without breaking modules.
 *
 * PROMPT 12 §3.
 */
export interface RouterFacade {
  /** Navigate to a route by opaque reference. */
  navigate(route: RouteRef, params?: Readonly<Record<string, string>>): void;
  /** Currently active route reference, or `null` on an unknown surface. */
  current(): RouteRef | null;
}

export interface CommandsFacade {
  /**
   * True iff a command with the given id is registered by an active
   * module AND all its required operations are granted to the current
   * session. UI MUST use this to hide affordances for commands that
   * are not currently invocable, but MUST NOT rely on it as a
   * security check — `invoke()` re-verifies capabilities before
   * dispatch (PROMPT 29 §12).
   */
  has(commandId: string): boolean;
  /**
   * Invoke a command by id — Host owns dispatch and error isolation.
   * The handler runs against the OWNER module's context (PROMPT 29
   * §3), not the caller's; the caller cannot substitute a context.
   * Return type is `unknown` by default; callers that expect a
   * Runtime receipt pass the receipt type as `TResult`.
   */
  invoke<TResult = unknown>(
    commandId: string,
    args?: unknown,
  ): Promise<TResult>;
}


export interface ViewsFacade {
  /**
   * Ask the Host to render the best viewer for `(profileId, schemaId,
   * schemaVersion, surface)`. Returns a boolean indicating whether a
   * viewer was found; the module cannot inspect other modules' loaders.
   */
  resolve(query: {
    profileId: string;
    schemaId: string;
    schemaVersion: string;
    surface: "preview" | "list" | "detail" | "player";
  }): boolean;
}

export interface PanelsFacade {
  /** Request the Host to open a panel by contribution id. */
  open(panelId: string): void;
  close(panelId: string): void;
}

export interface DashboardFacade {
  /** Refresh a dashboard card by contribution id. */
  refresh(cardId: string): void;
}

export interface TerminologyFacade {
  /**
   * Resolve a terminology key against the currently active
   * `workspace.config.json → terminology`, falling back to the built-in
   * Host defaults.
   */
  term(key: string, fallback?: string): string;
}

export interface DiagnosticsFacade {
  /** Report a diagnostic through the Host diagnostics surface. */
  report(diagnostic: {
    code: string;
    message: string;
    details?: unknown;
  }): void;
}

export interface CurrentWorkspaceFacade {
  /**
   * The workspace the shell is currently focused on, or `null` when the
   * user is on a domain-level surface. Modules MUST NOT cache this value.
   */
  get(): WorkspaceRecord | null;
  /** Subscribe to workspace-focus changes; returns an unsubscribe fn. */
  subscribe(listener: (ws: WorkspaceRecord | null) => void): () => void;
  /**
   * PROMPT 28 §9 — set the current workspace focus. Only the owning
   * module (`iwxa.workspace.base`) may claim; every other caller sees
   * this method as a no-op (a diagnostic is emitted through the
   * module's `diagnostics` sink).
   */
  claim(ws: WorkspaceRecord | null): void;
  /** Clear the current workspace focus. Same owner-gating as `claim`. */
  release(): void;
}


/**
 * Read-only view of the workspace profile active in the current Host
 * session. Modules use this to render profile-scoped copy and to
 * decide whether to expose profile-specific affordances.
 *
 * The Host owns the profile source of truth; modules MUST treat this
 * facade as immutable and MUST NOT mutate the definition object.
 */
export interface ProfileFacade {
  /** Stable profile identifier (matches `WorkspaceProfileId`). */
  readonly id: string;
  /**
   * Host-owned profile definition. Structurally-typed subset — modules
   * MUST treat this object as read-only and MUST NOT rely on keys
   * beyond those listed. Concrete definitions carry additional fields
   * (sections, unknownObjectsSection, logoText) which modules access
   * via a widening cast when they truly need them.
   */
  readonly definition: {
    readonly id: string;
    readonly label: string;
    readonly description: string;
    readonly accent: string;
  };
  /** True when the Host substituted the generic profile for an unknown id. */
  readonly fallback: boolean;
}

// --- Aggregate context -----------------------------------------------------

export interface WorkspaceModuleContext {
  kernel: KernelFacade;
  router: RouterFacade;
  commands: CommandsFacade;
  views: ViewsFacade;
  panels: PanelsFacade;
  dashboard: DashboardFacade;
  terminology: TerminologyFacade;
  diagnostics: DiagnosticsFacade;
  currentWorkspace: CurrentWorkspaceFacade;
  profile: ProfileFacade;
}

/**
 * Canonical list of the ONLY keys a module may see on its context.
 * Anything outside this set is a Workspace Contract violation and MUST NOT
 * be added by the future ModuleRegistry.
 */
export const ALLOWED_MODULE_CONTEXT_KEYS = [
  "kernel",
  "router",
  "commands",
  "views",
  "panels",
  "dashboard",
  "terminology",
  "diagnostics",
  "currentWorkspace",
  "profile",
] as const satisfies readonly (keyof WorkspaceModuleContext)[];


/**
 * Explicit blocklist for `assertNoForbiddenContextKeys()`. Named here so
 * regressions in the ModuleRegistry are caught by property tests instead
 * of silent object-spread accidents.
 */
export const FORBIDDEN_MODULE_CONTEXT_KEYS = [
  "indexedDB",
  "IDBDatabase",
  "localStore",
  "runtime",
  "client",
  "session",
  "adapter",
  "registry",
  "window",
  "IWXA",
  "secrets",
  "config",
] as const;

export function assertNoForbiddenContextKeys(ctx: object): void {
  for (const key of FORBIDDEN_MODULE_CONTEXT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(ctx, key)) {
      throw new Error(
        `WorkspaceModuleContext contains forbidden key "${key}" — Workspace Contract v0.1 does not expose it to modules.`,
      );
    }
  }
}

/**
 * Canonical list of `KernelFacade` methods that MUST be present. Used by
 * static-check and by property tests to detect accidental narrowing.
 */
export const REQUIRED_KERNEL_FACADE_METHODS = [
  "hasOperation",
  "authorizationForWorkspace",
  "hasCapability",
  // reads
  "listWorkspaces",
  "getWorkspace",
  "createWorkspace",
  "listObjects",
  "getObject",
  "listEventsSince",
  // writes
  "putObject",
  "deleteObject",
  "putRelation",
  "deleteRelation",
  "listAssets",
  "getAsset",
  "putAsset",
  "deleteAsset",
  // lifecycle
  "softDeleteWorkspace",
  "restoreWorkspace",
  "purgePreview",
  "purgeCommit",
  "purgeCancel",
  // exchange
  "exportPreview",
  "exportPackage",
  "confirmExport",
  "importPreview",
  "importCommit",
  "importCancel",
] as const satisfies readonly (keyof KernelFacade)[];
