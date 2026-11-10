/**
 * Shared workspace-lifecycle helpers.
 *
 * Both `WorkspaceApi` (kernel-facing) and `ScopedWorkspaceApi` (service-facing)
 * route through here — the scoped layer adds permission checks and delegates
 * the physical work to functions in this module. This is the single place
 * that knows how to:
 *
 *   - count records that belong to a workspace across every workspace-scoped
 *     store (objects, events, relations, assets, permissions, service_state,
 *     outbox);
 *   - physically wipe those stores and the workspace row itself;
 *   - append `package.export.prepared` / `package.export.confirmed`
 *     receipts to the outbox WITHOUT persisting the package bytes;
 *   - read the last prepared / confirmed export summaries used by
 *     `purgePreview`.
 *
 * NEVER touched by wipe: `meta`, `migrations`, and rows for other workspaces.
 */

import type { LocalStore } from "../local-store/LocalStore";
import {
  STORES,
  type OutboxRecord,
  type StoreName,
  type WorkspaceRecord,
} from "../local-store/types";
import { createEvent } from "../events/index";
import { IntegrityCheckError } from "../errors";

// ---------------------------------------------------------------------------
// Types

export type PurgeCounts = {
  objects: number;
  events: number;
  relations: number;
  assets: number;
  permissions: number;
  service_state: number;
  outbox: number;
};

export type PurgeRemoved = PurgeCounts & { workspaces: number };

export type ExportReceiptSummary = {
  at: string;
  outbox_id?: string;
  package_digest?: string;
  semantic_digest?: string;
  filename?: string;
  size?: number;
  /** Populated by `readLastExport` when a preview timestamp is supplied. */
  age_ms?: number;
  scope_mode?: "workspace" | "readable_objects";
  backup_complete?: boolean;
  workspace_state_updated_at?: string;
  confirms_outbox_id?: string;
};

export type BackupStatus = "current" | "stale" | "missing";

export type LastExportInfo = {
  prepared: ExportReceiptSummary | null;
  confirmed: ExportReceiptSummary | null;
  /** Human-readable warning surfaced in `purgePreview.last_export.warning`. */
  warning: string | null;
  /**
   * Backup freshness classification: "current" | "stale" | "missing".
   * A `purgePreview` observing "missing" requires `acknowledge_no_backup`
   * to be set true before the corresponding commit is allowed to proceed.
   */
  backup_status: BackupStatus;
};

/**
 * When `readLastExport` returns `backup_status: "missing"`, `purgePreview`
 * MUST require the caller to pass `acknowledge_no_backup: true` on the
 * PurgePreviewInput before it will issue a purge_token. This constant is
 * exported so callers and tests can reference the exact flag name.
 */
export const ACKNOWLEDGE_NO_BACKUP_FLAG = "acknowledge_no_backup" as const;



export const EXPORT_PREPARED_KIND = "package.export.prepared";
export const EXPORT_CONFIRMED_KIND = "package.export.confirmed";

// ---------------------------------------------------------------------------
// Small IDB promise helper (kept local to avoid a dependency).

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

// ---------------------------------------------------------------------------
// Counting

async function countByWorkspaceIdx(
  store: LocalStore,
  storeName: StoreName,
  workspace_id: string,
): Promise<number> {
  return store.transact([storeName], "readonly", async (tx) => {
    const idx = tx.objectStore(storeName).index("by_workspace");
    return (await req<number>(idx.count(workspace_id))) as number;
  });
}

async function countServiceState(
  store: LocalStore,
  workspace_id: string,
): Promise<number> {
  return store.transact([STORES.service_state], "readonly", async (tx) => {
    const os = tx.objectStore(STORES.service_state);
    const range = IDBKeyRange.bound([workspace_id, ""], [workspace_id, "\uffff"]);
    return (await req<number>(os.count(range))) as number;
  });
}

export async function countPurgeTargets(
  store: LocalStore,
  workspace_id: string,
): Promise<PurgeCounts> {
  const [objects, events, relations, assets, permissions, service_state, outbox] =
    await Promise.all([
      countByWorkspaceIdx(store, STORES.objects, workspace_id),
      countByWorkspaceIdx(store, STORES.events, workspace_id),
      countByWorkspaceIdx(store, STORES.relations, workspace_id),
      countByWorkspaceIdx(store, STORES.assets, workspace_id),
      countByWorkspaceIdx(store, STORES.permissions, workspace_id),
      countServiceState(store, workspace_id),
      countByWorkspaceIdx(store, STORES.outbox, workspace_id),
    ]);
  return { objects, events, relations, assets, permissions, service_state, outbox };
}

// ---------------------------------------------------------------------------
// Purge

async function deleteByWorkspaceIdx(
  store: LocalStore,
  storeName: StoreName,
  workspace_id: string,
): Promise<number> {
  return store.transact([storeName], "readwrite", async (tx) => {
    const idx = tx.objectStore(storeName).index("by_workspace");
    const keys = (await req<IDBValidKey[]>(
      idx.getAllKeys(workspace_id),
    )) as IDBValidKey[];
    for (const k of keys) tx.objectStore(storeName).delete(k);
    return keys.length;
  });
}

async function deleteServiceStateRows(
  store: LocalStore,
  workspace_id: string,
): Promise<number> {
  return store.transact([STORES.service_state], "readwrite", async (tx) => {
    const os = tx.objectStore(STORES.service_state);
    const range = IDBKeyRange.bound([workspace_id, ""], [workspace_id, "\uffff"]);
    const keys = (await req<IDBValidKey[]>(os.getAllKeys(range))) as IDBValidKey[];
    for (const k of keys) os.delete(k);
    return keys.length;
  });
}

/**
 * Wipe every workspace-scoped store, then the workspace row. Verifies the
 * post-condition — no records with `workspace_id` remain in any scoped store
 * — before returning. `meta` and `migrations` are never touched. Rows for
 * OTHER workspaces are never touched.
 */
export async function purgeWorkspaceStores(
  store: LocalStore,
  workspace_id: string,
): Promise<PurgeRemoved> {
  const removed: PurgeRemoved = {
    workspaces: 0,
    objects: 0,
    events: 0,
    relations: 0,
    assets: 0,
    permissions: 0,
    service_state: 0,
    outbox: 0,
  };

  const stores: StoreName[] = [
    STORES.workspaces,
    STORES.objects,
    STORES.events,
    STORES.relations,
    STORES.assets,
    STORES.permissions,
    STORES.service_state,
    STORES.outbox,
    STORES.graph_commits,
  ];

  await store.transact(stores, "readwrite", async (tx) => {
    const wipeByIdx = async (
      name: StoreName,
      counterKey: keyof PurgeCounts,
    ) => {
      const os = tx.objectStore(name);
      const idx = os.index("by_workspace");
      const keys = (await req<IDBValidKey[]>(
        idx.getAllKeys(workspace_id),
      )) as IDBValidKey[];
      for (const k of keys) os.delete(k);
      removed[counterKey] = keys.length;
    };
    await wipeByIdx(STORES.objects, "objects");
    await wipeByIdx(STORES.events, "events");
    await wipeByIdx(STORES.relations, "relations");
    await wipeByIdx(STORES.assets, "assets");
    await wipeByIdx(STORES.permissions, "permissions");
    await wipeByIdx(STORES.outbox, "outbox");

    const graph = tx.objectStore(STORES.graph_commits);
    const graphKeys = await req<IDBValidKey[]>(graph.index("by_workspace").getAllKeys(workspace_id));
    for (const key of graphKeys) graph.delete(key);

    const ss = tx.objectStore(STORES.service_state);
    const range = IDBKeyRange.bound(
      [workspace_id, ""],
      [workspace_id, "\uffff"],
    );
    const ssKeys = (await req<IDBValidKey[]>(
      ss.getAllKeys(range),
    )) as IDBValidKey[];
    for (const k of ssKeys) ss.delete(k);
    removed.service_state = ssKeys.length;

    tx.objectStore(STORES.workspaces).delete(workspace_id);
    removed.workspaces = 1;
  });

  const residual = await countPurgeTargets(store, workspace_id);
  for (const [k, v] of Object.entries(residual)) {
    if (v > 0) {
      throw new Error(
        `purgeWorkspaceStores: ${v} residual record(s) left in "${k}" for workspace "${workspace_id}"`,
      );
    }
  }
  return removed;
}


// ---------------------------------------------------------------------------
// Export receipts (outbox) — no package bytes are ever stored here.

function genOutboxId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return `ob_${c.randomUUID()}`;
  return `ob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Batched prepared receipts — one atomic write per exportPackage() call.

export type ExportPreparedBatchInput = {
  service_id: string;
  package_digest: string;
  semantic_digest: string;
  filename: string;
  size: number;
  scope_mode: "workspace" | "readable_objects";
  backup_complete: boolean;
  workspace_states: Array<{
    workspace_id: string;
    updated_at: string;
  }>;
};

/**
 * Write one `package.export.prepared` receipt per workspace snapshot in a
 * SINGLE readwrite transaction on STORES.outbox. Never persists package
 * bytes. Uses `updated_at` values captured at package-build time — the
 * caller MUST NOT re-read the Workspace row from storage, because a
 * concurrent mutation could otherwise smuggle a newer snapshot into the
 * receipt (see C-09 snapshot-race requirement).
 *
 * Input is validated first (no empty batch, no duplicate workspace_id).
 * On any inconsistency, throws `IntegrityCheckError` (`INTEGRITY_FAILED`)
 * BEFORE opening the transaction.
 */
export async function writeExportPreparedBatch(
  store: LocalStore,
  input: ExportPreparedBatchInput,
): Promise<OutboxRecord[]> {
  if (!Array.isArray(input.workspace_states) || input.workspace_states.length === 0) {
    throw new IntegrityCheckError(
      "writeExportPreparedBatch: workspace_states must contain at least one entry",
      { service_id: input.service_id, package_digest: input.package_digest },
    );
  }
  const seen = new Set<string>();
  for (const state of input.workspace_states) {
    if (!state || typeof state.workspace_id !== "string" || typeof state.updated_at !== "string") {
      throw new IntegrityCheckError(
        "writeExportPreparedBatch: workspace_states entry is missing workspace_id/updated_at",
        { service_id: input.service_id },
      );
    }
    if (seen.has(state.workspace_id)) {
      throw new IntegrityCheckError(
        `writeExportPreparedBatch: duplicate workspace_id "${state.workspace_id}" in workspace_states`,
        { service_id: input.service_id, workspace_id: state.workspace_id },
      );
    }
    seen.add(state.workspace_id);
  }

  const created_at = new Date().toISOString();
  const receipts: OutboxRecord[] = input.workspace_states.map((state) => ({
    outbox_id: genOutboxId(),
    workspace_id: state.workspace_id,
    service_id: input.service_id,
    kind: EXPORT_PREPARED_KIND,
    package_digest: input.package_digest,
    semantic_digest: input.semantic_digest,
    filename: input.filename,
    size: input.size,
    scope_mode: input.scope_mode,
    backup_complete: input.backup_complete,
    workspace_state_updated_at: state.updated_at,
    created_at,
    attempts: 0,
    payload: {
      package_digest: input.package_digest,
      semantic_digest: input.semantic_digest,
      filename: input.filename,
      size: input.size,
      scope_mode: input.scope_mode,
      backup_complete: input.backup_complete,
      workspace_state_updated_at: state.updated_at,
    },
  }));

  await store.transact([STORES.outbox], "readwrite", (tx) => {
    const os = tx.objectStore(STORES.outbox);
    for (const rec of receipts) os.put(rec);
  });
  return receipts;
}

// ---------------------------------------------------------------------------
// Batched confirmation — one atomic write per exportPackage confirmation.

export type ConfirmExportBatchInput = {
  service_id: string;
  package_digest: string;
  workspace_ids?: string[];
};

export type ConfirmExportBatchResult = {
  confirmations: OutboxRecord[];
  workspace_ids: string[];
  confirmation_timestamp: string;
};

function makeConfirmationRecord(
  prepared: OutboxRecord,
  timestamp: string,
): OutboxRecord {
  if (!prepared.outbox_id) {
    throw Object.assign(
      new Error("confirmExportBatch: prepared receipt is missing outbox_id"),
      { code: "INTEGRITY_FAILED" },
    );
  }
  return {
    outbox_id: genOutboxId(),
    workspace_id: prepared.workspace_id,
    service_id: prepared.service_id,
    kind: EXPORT_CONFIRMED_KIND,
    package_digest: prepared.package_digest,
    semantic_digest: prepared.semantic_digest,
    filename: prepared.filename,
    size: prepared.size,
    scope_mode: prepared.scope_mode,
    backup_complete: prepared.backup_complete,
    workspace_state_updated_at: prepared.workspace_state_updated_at,
    confirms_outbox_id: prepared.outbox_id,
    created_at: timestamp,
    attempts: 0,
    payload: {
      package_digest: prepared.package_digest,
      confirms_outbox_id: prepared.outbox_id,
    },
  };
}

/**
 * Atomically confirm a previously-prepared export batch.
 *
 * Contract:
 *  - Opens exactly ONE readwrite transaction on [workspaces, outbox].
 *  - Complete preflight runs BEFORE any write. If ANY selected workspace
 *    has no matching prepared receipt, or its Workspace row is missing,
 *    the whole call rejects with CONFLICT and NOTHING is written — partial
 *    confirmation is forbidden.
 *  - Existing confirmations (matched by
 *    `confirms_outbox_id === prepared.outbox_id`) are reused, not
 *    duplicated → repeated calls are idempotent.
 *  - Returns the confirmations that now exist (both reused and newly
 *    created) together with the confirmation timestamp shared by all NEW
 *    rows.
 */
export async function confirmExportBatch(
  store: LocalStore,
  input: ConfirmExportBatchInput,
): Promise<ConfirmExportBatchResult> {
  if (!input.service_id || typeof input.service_id !== "string") {
    throw Object.assign(
      new Error("confirmExportBatch: service_id is required"),
      { code: "CONFLICT" },
    );
  }
  if (
    typeof input.package_digest !== "string" ||
    input.package_digest.length < 8
  ) {
    throw Object.assign(
      new Error("confirmExportBatch: package_digest is required"),
      { code: "CONFLICT" },
    );
  }

  let requestedIds: string[] | undefined;
  if (input.workspace_ids !== undefined) {
    if (!Array.isArray(input.workspace_ids)) {
      throw Object.assign(
        new Error("confirmExportBatch: workspace_ids must be an array"),
        { code: "CONFLICT" },
      );
    }
    for (const id of input.workspace_ids) {
      if (typeof id !== "string" || id.length === 0) {
        throw Object.assign(
          new Error(
            "confirmExportBatch: workspace_ids entries must be non-empty strings",
          ),
          { code: "CONFLICT" },
        );
      }
    }
    requestedIds = [...new Set(input.workspace_ids)];
  }

  const confirmation_timestamp = new Date().toISOString();

  return store.transact(
    [STORES.workspaces, STORES.outbox],
    "readwrite",
    async (tx) => {
      const outbox = tx.objectStore(STORES.outbox);
      const workspaces = tx.objectStore(STORES.workspaces);

      const allRows = (await req<OutboxRecord[]>(
        outbox.getAll(),
      )) as OutboxRecord[];

      // Prepared receipts matching (kind, service_id, package_digest)
      // indexed per workspace, plus every existing confirmation indexed
      // by the prepared row it confirms.
      const preparedByWorkspace = new Map<string, OutboxRecord>();
      const confirmationsByPreparedId = new Map<string, OutboxRecord>();

      for (const row of allRows ?? []) {
        if (
          row.kind === EXPORT_PREPARED_KIND &&
          row.service_id === input.service_id &&
          row.package_digest === input.package_digest &&
          typeof row.workspace_id === "string"
        ) {
          const prev = preparedByWorkspace.get(row.workspace_id);
          if (!prev || (row.created_at ?? "") > (prev.created_at ?? "")) {
            preparedByWorkspace.set(row.workspace_id, row);
          }
        } else if (
          row.kind === EXPORT_CONFIRMED_KIND &&
          typeof row.confirms_outbox_id === "string"
        ) {
          confirmationsByPreparedId.set(row.confirms_outbox_id, row);
        }
      }

      const targetIds =
        requestedIds !== undefined
          ? requestedIds
          : [...preparedByWorkspace.keys()];

      if (targetIds.length === 0) {
        throw Object.assign(
          new Error(
            "confirmExportBatch: no prepared export receipt matches (service_id, package_digest)",
          ),
          {
            code: "CONFLICT",
            service_id: input.service_id,
            package_digest: input.package_digest,
          },
        );
      }

      // Preflight — every target must have BOTH a matching prepared receipt
      // AND an existing Workspace row. Any miss aborts the whole batch.
      for (const workspace_id of targetIds) {
        const prepared = preparedByWorkspace.get(workspace_id);
        if (!prepared) {
          throw Object.assign(
            new Error(
              `confirmExportBatch: no prepared receipt for workspace "${workspace_id}"`,
            ),
            {
              code: "CONFLICT",
              workspace_id,
              service_id: input.service_id,
              package_digest: input.package_digest,
            },
          );
        }
        const ws = (await req<WorkspaceRecord | undefined>(
          workspaces.get(workspace_id),
        )) as WorkspaceRecord | undefined;
        if (!ws) {
          throw Object.assign(
            new Error(
              `confirmExportBatch: workspace "${workspace_id}" does not exist`,
            ),
            { code: "CONFLICT", workspace_id },
          );
        }
      }

      // Preflight passed → produce final confirmations, reusing any
      // existing ones. All writes stay inside THIS transaction.
      const results: OutboxRecord[] = [];
      for (const workspace_id of targetIds) {
        const prepared = preparedByWorkspace.get(workspace_id)!;
        const existing = confirmationsByPreparedId.get(prepared.outbox_id!);
        if (existing) {
          results.push(existing);
          continue;
        }
        const rec = makeConfirmationRecord(prepared, confirmation_timestamp);
        outbox.put(rec);
        results.push(rec);
      }

      return {
        confirmations: results,
        workspace_ids: targetIds,
        confirmation_timestamp,
      };
    },
  );
}

function toExportReceiptSummary(record: OutboxRecord): ExportReceiptSummary {
  return {
    at: record.created_at,
    outbox_id: record.outbox_id,
    package_digest: record.package_digest,
    semantic_digest: record.semantic_digest,
    filename: record.filename,
    size: record.size,
    scope_mode: record.scope_mode,
    backup_complete: record.backup_complete,
    workspace_state_updated_at: record.workspace_state_updated_at,
    confirms_outbox_id: record.confirms_outbox_id,
  };
}

/**
 * Read the last export status for a workspace/service pair (C-10).
 *
 * A confirmation is considered valid only when it references an existing
 * prepared receipt (`confirms_outbox_id`) whose full identity matches:
 * same workspace, same service, same package_digest, same semantic_digest,
 * same scope_mode, same backup_complete, and same workspace_state_updated_at.
 * Any mismatch → `backup_status: "missing"` and the confirmation is NOT
 * surfaced in `last_export.confirmed`.
 *
 * Backup freshness:
 *  - `missing`  — no valid linked pair, or prepared/confirmation is not a
 *                 complete workspace-scope backup.
 *  - `stale`    — valid linked pair, but its `workspace_state_updated_at`
 *                 differs from the current Workspace `updated_at`.
 *  - `current`  — valid linked pair matching the current Workspace state.
 */
export async function readLastExport(
  store: LocalStore,
  workspace_id: string,
  service_id: string,
  current_workspace_updated_at: string,
): Promise<LastExportInfo> {
  return store.transact([STORES.outbox], "readonly", async (tx) => {
    const rows = await req<OutboxRecord[]>(
      tx.objectStore(STORES.outbox).index("by_workspace").getAll(workspace_id),
    );
    const serviceRows = (rows ?? []).filter(
      (row) =>
        row.workspace_id === workspace_id && row.service_id === service_id,
    );

    const preparedRows = serviceRows
      .filter((row) => row.kind === EXPORT_PREPARED_KIND)
      .sort((left, right) => right.created_at.localeCompare(left.created_at));

    const preparedById = new Map<string, OutboxRecord>();
    for (const prepared of preparedRows) {
      if (prepared.outbox_id) {
        preparedById.set(prepared.outbox_id, prepared);
      }
    }

    const confirmedRows = serviceRows
      .filter((row) => row.kind === EXPORT_CONFIRMED_KIND)
      .sort((left, right) => right.created_at.localeCompare(left.created_at));

    let validConfirmed: OutboxRecord | null = null;
    let linkedPrepared: OutboxRecord | null = null;

    for (const confirmed of confirmedRows) {
      const confirmsId = confirmed.confirms_outbox_id;
      if (!confirmsId) continue;
      const prepared = preparedById.get(confirmsId);
      if (!prepared) continue;

      const linkIsValid =
        prepared.kind === EXPORT_PREPARED_KIND &&
        confirmed.kind === EXPORT_CONFIRMED_KIND &&
        prepared.workspace_id === workspace_id &&
        confirmed.workspace_id === workspace_id &&
        prepared.service_id === service_id &&
        confirmed.service_id === service_id &&
        prepared.package_digest === confirmed.package_digest &&
        prepared.semantic_digest === confirmed.semantic_digest &&
        prepared.scope_mode === confirmed.scope_mode &&
        prepared.backup_complete === confirmed.backup_complete &&
        prepared.workspace_state_updated_at ===
          confirmed.workspace_state_updated_at;

      if (!linkIsValid) continue;

      validConfirmed = confirmed;
      linkedPrepared = prepared;
      break;
    }

    const latestPrepared = preparedRows[0] ?? null;
    const selectedPrepared = linkedPrepared ?? latestPrepared;

    const preparedSummary = selectedPrepared
      ? toExportReceiptSummary(selectedPrepared)
      : null;
    const confirmedSummary = validConfirmed
      ? toExportReceiptSummary(validConfirmed)
      : null;

    let backup_status: BackupStatus;
    if (
      !validConfirmed ||
      !linkedPrepared ||
      linkedPrepared.backup_complete !== true ||
      linkedPrepared.scope_mode !== "workspace" ||
      validConfirmed.backup_complete !== true ||
      validConfirmed.scope_mode !== "workspace"
    ) {
      backup_status = "missing";
    } else if (
      linkedPrepared.workspace_state_updated_at !==
      current_workspace_updated_at
    ) {
      backup_status = "stale";
    } else {
      backup_status = "current";
    }

    let warning: string | null = null;
    if (backup_status === "missing") {
      warning = latestPrepared
        ? "No valid confirmed export is linked to the latest available prepared export receipt."
        : "No confirmed backup exists for this workspace — purging will destroy the only copy of its data.";
    } else if (backup_status === "stale") {
      warning =
        "The confirmed full backup does not match the current Workspace state.";
    }

    return {
      prepared: preparedSummary,
      confirmed: confirmedSummary,
      warning,
      backup_status,
    };
  });
}





// ---------------------------------------------------------------------------
// Soft-delete / restore — pure state transitions, no perm checks.

export async function performSoftDelete(
  store: LocalStore,
  workspace: WorkspaceRecord,
  by_service: string,
): Promise<WorkspaceRecord> {
  const now = new Date().toISOString();
  const next: WorkspaceRecord = {
    ...workspace,
    read_only_before_delete: workspace.read_only ?? false,
    read_only: true,
    deleted_at: now,
    deleted_by_service: by_service,
    updated_at: now,
  };
  await store.transact(
    [STORES.workspaces, STORES.events],
    "readwrite",
    (tx) => {
      tx.objectStore(STORES.workspaces).put(next);
      tx.objectStore(STORES.events).add(
        createEvent({
          event_type: "workspace.soft_deleted",
          workspace_id: workspace.workspace_id,
          service_id: by_service,
          occurred_at: now,
          payload: { deleted_at: now },
        }),
      );
    },
  );
  return next;
}

export async function performRestore(
  store: LocalStore,
  workspace: WorkspaceRecord,
  by_service: string,
): Promise<WorkspaceRecord> {
  const now = new Date().toISOString();
  const next: WorkspaceRecord = {
    ...workspace,
    read_only: workspace.read_only_before_delete ?? false,
    updated_at: now,
  };
  delete next.deleted_at;
  delete next.deleted_by_service;
  delete next.read_only_before_delete;
  await store.transact(
    [STORES.workspaces, STORES.events],
    "readwrite",
    (tx) => {
      tx.objectStore(STORES.workspaces).put(next);
      tx.objectStore(STORES.events).add(
        createEvent({
          event_type: "workspace.restored",
          workspace_id: workspace.workspace_id,
          service_id: by_service,
          occurred_at: now,
          payload: { restored_at: now },
        }),
      );
    },
  );
  return next;
}

