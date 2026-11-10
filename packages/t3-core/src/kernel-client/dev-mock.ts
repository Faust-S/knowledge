/**
 * Development-only mock of the real `IWXAClient` surface.
 *
 * Mirrors the Runtime Contract 1.3.0 Runtime Contract exactly:
 *   - Top-level: `contract_version`, `runtime_version`, `granted_levels`,
 *     `granted_operations`, `mode`, `service`.
 *   - Object identity: `(workspace_id, object_id)`. No `id`, no owner
 *     `service_id`, no top-level `version`.
 *   - `t0` / `t1` / `t2` are plain method-bag objects (never callable).
 *   - `getWorkspace` returns `WorkspaceRecord | null`.
 *
 * MUST be imported only via a dynamic `import()` guarded by
 * `import.meta.env.DEV`. Carries the `IWXA_DEV_MOCK_MARKER` sentinel so
 * `scripts/verify-chunks.mjs` can prove it never ships in production.
 */

/* IWXA_DEV_MOCK_MARKER */

import type {
  CommitResult,
  ListAssetsQuery,
  RelationRecord,
  RelationDeleteResult,
  RelationCommitResult,
  PutRelationInput,
  PutAssetInput,
  DeleteRelationInput,
  DeleteAssetInput,
  AssetWithBytes,
  AssetRecord,
  AssetDeleteResult,
  AssetCommitResult,
  ConfirmExportInput,
  ConfirmExportReceipt,
  DeleteObjectInput,
  EventRecord,
  ExportOptions,
  ExportPreview,
  ImportPlan,
  ImportReceipt,
  IWXAClient,
  Level,
  ListObjectsQuery,
  ObjectRecord,
  ObjectWithRelations,
  PackageArtifact,
  PurgeCommitInput,
  PurgePreview,
  PurgePreviewInput,
  PurgeReceipt,
  PutObjectInput,
  RestoreWorkspaceReceipt,
  SecureCommitInput,
  SecureImportPreview,
  SoftDeleteWorkspaceReceipt,
  T0Surface,
  T1Surface,
  T2Surface,
  WorkspaceRecord,
} from "./contracts/runtime-1.3.0";
import { ALL_OPERATIONS } from "./contracts/runtime-1.3.0";
import { PackageCorruptedError, PreviewTokenInvalidError } from "./errors";

import type { KernelBootstrap, KernelSession } from "./types";
import { CONTRACT_VERSION } from "./contracts/runtime-1.3.0";

const READ_OPS: readonly string[] = [
  "t1.listWorkspaces",
  "t1.getWorkspace",
  "t1.listObjects",
  "t1.getObject",
  "t1.listAssets",
  "t1.getAsset",
  "t1.listEventsSince",
];
const EXPORT_OPS: readonly string[] = [
  "t2.exportPreview",
  "t2.exportPackage",
  "t2.confirmExport",
];

/**
 * Full-mode default `granted_operations`: every op in the Runtime Contract 1.3.0
 * inventory (`ALL_OPERATIONS`). Mode-specific defaults trim the set.
 */
// This mock has no atomic graph implementation. Never advertise one.
const DEFAULT_OPERATIONS: readonly string[] = ALL_OPERATIONS.filter(op => op !== "t1.commitObjectGraph");

function defaultOpsForMode(mode: IWXAClient["mode"]): string[] {
  switch (mode) {
    case "read-only":
      return [...READ_OPS, "t2.exportPreview"];
    case "limited":
      return [...READ_OPS, "t2.exportPreview"];
    case "emergency-export":
      return [...READ_OPS, ...EXPORT_OPS];
    case "update-required":
      return [];
    case "full":
    default:
      return [...DEFAULT_OPERATIONS];
  }
}

export interface DevMockOptions {
  serviceId?: string;
  basePath?: string;
  mode?: IWXAClient["mode"];
  grantedLevels?: Level[];
  grantedOperations?: string[];
  contractVersion?: string;
  runtimeVersion?: string;
  seedWorkspaces?: WorkspaceRecord[];
  seedObjects?: ObjectRecord[];
}

interface Store {
  workspaces: Map<string, WorkspaceRecord>;
  /** key = `${workspace_id}:${object_id}` */
  objects: Map<string, ObjectRecord>;
  relations: Map<string, RelationRecord>;
  assets: Map<string, AssetWithBytes>;
  events: EventRecord[];
}

function objKey(ws: string, oid: string): string {
  return `${ws}:${oid}`;
}

function newStore(seed?: DevMockOptions): Store {
  const now = new Date().toISOString();
  const wss = new Map<string, WorkspaceRecord>();
  for (const w of seed?.seedWorkspaces ?? []) wss.set(w.workspace_id, w);
  if (wss.size === 0) {
    wss.set("demo", {
      workspace_id: "demo",
      profile: "demo",
      capabilities: ["T1"],
      read_only: false,
      created_at: now,
      updated_at: now,
    });
  }
  const objs = new Map<string, ObjectRecord>();
  for (const o of seed?.seedObjects ?? []) {
    objs.set(objKey(o.workspace_id, o.object_id), o);
  }
  return { workspaces: wss, objects: objs, relations: new Map(), assets: new Map(), events: [] };
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createDevMockClient(opts: DevMockOptions = {}): KernelSession {
  const serviceId = opts.serviceId ?? "iwxa.dev.mock";
  const basePath = opts.basePath ?? "/workspace/";
  const mode = opts.mode ?? "full";
  const grantedLevels = opts.grantedLevels ?? (["T0", "T1", "T2"] as Level[]);
  const grantedOperations = opts.grantedOperations ?? defaultOpsForMode(mode);
  const store = newStore(opts);
  const pendingPurges = new Map<
    string,
    { workspace_id: string; challenge: string; expires_at: number }
  >();

  const buildEvent = (
    workspace_id: string,
    event_type: string,
    payload: unknown,
  ): EventRecord => ({
    workspace_id,
    service_id: serviceId,
    event_id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    event_type,
    payload,
    occurred_at: nowIso(),
  });

  const t0: T0Surface = {
    validate: async (input) => ({
      tier: "t0",
      service_id: serviceId,
      ok: true,
      objects: (input.objects ?? []) as ObjectRecord[],
    }),
  };

  const t1: T1Surface = {
    commitObjectGraph: async () => {
      throw new Error("DEV_MOCK_ATOMIC_GRAPH_UNAVAILABLE");
    },
    listWorkspaces: async () => [...store.workspaces.values()],
    getWorkspace: async (id: string) => store.workspaces.get(id) ?? null,
    createWorkspace: async (input) => {
      if (store.workspaces.has(input.workspace_id)) {
        throw new Error(`workspace "${input.workspace_id}" already exists`);
      }
      const now = nowIso();
      const rec: WorkspaceRecord = {
        workspace_id: input.workspace_id,
        profile: input.profile,
        capabilities: [...(input.capabilities ?? [])],
        read_only: input.read_only ?? false,
        created_at: now,
        updated_at: now,
      };
      store.workspaces.set(rec.workspace_id, rec);
      return rec;
    },
    listObjects: async (q: ListObjectsQuery) => {
      return [...store.objects.values()].filter(
        (o) =>
          o.workspace_id === q.workspace_id &&
          (!q.schema_id || o.schema_id === q.schema_id) &&
          (q.include_deleted || !o.deleted),
      );
    },
    getObject: async (
      workspace_id: string,
      object_id: string,
    ): Promise<ObjectWithRelations | null> => {
      const rec = store.objects.get(objKey(workspace_id, object_id));
      if (!rec) return null;
      const relations = [...store.relations.values()].filter((r) => r.workspace_id === workspace_id);
      return {
        object: rec,
        relations: {
          outgoing: relations.filter((r) => r.from_object_id === object_id),
          incoming: relations.filter((r) => r.to_object_id === object_id),
        },
      };
    },
    putObject: async (input: PutObjectInput): Promise<CommitResult> => {
      const key = objKey(input.workspace_id, input.object_id);
      const prev = store.objects.get(key);
      const currentRev = prev?.revision ?? 0;
      const baseRev = input.base_revision ?? currentRev;
      if (baseRev !== currentRev) {
        throw new Error(
          `CONFLICT: base_revision ${baseRev} ≠ current ${currentRev}`,
        );
      }
      const now = nowIso();
      const rec: ObjectRecord = {
        workspace_id: input.workspace_id,
        object_id: input.object_id,
        schema_id: input.schema_id,
        schema_version: input.schema_version,
        created_by_service: prev?.created_by_service ?? serviceId,
        updated_by_service: serviceId,
        created_at: prev?.created_at ?? now,
        updated_at: now,
        revision: currentRev + 1,
        data: input.data,
        extensions: input.extensions ?? prev?.extensions ?? {},
        deleted: false,
        deleted_at: undefined,
      };
      store.objects.set(key, rec);
      const ev = buildEvent(input.workspace_id, input.event.event_type, input.event.payload);
      store.events.push(ev);
      return { object: rec, event: ev, deduplicated: false };
    },
    deleteObject: async (input: DeleteObjectInput): Promise<CommitResult> => {
      const key = objKey(input.workspace_id, input.object_id);
      const prev = store.objects.get(key);
      if (!prev) throw new Error(`OBJECT_NOT_FOUND: ${key}`);
      const baseRev = input.base_revision ?? prev.revision;
      if (baseRev !== prev.revision) {
        throw new Error(
          `CONFLICT: base_revision ${baseRev} ≠ current ${prev.revision}`,
        );
      }
      const now = nowIso();
      const rec: ObjectRecord = {
        ...prev,
        deleted: true,
        deleted_at: now,
        revision: prev.revision + 1,
        updated_by_service: serviceId,
        updated_at: now,
      };
      store.objects.set(key, rec);
      const ev = buildEvent(input.workspace_id, input.event.event_type, input.event.payload);
      store.events.push(ev);
      return { object: rec, event: ev, deduplicated: false };
    },
    putRelation: async (input: PutRelationInput): Promise<RelationCommitResult> => {
      const now = nowIso();
      const relation: RelationRecord = {
        relation_id: input.relation_id,
        workspace_id: input.workspace_id,
        from_object_id: input.from_object_id,
        to_object_id: input.to_object_id,
        kind: input.kind,
        created_at: store.relations.get(input.relation_id)?.created_at ?? now,
        created_by_service: serviceId,
      };
      store.relations.set(input.relation_id, relation);
      const event = buildEvent(input.workspace_id, input.event.event_type, input.event.payload);
      store.events.push(event);
      return { relation, event, deduplicated: false };
    },
    deleteRelation: async (input: DeleteRelationInput): Promise<RelationDeleteResult> => {
      if (!store.relations.delete(input.relation_id)) throw new Error(`RELATION_NOT_FOUND: ${input.relation_id}`);
      const event = buildEvent(input.workspace_id, input.event.event_type, input.event.payload);
      store.events.push(event);
      return { relation_id: input.relation_id, event, deduplicated: false };
    },
    listAssets: async (query: ListAssetsQuery): Promise<AssetRecord[]> =>
      [...store.assets.values()]
        .map((row) => row.asset)
        .filter((asset) => asset.workspace_id === query.workspace_id && (!query.object_id || asset.object_id === query.object_id)),
    getAsset: async (workspace_id: string, asset_id: string): Promise<AssetWithBytes | null> => {
      const row = store.assets.get(asset_id);
      return row?.asset.workspace_id === workspace_id ? row : null;
    },
    putAsset: async (input: PutAssetInput): Promise<AssetCommitResult> => {
      const previous = store.assets.get(input.asset_id)?.asset;
      const currentRevision = previous?.revision ?? 0;
      const baseRevision = input.base_revision ?? currentRevision;
      if (baseRevision !== currentRevision) throw new Error(`CONFLICT: base_revision ${baseRevision} ≠ current ${currentRevision}`);
      const now = nowIso();
      const asset: AssetRecord = {
        asset_id: input.asset_id,
        workspace_id: input.workspace_id,
        service_id: serviceId,
        object_id: input.object_id,
        mime: input.mime,
        size: input.bytes.byteLength,
        created_at: previous?.created_at ?? now,
        updated_at: now,
        updated_by_service: serviceId,
        revision: currentRevision + 1,
      };
      store.assets.set(input.asset_id, { asset, bytes: new Uint8Array(input.bytes) });
      const event = buildEvent(input.workspace_id, input.event.event_type, input.event.payload);
      store.events.push(event);
      return { asset, event, deduplicated: false };
    },
    deleteAsset: async (input: DeleteAssetInput): Promise<AssetDeleteResult> => {
      const existing = store.assets.get(input.asset_id);
      if (!existing || existing.asset.workspace_id !== input.workspace_id) throw new Error(`ASSET_NOT_FOUND: ${input.asset_id}`);
      const baseRevision = input.base_revision ?? existing.asset.revision;
      if (baseRevision !== existing.asset.revision) throw new Error(`CONFLICT: base_revision ${baseRevision} ≠ current ${existing.asset.revision}`);
      store.assets.delete(input.asset_id);
      const event = buildEvent(input.workspace_id, input.event.event_type, input.event.payload);
      store.events.push(event);
      return { asset_id: input.asset_id, event, deduplicated: false };
    },
    listEventsSince: async (workspace_id: string, since?: string) => {
      const rows = store.events.filter((e) => e.workspace_id === workspace_id);
      if (!since) return rows;
      return rows.filter((e) => e.occurred_at > since);
    },
    softDeleteWorkspace: async (
      workspace_id: string,
    ): Promise<SoftDeleteWorkspaceReceipt> => {
      const w = store.workspaces.get(workspace_id);
      if (!w) throw new Error(`WORKSPACE_NOT_FOUND: ${workspace_id}`);
      const deleted_at = nowIso();
      store.workspaces.set(workspace_id, { ...w, deleted_at });
      return { workspace_id, deleted_at };
    },
    restoreWorkspace: async (
      workspace_id: string,
    ): Promise<RestoreWorkspaceReceipt> => {
      const w = store.workspaces.get(workspace_id);
      if (!w) throw new Error(`WORKSPACE_NOT_FOUND: ${workspace_id}`);
      const restored_at = nowIso();
      const { deleted_at: _dropped, ...rest } = w;
      void _dropped;
      store.workspaces.set(workspace_id, { ...rest });
      return { workspace_id, restored_at };
    },
    purgePreview: async (input: PurgePreviewInput): Promise<PurgePreview> => {
      const w = store.workspaces.get(input.workspace_id);
      if (!w) throw new Error(`WORKSPACE_NOT_FOUND: ${input.workspace_id}`);
      const objs = [...store.objects.values()].filter(
        (o) => o.workspace_id === input.workspace_id,
      );
      const evs = store.events.filter((e) => e.workspace_id === input.workspace_id);
      const rels = [...store.relations.values()].filter((r) => r.workspace_id === input.workspace_id);
      const assets = [...store.assets.values()].filter((a) => a.asset.workspace_id === input.workspace_id);
      const purge_token = `purge-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const challenge = `PURGE ${input.workspace_id}`;
      const expires_at_ms = Date.now() + 15 * 60 * 1000;
      const preview: PurgePreview = {
        purge_token,
        challenge,
        expires_at: new Date(expires_at_ms).toISOString(),
        workspace_id: input.workspace_id,
        workspace_state_timestamp: Date.parse(w.updated_at) || Date.now(),
        counts: {
          objects: objs.length,
          events: evs.length,
          relations: rels.length,
          assets: assets.length,
          permissions: 0,
          service_state: 0,
          outbox: 0,
        },
        last_export: {
          prepared: null,
          confirmed: null,
          backup_status: "missing",
          warning: null,
        },
        acknowledge_no_backup: !!input.acknowledge_no_backup,
      };
      pendingPurges.set(purge_token, {
        workspace_id: input.workspace_id,
        challenge,
        expires_at: expires_at_ms,
      });
      return preview;
    },
    purgeCommit: async (input: PurgeCommitInput): Promise<PurgeReceipt> => {
      const entry = pendingPurges.get(input.purge_token);
      if (!entry) throw new Error("PURGE_TOKEN_INVALID");
      if (Date.now() > entry.expires_at) {
        pendingPurges.delete(input.purge_token);
        throw new Error("PURGE_EXPIRED");
      }
      if (entry.challenge !== input.confirmation) {
        throw new Error("PURGE_CHALLENGE_MISMATCH");
      }
      const ws = entry.workspace_id;
      const objs = [...store.objects.values()].filter((o) => o.workspace_id === ws);
      const evs = store.events.filter((e) => e.workspace_id === ws);
      const rels = [...store.relations.values()].filter((r) => r.workspace_id === ws);
      const assets = [...store.assets.values()].filter((a) => a.asset.workspace_id === ws);
      for (const o of objs) store.objects.delete(objKey(o.workspace_id, o.object_id));
      for (const r of rels) store.relations.delete(r.relation_id);
      for (const a of assets) store.assets.delete(a.asset.asset_id);
      store.events = store.events.filter((e) => e.workspace_id !== ws);
      const hadWorkspace = store.workspaces.delete(ws);
      pendingPurges.delete(input.purge_token);
      return {
        workspace_id: ws,
        removed: {
          workspaces: hadWorkspace ? 1 : 0,
          objects: objs.length,
          events: evs.length,
          relations: rels.length,
          assets: assets.length,
          permissions: 0,
          service_state: 0,
          outbox: 0,
        },
      };
    },
    purgeCancel: async (purge_token: string): Promise<boolean> => {
      return pendingPurges.delete(purge_token);
    },
  };



  // ---- T2: token-based export / import ------------------------------------
  type PendingPreview = {
    package_digest: string;
    semantic_digest: string;
    expires_at: number;
    parsed: {
      workspaces: WorkspaceRecord[];
      objects: ObjectRecord[];
      events: EventRecord[];
    };
    body: SecureImportPreview["preview"];
    consumed: boolean;
  };
  const pendingPreviews = new Map<string, PendingPreview>();
  const PREVIEW_TTL_MS = 15 * 60 * 1000;

  const collectExport = (opts: ExportOptions) => {
    const ids = opts.workspaces ?? [];
    const wss = [...store.workspaces.values()].filter((w) => ids.includes(w.workspace_id));
    const objs = [...store.objects.values()].filter((o) => ids.includes(o.workspace_id));
    const evs = store.events.filter((e) => ids.includes(e.workspace_id));
    const schemaSet = new Set(objs.map((o) => `${o.schema_id}@${o.schema_version}`));
    return { ids, wss, objs, evs, schemaCount: schemaSet.size };
  };

  const t2: T2Surface = {
    exportPreview: async (opts: ExportOptions): Promise<ExportPreview> => {
      const { ids, objs, evs, schemaCount } = collectExport(opts);
      const includeHistory = opts.include_history ?? true;
      const includeRelations = opts.include_relations ?? true;
      const includeAssets = opts.include_assets ?? true;
      const includeSchemas = opts.include_schemas ?? true;
      const counts = {
        workspaces: ids.length,
        objects: objs.length,
        events: includeHistory ? evs.length : 0,
        relations: includeRelations ? 0 : 0,
        assets: includeAssets ? 0 : 0,
        schemas: includeSchemas ? schemaCount : 0,
      };
      return {
        workspaces: ids,
        counts,
        approx_bytes: JSON.stringify({ objs, evs }).length,
        summary: {
          included: counts,
          excluded_by_permission: {
            workspaces: 0, objects: 0, events: 0,
            relations: 0, assets: 0, schemas: 0,
          },
          scope_mode: opts.scope?.mode ?? "workspace",
        },
        unsupported: [],
        conflicts: [],
      };
    },
    exportPackage: async (opts: ExportOptions): Promise<PackageArtifact> => {
      const { ids, wss, objs, evs, schemaCount } = collectExport(opts);
      const includeHistory = opts.include_history ?? true;
      const includeRelations = opts.include_relations ?? true;
      const includeAssets = opts.include_assets ?? true;
      const includeSchemas = opts.include_schemas ?? true;
      const payload = { workspaces: wss, objects: objs, events: includeHistory ? evs : [] };
      const bytes = new TextEncoder().encode(JSON.stringify(payload));
      const digest = `sha256-${bytes.length}-${ids.join(",")}`;
      const counts = {
        workspaces: ids.length,
        objects: objs.length,
        events: payload.events.length,
        relations: 0,
        assets: 0,
        schemas: includeSchemas ? schemaCount : 0,
      };
      return {
        filename: `dev-mock-${Date.now()}.iwxa`,
        bytes,
        size: bytes.byteLength,
        package_digest: digest,
        semantic_digest: `sem-${digest}`,
        manifest: {
          format: "iwxa.package",
          format_version: "1.0",
          encryption: "none",
          created_at: nowIso(),
          workspaces: ids,
          workspace_states: wss.map((w) => ({
            workspace_id: w.workspace_id,
            updated_at: w.updated_at,
          })),
          options: {
            include_history: includeHistory,
            include_assets: includeAssets,
            include_relations: includeRelations,
            include_schemas: includeSchemas,
          },
          counts,
          files: [],
          package_digest: digest,
          semantic_digest: `sem-${digest}`,
        },
        validation: {
          format: "iwxa.package.validation",
          ok: true,
          checked_at: nowIso(),
          file_count: 0,
          object_count: objs.length,
          schema_issues: [],
          path_issues: [],
        },
        summary: {
          included: counts,
          excluded_by_permission: {
            workspaces: 0, objects: 0, events: 0,
            relations: 0, assets: 0, schemas: 0,
          },
          scope_mode: opts.scope?.mode ?? "workspace",
        },
      };
    },
    confirmExport: async (input: ConfirmExportInput): Promise<ConfirmExportReceipt> => ({
      confirmed_at: nowIso(),
      package_digest: input.package_digest,
      workspace_ids: input.workspace_ids ?? [],
      confirmations: 1,
    }),
    importPreview: async (zipBytes: Uint8Array): Promise<SecureImportPreview> => {
      let parsed: PendingPreview["parsed"];
      try {
        const raw = JSON.parse(new TextDecoder().decode(zipBytes)) as Partial<PendingPreview["parsed"]>;
        parsed = {
          workspaces: raw.workspaces ?? [],
          objects: raw.objects ?? [],
          events: raw.events ?? [],
        };
      } catch (cause) {
        throw new PackageCorruptedError("package_corrupted", cause);
      }
      const workspacesRows = parsed.workspaces.map((w) => ({
        workspace_id: w.workspace_id,
        exists_locally: store.workspaces.has(w.workspace_id),
        incoming_objects: parsed.objects.filter((o) => o.workspace_id === w.workspace_id).length,
        incoming_events: parsed.events.filter((e) => e.workspace_id === w.workspace_id).length,
        incoming_relations: 0,
        incoming_assets: 0,
      }));
      const schemaMap = new Map<string, { schema_id: string; schema_version: string; object_count: number }>();
      for (const o of parsed.objects) {
        const key = `${o.schema_id}@${o.schema_version}`;
        const existing = schemaMap.get(key);
        if (existing) existing.object_count++;
        else schemaMap.set(key, { schema_id: o.schema_id, schema_version: o.schema_version, object_count: 1 });
      }
      const schemasRows = [...schemaMap.values()].map((s) => ({
        schema_id: s.schema_id,
        schema_version: s.schema_version,
        status: "known_domain" as const,
        object_count: s.object_count,
      }));
      const preview_token = `tok-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const package_digest = `sha256-${zipBytes.byteLength}-${parsed.workspaces.map((w) => w.workspace_id).join(",")}`;
      const semantic_digest = `sem-${package_digest}`;
      const expires_at_ms = Date.now() + PREVIEW_TTL_MS;
      const objectsRows = parsed.objects.map((o) => {
        const localKey = objKey(o.workspace_id, o.object_id);
        const local = store.objects.get(localKey);
        return {
          workspace_id: o.workspace_id,
          object_id: o.object_id,
          created_by_service: o.created_by_service,
          updated_by_service: o.updated_by_service,
          schema_id: o.schema_id,
          schema_version: o.schema_version,
          incoming_revision: o.revision,
          local_revision: local?.revision ?? null,
          data_equal: false,
          conflict: !!local,
        };
      });
      const conflicts = objectsRows.filter((r) => r.conflict);
      const zeroCounts = {
        workspaces: 0, objects: 0, events: 0,
        relations: 0, assets: 0, schemas: 0,
      };
      const body: SecureImportPreview["preview"] = {
        manifest: {
          format: "iwxa.package",
          format_version: "1.0",
          encryption: "none",
          created_at: nowIso(),
          workspaces: parsed.workspaces.map((w) => w.workspace_id),
          workspace_states: parsed.workspaces.map((w) => ({
            workspace_id: w.workspace_id,
            updated_at: w.updated_at,
          })),
          options: {
            include_history: true,
            include_assets: true,
            include_relations: true,
            include_schemas: true,
          },
          counts: {
            workspaces: parsed.workspaces.length,
            objects: parsed.objects.length,
            events: parsed.events.length,
            relations: 0,
            assets: 0,
            schemas: schemaMap.size,
          },
          files: [],
          package_digest,
          semantic_digest,
        },
        package_digest,
        semantic_digest,
        bytes: zipBytes.byteLength,
        totals: {
          files: 0,
          workspaces: parsed.workspaces.length,
          objects: parsed.objects.length,
          events: parsed.events.length,
          relations: 0,
          assets: 0,
          schemas: schemaMap.size,
        },
        workspaces: workspacesRows,
        schemas: schemasRows,
        objects: objectsRows,
        conflicts,
        unsupported: [],
        warnings: [],
        invalid: {
          envelopes: 0,
          dependencies: 0,
          schema_validation: 0,
          schema_conflicts: 0,
        },
        included: { ...zeroCounts },
        excluded_by_permission: { ...zeroCounts },
        scope_mode: "workspace",
      };
      pendingPreviews.set(preview_token, {
        package_digest,
        semantic_digest,
        expires_at: expires_at_ms,
        parsed,
        body,
        consumed: false,
      });
      return {
        preview_token,
        package_digest,
        semantic_digest,
        expires_at: new Date(expires_at_ms).toISOString(),
        allowed_modes: ["selective", "full", "merge"],
        preview: body,
      };
    },
    importCommit: async (request: SecureCommitInput): Promise<ImportReceipt> => {
      const entry = pendingPreviews.get(request.preview_token);
      if (!entry || entry.consumed) {
        throw new PreviewTokenInvalidError("preview_token_invalid");
      }
      if (entry.package_digest !== request.package_digest) {
        throw new PreviewTokenInvalidError("preview_token_invalid");
      }
      if (Date.now() > entry.expires_at) {
        pendingPreviews.delete(request.preview_token);
        throw new PreviewTokenInvalidError("preview_token_expired");
      }
      const plan: ImportPlan = request.plan;
      const wanted =
        plan.mode === "selective"
          ? new Set(plan.include_workspaces ?? [])
          : new Set(entry.parsed.workspaces.map((w) => w.workspace_id));
      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      let workspacesTouched = 0;
      let evsWritten = 0;
      const skipped_conflicts: ImportReceipt["skipped_conflicts"] = [];
      for (const w of entry.parsed.workspaces) {
        if (!wanted.has(w.workspace_id)) continue;
        if (!store.workspaces.has(w.workspace_id)) workspacesTouched++;
        store.workspaces.set(w.workspace_id, w);
      }
      for (const o of entry.parsed.objects) {
        if (!wanted.has(o.workspace_id)) continue;
        const key = objKey(o.workspace_id, o.object_id);
        const exists = store.objects.has(key);
        if (exists && plan.mode === "selective") {
          skipped++;
          skipped_conflicts.push(`${o.workspace_id}/${o.object_id}` as `${string}/${string}`);
          continue;
        }
        store.objects.set(key, o);
        if (exists) updated++;
        else inserted++;
      }
      const includeHistory = plan.include_history ?? true;
      if (includeHistory) {
        for (const e of entry.parsed.events) {
          if (!wanted.has(e.workspace_id)) continue;
          store.events.push(e);
          evsWritten++;
        }
      }
      entry.consumed = true;
      pendingPreviews.delete(request.preview_token);
      const zeroExcl = {
        workspaces: 0, objects: 0, events: 0,
        relations: 0, assets: 0, schemas: 0,
      };
      return {
        import_id: `imp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        format: "iwxa.import.receipt",
        format_version: "1.0",
        package_digest: entry.package_digest,
        semantic_digest: entry.semantic_digest,
        mode: plan.mode,
        conflict_policy: plan.conflict ?? "skip",
        committed_at: nowIso(),
        applied: {
          workspaces: workspacesTouched,
          objects_inserted: inserted,
          objects_updated: updated,
          objects_skipped: skipped,
          events: evsWritten,
          relations: 0,
          assets: 0,
          schemas_inserted: 0,
          schemas_reused: 0,
          schemas_rejected: 0,
        },
        skipped_conflicts,
        workspace_id_map: {},
        excluded_by_permission: zeroExcl,
      };
    },
    importCancel: async (preview_token: string): Promise<boolean> => {
      const entry = pendingPreviews.get(preview_token);
      if (!entry) return false;
      pendingPreviews.delete(preview_token);
      return true;
    },
  };

  const session: KernelSession = {
    contract_version: opts.contractVersion ?? CONTRACT_VERSION,
    runtime_version: opts.runtimeVersion ?? "dev-mock-0.3.6",
    mode,
    service: {
      service_id: serviceId,
      service_version: "dev-mock-0.3.6",
      base_path: basePath,
    },
    granted_levels: grantedLevels,
    granted_operations: grantedOperations,
    authorization: Object.freeze({
      async forWorkspace(workspace_id: string) {
        return {
          decision: "DENY" as const,
          workspace_id,
          audience_service_id: serviceId,
          instance_id: null,
          lineage_id: null,
          grant_id: null,
          effective_capabilities: Object.freeze([] as string[]),
          valid_until: null,
          evaluated_at: nowIso(),
          reason: "DEV_MOCK_NO_CAPABILITY_GRANT",
        };
      },
      async hasCapability(_workspace_id: string, _capability_id: string) { return false; },
    }),
    t0,
    t1,
    t2,
  };
  return session;
}

/**
 * Bootstrap facade — mimics the real `window.IWXA` global. Callers use
 * `loadBootstrap()` which returns this object in DEV / mock mode.
 */
export function createDevMockBootstrap(opts: DevMockOptions = {}): KernelBootstrap {
  return {
    version: 1,
    connect: async () => createDevMockClient(opts) as unknown as import("./contracts/runtime-1.3.0").IWXAClient,
  };
}
