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

import { CONTRACT_VERSION } from "./index";

export type ErrorLocation =
  | "loader"
  | "loader/runtime"
  | "runtime"
  | "workspace-api"
  | "package-import"
  | "package-export";

export type ErrorDefinition = { where: ErrorLocation; meaning: string };

export const ERROR_DEFINITIONS = {
  // Loader / configuration
  CONFIG_INVALID: { where: "loader/runtime", meaning: "domain.json / current.json failed validation" } as ErrorDefinition,
  SECRET_FIELD_FORBIDDEN: { where: "loader/runtime", meaning: "domain.json contained a secret-like field" } as ErrorDefinition,
  ORIGIN_MISMATCH: { where: "loader", meaning: "Runtime origin ≠ document origin" } as ErrorDefinition,
  UPDATE_REQUIRED: { where: "loader", meaning: "current.json marks the runtime as update-required" } as ErrorDefinition,

  // Runtime / connect
  UNKNOWN_SERVICE: { where: "runtime", meaning: "service_id not registered in domain.json.modules" } as ErrorDefinition,
  BASE_PATH_MISMATCH: { where: "runtime", meaning: "Passport base_path ≠ domain module base_path" } as ErrorDefinition,
  PASSPORT_INVALID: { where: "runtime", meaning: "Service passport failed canonical validation" } as ErrorDefinition,
  LEVEL_NOT_ALLOWED: { where: "runtime", meaning: "Passport level not in domain.enabled_capabilities" } as ErrorDefinition,
  MISSING_LEVEL: { where: "runtime", meaning: "Method requires higher tier or mode than granted" } as ErrorDefinition,
  KERNEL_UNAVAILABLE: { where: "runtime", meaning: "T1/T2 method invoked without a backing LocalStore" } as ErrorDefinition,
  MIGRATION_REQUIRED: { where: "runtime", meaning: "Local Store schema version older than runtime expected" } as ErrorDefinition,
  QUOTA_EXCEEDED: { where: "runtime", meaning: "IndexedDB quota exhausted" } as ErrorDefinition,
  INTEGRITY_FAILED: { where: "runtime", meaning: "Post-fault integrity check failed" } as ErrorDefinition,

  // Workspace API
  PERMISSION_DENIED: { where: "workspace-api", meaning: "service_passport.permissions rejected the call" } as ErrorDefinition,
  WORKSPACE_NOT_FOUND: { where: "workspace-api", meaning: "Referenced workspace does not exist" } as ErrorDefinition,
  WORKSPACE_READ_ONLY: { where: "workspace-api", meaning: "Write blocked by workspace read-only flag" } as ErrorDefinition,
  WORKSPACE_DELETED: { where: "workspace-api", meaning: "Workspace is soft-deleted" } as ErrorDefinition,
  OBJECT_NOT_FOUND: { where: "workspace-api", meaning: "Object with (workspace_id, object_id) does not exist" } as ErrorDefinition,
  CONFLICT: { where: "workspace-api", meaning: "base_revision does not match stored revision" } as ErrorDefinition,
  UNSUPPORTED_SCHEMA: { where: "workspace-api", meaning: "schema_id not declared by the passport" } as ErrorDefinition,
  SCHEMA_NOT_DECLARED: { where: "workspace-api", meaning: "schema_id was not declared by any loaded passport" } as ErrorDefinition,
  SCHEMA_INVALID: { where: "workspace-api", meaning: "data failed the declared JSON Schema" } as ErrorDefinition,
  SCHEMA_CONFLICT: { where: "workspace-api", meaning: "Two passports declared the same (schema_id, schema_version) with different digests" } as ErrorDefinition,
  SCHEMA_DIGEST_MISMATCH: { where: "workspace-api", meaning: "Stored schema digest differs from statically registered domain schema" } as ErrorDefinition,

  // Package import
  ZIP_PARSE: { where: "package-import", meaning: "ZIP central directory could not be parsed" } as ErrorDefinition,
  UNSUPPORTED_ZIP64: { where: "package-import", meaning: "ZIP64 archives are rejected" } as ErrorDefinition,
  COMPRESSION_RATIO: { where: "package-import", meaning: "ZIP tripped compression-ratio safety limit" } as ErrorDefinition,
  ABSOLUTE_PATH: { where: "package-import", meaning: "ZIP contained an absolute path entry" } as ErrorDefinition,
  PATH_TRAVERSAL: { where: "package-import", meaning: "ZIP contained a `..` traversal entry" } as ErrorDefinition,
  DUPLICATE_PATH: { where: "package-import", meaning: "ZIP contained duplicate paths" } as ErrorDefinition,
  EXCESSIVE_SIZE: { where: "package-import", meaning: "ZIP exceeded max-size / max-entries limits" } as ErrorDefinition,
  INVALID_MANIFEST: { where: "package-import", meaning: "manifest.json failed schema validation" } as ErrorDefinition,
  MANIFEST_WORKSPACE_MISMATCH: { where: "package-import", meaning: "Manifest workspaces do not match embedded NDJSON" } as ErrorDefinition,
  VERIFY_FAILED: { where: "package-import", meaning: "package_digest or semantic_digest verification failed after package read" } as ErrorDefinition,
  UNSUPPORTED_FORMAT: { where: "package-import", meaning: "manifest.format ≠ iwxa.package/1.0" } as ErrorDefinition,
  UNSUPPORTED_ENCRYPTION: { where: "package-import", meaning: "Encrypted packages are rejected" } as ErrorDefinition,
  NDJSON_PARSE: { where: "package-import", meaning: "NDJSON record failed to parse" } as ErrorDefinition,
  INVALID_RECORD: { where: "package-import", meaning: "NDJSON record failed envelope validation" } as ErrorDefinition,
  DUPLICATE_RECORD: { where: "package-import", meaning: "Duplicate record identity within a category" } as ErrorDefinition,
  DANGLING_REFERENCE: { where: "package-import", meaning: "Relation or asset references an unknown object" } as ErrorDefinition,
  MISSING_ASSET: { where: "package-import", meaning: "Referenced asset payload is missing" } as ErrorDefinition,
  MISSING_DEPENDENCY: { where: "package-import", meaning: "Object references data that is not present in the package" } as ErrorDefinition,
  INVALID_PLAN: { where: "package-import", meaning: "ImportPlan is inconsistent with the package" } as ErrorDefinition,
  WORKSPACE_MAP_INVALID: { where: "package-import", meaning: "workspace_id_map keys/values are invalid" } as ErrorDefinition,
  PACKAGE_DIGEST_MISMATCH: { where: "package-import", meaning: "commit digest ≠ preview digest" } as ErrorDefinition,
  IMPORT_CANCELLED: { where: "package-import", meaning: "Import was cancelled by the caller" } as ErrorDefinition,
  PREVIEW_REQUIRED: { where: "package-import", meaning: "importCommit invoked without a preview_token" } as ErrorDefinition,
  PREVIEW_TOKEN_INVALID: { where: "package-import", meaning: "preview_token is unknown" } as ErrorDefinition,
  PREVIEW_TOKEN_USED: { where: "package-import", meaning: "preview_token was already consumed" } as ErrorDefinition,
  PREVIEW_EXPIRED: { where: "package-import", meaning: "preview_token past TTL" } as ErrorDefinition,
  PREVIEW_SERVICE_MISMATCH: { where: "package-import", meaning: "preview_token not bound to caller service_id" } as ErrorDefinition,
  PREVIEW_ORIGIN_MISMATCH: { where: "package-import", meaning: "preview_token not bound to caller origin" } as ErrorDefinition,
  PLAN_NOT_IN_PREVIEW: { where: "package-import", meaning: "commit plan references entities not present in the staged preview" } as ErrorDefinition,



  // Purge lifecycle
  PURGE_REQUIRED: { where: "workspace-api", meaning: "purgeCommit invoked without a purge_token" } as ErrorDefinition,
  PURGE_TOKEN_INVALID: { where: "workspace-api", meaning: "purge_token is unknown" } as ErrorDefinition,
  PURGE_TOKEN_USED: { where: "workspace-api", meaning: "purge_token was already consumed" } as ErrorDefinition,
  PURGE_EXPIRED: { where: "workspace-api", meaning: "purge_token past TTL" } as ErrorDefinition,
  PURGE_SERVICE_MISMATCH: { where: "workspace-api", meaning: "purge_token not bound to caller service_id" } as ErrorDefinition,
  PURGE_ORIGIN_MISMATCH: { where: "workspace-api", meaning: "purge_token not bound to caller origin" } as ErrorDefinition,
  PURGE_WORKSPACE_MISMATCH: { where: "workspace-api", meaning: "purge_token workspace_id differs from commit" } as ErrorDefinition,
  PURGE_STATE_CHANGED: { where: "workspace-api", meaning: "Workspace state changed between preview and commit" } as ErrorDefinition,
  PURGE_NOT_TRASHED: { where: "workspace-api", meaning: "Workspace must be soft-deleted before purge" } as ErrorDefinition,
  PURGE_EXPORT_NOT_CONFIRMED: { where: "workspace-api", meaning: "purge blocked because no confirmed export exists" } as ErrorDefinition,
  PURGE_CHALLENGE_MISMATCH: { where: "workspace-api", meaning: "Purge confirmation string did not match challenge" } as ErrorDefinition,

  // Local Store open / transactional
  NO_INDEXEDDB: { where: "runtime", meaning: "Environment has no IndexedDB" } as ErrorDefinition,
  BLOCKED: { where: "runtime", meaning: "IndexedDB upgrade blocked by another tab" } as ErrorDefinition,
  OPEN_FAILED: { where: "runtime", meaning: "IndexedDB open failed" } as ErrorDefinition,
  UPGRADE_FAILED: { where: "runtime", meaning: "IndexedDB migration failed" } as ErrorDefinition,
  TX_ABORTED: { where: "runtime", meaning: "IndexedDB transaction aborted" } as ErrorDefinition,

  // Sync / locks
  WEB_LOCKS_UNAVAILABLE: { where: "runtime", meaning: "Web Locks API not available" } as ErrorDefinition,
  LOCK_UNAVAILABLE: { where: "runtime", meaning: "Named Web Lock could not be acquired" } as ErrorDefinition,

  // Runtime capability / schema
  MISSING_CAPABILITY: { where: "runtime", meaning: "Method requires a capability not granted" } as ErrorDefinition,
  UNKNOWN_SCHEMA: { where: "runtime", meaning: "Referenced schema is not registered" } as ErrorDefinition,
  MIGRATION_CONFLICT: { where: "runtime", meaning: "Two logical migrations declared the same source pair" } as ErrorDefinition,
  MIGRATION_FAILED: { where: "runtime", meaning: "Logical migration threw during upgrade" } as ErrorDefinition,
  NO_MIGRATION_PATH: { where: "runtime", meaning: "No migration path between stored and requested schema version" } as ErrorDefinition,
} as const;

export type ErrorCode = keyof typeof ERROR_DEFINITIONS;

/** Legacy readonly array shape kept for `scripts/build-contracts.mjs`. */
export type ErrorEntry = { code: ErrorCode; where: ErrorLocation; meaning: string };

export const ERROR_CATALOGUE: readonly ErrorEntry[] = Object.freeze(
  (Object.keys(ERROR_DEFINITIONS) as ErrorCode[]).map((code) => ({
    code,
    where: ERROR_DEFINITIONS[code].where,
    meaning: ERROR_DEFINITIONS[code].meaning,
  })),
);

export function toCataloguePayload() {
  return {
    contract_version: CONTRACT_VERSION,
    errors: ERROR_CATALOGUE.map((e) => ({ ...e })),
  };
}
