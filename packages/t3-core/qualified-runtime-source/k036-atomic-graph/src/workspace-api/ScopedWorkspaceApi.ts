/**
 * ScopedWorkspaceApi — the ONLY layer through which a service may reach the
 * Local Store at T1/T2. Every T1/T2 method on the public Runtime funnels
 * here. Runtime never calls `commitObjectChange` / `commitObjectDelete` /
 * `PackageBuilder` / `PackageImporter` directly.
 *
 * Enforcement (all checks run BEFORE any mutation):
 *   - workspace exists, not soft-deleted, not read_only (for writes);
 *   - object_id is well-formed;
 *   - schema_id is present in the caller's `permissions.objects.{read|write|delete}`;
 *   - base_revision (if provided) is verified inside the transaction;
 *   - `permissions.workspace.{list|read|create|soft_delete|purge}` gates
 *     lifecycle operations;
 *   - `permissions.packages.{export|import}` gates T2;
 *   - `permissions.events.read_scope` narrows event streams.
 *
 * Wildcard: the ONLY implicit-broad syntax is a literal "*" entry in a
 * permission array. An empty array denies the operation for every schema.
 */

import type { LocalStore } from "../local-store/LocalStore";
import { commitAtomicGraph, normalizeGraphInput } from "../local-store/atomic-graph";
import type { CommitObjectGraphInput, CommitObjectGraphReceipt } from "../public-contract";
import { STORES } from "../local-store/types";
import type { AssetRecord as StoredAssetRecord, EventRecord, ObjectRecord, RelationRecord, WorkspaceRecord } from "../local-store/types";
import {
  commitObjectChange,
  commitObjectDelete,
  commitRelationCreate,
  commitRelationDelete,
  commitAssetPut,
  commitAssetDelete,
} from "../local-store/transactions";
import { LockAcquisitionError, LocksUnavailableError, withRestoreLock } from "../sync/locks";
import type { ServicePassport } from "../runtime/public-api";
import type {
  ConfirmExportInput,
  ConfirmExportReceipt,
  ExportReceiptSummary,
  PurgePreview,
  PurgeCommitInput,
  PurgeReceipt,
  PurgePreviewInput,
  ListWorkspacesOptions,
  CommitResult,
  SoftDeleteWorkspaceReceipt,
  RestoreWorkspaceReceipt,
  AssetRecord,
  AssetWithBytes,
  AssetCommitResult,
  AssetDeleteResult,
  RelationCommitResult,
  RelationDeleteResult,
} from "../runtime/public-api";
import { purgeTokens } from "./purgeTokenStore";
import {
  confirmExportBatch,
  countPurgeTargets,
  performRestore,
  performSoftDelete,
  purgeWorkspaceStores,
  readLastExport,
  writeExportPreparedBatch,
  type LastExportInfo,
} from "./lifecycle";
import { PackageBuilder } from "../package/export/PackageBuilder";
import { SchemaRegistry } from "../schemas/SchemaRegistry";
import { PackageImporter } from "../package/import";
import type {
  ImportPlan,
  ImportReceipt,
  ImportServiceScope,
  SecureCommitInput,
  SecureImportPreview,
} from "../package/import";
import { ImportError } from "../package/import";
import type {
  ExportOptions,
  ExportPreview,
  ExportServiceScope,
  PackageArtifact,
} from "../package/export/types";

import {
  ConfigInvalidError,
  ConflictError,
  KernelUnavailableError,
  PermissionDeniedError,
  PurgeError,
  SchemaInvalidError,
  SchemaNotDeclaredError,
  AssetNotFoundError,
  RelationNotFoundError,
  ObjectNotFoundError,
  UnsupportedSchemaError,
  toWorkspaceApiError,
  WorkspaceApiError,
} from "./errors";
import { IntegrityCheckError } from "../errors";
import { CapabilityDeniedError, CapabilityDivergenceError } from "../capability/errors";
import type { CapabilityRuntimeAuthority } from "../capability/authority";


import {
  createEvent,
} from "../events/index";


const WORKSPACE_ID_RE = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const OBJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const RELATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ASSET_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function requestResult<T>(
  request: IDBRequest<T>,
): Promise<T> {
  return new Promise(
    (resolve, reject) => {
      request.onsuccess = () =>
        resolve(
          request.result,
        );
      request.onerror = () =>
        reject(
          request.error,
        );
    },
  );
}

function isAllowed(list: string[] | undefined, schema_id: string): boolean {
  if (!list || list.length === 0) return false;
  return list.includes("*") || list.includes(schema_id);
}

export type ScopedPutObjectInput = {
  workspace_id: string;
  object_id: string;
  schema_id: string;
  schema_version: string;
  data: unknown;
  extensions?: Record<string, unknown>;
  base_revision?: number;
  event: { event_type: string; payload?: unknown };
};

export type ScopedDeleteObjectInput = {
  workspace_id: string;
  object_id: string;
  base_revision?: number;
  event: { event_type: string; payload?: unknown };
};

export type ScopedPutRelationInput = {
  workspace_id: string; relation_id: string; from_object_id: string; to_object_id: string; kind: string;
  event: { event_type: string; payload?: unknown; idempotency_key?: string };
};
export type ScopedDeleteRelationInput = {
  workspace_id: string; relation_id: string;
  event: { event_type: string; payload?: unknown; idempotency_key?: string };
};
export type ScopedPutAssetInput = {
  workspace_id: string; asset_id: string; object_id: string; mime: string; bytes: Uint8Array; base_revision?: number;
  event: { event_type: string; payload?: unknown; idempotency_key?: string };
};
export type ScopedDeleteAssetInput = {
  workspace_id: string; asset_id: string; base_revision?: number;
  event: { event_type: string; payload?: unknown; idempotency_key?: string };
};

export class ScopedWorkspaceApi {
  private constructor(
    private readonly store: LocalStore,
    private readonly passport: ServicePassport,
    private readonly origin: string,
    private readonly schemas: SchemaRegistry,
    private readonly capability?: CapabilityRuntimeAuthority,
  ) {}

  static forService(
    store: LocalStore,
    passport: ServicePassport,
    origin: string,
    schemas: SchemaRegistry,
    capability?: CapabilityRuntimeAuthority,
  ): ScopedWorkspaceApi {
    if (!origin) {
      throw new ConfigInvalidError(
        "ScopedWorkspaceApi requires a verified origin",
      );
    }
    if (!schemas) {
      throw new KernelUnavailableError(
        "ScopedWorkspaceApi requires a SchemaRegistry",
      );
    }
    return new ScopedWorkspaceApi(store, passport, origin, schemas, capability);
  }

  // ---------------------------------------------------------------------
  // workspaces
  // ---------------------------------------------------------------------


  async listWorkspaces(opts: ListWorkspacesOptions = {}): Promise<WorkspaceRecord[]> {
    return this.guard(async () => {
      this.requirePerm(this.passport.permissions.workspace.list, "workspace.list");
      const rows = await this.store.listWorkspaces();
      return opts.include_deleted ? rows : rows.filter((w) => !w.deleted_at);
    });
  }

  async getWorkspace(workspace_id: string): Promise<WorkspaceRecord | null> {
    return this.guard(async () => {
      this.requirePerm(this.passport.permissions.workspace.read, "workspace.read");
      return this.store.getWorkspace(workspace_id);
    });
  }

  async createWorkspace(input: {
    workspace_id: string;
    profile: string;
    capabilities?: string[];
    read_only?: boolean;
  }): Promise<WorkspaceRecord> {
    return this.guard(async () => {
      this.requirePerm(
        this.passport
          .permissions
          .workspace
          .create,
        "workspace.create",
      );
      if (
        !input ||
        typeof input !== "object"
      ) {
        throw new ConfigInvalidError(
          "createWorkspace: input must be an object",
        );
      }
      if (
        !input.workspace_id ||
        !WORKSPACE_ID_RE.test(
          input.workspace_id,
        )
      ) {
        throw new ConfigInvalidError(
          "workspace_id has an invalid format",
          {
            workspace_id:
              input.workspace_id,
          },
        );
      }
      if (
        typeof input.profile !==
          "string" ||
        input.profile.length === 0
      ) {
        throw new ConfigInvalidError(
          "createWorkspace: profile is required",
        );
      }
      const now =
        new Date().toISOString();
      const record:
        WorkspaceRecord = {
          workspace_id:
            input.workspace_id,
          profile:
            input.profile,
          capabilities: [
            ...(
              input.capabilities ??
              []
            ),
          ],
          read_only:
            input.read_only ??
            false,
          created_at:
            now,
          updated_at:
            now,
        };
      await this.store.transact(
        [
          STORES.workspaces,
          STORES.events,
        ],
        "readwrite",
        async (transaction) => {
          const existing =
            await requestResult(
              transaction
                .objectStore(
                  STORES.workspaces,
                )
                .get(
                  input.workspace_id,
                ),
            );
          if (existing) {
            throw new ConflictError(
              `Workspace "${input.workspace_id}" already exists`,
              {
                workspace_id:
                  input.workspace_id,
              },
            );
          }
          transaction
            .objectStore(
              STORES.workspaces,
            )
            .add(record);
          transaction
            .objectStore(
              STORES.events,
            )
            .add(
              createEvent({
                event_type:
                  "workspace.created",
                workspace_id:
                  input.workspace_id,
                service_id:
                  this.passport
                    .service_id,
                occurred_at:
                  now,
                payload: {
                  profile:
                    input.profile,
                  capabilities:
                    record.capabilities,
                  read_only:
                    record.read_only,
                },
              }),
            );
        },
      );
      return record;
    });
  }

  // ---------------------------------------------------------------------
  // objects
  // ---------------------------------------------------------------------

  async listObjects(query: {
    workspace_id: string;
    schema_id?: string;
    include_deleted?: boolean;
    limit?: number;
  }): Promise<ObjectRecord[]> {
    return this.guard(async () => {
      this.requirePerm(this.passport.permissions.workspace.read, "workspace.read");
      if (!query.workspace_id) {
        throw new ConfigInvalidError("workspace_id is required");
      }
      const readList = this.passport.permissions.objects.read;
      if (query.schema_id && !isAllowed(readList, query.schema_id)) {
        throw new PermissionDeniedError(
          `Service "${this.passport.service_id}" cannot read schema "${query.schema_id}"`,
          { schema_id: query.schema_id, service_id: this.passport.service_id },
        );
      }
      const rows = await this.store.queryObjects({
        workspace_id: query.workspace_id,
        schema_id: query.schema_id,
        limit: query.limit,
      });
      const visible = rows.filter((r) => isAllowed(readList, r.schema_id));
      return query.include_deleted ? visible : visible.filter((r) => !r.deleted);
    });
  }

  async getObject(
    workspace_id: string,
    object_id: string,
  ): Promise<{
    object: ObjectRecord;
    relations: {
      outgoing: RelationRecord[];
      incoming: RelationRecord[];
    };
  } | null> {
    return this.guard(async () => {
      this.requirePerm(
        this.passport.permissions.workspace.read,
        "workspace.read",
      );
      const object = await this.store.getObject(workspace_id, object_id);
      if (!object) return null;
      if (!isAllowed(this.passport.permissions.objects.read, object.schema_id)) {
        return null;
      }
      const outgoing = await this.store.listOutgoingRelations(
        workspace_id,
        object_id,
      );
      const incoming = await this.store.listIncomingRelations(
        workspace_id,
        object_id,
      );
      const readable = async (relatedObjectId: string): Promise<boolean> => {
        const related = await this.store.getObject(workspace_id, relatedObjectId);
        return (
          related !== null &&
          isAllowed(this.passport.permissions.objects.read, related.schema_id)
        );
      };
      const visibleOutgoing: RelationRecord[] = [];
      for (const relation of outgoing) {
        if (await readable(relation.to_object_id)) visibleOutgoing.push(relation);
      }
      const visibleIncoming: RelationRecord[] = [];
      for (const relation of incoming) {
        if (await readable(relation.from_object_id)) visibleIncoming.push(relation);
      }
      return {
        object,
        relations: { outgoing: visibleOutgoing, incoming: visibleIncoming },
      };
    });
  }

  async commitObjectGraph(input: CommitObjectGraphInput): Promise<CommitObjectGraphReceipt> {
    return this.guard(async () => {
      if (!this.passport.permissions.operations?.includes("t1.commitObjectGraph")) throw new CapabilityDeniedError("t1.commitObjectGraph not granted");
      try { input = normalizeGraphInput(input); } catch (error) {
        const raw = error as { code?: string; message?: string; details?: Record<string, unknown> };
        if (raw.code === "CONFIG_INVALID") throw new ConfigInvalidError(raw.message ?? "Invalid graph", raw.details);
        throw error;
      }
      if (!input?.object || !input.event) throw new ConfigInvalidError("commitObjectGraph: object/event required");
      if (this.capability) await this.capability.authorizeOperation(input.workspace_id, "t1.commitObjectGraph", input.object.schema_id);
      const object = input.object;
      if (!isAllowed(this.passport.permissions.objects.write, object.schema_id)) throw new PermissionDeniedError("Graph object schema not writable");
      if (!this.schemas.has(object.schema_id, object.schema_version)) throw new SchemaNotDeclaredError("Graph schema not declared");
      const validation = this.schemas.validate(object.schema_id, object.schema_version, object.data);
      if (!validation.ok) throw new SchemaInvalidError("Graph object data invalid", { errors: validation.errors });
      // Authorize every endpoint schema using the composite operation id. Recheck
      // the schema set synchronously inside the transaction to close schema-change races.
      const authorized = new Set([object.schema_id]);
      const ids = new Set((input.relation_puts ?? []).flatMap(row => [row.from_object_id, row.to_object_id]));
      for (const row of input.relation_deletes ?? []) {
        const relation = await this.store.getRelation(input.workspace_id, row.relation_id);
        if (relation) { ids.add(relation.from_object_id); ids.add(relation.to_object_id); }
      }
      ids.add(object.object_id);
      for (const id of ids) {
        const endpoint = await this.store.getObject(input.workspace_id, id);
        if (endpoint && !authorized.has(endpoint.schema_id)) {
          if (this.capability) await this.capability.authorizeOperation(input.workspace_id, "t1.commitObjectGraph", endpoint.schema_id);
          authorized.add(endpoint.schema_id);
        }
      }
      return commitAtomicGraph(this.store, input, this.passport.service_id, (schema_id) => {
        if (!authorized.has(schema_id)) throw new ConflictError("Graph endpoint schema changed during authorization");
        if (!isAllowed(this.passport.permissions.objects.write, schema_id)) throw new PermissionDeniedError("Graph endpoint schema not writable");
      });
    });
  }

  async putObject(input: ScopedPutObjectInput): Promise<CommitResult> {
    return this.guard(async () => {
      // 1. workspace liveness
      const ws = await this.requireLiveWorkspace(input.workspace_id, "putObject");
      if (ws.read_only) {
        throw new PermissionDeniedError(
          `Workspace "${input.workspace_id}" is read-only`,
          { workspace_id: input.workspace_id },
        );
      }
      // 2. schema permission
      if (!isAllowed(this.passport.permissions.objects.write, input.schema_id)) {
        throw new PermissionDeniedError(
          `Service "${this.passport.service_id}" cannot write schema "${input.schema_id}"`,
          { schema_id: input.schema_id, service_id: this.passport.service_id },
        );
      }
      // 3. object_id shape
      if (!input.object_id || !OBJECT_ID_RE.test(input.object_id)) {
        throw new ConfigInvalidError("object_id has an invalid format", {
          object_id: input.object_id,
        });
      }
      // 4. schema declared + data validates against JSON Schema
      if (!this.schemas.has(input.schema_id, input.schema_version)) {
        throw new SchemaNotDeclaredError(
          `Schema ${input.schema_id}@${input.schema_version} is not declared`,
          {
            schema_id: input.schema_id,
            schema_version: input.schema_version,
          },
        );
      }
      const validation = this.schemas.validate(
        input.schema_id,
        input.schema_version,
        input.data,
      );
      if (!validation.ok) {
        throw new SchemaInvalidError(
          `Data failed schema ${input.schema_id}@${input.schema_version}`,
          {
            schema_id: input.schema_id,
            schema_version: input.schema_version,
            errors: validation.errors,
          },
        );
      }
      return commitObjectChange(this.store, {
        workspace_id: input.workspace_id,
        by_service: this.passport.service_id,
        object: {
          object_id: input.object_id,
          schema_id: input.schema_id,
          schema_version: input.schema_version,
          data: input.data,
          extensions: input.extensions,
        },
        expectedRevision: input.base_revision,
        event: { event_type: input.event.event_type, payload: input.event.payload },
      });
    });
  }

  async deleteObject(input: ScopedDeleteObjectInput): Promise<CommitResult> {
    return this.guard(async () => {
      const ws = await this.requireLiveWorkspace(input.workspace_id, "deleteObject");
      if (ws.read_only) {
        throw new PermissionDeniedError(
          `Workspace "${input.workspace_id}" is read-only`,
          { workspace_id: input.workspace_id },
        );
      }
      // must look up the object to know its schema for the delete-permission check
      const existing = await this.store.getObject(input.workspace_id, input.object_id);
      if (!existing) {
        throw new ConflictError(
          `Object "${input.object_id}" not found in workspace "${input.workspace_id}"`,
          { workspace_id: input.workspace_id, object_id: input.object_id },
        );
      }
      if (!isAllowed(this.passport.permissions.objects.delete, existing.schema_id)) {
        throw new PermissionDeniedError(
          `Service "${this.passport.service_id}" cannot delete schema "${existing.schema_id}"`,
          { schema_id: existing.schema_id, service_id: this.passport.service_id },
        );
      }
      return commitObjectDelete(this.store, {
        workspace_id: input.workspace_id,
        object_id: input.object_id,
        by_service: this.passport.service_id,
        expectedRevision: input.base_revision,
        event: { event_type: input.event.event_type, payload: input.event.payload },
      });
    });
  }

  // ---------------------------------------------------------------------
  // relations (Runtime Contract 1.1.0)
  // ---------------------------------------------------------------------

  private async requireWritableObject(workspace_id: string, object_id: string, operation: string): Promise<ObjectRecord> {
    const object = await this.store.getObject(workspace_id, object_id);
    if (!object || object.deleted) {
      throw new ObjectNotFoundError(`${operation}: object does not exist`, { workspace_id, object_id });
    }
    if (!isAllowed(this.passport.permissions.objects.write, object.schema_id)) {
      throw new PermissionDeniedError(
        `Service "${this.passport.service_id}" cannot mutate graph/assets for schema "${object.schema_id}"`,
        { schema_id: object.schema_id, service_id: this.passport.service_id, operation },
      );
    }
    return object;
  }

  async putRelation(input: ScopedPutRelationInput): Promise<RelationCommitResult> {
    return this.guard(async () => {
      const ws = await this.requireLiveWorkspace(input.workspace_id, "putRelation");
      if (ws.read_only) throw new PermissionDeniedError(`Workspace "${input.workspace_id}" is read-only`);
      if (!RELATION_ID_RE.test(input.relation_id) || !input.kind || input.kind.length > 128) {
        throw new ConfigInvalidError("putRelation: invalid relation_id/kind");
      }
      await this.requireWritableObject(input.workspace_id, input.from_object_id, "putRelation");
      await this.requireWritableObject(input.workspace_id, input.to_object_id, "putRelation");
      return commitRelationCreate(this.store, {
        ...input,
        by_service: this.passport.service_id,
        event: { ...input.event, payload: input.event.payload ?? {} },
      });
    });
  }

  async deleteRelation(input: ScopedDeleteRelationInput): Promise<RelationDeleteResult> {
    return this.guard(async () => {
      const ws = await this.requireLiveWorkspace(input.workspace_id, "deleteRelation");
      if (ws.read_only) throw new PermissionDeniedError(`Workspace "${input.workspace_id}" is read-only`);
      const relation = await this.store.getRelation(input.workspace_id, input.relation_id);
      if (!relation) throw new RelationNotFoundError(`Relation "${input.relation_id}" not found`);
      if (relation.created_by_service !== this.passport.service_id) {
        throw new PermissionDeniedError(
          `Service "${this.passport.service_id}" cannot delete relation created by "${relation.created_by_service}"`,
          { relation_id: input.relation_id, created_by_service: relation.created_by_service },
        );
      }
      await this.requireWritableObject(input.workspace_id, relation.from_object_id, "deleteRelation");
      await this.requireWritableObject(input.workspace_id, relation.to_object_id, "deleteRelation");
      return commitRelationDelete(this.store, {
        ...input,
        by_service: this.passport.service_id,
        event: { ...input.event, payload: input.event.payload ?? {} },
      });
    });
  }

  // ---------------------------------------------------------------------
  // assets (Runtime Contract 1.1.0)
  // ---------------------------------------------------------------------

  private toPublicAsset(asset: StoredAssetRecord): AssetRecord {
    return {
      asset_id: asset.asset_id,
      workspace_id: asset.workspace_id,
      service_id: asset.service_id,
      object_id: asset.object_id ?? "",
      mime: asset.mime,
      size: asset.size,
      created_at: asset.created_at,
      updated_at: asset.updated_at ?? asset.created_at,
      updated_by_service: asset.updated_by_service ?? asset.service_id,
      revision: asset.revision ?? 1,
    };
  }

  private async assetBytes(asset: StoredAssetRecord): Promise<Uint8Array> {
    if (asset.blob instanceof Uint8Array) return asset.blob.slice();
    return new Uint8Array(await asset.blob.arrayBuffer());
  }

  async listAssets(query: { workspace_id: string; object_id?: string }): Promise<AssetRecord[]> {
    return this.guard(async () => {
      this.requirePerm(this.passport.permissions.workspace.read, "workspace.read");
      const rows = await this.store.listAssets(query);
      const out: AssetRecord[] = [];
      for (const asset of rows) {
        if (!asset.object_id) continue;
        const object = await this.store.getObject(asset.workspace_id, asset.object_id);
        if (object && !object.deleted && isAllowed(this.passport.permissions.objects.read, object.schema_id)) {
          out.push(this.toPublicAsset(asset));
        }
      }
      return out;
    });
  }

  async getAsset(workspace_id: string, asset_id: string): Promise<AssetWithBytes | null> {
    return this.guard(async () => {
      this.requirePerm(this.passport.permissions.workspace.read, "workspace.read");
      const asset = await this.store.getAsset(workspace_id, asset_id);
      if (!asset || !asset.object_id) return null;
      const object = await this.store.getObject(workspace_id, asset.object_id);
      if (!object || object.deleted || !isAllowed(this.passport.permissions.objects.read, object.schema_id)) return null;
      return { asset: this.toPublicAsset(asset), bytes: await this.assetBytes(asset) };
    });
  }

  async putAsset(input: ScopedPutAssetInput): Promise<AssetCommitResult> {
    return this.guard(async () => {
      const ws = await this.requireLiveWorkspace(input.workspace_id, "putAsset");
      if (ws.read_only) throw new PermissionDeniedError(`Workspace "${input.workspace_id}" is read-only`);
      if (!ASSET_ID_RE.test(input.asset_id) || !input.mime || input.mime.length > 255 || !(input.bytes instanceof Uint8Array)) {
        throw new ConfigInvalidError("putAsset: invalid asset_id/mime/bytes");
      }
      await this.requireWritableObject(input.workspace_id, input.object_id, "putAsset");
      const current = await this.store.getAsset(input.workspace_id, input.asset_id);
      if (current) {
        if (current.service_id !== this.passport.service_id) {
          throw new PermissionDeniedError(
            `Service "${this.passport.service_id}" cannot replace asset created by "${current.service_id}"`,
            { asset_id: input.asset_id, service_id: current.service_id },
          );
        }
        if (current.object_id && current.object_id !== input.object_id) {
          await this.requireWritableObject(input.workspace_id, current.object_id, "putAsset.rebind");
        }
      }
      const result = await commitAssetPut(this.store, {
        ...input,
        by_service: this.passport.service_id,
        expectedRevision: input.base_revision,
        event: { ...input.event, payload: input.event.payload ?? {} },
      });
      return { asset: this.toPublicAsset(result.asset), event: result.event, deduplicated: result.deduplicated };
    });
  }

  async deleteAsset(input: ScopedDeleteAssetInput): Promise<AssetDeleteResult> {
    return this.guard(async () => {
      const ws = await this.requireLiveWorkspace(input.workspace_id, "deleteAsset");
      if (ws.read_only) throw new PermissionDeniedError(`Workspace "${input.workspace_id}" is read-only`);
      const current = await this.store.getAsset(input.workspace_id, input.asset_id);
      if (!current) throw new AssetNotFoundError(`Asset "${input.asset_id}" not found`);
      if (current.service_id !== this.passport.service_id) {
        throw new PermissionDeniedError(
          `Service "${this.passport.service_id}" cannot delete asset created by "${current.service_id}"`,
          { asset_id: input.asset_id, service_id: current.service_id },
        );
      }
      if (current.object_id) await this.requireWritableObject(input.workspace_id, current.object_id, "deleteAsset");
      return commitAssetDelete(this.store, {
        ...input,
        by_service: this.passport.service_id,
        expectedRevision: input.base_revision,
        event: { ...input.event, payload: input.event.payload ?? {} },
      });
    });
  }

  // ---------------------------------------------------------------------
  // events
  // ---------------------------------------------------------------------

  async listEventsSince(
    workspace_id: string,
    since?: string,
  ): Promise<EventRecord[]> {
    return this.guard(async () => {
      this.requirePerm(this.passport.permissions.workspace.read, "workspace.read");
      const rows = await this.store.listEventsSince(workspace_id, since ?? "");
      if (this.passport.permissions.events.read_scope === "service") {
        return rows.filter((e) => e.service_id === this.passport.service_id);
      }
      return rows;
    });
  }

  // ---------------------------------------------------------------------
  // packages (T2)
  // ---------------------------------------------------------------------

  async exportPreview(opts: ExportOptions): Promise<ExportPreview> {
    return this.guard(async () => {
      if (!this.passport.permissions.packages.export) {
        throw new PermissionDeniedError(
          `Service "${this.passport.service_id}" cannot export packages`,
          { service_id: this.passport.service_id },
        );
      }
      await this.assertExportWorkspacesAccessible(opts);
      return new PackageBuilder({
        store: this.store,
        schemas: this.schemas,
        capabilityCarrierProvider: this.capability ? (workspace_ids) => this.capability!.portableCarrierForWorkspaces(workspace_ids) : undefined,
      }).exportPreview({
        ...opts,
        scope: this.buildExportScope(),
      });
    });
  }

  async exportPackage(opts: ExportOptions): Promise<PackageArtifact> {
    return this.guard(async () => {
      if (!this.passport.permissions.packages.export) {
        throw new PermissionDeniedError(
          `Service "${this.passport.service_id}" cannot export packages`,
          { service_id: this.passport.service_id },
        );
      }
      await this.assertExportWorkspacesAccessible(opts);
      const artifact = await new PackageBuilder({
        store: this.store,
        schemas: this.schemas,
        capabilityCarrierProvider: this.capability ? (workspace_ids) => this.capability!.portableCarrierForWorkspaces(workspace_ids) : undefined,
      }).buildPackage({
        ...opts,
        scope: this.buildExportScope(),
      });
      // Record an export receipt (metadata only — NO bytes) for every
      // workspace covered by the artifact. Prepared != confirmed: the user
      // must still confirm the file was saved before it counts as a backup.
      const filename = artifact.filename;
      const size = artifact.size;
      const scope_mode = artifact.summary.scope_mode;
      const packageOptions = artifact.manifest.options;
      // A prepared receipt is a *complete backup* only when a fully-trusted
      // `workspace` export was written with EVERY payload category. Source
      // of truth is the resolved manifest — PackageBuilder defaults missing
      // include_* flags to true, so an `exportPackage({ workspaces })` call
      // with no explicit flags is still a complete backup.
      const backup_complete =
        scope_mode === "workspace" &&
        packageOptions.include_history === true &&
        packageOptions.include_assets === true &&
        packageOptions.include_relations === true &&
        packageOptions.include_schemas === true;


      // Snapshot source of truth: `artifact.manifest.workspace_states` — the
      // updated_at values captured atomically at package-build time. NEVER
      // re-read Workspace rows here: a concurrent mutation between build
      // and receipt-write must not smuggle a newer snapshot into the
      // receipt.
      const stateByWorkspace = new Map(
        artifact.manifest.workspace_states.map((state) => [
          state.workspace_id,
          state.updated_at,
        ] as const),
      );
      // Integrity check: every manifest workspace has a state entry, no
      // stray states, no duplicate workspace_id.
      const manifestWorkspaces = artifact.manifest.workspaces;
      const manifestSet = new Set(manifestWorkspaces);
      if (manifestSet.size !== manifestWorkspaces.length) {
        throw new IntegrityCheckError(
          "exportPackage: duplicate workspace_id in manifest.workspaces",
          { workspaces: manifestWorkspaces },
        );
      }
      if (stateByWorkspace.size !== artifact.manifest.workspace_states.length) {
        throw new IntegrityCheckError(
          "exportPackage: duplicate workspace_id in manifest.workspace_states",
          { workspace_states: artifact.manifest.workspace_states },
        );
      }
      for (const workspace_id of manifestWorkspaces) {
        if (!stateByWorkspace.has(workspace_id)) {
          throw new IntegrityCheckError(
            `exportPackage: manifest.workspaces "${workspace_id}" has no matching workspace_states entry`,
            { workspace_id },
          );
        }
      }
      for (const state of artifact.manifest.workspace_states) {
        if (!manifestSet.has(state.workspace_id)) {
          throw new IntegrityCheckError(
            `exportPackage: manifest.workspace_states "${state.workspace_id}" is not in manifest.workspaces`,
            { workspace_id: state.workspace_id },
          );
        }
      }

      await writeExportPreparedBatch(this.store, {
        service_id: this.passport.service_id,
        package_digest: artifact.package_digest,
        semantic_digest: artifact.semantic_digest,
        filename,
        size,
        scope_mode,
        backup_complete,
        workspace_states: artifact.manifest.workspace_states,
      });
      return artifact;
    });
  }

  /**
   * Two-phase export ends here: after the caller has written the artifact
   * bytes to disk / uploaded them, they call `confirmExport` so the runtime
   * can promote the outbox record from `package.export.prepared` to
   * `package.export.confirmed`. Only confirmed exports count as backups for
   * `purgePreview`.
   */
  async confirmExport(input: ConfirmExportInput): Promise<ConfirmExportReceipt> {
    return this.guard(async () => {
      // Preflight — permissions and shape validation happen BEFORE
      // confirmExportBatch opens its transaction.
      if (!this.passport.permissions.packages.export) {
        throw new PermissionDeniedError(
          `Service "${this.passport.service_id}" cannot confirm exports`,
          { service_id: this.passport.service_id },
        );
      }
      this.requirePerm(
        this.passport.permissions.workspace.read,
        "workspace.read",
      );
      if (!input || typeof input !== "object") {
        throw new ConfigInvalidError("confirmExport: input must be an object");
      }
      const digest = input.package_digest;
      if (typeof digest !== "string" || digest.length < 8) {
        throw new ConfigInvalidError("confirmExport: package_digest is required", {
          package_digest: digest,
        });
      }
      if (
        input.workspace_ids !== undefined &&
        !Array.isArray(input.workspace_ids)
      ) {
        throw new ConfigInvalidError(
          "confirmExport: workspace_ids must be an array of strings",
        );
      }
      if (Array.isArray(input.workspace_ids)) {
        for (const id of input.workspace_ids) {
          if (typeof id !== "string" || id.length === 0) {
            throw new ConfigInvalidError(
              "confirmExport: workspace_ids entries must be non-empty strings",
            );
          }
        }
      }
      if (this.capability && await this.capability.isOperationGuarded("t2.confirmExport")) {
        if (!Array.isArray(input.workspace_ids) || input.workspace_ids.length === 0) {
          throw new CapabilityDeniedError("Guarded confirmExport requires explicit workspace_ids before mutation");
        }
        for (const workspace_id of input.workspace_ids) await this.capability.authorizeOperation(workspace_id, "t2.confirmExport");
      }

      const result = await confirmExportBatch(this.store, {
        service_id: this.passport.service_id,
        package_digest: digest,
        workspace_ids: input.workspace_ids,
      });
      return {
        confirmed_at: result.confirmation_timestamp,
        package_digest: digest,
        workspace_ids: result.workspace_ids,
        confirmations: result.confirmations.length,
      };
    });
  }



  /**
   * Guard shared by exportPreview / exportPackage.
   *
   *   1. Requires `workspace.read` — package export must not be a back
   *      door around the permission model.
   *   2. Every workspace id passed by the caller must resolve to a real
   *      local record; unknown ids are rejected before the builder runs
   *      so the manifest never claims workspaces that don't exist.
   */
  private async assertExportWorkspacesAccessible(
    opts: ExportOptions,
  ): Promise<void> {
    this.requirePerm(this.passport.permissions.workspace.read, "workspace.read");
    const wsIds = (opts as { workspaces?: string[] }).workspaces ?? [];
    for (const id of wsIds) {
      const ws = await this.store.getWorkspace(id);
      if (!ws) {
        throw new PermissionDeniedError(
          `Workspace "${id}" is not accessible for export`,
          { workspace_id: id, service_id: this.passport.service_id },
        );
      }
    }
  }

  /**
   * T2 import — phase 1. Decompresses the package exactly once, stages it
   * in Runtime memory, and returns a one-time `preview_token` bound to
   * (service_id, origin, package_digest). Nothing is written to IndexedDB.
   */
  async importPreview(zip_bytes: Uint8Array): Promise<SecureImportPreview> {
    return this.guard(async () => {
      this.requirePackageImport();
      return PackageImporter.previewSecure(zip_bytes, this.store, {
        binding: {
          service_id: this.passport.service_id,
          origin: this.origin,
          package_digest: "", // filled by previewSecure from the staged manifest
        },
        schemas: this.schemas,
        scope: this.buildImportScope(),
        capability: this.capability,
      });
    });
  }

  /**
   * T2 import — phase 2. Consumes the `preview_token` returned by phase 1,
   * re-validates (service_id, origin, package_digest) and applies the
   * already-staged package under the caller's chosen plan.
   */
  async importCommit(input: SecureCommitInput): Promise<ImportReceipt> {
    return this.guard(async () => {
      this.requirePackageImport();
      return PackageImporter.commitSecure(this.store, input, {
        binding: {
          service_id: this.passport.service_id,
          origin: this.origin,
          package_digest: input?.package_digest ?? "",
        },
        scope: this.buildImportScope(),
        schemas: this.schemas,
        capability: this.capability,
      });
    });
  }

  /** Explicitly discard a staged package. */
  importCancel(preview_token: string): boolean {
    return PackageImporter.cancelSecure(preview_token, {
      service_id: this.passport.service_id,
      origin: this.origin,
    });
  }

  /**
   * Derive the caller's `ExportServiceScope` from its passport. Trusted
   * universal Workspace passports (validated at passport-load time) are
   * the only ones that ever produce `{ mode: "workspace" }`; every other
   * service falls through to `readable_objects` — see requirement #3 in
   * the package-permissions spec.
   */
  private buildExportScope(): ExportServiceScope {
    const pkg = this.passport.permissions.packages;
    if (pkg.export_scope === "workspace") return { mode: "workspace" };
    return {
      mode: "readable_objects",
      service_id: this.passport.service_id,
      readable_schemas: [...this.passport.permissions.objects.read],
      event_read_scope: this.passport.permissions.events.read_scope,
    };
  }

  private buildImportScope(): ImportServiceScope {
    const pkg = this.passport.permissions.packages;
    if (pkg.import_scope === "workspace") return { mode: "workspace" };
    return {
      mode: "writable_objects",
      service_id: this.passport.service_id,
      writable_schemas: [...this.passport.permissions.objects.write],
      deletable_schemas: [...this.passport.permissions.objects.delete],
      // A regular service may re-create a Workspace via package import
      // only if its passport explicitly grants `workspace.create`. Foreign
      // events/assets remain forbidden — only trusted `workspace` scope
      // can carry cross-service authorship.
      allow_create_workspace: this.passport.permissions.workspace.create === true,
      allow_foreign_events: false,
      allow_foreign_assets: false,
    };
  }

  private requirePackageImport(): void {
    if (!this.passport.permissions.packages.import) {
      throw new PermissionDeniedError(
        `Service "${this.passport.service_id}" cannot import packages`,
        { service_id: this.passport.service_id },
      );
    }
  }

  // ---------------------------------------------------------------------
  // workspace lifecycle (soft-delete / restore / two-phase purge)
  //
  // Implementations live in `./lifecycle.ts`; this class is the permission
  // gate + auditing layer. WorkspaceApi uses the same primitives, so we
  // don't fork lifecycle rules across two files.
  // ---------------------------------------------------------------------

  async softDeleteWorkspace(
    workspace_id: string,
  ): Promise<SoftDeleteWorkspaceReceipt> {
    return this.guard(async () => {
      this.requirePerm(
        this.passport.permissions.workspace.soft_delete,
        "workspace.soft_delete",
      );
      const ws = await this.getExisting(workspace_id, "softDeleteWorkspace");
      const next = await performSoftDelete(this.store, ws, this.passport.service_id);
      return { workspace_id, deleted_at: next.deleted_at as string };
    });
  }

  async restoreWorkspace(
    workspace_id: string,
  ): Promise<RestoreWorkspaceReceipt> {
    return this.guard(async () => {
      this.requirePerm(
        this.passport.permissions.workspace.restore,
        "workspace.restore",
      );
      const ws = await this.getExisting(workspace_id, "restoreWorkspace");
      const next = await withRestoreLock(() =>
        performRestore(this.store, ws, this.passport.service_id),
      );
      return { workspace_id, restored_at: next.updated_at };

    });
  }

  async purgePreview(input: PurgePreviewInput): Promise<PurgePreview> {
    return this.guard(async () => {
      this.requirePerm(
        this.passport.permissions.workspace.purge,
        "workspace.purge",
      );
      const ws = await this.getExisting(input.workspace_id, "purgePreview");
      if (!ws.deleted_at) {
        throw new PurgeError(
          "PURGE_NOT_TRASHED",
          `Workspace "${input.workspace_id}" must be soft-deleted before purge`,
          { workspace_id: input.workspace_id },
        );
      }
      const counts = await countPurgeTargets(this.store, input.workspace_id);
      const last_export = await readLastExport(
        this.store,
        input.workspace_id,
        this.passport.service_id,
        ws.updated_at,
      );
      const acknowledge_no_backup = input.acknowledge_no_backup === true;
      const registered = purgeTokens.register({
        binding: {
          service_id: this.passport.service_id,
          origin: this.origin,
          workspace_id: input.workspace_id,
          workspace_updated_at: ws.updated_at,
        },
        acknowledge_no_backup,
        last_export_at: last_export.confirmed?.at ?? null,
      });
      return {
        purge_token: registered.purge_token,
        challenge: registered.challenge,
        expires_at: registered.expires_at,
        workspace_id: input.workspace_id,
        // Named `workspace_state_timestamp` to make it clear this is a
        // wall-clock timestamp derived from `workspaces.updated_at`, not a
        // monotonic revision counter.
        workspace_state_timestamp: Date.parse(ws.updated_at) || 0,
        counts,
        last_export: this.projectLastExport(last_export),
        acknowledge_no_backup,
      };
    });
  }

  async purgeCommit(input: PurgeCommitInput): Promise<PurgeReceipt> {
    return this.guard(async () => {
      this.requirePerm(
        this.passport.permissions.workspace.purge,
        "workspace.purge",
      );
      const preview = purgeTokens.peek(input.purge_token);
      if (!preview) {
        throw new PurgeError("PURGE_TOKEN_INVALID", "unknown purge_token");
      }
      if (this.capability) await this.capability.authorizeOperation(preview.workspace_id, "t1.purgeCommit");
      const ws = await this.getExisting(preview.workspace_id, "purgeCommit");
      if (!ws.deleted_at) {
        throw new PurgeError(
          "PURGE_NOT_TRASHED",
          "workspace was restored after preview",
          { workspace_id: preview.workspace_id },
        );
      }
      if (!preview.acknowledge_no_backup) {
        const status = await readLastExport(
          this.store,
          preview.workspace_id,
          this.passport.service_id,
          ws.updated_at,
        );
        if (status.backup_status !== "current") {
          throw new PurgeError(
            "PURGE_EXPORT_NOT_CONFIRMED",
            "A current confirmed full backup is required, or acknowledge_no_backup must be true",
            { workspace_id: preview.workspace_id, backup_status: status.backup_status },
          );
        }
      }
      const entry = purgeTokens.consume(
        input.purge_token,
        {
          service_id: this.passport.service_id,
          origin: this.origin,
          workspace_id: preview.workspace_id,
          workspace_updated_at: ws.updated_at,
        },
        input.confirmation,
      );
      const removed = await withRestoreLock(() =>
        purgeWorkspaceStores(this.store, entry.workspace_id),
      );
      return { workspace_id: entry.workspace_id, removed };
    });
  }

  async purgeCancel(purge_token: string): Promise<boolean> {
    const preview = purgeTokens.peek(purge_token);
    if (preview && this.capability) await this.capability.authorizeOperation(preview.workspace_id, "t1.purgeCancel");
    return purgeTokens.cancel(purge_token, {
      service_id: this.passport.service_id,
      origin: this.origin,
    });
  }

  // ---------------------------------------------------------------------
  // lifecycle helpers
  // ---------------------------------------------------------------------

  private async getExisting(
    workspace_id: string,
    op: string,
  ): Promise<WorkspaceRecord> {
    if (!workspace_id || !WORKSPACE_ID_RE.test(workspace_id)) {
      throw new ConfigInvalidError(`${op}: workspace_id has an invalid format`, {
        workspace_id,
      });
    }
    const ws = await this.store.getWorkspace(workspace_id);
    if (!ws) {
      throw new ConflictError(`${op}: workspace "${workspace_id}" not found`, {
        workspace_id,
      });
    }
    return ws;
  }

  // findWorkspacesForDigest removed — confirmExportBatch performs the scan
  // and preflight atomically inside its own transaction.



  private projectLastExport(info: LastExportInfo): PurgePreview["last_export"] {
    const project = (r: LastExportInfo["prepared"]): ExportReceiptSummary | null =>
      r
        ? {
            at: r.at,
            outbox_id: r.outbox_id,
            package_digest: r.package_digest,
            semantic_digest: r.semantic_digest,
            filename: r.filename,
            size: r.size,
            age_ms: r.age_ms,
          }
        : null;
    return {
      prepared: project(info.prepared),
      confirmed: project(info.confirmed),
      backup_status: info.backup_status,
      warning: info.warning,
    };
  }



  private requirePerm(flag: boolean, name: string): void {
    if (!flag) {
      throw new PermissionDeniedError(
        `Service "${this.passport.service_id}" does not have permission "${name}"`,
        { service_id: this.passport.service_id, permission: name },
      );
    }
  }

  private async requireLiveWorkspace(
    workspace_id: string,
    op: string,
  ): Promise<WorkspaceRecord> {
    if (!workspace_id || !WORKSPACE_ID_RE.test(workspace_id)) {
      throw new ConfigInvalidError(`${op}: workspace_id has an invalid format`, {
        workspace_id,
      });
    }
    const ws = await this.store.getWorkspace(workspace_id);
    if (!ws) {
      throw new ConflictError(`${op}: workspace "${workspace_id}" does not exist`, {
        workspace_id,
      });
    }
    if (ws.deleted_at) {
      throw new PermissionDeniedError(
        `${op}: workspace "${workspace_id}" is soft-deleted`,
        { workspace_id, deleted_at: ws.deleted_at },
      );
    }
    return ws;
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.store.isOpen()) {
      throw new KernelUnavailableError("LocalStore is not open");
    }
    try {
      return await fn();
    } catch (e) {
      if (e instanceof WorkspaceApiError) throw e;
      if (e instanceof ImportError) throw e;
      if (e instanceof CapabilityDeniedError || e instanceof CapabilityDivergenceError) throw e;
      if (e instanceof LocksUnavailableError || e instanceof LockAcquisitionError) throw e;
      throw toWorkspaceApiError(e);

    }
  }
}

// Silence unused-imports warning for UnsupportedSchemaError (kept for public export parity).
export type { UnsupportedSchemaError };
