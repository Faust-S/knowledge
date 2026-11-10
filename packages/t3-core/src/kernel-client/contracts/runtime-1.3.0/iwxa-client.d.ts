// -------- error-catalogue.d.ts --------
/**
 * Canonical IWXA Runtime Contract error catalogue.
 *
 * SOURCE OF TRUTH for every error code emitted through the public runtime
 * surface. `scripts/build-contracts.mjs` imports this file and emits
 * `error-catalogue.json` inside the contract ZIP. Do not maintain a second
 * copy — CI parity tests fail if the JSON drifts from this list.
 *
 * Every error class across the kernel MUST use `ErrorCode`. There is no
 * separate `ConnectErrorCode` / `WorkspaceApiErrorCode` / `ImportErrorCode`
 * union — they are `Pick<ErrorCode, ...>` subsets of this catalogue.
 */
export type ErrorLocation = "loader" | "loader/runtime" | "runtime" | "workspace-api" | "package-import" | "package-export";
export type ErrorDefinition = {
    where: ErrorLocation;
    meaning: string;
};
export declare const ERROR_DEFINITIONS: {
    readonly CONFIG_INVALID: ErrorDefinition;
    readonly SECRET_FIELD_FORBIDDEN: ErrorDefinition;
    readonly ORIGIN_MISMATCH: ErrorDefinition;
    readonly UPDATE_REQUIRED: ErrorDefinition;
    readonly UNKNOWN_SERVICE: ErrorDefinition;
    readonly BASE_PATH_MISMATCH: ErrorDefinition;
    readonly PASSPORT_INVALID: ErrorDefinition;
    readonly LEVEL_NOT_ALLOWED: ErrorDefinition;
    readonly MISSING_LEVEL: ErrorDefinition;
    readonly KERNEL_UNAVAILABLE: ErrorDefinition;
    readonly MIGRATION_REQUIRED: ErrorDefinition;
    readonly QUOTA_EXCEEDED: ErrorDefinition;
    readonly INTEGRITY_FAILED: ErrorDefinition;
    readonly PERMISSION_DENIED: ErrorDefinition;
    readonly WORKSPACE_NOT_FOUND: ErrorDefinition;
    readonly WORKSPACE_READ_ONLY: ErrorDefinition;
    readonly WORKSPACE_DELETED: ErrorDefinition;
    readonly OBJECT_NOT_FOUND: ErrorDefinition;
    readonly RELATION_NOT_FOUND: ErrorDefinition;
    readonly ASSET_NOT_FOUND: ErrorDefinition;
    readonly CONFLICT: ErrorDefinition;
    readonly UNSUPPORTED_SCHEMA: ErrorDefinition;
    readonly SCHEMA_NOT_DECLARED: ErrorDefinition;
    readonly SCHEMA_INVALID: ErrorDefinition;
    readonly SCHEMA_CONFLICT: ErrorDefinition;
    readonly SCHEMA_DIGEST_MISMATCH: ErrorDefinition;
    readonly ZIP_PARSE: ErrorDefinition;
    readonly UNSUPPORTED_ZIP64: ErrorDefinition;
    readonly COMPRESSION_RATIO: ErrorDefinition;
    readonly ABSOLUTE_PATH: ErrorDefinition;
    readonly PATH_TRAVERSAL: ErrorDefinition;
    readonly DUPLICATE_PATH: ErrorDefinition;
    readonly EXCESSIVE_SIZE: ErrorDefinition;
    readonly INVALID_MANIFEST: ErrorDefinition;
    readonly MANIFEST_WORKSPACE_MISMATCH: ErrorDefinition;
    readonly VERIFY_FAILED: ErrorDefinition;
    readonly UNSUPPORTED_FORMAT: ErrorDefinition;
    readonly UNSUPPORTED_ENCRYPTION: ErrorDefinition;
    readonly NDJSON_PARSE: ErrorDefinition;
    readonly INVALID_RECORD: ErrorDefinition;
    readonly DUPLICATE_RECORD: ErrorDefinition;
    readonly DANGLING_REFERENCE: ErrorDefinition;
    readonly MISSING_ASSET: ErrorDefinition;
    readonly MISSING_DEPENDENCY: ErrorDefinition;
    readonly INVALID_PLAN: ErrorDefinition;
    readonly WORKSPACE_MAP_INVALID: ErrorDefinition;
    readonly PACKAGE_DIGEST_MISMATCH: ErrorDefinition;
    readonly IMPORT_CANCELLED: ErrorDefinition;
    readonly PREVIEW_REQUIRED: ErrorDefinition;
    readonly PREVIEW_TOKEN_INVALID: ErrorDefinition;
    readonly PREVIEW_TOKEN_USED: ErrorDefinition;
    readonly PREVIEW_EXPIRED: ErrorDefinition;
    readonly PREVIEW_SERVICE_MISMATCH: ErrorDefinition;
    readonly PREVIEW_ORIGIN_MISMATCH: ErrorDefinition;
    readonly PLAN_NOT_IN_PREVIEW: ErrorDefinition;
    readonly CAPABILITY_DENIED: ErrorDefinition;
    readonly REJECT_DIVERGED_IMPORT_REQUIRES_RECONCILIATION: ErrorDefinition;
    readonly PURGE_REQUIRED: ErrorDefinition;
    readonly PURGE_TOKEN_INVALID: ErrorDefinition;
    readonly PURGE_TOKEN_USED: ErrorDefinition;
    readonly PURGE_EXPIRED: ErrorDefinition;
    readonly PURGE_SERVICE_MISMATCH: ErrorDefinition;
    readonly PURGE_ORIGIN_MISMATCH: ErrorDefinition;
    readonly PURGE_WORKSPACE_MISMATCH: ErrorDefinition;
    readonly PURGE_STATE_CHANGED: ErrorDefinition;
    readonly PURGE_NOT_TRASHED: ErrorDefinition;
    readonly PURGE_EXPORT_NOT_CONFIRMED: ErrorDefinition;
    readonly PURGE_CHALLENGE_MISMATCH: ErrorDefinition;
    readonly NO_INDEXEDDB: ErrorDefinition;
    readonly BLOCKED: ErrorDefinition;
    readonly OPEN_FAILED: ErrorDefinition;
    readonly UPGRADE_FAILED: ErrorDefinition;
    readonly TX_ABORTED: ErrorDefinition;
    readonly WEB_LOCKS_UNAVAILABLE: ErrorDefinition;
    readonly LOCK_UNAVAILABLE: ErrorDefinition;
    readonly MISSING_CAPABILITY: ErrorDefinition;
    readonly UNKNOWN_SCHEMA: ErrorDefinition;
    readonly MIGRATION_CONFLICT: ErrorDefinition;
    readonly MIGRATION_FAILED: ErrorDefinition;
    readonly NO_MIGRATION_PATH: ErrorDefinition;
};
export type ErrorCode = keyof typeof ERROR_DEFINITIONS;
/** Legacy readonly array shape kept for `scripts/build-contracts.mjs`. */
export type ErrorEntry = {
    code: ErrorCode;
    where: ErrorLocation;
    meaning: string;
};
export declare const ERROR_CATALOGUE: readonly ErrorEntry[];
export declare function toCataloguePayload(): {
    contract_version: "1.3.0";
    errors: {
        code: ErrorCode;
        where: ErrorLocation;
        meaning: string;
    }[];
};


// -------- index.d.ts --------
/**
 * IWXA Public Runtime Contract — 1.2.0.
 *
 * SOURCE OF TRUTH for the public surface exposed by `window.IWXA.connect()`.
 * Consumed by Universal Workspace and every application module.
 *
 * ABSOLUTE RULES for this file:
 *   1. NO imports from `../local-store/*`, `../workspace-api/*`,
 *      `../package/*`, `../sync/*`, `../config/*`, `../contracts/*`.
 *   2. NO reference to `IDBDatabase`, `IDBTransaction`, `IDBObjectStore`,
 *      physical migrations, or any private token store.
 *   3. Wire format is snake_case; there is EXACTLY one spelling for every
 *      field. No `Promise<unknown>` in the public tier surfaces.
 *   4. Extending 1.0.x is limited to compatible fixes; 1.1.0/1.2.0 may add
 *      backward-compatible members; 2.0.0 is required for breaking changes.
 */
export declare const CONTRACT_VERSION: "1.3.0";
export type Level = "T0" | "T1" | "T2";
export declare const LEVELS: readonly ["T0", "T1", "T2"];
export type ConnectMode = "full" | "limited" | "read-only" | "update-required" | "emergency-export";
/**
 * Directional package-scope enums. `export_scope` and `import_scope`
 * intentionally have DIFFERENT domains — pairing `export_scope=writable_objects`
 * or `import_scope=readable_objects` is meaningless and is rejected by the
 * canonical passport validator at build time and connect time.
 */
export type ExportPackageScope = "readable_objects" | "workspace";
export type ImportPackageScope = "writable_objects" | "workspace";
export type ServicePermissions = {
    /** Explicit composite authority; old write grants never imply this permission. */
    operations?: Array<"t1.commitObjectGraph">;
    workspace: {
        list: boolean;
        read: boolean;
        create: boolean;
        soft_delete: boolean;
        restore: boolean;
        purge: boolean;
    };
    objects: {
        read: string[];
        write: string[];
        delete: string[];
    };
    events: {
        read_scope: "service" | "workspace";
    };
    packages: {
        export: boolean;
        import: boolean;
        export_scope: ExportPackageScope;
        import_scope: ImportPackageScope;
    };
};
/**
 * Reference from an embedded property to another schema declared elsewhere
 * (either by the same passport or by another module in the same domain
 * registry). Only the `(schema_id, schema_version)` pair travels in the
 * wire format — no inline duplication of shape.
 */
export type EmbeddedSchemaReference = {
    schema_id: string;
    schema_version: string;
};
/**
 * A single schema owned by a service passport. The key of the containing
 * record IS the `schema_id`; therefore this shape carries `schema_version`,
 * the `preserve_unknown` policy, the JSON Schema Draft 2020-12 payload for
 * `data`, and (optionally) references to other schemas embedded inside it.
 *
 * Constraints enforced by validators (Zod + JSON Schema mirror):
 *   - `schema_version` ~= `^\d+\.\d+\.\d+$`
 *   - `json_schema.type === "object"`
 *   - `preserve_unknown=false` ⇒ `json_schema.additionalProperties === false`
 *   - `preserve_unknown=true`  ⇒ `additionalProperties` may be boolean or schema
 *   - `embedded` must be present, may be `{}`
 *   - no stray top-level `version` beside JSON Schema keys
 */
export type ServiceSchemaDeclaration = {
    schema_version: string;
    preserve_unknown: boolean;
    json_schema: Record<string, unknown>;
    embedded: Record<string, EmbeddedSchemaReference>;
};
export type ServicePassport = {
    service_id: string;
    service_version: string;
    base_path: string;
    supported_levels: Level[];
    input_object_types: string[];
    output_object_types: string[];
    /** Keyed by `schema_id`; every entry is a strict declaration. */
    schemas: Record<string, ServiceSchemaDeclaration>;
    permissions: ServicePermissions;
};
export type DomainModuleLike = {
    service_id: string;
    base_path: string;
    min_runtime?: string;
    max_runtime?: string;
};
export type DomainLike = {
    domain_id?: string;
    origin?: string;
    modules?: DomainModuleLike[];
    enabled_capabilities?: Level[] | string[];
    emergency_export?: boolean;
    read_only?: boolean;
};
export type CurrentLike = {
    runtime_version: string;
    runtime_url?: string;
    contract_version?: string;
    min_loader?: number;
    status?: "active" | "update-required" | "deprecated";
};
export type WorkspaceRecord = {
    workspace_id: string;
    profile: string;
    capabilities: string[];
    read_only?: boolean;
    created_at: string;
    updated_at: string;
    deleted_at?: string;
    deleted_by_service?: string;
    read_only_before_delete?: boolean;
};
export type ObjectRecord<T = unknown> = {
    object_id: string;
    workspace_id: string;
    schema_id: string;
    schema_version: string;
    created_by_service: string;
    updated_by_service: string;
    created_at: string;
    updated_at: string;
    revision: number;
    data: T;
    extensions: Record<string, unknown>;
    deleted?: boolean;
    deleted_at?: string;
};
export type RelationRecord = {
    relation_id: string;
    workspace_id: string;
    from_object_id: string;
    to_object_id: string;
    kind: string;
    created_at: string;
    created_by_service: string;
};
export type AssetRecord = {
    asset_id: string;
    workspace_id: string;
    service_id: string;
    object_id: string;
    mime: string;
    size: number;
    created_at: string;
    updated_at: string;
    updated_by_service: string;
    revision: number;
};
export type AssetWithBytes = {
    asset: AssetRecord;
    bytes: Uint8Array;
};
export type EventRecord<T = unknown> = {
    event_id: string;
    event_type: string;
    workspace_id: string;
    service_id: string;
    object_id?: string;
    revision?: number;
    occurred_at: string;
    causation_id?: string;
    correlation_id?: string;
    idempotency_key?: string;
    payload: T;
};
export type ObjectWithRelations<T = unknown> = {
    object: ObjectRecord<T>;
    relations: {
        outgoing: RelationRecord[];
        incoming: RelationRecord[];
    };
};
export type CommitResult<T = unknown> = {
    object: ObjectRecord<T>;
    event: EventRecord;
    deduplicated: boolean;
};
export type PutObjectInput = {
    workspace_id: string;
    object_id: string;
    schema_id: string;
    schema_version: string;
    data: unknown;
    extensions?: Record<string, unknown>;
    base_revision?: number;
    event: {
        event_type: string;
        payload?: unknown;
    };
};
export type DeleteObjectInput = {
    workspace_id: string;
    object_id: string;
    base_revision?: number;
    event: {
        event_type: string;
        payload?: unknown;
    };
};
export type PutRelationInput = {
    workspace_id: string;
    relation_id: string;
    from_object_id: string;
    to_object_id: string;
    kind: string;
    event: {
        event_type: string;
        payload?: unknown;
        idempotency_key?: string;
    };
};
export type DeleteRelationInput = {
    workspace_id: string;
    relation_id: string;
    event: {
        event_type: string;
        payload?: unknown;
        idempotency_key?: string;
    };
};
export type RelationCommitResult = {
    relation: RelationRecord;
    event: EventRecord;
    deduplicated: boolean;
};
export type RelationDeleteResult = {
    relation_id: string;
    event: EventRecord;
    deduplicated: boolean;
};
export type ListAssetsQuery = {
    workspace_id: string;
    object_id?: string;
};
export type PutAssetInput = {
    workspace_id: string;
    asset_id: string;
    object_id: string;
    mime: string;
    bytes: Uint8Array;
    base_revision?: number;
    event: {
        event_type: string;
        payload?: unknown;
        idempotency_key?: string;
    };
};
export type DeleteAssetInput = {
    workspace_id: string;
    asset_id: string;
    base_revision?: number;
    event: {
        event_type: string;
        payload?: unknown;
        idempotency_key?: string;
    };
};
export type AssetCommitResult = {
    asset: AssetRecord;
    event: EventRecord;
    deduplicated: boolean;
};
export type AssetDeleteResult = {
    asset_id: string;
    event: EventRecord;
    deduplicated: boolean;
};
export type CreateWorkspaceInput = {
    workspace_id: string;
    profile: string;
    capabilities?: string[];
    read_only?: boolean;
};
export type ListObjectsQuery = {
    workspace_id: string;
    schema_id?: string;
    include_deleted?: boolean;
    limit?: number;
};
export type ListWorkspacesOptions = {
    include_deleted?: boolean;
};
export type PurgePreviewInput = {
    workspace_id: string;
    acknowledge_no_backup?: boolean;
};
export type ExportReceiptSummary = {
    at: string;
    outbox_id?: string;
    package_digest?: string;
    semantic_digest?: string;
    filename?: string;
    size?: number;
    /** Age of the receipt in milliseconds relative to preview time. */
    age_ms?: number;
};
export type PurgePreviewCounts = {
    objects: number;
    events: number;
    relations: number;
    assets: number;
    permissions: number;
    service_state: number;
    outbox: number;
};
export type PurgeBackupStatus = "current" | "stale" | "missing";
export type PurgePreviewLastExport = {
    prepared: ExportReceiptSummary | null;
    confirmed: ExportReceiptSummary | null;
    backup_status: PurgeBackupStatus;
    warning: string | null;
};
export type PurgePreview = {
    purge_token: string;
    challenge: string;
    expires_at: string;
    workspace_id: string;
    /** ms-since-epoch of `workspaces.updated_at` — a state timestamp, not a
     *  monotonic revision counter. Named accordingly to prevent misuse. */
    workspace_state_timestamp: number;
    counts: PurgePreviewCounts;
    last_export: PurgePreviewLastExport;
    acknowledge_no_backup: boolean;
};
export type PurgeCommitInput = {
    purge_token: string;
    confirmation: string;
};
export type PurgeReceipt = {
    workspace_id: string;
    removed: {
        workspaces: number;
        objects: number;
        events: number;
        relations: number;
        assets: number;
        permissions: number;
        service_state: number;
        outbox: number;
    };
};
export type ConfirmExportInput = {
    package_digest: string;
    /** When omitted, applies to every workspace referenced by the matching
     *  `package.export.prepared` receipt. */
    workspace_ids?: string[];
};
export type ConfirmExportReceipt = {
    confirmed_at: string;
    package_digest: string;
    workspace_ids: string[];
    confirmations: number;
};
export type ExportServiceScope = {
    mode: "workspace";
} | {
    mode: "readable_objects";
    service_id: string;
    readable_schemas: string[];
    event_read_scope: "service" | "workspace";
};
export type ExportOptions = {
    workspaces: string[];
    include_history?: boolean;
    include_assets?: boolean;
    include_relations?: boolean;
    include_schemas?: boolean;
    scope?: ExportServiceScope;
};
export type ExportCounts = {
    workspaces: number;
    objects: number;
    events: number;
    relations: number;
    assets: number;
    schemas: number;
};
export type ExportSummary = {
    included: ExportCounts;
    excluded_by_permission: ExportCounts;
    scope_mode: ExportServiceScope["mode"];
};
export type ExportPreview = {
    workspaces: string[];
    counts: ExportCounts;
    approx_bytes: number;
    summary: ExportSummary;
    unsupported: never[];
    conflicts: never[];
};
export type PackageManifestFile = {
    path: string;
    size: number;
    sha256: string;
};
export type PackageWorkspaceState = {
    workspace_id: string;
    updated_at: string;
};
export type PackageManifestBase = {
    format: "iwxa.package";
    encryption: "none";
    created_at: string;
    workspaces: string[];
    workspace_states: PackageWorkspaceState[];
    options: {
        include_history: boolean;
        include_assets: boolean;
        include_relations: boolean;
        include_schemas: boolean;
    };
    counts: ExportCounts;
    files: PackageManifestFile[];
    package_digest: string;
    semantic_digest: string;
};
export type PackageManifest10 = PackageManifestBase & {
    format_version: "1.0";
};
export type PackageManifest11 = PackageManifestBase & {
    format_version: "1.1";
    capability: {
        mode: "required";
        instance_path: "technical/capability/instance.json";
        grant_path: "technical/capability/grant.json";
    };
};
export type PackageManifest = PackageManifest10 | PackageManifest11;
export type ValidationIssue = {
    path: string;
    message: string;
    code?: string;
};
export type ValidationReport = {
    format: "iwxa.package.validation";
    ok: boolean;
    checked_at: string;
    file_count: number;
    object_count: number;
    schema_issues: Array<{
        workspace_id: string;
        object_id: string;
        created_by_service: string;
        updated_by_service: string;
        schema_id: string;
        schema_version: string;
        reason: string;
    }>;
    path_issues: string[];
};
export type PackageSchemaRecord = {
    schema_id: string;
    schema_version: string;
    preserve_unknown: boolean;
    canonical_sha256: string;
    json_schema: Record<string, unknown>;
    embedded: Record<string, EmbeddedSchemaReference>;
};
export type PackageAssetRecord = {
    asset_id: string;
    workspace_id: string;
    service_id: string;
    object_id?: string;
    mime: string;
    size: number;
    path: string;
    created_at: string;
    updated_at?: string;
    updated_by_service?: string;
    revision?: number;
};
export type PackageArtifact = {
    filename: string;
    bytes: Uint8Array;
    size: number;
    package_digest: string;
    semantic_digest: string;
    manifest: PackageManifest;
    validation: ValidationReport;
    summary: ExportSummary;
};
export type ImportMode = "full" | "selective" | "new-workspace" | "merge" | "cancel";
export type ConflictPolicy = "overwrite" | "skip" | "fail";
export type ObjectKey = `${string}/${string}`;
export type ImportPlan = {
    mode: ImportMode;
    conflict?: ConflictPolicy;
    workspace_id_map?: Record<string, string>;
    target_workspace?: string;
    include_workspaces?: string[];
    include_objects?: ObjectKey[];
    include_history?: boolean;
    include_assets?: boolean;
    include_relations?: boolean;
};
export type PreviewObjectRow = {
    workspace_id: string;
    object_id: string;
    created_by_service: string;
    updated_by_service: string;
    schema_id: string;
    schema_version: string;
    incoming_revision: number;
    local_revision: number | null;
    data_equal: boolean;
    conflict: boolean;
};
export type PreviewSchemaStatus = "known_domain" | "known_persisted" | "embedded_new" | "embedded_equal" | "conflict" | "missing" | "invalid";
export type PreviewSchemaRow = {
    schema_id: string;
    schema_version: string;
    status: PreviewSchemaStatus;
    object_count: number;
    canonical_sha256?: string;
    message?: string;
};
export type PreviewWorkspaceRow = {
    workspace_id: string;
    exists_locally: boolean;
    incoming_objects: number;
    incoming_events: number;
    incoming_relations: number;
    incoming_assets: number;
};
export type PreviewUnsupported = {
    kind: "unknown_schema";
    schema_id: string;
    schema_version: string;
    object_count: number;
} | {
    kind: "extension_field";
    path: string;
    sample: string;
} | {
    kind: "forbidden_for_service";
    schema_id: string;
    schema_version: string;
    object_count: number;
    reason: "not_in_write_permissions";
};
export type ImportInclusionCounts = {
    workspaces: number;
    objects: number;
    events: number;
    relations: number;
    assets: number;
    schemas: number;
};
export type ImportExclusionCounts = {
    workspaces: number;
    objects: number;
    events: number;
    relations: number;
    assets: number;
    schemas: number;
};
export type ImportInvalidCounts = {
    envelopes: number;
    dependencies: number;
    schema_validation: number;
    schema_conflicts: number;
};
export type SoftDeleteWorkspaceReceipt = {
    workspace_id: string;
    deleted_at: string;
};
export type RestoreWorkspaceReceipt = {
    workspace_id: string;
    restored_at: string;
};
export type ImportPreview = {
    manifest: PackageManifest;
    package_digest: string;
    semantic_digest: string;
    bytes: number;
    totals: {
        files: number;
        workspaces: number;
        objects: number;
        events: number;
        relations: number;
        assets: number;
        schemas: number;
    };
    workspaces: PreviewWorkspaceRow[];
    schemas: PreviewSchemaRow[];
    objects: PreviewObjectRow[];
    conflicts: PreviewObjectRow[];
    unsupported: PreviewUnsupported[];
    warnings: string[];
    invalid: ImportInvalidCounts;
    included: ImportInclusionCounts;
    excluded_by_permission: ImportExclusionCounts;
    scope_mode: "writable_objects" | "workspace";
};
export type SecureImportPreview = {
    preview_token: string;
    package_digest: string;
    semantic_digest: string;
    expires_at: string;
    allowed_modes: ImportMode[];
    preview: ImportPreview;
};
export type SecureCommitInput = {
    preview_token: string;
    package_digest: string;
    plan: ImportPlan;
};
export type ImportReceipt = {
    import_id: string;
    format: "iwxa.import.receipt";
    format_version: "1.0";
    package_digest: string;
    semantic_digest: string;
    mode: ImportMode;
    conflict_policy: ConflictPolicy;
    committed_at: string;
    applied: {
        workspaces: number;
        objects_inserted: number;
        objects_updated: number;
        objects_skipped: number;
        events: number;
        relations: number;
        assets: number;
        schemas_inserted: number;
        schemas_reused: number;
        schemas_rejected: number;
    };
    skipped_conflicts: Array<`${string}/${string}`>;
    workspace_id_map: Record<string, string>;
    excluded_by_permission: ImportExclusionCounts;
    cancelled?: boolean;
};
export type ConnectErrorCode = Extract<ErrorCode, "UNKNOWN_SERVICE" | "BASE_PATH_MISMATCH" | "LEVEL_NOT_ALLOWED" | "MISSING_LEVEL" | "UPDATE_REQUIRED" | "PASSPORT_INVALID" | "CONFIG_INVALID" | "ORIGIN_MISMATCH" | "SECRET_FIELD_FORBIDDEN">;
export type WorkspaceApiErrorCode = Extract<ErrorCode, "KERNEL_UNAVAILABLE" | "CONFIG_INVALID" | "PERMISSION_DENIED" | "CONFLICT" | "UNSUPPORTED_SCHEMA" | "SCHEMA_NOT_DECLARED" | "SCHEMA_INVALID" | "SCHEMA_CONFLICT" | "SCHEMA_DIGEST_MISMATCH" | "WORKSPACE_NOT_FOUND" | "WORKSPACE_READ_ONLY" | "WORKSPACE_DELETED" | "OBJECT_NOT_FOUND" | "RELATION_NOT_FOUND" | "ASSET_NOT_FOUND" | "MIGRATION_REQUIRED" | "QUOTA_EXCEEDED" | "INTEGRITY_FAILED" | "PURGE_REQUIRED" | "PURGE_TOKEN_INVALID" | "PURGE_TOKEN_USED" | "PURGE_EXPIRED" | "PURGE_SERVICE_MISMATCH" | "PURGE_ORIGIN_MISMATCH" | "PURGE_WORKSPACE_MISMATCH" | "PURGE_STATE_CHANGED" | "PURGE_NOT_TRASHED" | "PURGE_EXPORT_NOT_CONFIRMED" | "PURGE_CHALLENGE_MISMATCH">;
export type ImportErrorCode = Extract<ErrorCode, "ZIP_PARSE" | "VERIFY_FAILED" | "UNSUPPORTED_FORMAT" | "UNSUPPORTED_ENCRYPTION" | "UNSUPPORTED_ZIP64" | "COMPRESSION_RATIO" | "ABSOLUTE_PATH" | "PATH_TRAVERSAL" | "DUPLICATE_PATH" | "EXCESSIVE_SIZE" | "INVALID_MANIFEST" | "MANIFEST_WORKSPACE_MISMATCH" | "NDJSON_PARSE" | "INVALID_RECORD" | "DUPLICATE_RECORD" | "DANGLING_REFERENCE" | "MISSING_ASSET" | "MISSING_DEPENDENCY" | "CONFLICT" | "INVALID_PLAN" | "WORKSPACE_MAP_INVALID" | "PREVIEW_REQUIRED" | "PREVIEW_TOKEN_INVALID" | "PREVIEW_TOKEN_USED" | "PREVIEW_EXPIRED" | "PREVIEW_SERVICE_MISMATCH" | "PREVIEW_ORIGIN_MISMATCH" | "PACKAGE_DIGEST_MISMATCH" | "IMPORT_CANCELLED" | "PERMISSION_DENIED" | "SCHEMA_NOT_DECLARED" | "SCHEMA_INVALID" | "SCHEMA_CONFLICT" | "SCHEMA_DIGEST_MISMATCH" | "PLAN_NOT_IN_PREVIEW">;
export type IWXAErrorShape = {
    name: string;
    code: ErrorCode;
    message: string;
    details?: unknown;
};
/**
 * Canonical T0 contract (locked). `validate` accepts a batch of candidate
 * IWXAObjects and answers with either the accepted objects OR a list of
 * typed issues. There is no "structured/echo" fallback — a malformed input
 * is a validation failure, not a synonym for success.
 *
 * The result shape is stable; extending it requires bumping CONTRACT_VERSION.
 */
export type T0ValidateInput = {
    objects: unknown[];
};
export type T0ValidateIssue = {
    path: string;
    message: string;
};
export type T0ValidateResult = {
    tier: "t0";
    service_id: string;
    ok: true;
    objects: ObjectRecord[];
} | {
    tier: "t0";
    service_id: string;
    ok: false;
    errors: T0ValidateIssue[];
};
export type T0Surface = {
    validate(input: T0ValidateInput): Promise<T0ValidateResult>;
};
export type CommitObjectGraphInput = {
    workspace_id: string;
    idempotency_key: string;
    object: {
        object_id: string;
        schema_id: string;
        schema_version: string;
        data: unknown;
        extensions?: Record<string, unknown>;
        base_revision?: number;
    };
    relation_puts?: Array<{
        relation_id: string;
        from_object_id: string;
        to_object_id: string;
        kind: string;
    }>;
    relation_deletes?: Array<{
        relation_id: string;
    }>;
    event: {
        event_type: string;
        payload?: unknown;
    };
};
export type CommitObjectGraphReceipt = {
    transaction_id: string;
    workspace_id: string;
    object: ObjectRecord;
    relations_put: RelationRecord[];
    relation_ids_deleted: string[];
    event: EventRecord;
    deduplicated: boolean;
};
export type T1Surface = {
    commitObjectGraph(input: CommitObjectGraphInput): Promise<CommitObjectGraphReceipt>;
    listWorkspaces(opts?: ListWorkspacesOptions): Promise<WorkspaceRecord[]>;
    getWorkspace(workspace_id: string): Promise<WorkspaceRecord | null>;
    createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceRecord>;
    listObjects(query: ListObjectsQuery): Promise<ObjectRecord[]>;
    getObject(workspace_id: string, object_id: string): Promise<ObjectWithRelations | null>;
    putObject(input: PutObjectInput): Promise<CommitResult>;
    deleteObject(input: DeleteObjectInput): Promise<CommitResult>;
    putRelation(input: PutRelationInput): Promise<RelationCommitResult>;
    deleteRelation(input: DeleteRelationInput): Promise<RelationDeleteResult>;
    listAssets(query: ListAssetsQuery): Promise<AssetRecord[]>;
    getAsset(workspace_id: string, asset_id: string): Promise<AssetWithBytes | null>;
    putAsset(input: PutAssetInput): Promise<AssetCommitResult>;
    deleteAsset(input: DeleteAssetInput): Promise<AssetDeleteResult>;
    listEventsSince(workspace_id: string, since?: string): Promise<EventRecord[]>;
    softDeleteWorkspace(workspace_id: string): Promise<SoftDeleteWorkspaceReceipt>;
    restoreWorkspace(workspace_id: string): Promise<RestoreWorkspaceReceipt>;
    purgePreview(input: PurgePreviewInput): Promise<PurgePreview>;
    purgeCommit(input: PurgeCommitInput): Promise<PurgeReceipt>;
    purgeCancel(purge_token: string): Promise<boolean>;
};
export type T2Surface = {
    exportPreview(opts: ExportOptions): Promise<ExportPreview>;
    exportPackage(opts: ExportOptions): Promise<PackageArtifact>;
    confirmExport(input: ConfirmExportInput): Promise<ConfirmExportReceipt>;
    importPreview(zip_bytes: Uint8Array): Promise<SecureImportPreview>;
    importCommit(input: SecureCommitInput): Promise<ImportReceipt>;
    importCancel(preview_token: string): Promise<boolean>;
};
export type CapabilityAuthorizationView = {
    decision: "ACTIVE" | "DENY" | "STALE";
    workspace_id: string;
    audience_service_id: string;
    instance_id: string | null;
    lineage_id: string | null;
    grant_id: string | null;
    effective_capabilities: readonly string[];
    valid_until: string | null;
    evaluated_at: string;
    reason?: string;
};
export type AuthorizationSurface = {
    forWorkspace(workspace_id: string): Promise<CapabilityAuthorizationView>;
    hasCapability(workspace_id: string, capability_id: string): Promise<boolean>;
};
export type ConnectRequest = {
    service_id: string;
    required_levels?: Level[];
};
export type ConnectContext = {
    domain: DomainLike;
    current: CurrentLike;
    origin?: string;
};
export type TierHandlers = {
    t0: T0Surface;
    t1: T1Surface;
    t2: T2Surface;
    authorization: AuthorizationSurface;
};
export type IWXAClient = {
    contract_version: string;
    runtime_version: string;
    service: {
        service_id: string;
        base_path: string;
        service_version: string;
    };
    mode: ConnectMode;
    granted_levels: readonly Level[];
    granted_operations: readonly string[];
    authorization: AuthorizationSurface;
    t0: T0Surface;
    t1: T1Surface;
    t2: T2Surface;
};
/**
 * Canonical list of every public method addressable via `granted_operations`.
 * Parity tests assert each string here corresponds to a real method on the
 * appropriate tier surface, and vice versa.
 */
export declare const ALL_OPERATIONS: readonly ["t0.validate", "t1.listWorkspaces", "t1.getWorkspace", "t1.createWorkspace", "t1.listObjects", "t1.getObject", "t1.commitObjectGraph", "t1.putObject", "t1.deleteObject", "t1.putRelation", "t1.deleteRelation", "t1.listAssets", "t1.getAsset", "t1.putAsset", "t1.deleteAsset", "t1.listEventsSince", "t1.softDeleteWorkspace", "t1.restoreWorkspace", "t1.purgePreview", "t1.purgeCommit", "t1.purgeCancel", "t2.exportPreview", "t2.exportPackage", "t2.confirmExport", "t2.importPreview", "t2.importCommit", "t2.importCancel"];
export type OperationId = (typeof ALL_OPERATIONS)[number];
