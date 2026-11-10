/**
 * IWXA public runtime API (v1) — canonical passport & module contract.
 *
 * Public contract version: CONTRACT_VERSION.
 *
 * All JSON contracts use snake_case. There is no `serviceId` in any JSON
 * payload and no `serviceId:/path` override syntax on `domain.json.modules`.
 * There is exactly ONE spelling for every field on the wire.
 *
 * Runtime rules (enforced in `connect`):
 *   1. request.service_id must match a module in `domain.json.modules`
 *      by exact `service_id` equality.
 *   2. The passport file is fetched from `/_iwxa/services/<service_id>.json`.
 *   3. The passport's `service_id` must equal the requested id.
 *   4. The passport's `base_path` must equal the module's `base_path`
 *      (no override, no derivation).
 *   5. `supported_levels` must be a subset of `enabled_capabilities`.
 *   6. `service_id` accepts [A-Za-z0-9._-]; slashes and ".." are rejected.
 *   7. The client never exposes IDBDatabase, IDBTransaction, IDBObjectStore,
 *      physical migrations, or the internal LocalStore.
 */

// The canonical public contract lives in `../public-contract`. This runtime
// module re-exports every type/const from it so existing imports keep working
// verbatim, and imports the shapes it needs for the local factory.
export * from "../public-contract";
import type {
  ConnectMode,
  ConnectRequest,
  ConnectContext,
  CurrentLike,
  DomainLike,
  DeleteObjectInput,
  ExportOptions,
  ExportPreview,
  IWXAClient,
  ImportPlan,
  Level,
  PackageArtifact,
  PurgeCommitInput,
  PurgePreview,
  PurgePreviewInput,
  PurgeReceipt,
  PutObjectInput,
  SecureCommitInput,
  SecureImportPreview,
  ServicePassport,
  ServicePermissions,
  T0Surface,
  T1Surface,
  T2Surface,
  TierHandlers,
  WorkspaceRecord,
  ObjectRecord,
  ObjectWithRelations,
  CommitResult,
  EventRecord,
  CreateWorkspaceInput,
  ListObjectsQuery,
  ListWorkspacesOptions,
  ImportReceipt,
} from "../public-contract";
import { CONTRACT_VERSION } from "../public-contract";


export class ConnectError extends Error {
  constructor(
    message: string,
    public code:
      | "UNKNOWN_SERVICE"
      | "BASE_PATH_MISMATCH"
      | "LEVEL_NOT_ALLOWED"
      | "MISSING_LEVEL"
      | "UPDATE_REQUIRED"
      | "PASSPORT_INVALID"
      | "CONFIG_INVALID"
      | "ORIGIN_MISMATCH"
      | "SECRET_FIELD_FORBIDDEN",
    public details?: unknown,
  ) {
    super(message);
    this.name = "ConnectError";
  }
}

// TierHandlers is re-exported from ../public-contract via `export *` above.

import { buildDomainSchemaRegistry } from "../schemas/DomainSchemaRegistry";
import type { SchemaRegistry } from "../schemas/SchemaRegistry";

export type ConnectDeps = {
  loadPassport: (service_id: string) => Promise<ServicePassport | null>;
  /**
   * REQUIRED. There is intentionally no fallback: the shipped runtime bundle
   * MUST provide a real, kernel-backed implementation. Tests that need a
   * kernel-free surface import `makeTestTierHandlers` from
   * `tests/helpers/test-tier-handlers`, which is never bundled into
   * `runtime.js`.
   */
  makeTierHandlers: (ctx: {
    passport: ServicePassport;
    granted_levels: Level[];
    mode: ConnectMode;
    origin: string;
    schemas: SchemaRegistry;
  }) => TierHandlers;
};

// ---------------------------------------------------------------------------
// service_id validation — url-safe, no slashes, no directory traversal.
// ---------------------------------------------------------------------------

const SERVICE_ID_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/;

export function isValidServiceId(id: unknown): id is string {
  if (typeof id !== "string") return false;
  if (!SERVICE_ID_RE.test(id)) return false;
  if (id.includes("..")) return false;
  if (id.includes("/") || id.includes("\\")) return false;
  return true;
}

function assertServiceId(id: unknown): asserts id is string {
  if (!isValidServiceId(id)) {
    throw new ConnectError(
      "service_id must be url-safe (letters, digits, '.', '-', '_'; no '/' or '..')",
      "UNKNOWN_SERVICE",
      { service_id: id },
    );
  }
}

// ---------------------------------------------------------------------------
// Granted operations derived from passport permissions + mode + granted levels.
// A permission of `false` / empty array removes the operation from the list.
// ---------------------------------------------------------------------------

export function computeGrantedOperations(
  granted_levels: Level[],
  mode: ConnectMode,
  permissions: ServicePermissions,
): string[] {
  const canWrite = mode !== "read-only" && mode !== "update-required";
  const canOutbound = mode === "full";
  const ops: string[] = ["t0.validate"];
  const hasReadable = permissions.objects.read.length > 0;
  const hasWritable = permissions.objects.write.length > 0;
  const hasDeletable = permissions.objects.delete.length > 0;
  if (granted_levels.includes("T1")) {
    if (permissions.workspace.list) ops.push("t1.listWorkspaces");
    if (permissions.workspace.read) {
      ops.push("t1.getWorkspace", "t1.listEventsSince");
      if (hasReadable) ops.push("t1.listObjects", "t1.getObject", "t1.listAssets", "t1.getAsset");
    }
    if (canWrite) {
      if (permissions.workspace.create) ops.push("t1.createWorkspace");
      if (hasWritable && permissions.operations?.includes("t1.commitObjectGraph")) ops.push("t1.commitObjectGraph");
      if (hasWritable) {
        ops.push("t1.putObject", "t1.putRelation", "t1.deleteRelation", "t1.putAsset", "t1.deleteAsset");
      }
      if (hasDeletable) ops.push("t1.deleteObject");
      if (permissions.workspace.soft_delete) ops.push("t1.softDeleteWorkspace");
      if (permissions.workspace.restore) ops.push("t1.restoreWorkspace");
      if (permissions.workspace.purge) {
        ops.push("t1.purgePreview", "t1.purgeCommit", "t1.purgeCancel");
      }
    }
  }
  if (granted_levels.includes("T2")) {
    if (permissions.packages.export) {
      ops.push("t2.exportPreview");
      if (canOutbound) {
        ops.push("t2.exportPackage");
        ops.push("t2.confirmExport");
      }
    }
    if (permissions.packages.import) {
      ops.push("t2.importPreview", "t2.importCancel");
      if (canOutbound) ops.push("t2.importCommit");
    }
  }
  return ops;
}


// ---------------------------------------------------------------------------
// NOTE: no "default"/"dev" tier handlers exist in this module.
// The shipped Runtime bundle wires `makeKernelTierHandlers` from
// `./kernelHandlers`. Tests that need a kernel-free surface import
// `makeTestTierHandlers` from `tests/helpers/test-tier-handlers`.
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// connect() factory.
// ---------------------------------------------------------------------------

const CONNECT_ERROR_CODES = new Set<string>([
  "UNKNOWN_SERVICE",
  "BASE_PATH_MISMATCH",
  "LEVEL_NOT_ALLOWED",
  "MISSING_LEVEL",
  "UPDATE_REQUIRED",
  "PASSPORT_INVALID",
  "CONFIG_INVALID",
  "ORIGIN_MISMATCH",
  "SECRET_FIELD_FORBIDDEN",
]);

type ConnectErrorCode = ConstructorParameters<typeof ConnectError>[1];

function toConnectError(err: unknown, fallbackCode: ConnectErrorCode): ConnectError {
  if (err instanceof ConnectError) return err;
  if (err && typeof err === "object") {
    const anyErr = err as { code?: unknown; message?: unknown; details?: unknown };
    const rawCode = typeof anyErr.code === "string" ? anyErr.code : "";
    const message =
      typeof anyErr.message === "string" ? anyErr.message : "domain registry build failed";
    if (CONNECT_ERROR_CODES.has(rawCode)) {
      return new ConnectError(message, rawCode as ConnectErrorCode, anyErr.details);
    }
    if (rawCode.startsWith("SCHEMA_")) {
      return new ConnectError(message, "PASSPORT_INVALID", { schema_code: rawCode, ...(typeof anyErr.details === "object" && anyErr.details ? anyErr.details : {}) });
    }
    return new ConnectError(message, fallbackCode, anyErr.details);
  }
  return new ConnectError(String(err), fallbackCode);
}

export function createConnect(deps: ConnectDeps) {
  return async function connect(
    request: ConnectRequest,
    ctx: ConnectContext,
  ): Promise<IWXAClient> {
    assertServiceId(request.service_id);

    if (ctx.current.status === "update-required") {
      throw new ConnectError(
        "Runtime marked update-required by current.json",
        "UPDATE_REQUIRED",
      );
    }

    if (typeof ctx.origin !== "string" || ctx.origin.length === 0) {
      throw new ConnectError(
        "connect(): verified origin is required",
        "ORIGIN_MISMATCH",
      );
    }

    // 1. Locate the module in domain.json.modules by exact service_id.
    const modules = ctx.domain.modules ?? [];
    const module = modules.find((m) => m.service_id === request.service_id);
    if (!module) {
      throw new ConnectError(
        `Service "${request.service_id}" is not registered in domain.json`,
        "UNKNOWN_SERVICE",
      );
    }

    // 2. Build the domain-wide schema registry from ALL modules' passports.
    let domainSchemas;
    try {
      domainSchemas = await buildDomainSchemaRegistry({
        domain: { modules },
        load_passport: deps.loadPassport,
      });
    } catch (e) {
      throw toConnectError(e, "PASSPORT_INVALID");
    }

    const passport = domainSchemas.passports.get(request.service_id);
    if (!passport) {
      throw new ConnectError(
        `Service passport not found for "${request.service_id}"`,
        "UNKNOWN_SERVICE",
      );
    }

    // 3. base_path must equal domain module base_path exactly.
    if (passport.base_path !== module.base_path) {
      throw new ConnectError(
        `base_path mismatch: passport="${passport.base_path}", domain="${module.base_path}"`,
        "BASE_PATH_MISMATCH",
      );
    }

    // 4. supported_levels must be a subset of enabled_capabilities.
    const domainLevels = new Set<string>(ctx.domain.enabled_capabilities ?? []);
    const disallowed = passport.supported_levels.filter((l) => !domainLevels.has(l));
    if (disallowed.length > 0) {
      throw new ConnectError(
        `Passport levels not allowed by domain: ${disallowed.join(", ")}`,
        "LEVEL_NOT_ALLOWED",
        { service_id: request.service_id, disallowed },
      );
    }

    const granted: Level[] = [...passport.supported_levels];

    // 5. Required levels (if any) must all be granted.
    const required = request.required_levels ?? [];
    const missing_required = required.filter((l) => !granted.includes(l));
    if (missing_required.length > 0) {
      throw new ConnectError(
        `Required levels missing: ${missing_required.join(", ")}`,
        "MISSING_LEVEL",
        { service_id: request.service_id, missing: missing_required },
      );
    }

    // 6. Determine mode.
    let mode: ConnectMode = "full";
    if (ctx.domain.emergency_export) mode = "emergency-export";
    else if (ctx.domain.read_only) mode = "read-only";

    const tiers = deps.makeTierHandlers({
      passport,
      granted_levels: granted,
      mode,
      origin: ctx.origin,
      schemas: domainSchemas.registry,
    });

    // 7. Build the sealed client. No IDBDatabase, no raw handles leak.
    const client: IWXAClient = {
      contract_version: CONTRACT_VERSION,
      runtime_version: ctx.current.runtime_version,
      service: Object.freeze({
        service_id: passport.service_id,
        base_path: passport.base_path,
        service_version: passport.service_version,
      }),
      mode,
      granted_levels: Object.freeze([...granted]),
      granted_operations: Object.freeze(
        computeGrantedOperations(granted, mode, passport.permissions),
      ),
      authorization: Object.freeze({ ...tiers.authorization }),
      t0: Object.freeze({ ...tiers.t0 }),
      t1: Object.freeze({ ...tiers.t1 }),
      t2: Object.freeze({ ...tiers.t2 }),
    };
    return Object.freeze(client);
  };
}

/** Default passport loader: fetches `/_iwxa/services/<service_id>.json`. */
export async function defaultLoadPassport(
  service_id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ServicePassport | null> {
  if (!isValidServiceId(service_id)) return null;
  try {
    const res = await fetchImpl(`/_iwxa/services/${service_id}.json`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as ServicePassport;
  } catch {
    return null;
  }
}

// The module-level `connect` fallback used to exist here for convenience,
// but it forced `public-api.ts` to reference a fake handler set. It has been
// removed: the ONLY production `connect` is exported from `./entry`, which
// wires `makeKernelTierHandlers`. Tests construct `createConnect` explicitly.

