import type { CommitObjectGraphInput, CommitObjectGraphReceipt } from "../public-contract";
import { canonicalize } from "../package/export/canonical";
import { sha256Text } from "../package/export/hash";
import { createEvent, newEventId } from "../events";
import { getBroadcastBus } from "../sync/broadcast";
import { ConflictError } from "./transactions";
import type { LocalStore } from "./LocalStore";
import { STORES, type WorkspaceRecord, type ObjectRecord, type RelationRecord } from "./types";

function fail(code: string, reason: string): never { throw Object.assign(new Error(reason), { code, details: { reason } }); }
const request = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
function shape(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) fail("CONFIG_INVALID", "invalid_graph_shape");
}
function text(value: unknown, pattern?: RegExp): asserts value is string {
  if (typeof value !== "string" || !value.length || value.length > 256 || (pattern && !pattern.test(value))) fail("CONFIG_INVALID", "invalid_graph_identifier");
}
function jsonValue(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || !value || seen.has(value)) fail("CONFIG_INVALID", "graph_payload_not_json");
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail("CONFIG_INVALID", "graph_payload_not_plain_json");
  if (Object.getOwnPropertySymbols(value).length) fail("CONFIG_INVALID", "graph_payload_symbol_keys");
  seen.add(value);
  if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) jsonValue(value[i], seen); }
  else for (const k of Object.keys(value)) jsonValue((value as Record<string, unknown>)[k], seen);
  seen.delete(value);
}
/** Snapshot before hashing/awaiting; optional empty relation sets have identical meaning. */
export function normalizeGraphInput(raw: CommitObjectGraphInput): CommitObjectGraphInput {
  shape(raw, ["workspace_id", "idempotency_key", "object", "relation_puts", "relation_deletes", "event"]);
  text(raw.workspace_id, /^[a-z0-9][a-z0-9._:-]{0,127}$/i); text(raw.idempotency_key);
  shape(raw.object, ["object_id", "schema_id", "schema_version", "data", "extensions", "base_revision"]);
  text(raw.object.object_id, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/);
  text(raw.object.schema_id); text(raw.object.schema_version);
  jsonValue(raw.object.data);
  if (raw.object.extensions !== undefined) { shape(raw.object.extensions, Object.keys(raw.object.extensions)); jsonValue(raw.object.extensions); }
  if (raw.object.base_revision !== undefined && (!Number.isSafeInteger(raw.object.base_revision) || raw.object.base_revision < 0)) fail("CONFIG_INVALID", "invalid_base_revision");
  shape(raw.event, ["event_type", "payload"]); text(raw.event.event_type);
  if (raw.event.payload !== undefined) jsonValue(raw.event.payload);
  const ids = new Set<string>();
  for (const [rows, put] of [[raw.relation_puts ?? [], true], [raw.relation_deletes ?? [], false]] as const) {
    if (!Array.isArray(rows)) fail("CONFIG_INVALID", "invalid_relation_set");
    for (const row of rows) {
      shape(row, put ? ["relation_id", "from_object_id", "to_object_id", "kind"] : ["relation_id"]);
      text(row.relation_id, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
      if (ids.has(row.relation_id)) fail("CONFLICT", "duplicate_or_conflicting_relation_id"); ids.add(row.relation_id);
      if (put) { const fields = row as Record<string, unknown>; text(fields.from_object_id, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/); text(fields.to_object_id, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/); text(fields.kind, /^.{1,128}$/); }
    }
  }
  return JSON.parse(canonicalize({ ...raw, relation_puts: [...(raw.relation_puts ?? [])].sort((a,b) => a.relation_id < b.relation_id ? -1 : 1), relation_deletes: [...(raw.relation_deletes ?? [])].sort((a,b) => a.relation_id < b.relation_id ? -1 : 1), event: { event_type: raw.event.event_type, payload: raw.event.payload ?? {} } }));
}

type Replay = { workspace_id: string; service_id: string; idempotency_key: string; payload_sha256: string; receipt: CommitObjectGraphReceipt };
/** One IDB transaction. No asynchronous crypto/network work occurs while it is open. */
export async function commitAtomicGraph(store: LocalStore, raw: CommitObjectGraphInput, service_id: string, authorizeSchema: (schema_id: string) => void): Promise<CommitObjectGraphReceipt> {
  const input = normalizeGraphInput(raw);
  const digest = await sha256Text(canonicalize({ operation: "t1.commitObjectGraph", service_id, input }));
  const result = await store.transact([STORES.workspaces, STORES.objects, STORES.relations, STORES.events, STORES.graph_commits], "readwrite", async tx => {
    const ws = await request(tx.objectStore(STORES.workspaces).get(input.workspace_id)) as WorkspaceRecord | undefined;
    if (!ws) fail("WORKSPACE_NOT_FOUND", "workspace_missing");
    if (ws.deleted_at) fail("WORKSPACE_DELETED", "workspace_deleted");
    if (ws.read_only) fail("WORKSPACE_READ_ONLY", "workspace_read_only");
    const replayKey = [input.workspace_id, service_id, input.idempotency_key];
    const prior = await request(tx.objectStore(STORES.graph_commits).get(replayKey)) as Replay | undefined;
    if (prior) {
      if (prior.payload_sha256 !== digest) fail("CONFLICT", "idempotency_payload_mismatch");
      return { ...prior.receipt, deduplicated: true };
    }
    const collision = await request(tx.objectStore(STORES.events).index("by_idempotency").get(replayKey));
    if (collision) fail("CONFLICT", "idempotency_key_already_used");
    const current = await request(tx.objectStore(STORES.objects).get([input.workspace_id, input.object.object_id])) as ObjectRecord | undefined;
    if (input.object.base_revision !== undefined && input.object.base_revision !== (current?.revision ?? 0)) throw new ConflictError({ workspace_id: input.workspace_id, object_id: input.object.object_id }, input.object.base_revision, current?.revision ?? 0);
    authorizeSchema(input.object.schema_id);
    if (current) authorizeSchema(current.schema_id);
    // putObject convention: an explicit upsert revives its own tombstone. Other tombstones cannot be endpoints.
    const endpoint = async (id: string) => {
      if (id === input.object.object_id) return;
      const obj = await request(tx.objectStore(STORES.objects).get([input.workspace_id, id])) as ObjectRecord | undefined;
      if (!obj || obj.deleted || obj.workspace_id !== input.workspace_id) fail("OBJECT_NOT_FOUND", "endpoint_missing_or_deleted");
      authorizeSchema(obj.schema_id);
    };
    const puts: RelationRecord[] = []; const deletes: string[] = [];
    const now = new Date().toISOString();
    for (const row of input.relation_puts ?? []) {
      await endpoint(row.from_object_id); await endpoint(row.to_object_id);
      const old = await request(tx.objectStore(STORES.relations).get(row.relation_id));
      // Match predecessor relation creation policy: ids are immutable, replacement requires an explicit separate graph intent.
      if (old) fail("CONFLICT", "relation_id_exists");
      puts.push({ ...row, workspace_id: input.workspace_id, created_at: now, created_by_service: service_id });
    }
    for (const row of input.relation_deletes ?? []) {
      const old = await request(tx.objectStore(STORES.relations).get(row.relation_id)) as RelationRecord | undefined;
      if (!old || old.workspace_id !== input.workspace_id) fail("RELATION_NOT_FOUND", "relation_missing");
      if (old.created_by_service !== service_id) fail("PERMISSION_DENIED", "relation_owned_by_other_service");
      await endpoint(old.from_object_id); await endpoint(old.to_object_id); deletes.push(row.relation_id);
    }
    const object: ObjectRecord = { ...input.object, workspace_id: input.workspace_id, created_by_service: current?.created_by_service ?? service_id, updated_by_service: service_id, created_at: current?.created_at ?? now, updated_at: now, revision: (current?.revision ?? 0) + 1, extensions: { ...(current?.extensions ?? {}), ...(input.object.extensions ?? {}) }, deleted: false };
    // base_revision is an input precondition, never persisted on the canonical object.
    delete (object as ObjectRecord & { base_revision?: number }).base_revision;
    const transaction_id = newEventId();
    const event = createEvent({ ...input.event, payload: input.event.payload ?? {}, workspace_id: input.workspace_id, service_id, object_id: object.object_id, revision: object.revision, occurred_at: now, correlation_id: transaction_id, idempotency_key: input.idempotency_key });
    const receipt: CommitObjectGraphReceipt = { transaction_id, workspace_id: input.workspace_id, object, relations_put: puts, relation_ids_deleted: deletes, event, deduplicated: false };
    await request(tx.objectStore(STORES.objects).put(object));
    for (const row of puts) await request(tx.objectStore(STORES.relations).add(row));
    for (const id of deletes) await request(tx.objectStore(STORES.relations).delete(id));
    await request(tx.objectStore(STORES.events).add(event));
    await request(tx.objectStore(STORES.graph_commits).add({ workspace_id: input.workspace_id, service_id, idempotency_key: input.idempotency_key, payload_sha256: digest, receipt } satisfies Replay));
    await request(tx.objectStore(STORES.workspaces).put({ ...ws, updated_at: now }));
    return receipt;
  });
  if (!result.deduplicated) { try { getBroadcastBus().publish(result.event); } catch { /* committed state remains authoritative */ } }
  return result;
}
