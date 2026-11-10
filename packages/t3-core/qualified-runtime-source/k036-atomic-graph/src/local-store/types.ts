import type { IWXAObject } from "../contracts/types";
import type { StoredSchemaRecord } from "../schemas/types";
import type { CapabilityBindingRecord, CapabilityGrantRecord, CapabilityGrantRecord04, CapabilityInstanceRecord } from "../capability/types";
import type { AuthorizationDecisionRecord04, SecurityAtomicCommitRecord, SecurityTargetRecord } from "../capability/security-types";


/** Physical DB name — one per origin, per architecture lock. */
export const DB_NAME = "iwxa-local";

/** Current physical DB version. Bump only when stores/indexes change. */
export const DB_VERSION = 7;

/**
 * Object store names. Add-only — once a store ships, it never gets renamed or
 * removed; a new migration adds new stores instead.
 */
export const STORES = {
  graph_commits: "graph_commits",
  meta: "meta",
  workspaces: "workspaces",
  objects: "objects",
  relations: "relations",
  events: "events",
  assets: "assets",
  permissions: "permissions",
  service_state: "service_state",
  outbox: "outbox",
  migrations: "migrations",
  schemas: "schemas",
  capability_instances: "capability_instances",
  capability_grants: "capability_grants",
  capability_bindings: "capability_bindings",
  security_state: "security_state",
  security_targets: "security_targets",
  authorization_decisions: "authorization_decisions",
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

export const ALL_STORES: StoreName[] = Object.values(STORES);

export type WorkspaceRecord = {
  workspace_id: string;
  profile: string;
  capabilities: string[];
  read_only?: boolean;
  created_at: string;
  updated_at: string;
  /** ISO timestamp set by a soft-delete. Absence = live workspace. */
  deleted_at?: string;
  /** Service that issued the last soft-delete. */
  deleted_by_service?: string;
  /** Snapshot of `read_only` at the time of soft-delete, so restore can
   *  return the workspace to its prior state instead of forcing false. */
  read_only_before_delete?: boolean;
};

/**
 * On-disk object record. IWXAObject already carries every field of identity,
 * provenance, and revision — the record only adds the optional tombstone.
 */
export type ObjectRecord<T = unknown> = IWXAObject<T> & {
  deleted?: boolean;
  deleted_at?: string;
};

/**
 * Relations reference `object_id` (workspace-scoped). Cross-service links
 * are simply "object A relates to object B" — service ownership is
 * discoverable via the referenced objects' provenance fields.
 */
export type RelationRecord = {
  relation_id: string;
  workspace_id: string;
  from_object_id: string;
  to_object_id: string;
  kind: string;
  created_at: string;
  created_by_service: string;
};


/**
 * Append-only event envelope. Every mutating operation writes exactly one
 * event in the same transaction. `service_id` is the emitter; `object_id`
 * refers to the workspace-scoped object identity.
 */
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
  /** Client-supplied dedupe key. Unique per (workspace_id, service_id, idempotency_key). */
  idempotency_key?: string;
  payload: T;
};

export type AssetRecord = {
  asset_id: string;
  workspace_id: string;
  service_id: string;
  object_id?: string;
  mime: string;
  size: number;
  blob: Blob | Uint8Array;
  created_at: string;
  /** Added in Runtime Contract 1.1.0; absent on legacy/imported 1.0 records. */
  updated_at?: string;
  updated_by_service?: string;
  revision?: number;
};

export type PermissionRecord = {
  permission_id: string;
  workspace_id: string;
  service_id: string;
  capability: string;
  granted: boolean;
  updated_at: string;
};

export type ServiceStateRecord = {
  service_id: string;
  workspace_id: string;
  state: unknown;
  updated_at: string;
};

export type OutboxRecord = {
  outbox_id: string;
  workspace_id: string;
  service_id: string;
  kind: string;
  payload: unknown;
  created_at: string;
  attempts: number;
  package_digest?: string;
  semantic_digest?: string;
  filename?: string;
  size?: number;
  scope_mode?: "workspace" | "readable_objects";
  backup_complete?: boolean;
  workspace_state_updated_at?: string;
  confirms_outbox_id?: string;
};

export type MigrationRecord = {
  id: number;
  description: string;
  applied_at: string;
};

export type MetaRecord = { key: string; value: unknown };

export type { StoredSchemaRecord, CapabilityBindingRecord, CapabilityGrantRecord, CapabilityGrantRecord04, CapabilityInstanceRecord, SecurityAtomicCommitRecord, SecurityTargetRecord, AuthorizationDecisionRecord04 };

