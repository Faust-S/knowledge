/**
 * Kernel-backed tier handlers for the versioned Runtime.
 *
 * Every T1/T2 method delegates to `ScopedWorkspaceApi`, which is the ONLY
 * layer allowed to touch the Local Store on behalf of a service. Kernel
 * handlers never call `commitObjectChange` / `commitObjectDelete` /
 * `PackageBuilder` / `PackageImporter` directly — they merely translate
 * the public `PutObjectInput` / `DeleteObjectInput` / etc. into scoped
 * API calls and forward typed errors to the caller.
 *
 * T0 stays kernel-free: it runs the structural check against the passport's
 * declared object types without touching the store. If IndexedDB is missing
 * `t0.validate` still works; every T1 / T2 method throws a typed
 * `KernelUnavailableError`.
 */

import { LocalStore } from "../local-store/LocalStore";
import { ScopedWorkspaceApi } from "../workspace-api/ScopedWorkspaceApi";
import { buildMergedSchemaRegistry } from "../schemas/DomainSchemaRegistry";
import { SchemaRegistry } from "../schemas/SchemaRegistry";
import { CapabilityAuthorizationRouter } from "../capability/router";
import { CapabilityDeniedError } from "../capability/errors";
import type { CapabilityRuntimeAuthority } from "../capability/authority";
import type { SecurityMetadataProvider04, SecurityMonotonicAnchor04 } from "../capability/security-types";
import { FetchCapabilityControlPlaneProvider, FetchTrustedTimeProvider } from "../capability/control-plane";
import type { CapabilityControlPlaneProvider, TrustedTimeProvider } from "../capability/types";


import { validateT0Result } from "../contracts/validateT0";
import {
  ConnectError,
  type ConnectMode,
  type Level,
  type ServicePassport,
  type T0Surface,
  type T0ValidateIssue,
  type T1Surface,
  type T2Surface,
  type CommitObjectGraphInput,
  type PutObjectInput,
  type DeleteObjectInput,
  type PutRelationInput,
  type DeleteRelationInput,
  type PutAssetInput,
  type DeleteAssetInput,
  type T0ValidateResult,
} from "./public-api";

export class KernelUnavailableError extends Error {
  readonly code = "KERNEL_UNAVAILABLE" as const;
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "KernelUnavailableError";
    if (cause !== undefined) this.cause = cause;
  }
  toJSON() {
    return { name: this.name, code: this.code, message: this.message };
  }
}

let storePromise: Promise<LocalStore> | null = null;

function hasIndexedDB(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { indexedDB?: unknown }).indexedDB !== "undefined"
  );
}

async function ensureStore(): Promise<LocalStore> {
  if (!hasIndexedDB()) {
    throw new KernelUnavailableError("IndexedDB is not available in this environment");
  }
  if (!storePromise) {
    storePromise = LocalStore.connect().catch((e) => {
      storePromise = null;
      throw new KernelUnavailableError("LocalStore failed to open", e);
    });
  }
  return storePromise;
}

/** For tests only — force a fresh LocalStore handle on the next call. */
export function __resetKernelStoreForTests(): void {
  storePromise = null;
}

export function makeKernelTierHandlers(ctx: {
  passport: ServicePassport;
  granted_levels: Level[];
  mode: ConnectMode;
  origin: string;
  schemas: SchemaRegistry;
  capability_control_plane_provider?: CapabilityControlPlaneProvider;
  trusted_time_provider?: TrustedTimeProvider;
  /** Test/release injection points. Production normally uses same-origin fetch and the generated release-bound root. */
  security04_metadata_provider?: SecurityMetadataProvider04;
  security04_embedded_root_bytes?: Uint8Array | null;
  security04_monotonic_anchor?: SecurityMonotonicAnchor04;
}): {
  t0: T0Surface;
  t1: T1Surface;
  t2: T2Surface;
  authorization: import("../public-contract").AuthorizationSurface;
} {
  const sid = ctx.passport.service_id;

  if (!ctx.origin) {
    throw new ConnectError(
      "Verified origin is required",
      "ORIGIN_MISMATCH",
    );
  }

  if (!ctx.schemas) {
    // KERNEL_UNAVAILABLE is not part of ConnectError codes; use CONFIG_INVALID
    // as the closest stable public code and include the intent in details.
    throw new ConnectError(
      "Domain SchemaRegistry is required",
      "CONFIG_INVALID",
      { reason: "KERNEL_UNAVAILABLE" },
    );
  }

  // Resolve security endpoints against the already verified domain origin.
  // This makes browser runtime behavior independent of module/blob/base-URL context
  // while preserving same-origin credentials and fail-closed authority semantics.
  const controlPlaneProvider = ctx.capability_control_plane_provider ?? new FetchCapabilityControlPlaneProvider(fetch, ctx.origin);
  const trustedTimeProvider = ctx.trusted_time_provider ?? new FetchTrustedTimeProvider(fetch, ctx.origin);
  const makeCapabilityAuthority = (store: LocalStore): CapabilityRuntimeAuthority => new CapabilityAuthorizationRouter({
    store,
    serviceId: sid,
    origin: ctx.origin,
    legacyControlPlaneProvider: controlPlaneProvider,
    legacyTrustedTimeProvider: trustedTimeProvider,
    security04Provider: ctx.security04_metadata_provider,
    embeddedSecurity04RootBytes: ctx.security04_embedded_root_bytes,
    monotonicAnchor: ctx.security04_monotonic_anchor,
  });

  const declared = new Set<string>([
    ...Object.keys(ctx.passport.schemas ?? {}),
    ...(ctx.passport.input_object_types ?? []),
    ...(ctx.passport.output_object_types ?? []),
  ]);

  const canWrite = ctx.mode !== "read-only" && ctx.mode !== "update-required";
  const canOutbound = ctx.mode === "full";

  const requireLevel = (lvl: Level, method: string) => {
    if (!ctx.granted_levels.includes(lvl)) {
      throw new ConnectError(
        `${method}: level ${lvl} not granted to "${sid}"`,
        "MISSING_LEVEL",
      );
    }
  };
  const requireWrite = (method: string) => {
    if (!canWrite) {
      throw new ConnectError(
        `${method}: writes disabled in mode "${ctx.mode}"`,
        "MISSING_LEVEL",
      );
    }
  };
  const requireOutbound = (method: string) => {
    if (!canOutbound) {
      throw new ConnectError(
        `${method}: T2 outbound requires "full" mode (current "${ctx.mode}")`,
        "MISSING_LEVEL",
      );
    }
  };
  const requireDeclaredSchema = (schema_id: string, method: string) => {
    if (declared.size === 0) return;
    if (!declared.has(schema_id)) {
      throw new ConnectError(
        `${method}: schema "${schema_id}" not declared by service "${sid}"`,
        "PASSPORT_INVALID",
        { service_id: sid, schema_id },
      );
    }
  };

  const withScoped = async <T>(
    method: string,
    level: "T1" | "T2",
    operation: (api: ScopedWorkspaceApi, capability: CapabilityRuntimeAuthority) => Promise<T>,
    capabilityScope?: { workspace_id: string; schema_id?: string },
  ): Promise<T> => {
    requireLevel(level, method);
    const store = await ensureStore();
    const mergedSchemas = await buildMergedSchemaRegistry({
      domain_registry: ctx.schemas,
      store,
    });
    const capability = makeCapabilityAuthority(store);
    if (capabilityScope) await capability.authorizeOperation(capabilityScope.workspace_id, method, capabilityScope.schema_id);
    const api = ScopedWorkspaceApi.forService(
      store,
      ctx.passport,
      ctx.origin,
      mergedSchemas,
      capability,
    );
    return operation(api, capability);
  };


  // ---- T0 surface (kernel-free) ----
  //
  // Canonical contract: input is `{ objects: unknown[] }`. Each entry is
  // validated by `validateT0Result`, which enforces the IWXAObject envelope
  // (Zod), the passport's declared schemas (schema_id must be declared,
  // schema_version must match the passport hint when present), provenance
  // (created_by_service or updated_by_service must equal the caller), and
  // the schema body itself (Ajv 2020 — full required/type/pattern check).
  //
  // T0 stays kernel-free — no IndexedDB is opened, no LocalStore is created.
  const t0: T0Surface = {
    validate: async (input) => {
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        return {
          tier: "t0",
          service_id: sid,
          ok: false,
          errors: [{ path: "(root)", message: "t0.validate expects { objects: [...] }" }],
        };
      }
      const objects = (input as { objects?: unknown }).objects;
      if (!Array.isArray(objects)) {
        return {
          tier: "t0",
          service_id: sid,
          ok: false,
          errors: [{ path: "objects", message: "t0.validate: `objects` must be an array" }],
        };
      }
      // Pre-check: declared schema_id gate short-circuits with a typed
      // PASSPORT_INVALID error (kept for backward-compatible tests).
      for (let i = 0; i < objects.length; i++) {
        const obj = objects[i];
        if (obj && typeof obj === "object" && !Array.isArray(obj)) {
          const s = (obj as { schema_id?: unknown }).schema_id;
          if (typeof s === "string") requireDeclaredSchema(s, "t0.validate");
        }
      }
      const r = validateT0Result(objects, {
        service_id: sid,
        passport: ctx.passport,
      });
      if (r.ok) {
        const errors: T0ValidateIssue[] = [];
        r.value.forEach((object, index) => {
          if (!ctx.schemas.has(object.schema_id, object.schema_version)) {
            errors.push({
              path: `[${index}].schema_id`,
              message: `Schema ${object.schema_id}@${object.schema_version} is not declared in the domain`,
            });
            return;
          }
          const validation = ctx.schemas.validate(
            object.schema_id,
            object.schema_version,
            object.data,
          );
          if (!validation.ok) {
            for (const message of validation.errors) {
              errors.push({ path: `[${index}].data`, message });
            }
          }
        });
        if (errors.length > 0) {
          return { tier: "t0", service_id: sid, ok: false, errors };
        }
        return { tier: "t0", service_id: sid, ok: true, objects: r.value } as T0ValidateResult;
      }
      return { tier: "t0", service_id: sid, ok: false, errors: r.errors } as T0ValidateResult;
    },
  };

  // ---- T1 surface (routes through ScopedWorkspaceApi) ----
  const t1: T1Surface = {
    commitObjectGraph: (input: CommitObjectGraphInput) => {
      requireWrite("t1.commitObjectGraph");
      if (!ctx.passport.permissions.operations?.includes("t1.commitObjectGraph")) throw new CapabilityDeniedError("t1.commitObjectGraph not granted");
      return withScoped("t1.commitObjectGraph", "T1", (api) => api.commitObjectGraph(input));
    },
    listWorkspaces: (opts) =>
      withScoped("t1.listWorkspaces", "T1", async (api, capability) => {
        const rows = await api.listWorkspaces(opts);
        if (!(await capability.isOperationGuarded("t1.listWorkspaces"))) return rows;
        const visible = [];
        for (const row of rows) {
          try { await capability.authorizeOperation(row.workspace_id, "t1.listWorkspaces"); visible.push(row); } catch { /* hide unauthorized workspace */ }
        }
        return visible;
      }),

    getWorkspace: (workspace_id) =>
      withScoped("t1.getWorkspace", "T1", (api) => api.getWorkspace(workspace_id), { workspace_id }),

    createWorkspace: (input) => {
      requireWrite("t1.createWorkspace");
      return withScoped("t1.createWorkspace", "T1", async (api, capability) => {
        if (await capability.isOperationGuarded("t1.createWorkspace")) {
          throw new CapabilityDeniedError("Guarded workspace creation requires a pre-existing bound instance; Provisioner flow is external to createWorkspace");
        }
        return api.createWorkspace(input);
      });
    },

    listObjects: (query) =>
      withScoped("t1.listObjects", "T1", (api) =>
        api.listObjects({
          workspace_id: query.workspace_id,
          schema_id: query.schema_id,
          include_deleted: query.include_deleted,
          limit: query.limit,
        }),
        { workspace_id: query.workspace_id, schema_id: query.schema_id },
      ),

    getObject: (workspace_id, object_id) =>
      withScoped("t1.getObject", "T1", (api) => api.getObject(workspace_id, object_id), { workspace_id }),

    putObject: async (input: PutObjectInput) => {
      requireWrite("t1.putObject");
      requireDeclaredSchema(input.schema_id, "t1.putObject");
      return withScoped("t1.putObject", "T1", (api) =>
        api.putObject({
          workspace_id: input.workspace_id,
          object_id: input.object_id,
          schema_id: input.schema_id,
          schema_version: input.schema_version,
          data: input.data,
          extensions: input.extensions,
          base_revision: input.base_revision,
          event: { event_type: input.event.event_type, payload: input.event.payload },
        }),
        { workspace_id: input.workspace_id, schema_id: input.schema_id },
      );
    },

    deleteObject: async (input: DeleteObjectInput) => {
      requireWrite("t1.deleteObject");
      return withScoped("t1.deleteObject", "T1", (api) =>
        api.deleteObject({
          workspace_id: input.workspace_id,
          object_id: input.object_id,
          base_revision: input.base_revision,
          event: { event_type: input.event.event_type, payload: input.event.payload },
        }),
        { workspace_id: input.workspace_id },
      );
    },

    putRelation: async (input: PutRelationInput) => {
      requireWrite("t1.putRelation");
      return withScoped("t1.putRelation", "T1", (api) => api.putRelation(input), { workspace_id: input.workspace_id });
    },

    deleteRelation: async (input: DeleteRelationInput) => {
      requireWrite("t1.deleteRelation");
      return withScoped("t1.deleteRelation", "T1", (api) => api.deleteRelation(input), { workspace_id: input.workspace_id });
    },

    listAssets: (query) =>
      withScoped("t1.listAssets", "T1", (api) => api.listAssets(query), { workspace_id: query.workspace_id }),

    getAsset: (workspace_id, asset_id) =>
      withScoped("t1.getAsset", "T1", (api) => api.getAsset(workspace_id, asset_id), { workspace_id }),

    putAsset: async (input: PutAssetInput) => {
      requireWrite("t1.putAsset");
      return withScoped("t1.putAsset", "T1", (api) => api.putAsset(input), { workspace_id: input.workspace_id });
    },

    deleteAsset: async (input: DeleteAssetInput) => {
      requireWrite("t1.deleteAsset");
      return withScoped("t1.deleteAsset", "T1", (api) => api.deleteAsset(input), { workspace_id: input.workspace_id });
    },

    listEventsSince: (workspace_id, since) =>
      withScoped("t1.listEventsSince", "T1", (api) =>
        api.listEventsSince(workspace_id, since),
        { workspace_id },
      ),

    softDeleteWorkspace: (workspace_id) => {
      requireWrite("t1.softDeleteWorkspace");
      return withScoped("t1.softDeleteWorkspace", "T1", (api) =>
        api.softDeleteWorkspace(workspace_id),
        { workspace_id },
      );
    },

    restoreWorkspace: (workspace_id) => {
      requireWrite("t1.restoreWorkspace");
      return withScoped("t1.restoreWorkspace", "T1", (api) =>
        api.restoreWorkspace(workspace_id),
        { workspace_id },
      );
    },

    purgePreview: (input) => {
      requireWrite("t1.purgePreview");
      return withScoped("t1.purgePreview", "T1", (api) => api.purgePreview(input), { workspace_id: input.workspace_id });
    },

    purgeCommit: (input) => {
      requireWrite("t1.purgeCommit");
      return withScoped("t1.purgeCommit", "T1", (api) => api.purgeCommit(input));
    },

    purgeCancel: (purge_token) =>
      withScoped("t1.purgeCancel", "T1", (api) => api.purgeCancel(purge_token)),
  };

  // ---- T2 surface ----
  const t2: T2Surface = {
    exportPreview: (opts) =>
      withScoped("t2.exportPreview", "T2", async (api, capability) => {
        for (const workspace_id of opts.workspaces) await capability.authorizeOperation(workspace_id, "t2.exportPreview");
        return api.exportPreview(opts);
      }),

    exportPackage: (opts) => {
      requireOutbound("t2.exportPackage");
      return withScoped("t2.exportPackage", "T2", async (api, capability) => {
        for (const workspace_id of opts.workspaces) await capability.authorizeOperation(workspace_id, "t2.exportPackage");
        return api.exportPackage(opts);
      });
    },

    confirmExport: (input) => {
      requireOutbound("t2.confirmExport");
      return withScoped("t2.confirmExport", "T2", (api) => api.confirmExport(input));
    },

    importPreview: (zip_bytes) =>
      withScoped("t2.importPreview", "T2", (api) => api.importPreview(zip_bytes)),

    importCommit: (input) => {
      requireOutbound("t2.importCommit");
      return withScoped("t2.importCommit", "T2", (api) =>
        api.importCommit(input),
      );
    },

    importCancel: (preview_token) =>
      withScoped("t2.importCancel", "T2", async (api) =>
        api.importCancel(preview_token),
      ),
  };

  const authorization = {
    forWorkspace: async (workspace_id: string) => {
      const store = await ensureStore();
      return makeCapabilityAuthority(store).authorizationForWorkspace(workspace_id);
    },
    hasCapability: async (workspace_id: string, capability_id: string) => {
      const store = await ensureStore();
      const view = await makeCapabilityAuthority(store).authorizationForWorkspace(workspace_id);
      return view.decision === "ACTIVE" && view.effective_capabilities.includes(capability_id);
    },
  };

  return { t0, t1, t2, authorization };
}

