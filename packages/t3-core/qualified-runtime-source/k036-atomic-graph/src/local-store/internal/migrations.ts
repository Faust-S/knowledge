/*
 * Schema migrations for the singleton iwxa-local DB.
 *
 * Append-only. `up` must be idempotent across its version range.
 * DB_VERSION currently = 6.
 */


import { STORES } from "../types";

type MigrationStep = {
  version: number;
  description: string;
  up: (db: IDBDatabase, tx: IDBTransaction) => void;
};

/**
 * v3 primary object store shape — kept as a helper so the migration can
 * both create it fresh and recreate it after a delete.
 */
function createObjectsStore(db: IDBDatabase): void {
  const objs = db.createObjectStore(STORES.objects, {
    keyPath: ["workspace_id", "object_id"],
  });
  objs.createIndex("by_workspace", "workspace_id", { unique: false });
  objs.createIndex("by_schema", ["workspace_id", "schema_id"], { unique: false });
  objs.createIndex(
    "by_created_by_service",
    ["workspace_id", "created_by_service"],
    { unique: false },
  );
  objs.createIndex(
    "by_updated_by_service",
    ["workspace_id", "updated_by_service"],
    { unique: false },
  );
  objs.createIndex("by_updated_at", "updated_at", { unique: false });
  objs.createIndex(
    "by_revision",
    ["workspace_id", "object_id", "revision"],
    { unique: true },
  );
}

function createRelationsStore(db: IDBDatabase): void {
  const rel = db.createObjectStore(STORES.relations, { keyPath: "relation_id" });
  rel.createIndex("by_workspace", "workspace_id", { unique: false });
  rel.createIndex("by_from", ["workspace_id", "from_object_id"], { unique: false });
  rel.createIndex("by_to", ["workspace_id", "to_object_id"], { unique: false });
}

function createEventsStore(db: IDBDatabase): void {
  const ev = db.createObjectStore(STORES.events, { keyPath: "event_id" });
  ev.createIndex("by_workspace", "workspace_id", { unique: false });
  ev.createIndex("by_service", ["workspace_id", "service_id"], { unique: false });
  ev.createIndex("by_object", ["workspace_id", "object_id"], { unique: false });
  ev.createIndex("by_correlation", "correlation_id", { unique: false });
  ev.createIndex(
    "by_idempotency",
    ["workspace_id", "service_id", "idempotency_key"],
    { unique: true },
  );
}

const STEPS: MigrationStep[] = [
  {
    version: 1,
    description:
      "Initial schema: meta, workspaces, permissions, service_state, assets, outbox, migrations.",
    up: (db, tx) => {
      db.createObjectStore(STORES.meta, { keyPath: "key" });

      const ws = db.createObjectStore(STORES.workspaces, { keyPath: "workspace_id" });
      ws.createIndex("by_profile", "profile", { unique: false });

      const perm = db.createObjectStore(STORES.permissions, { keyPath: "permission_id" });
      perm.createIndex("by_workspace", "workspace_id", { unique: false });
      perm.createIndex("by_service", ["workspace_id", "service_id"], { unique: false });

      const st = db.createObjectStore(STORES.service_state, {
        keyPath: ["workspace_id", "service_id"],
      });
      st.createIndex("by_workspace", "workspace_id", { unique: false });

      const assets = db.createObjectStore(STORES.assets, { keyPath: "asset_id" });
      assets.createIndex("by_workspace", "workspace_id", { unique: false });
      assets.createIndex("by_service", ["workspace_id", "service_id"], { unique: false });

      const out = db.createObjectStore(STORES.outbox, { keyPath: "outbox_id" });
      out.createIndex("by_workspace", "workspace_id", { unique: false });
      out.createIndex("by_service", ["workspace_id", "service_id"], { unique: false });

      db.createObjectStore(STORES.migrations, { keyPath: "id" });

      tx.objectStore(STORES.migrations).put({
        id: 1,
        description: STEPS[0].description,
        applied_at: new Date().toISOString(),
      });
    },
  },
  {
    version: 2,
    description: "Reserved (superseded by v3 canonical-object refactor).",
    up: (_db, tx) => {
      tx.objectStore(STORES.migrations).put({
        id: 2,
        description: STEPS[1].description,
        applied_at: new Date().toISOString(),
      });
    },
  },
  {
    version: 3,
    description:
      "Canonical object identity (workspace_id, object_id): recreate objects/relations/events with new key paths + provenance indexes.",
    up: (db, tx) => {
      // Drop-and-recreate for object/relation/event stores. Pre-production —
      // there is no data to preserve.
      if (db.objectStoreNames.contains(STORES.objects)) {
        db.deleteObjectStore(STORES.objects);
      }
      if (db.objectStoreNames.contains(STORES.relations)) {
        db.deleteObjectStore(STORES.relations);
      }
      if (db.objectStoreNames.contains(STORES.events)) {
        db.deleteObjectStore(STORES.events);
      }
      createObjectsStore(db);
      createRelationsStore(db);
      createEventsStore(db);

      tx.objectStore(STORES.migrations).put({
        id: 3,
        description: STEPS[2].description,
        applied_at: new Date().toISOString(),
      });
    },
  },
  {
    version: 4,
    description: "Add global schemas store and assets.by_object index.",
    up: (db, tx) => {
      if (!db.objectStoreNames.contains(STORES.schemas)) {
        const schemas = db.createObjectStore(STORES.schemas, {
          keyPath: ["schema_id", "schema_version"],
        });
        schemas.createIndex("by_schema_id", "schema_id", { unique: false });
        schemas.createIndex("by_source", "source", { unique: false });
        schemas.createIndex("by_source_service", "source_service_id", { unique: false });
        schemas.createIndex("by_package", "source_package_digest", { unique: false });
      }
      const assets = tx.objectStore(STORES.assets);
      if (!assets.indexNames.contains("by_object")) {
        assets.createIndex("by_object", ["workspace_id", "object_id"], { unique: false });
      }
      tx.objectStore(STORES.migrations).put({
        id: 4,
        description: "Add global schemas store and assets.by_object index.",
        applied_at: new Date().toISOString(),
      });
    },
  },

  {
    version: 5,
    description: "Add Capability 0.3.1 instance/grant/workspace binding stores.",
    up: (db, tx) => {
      if (!db.objectStoreNames.contains(STORES.capability_instances)) {
        const instances = db.createObjectStore(STORES.capability_instances, { keyPath: "instance_id" });
        instances.createIndex("by_lineage", "lineage_id", { unique: false });
        instances.createIndex("by_service", "audience_service_id", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.capability_grants)) {
        const grants = db.createObjectStore(STORES.capability_grants, { keyPath: "grant_id" });
        grants.createIndex("by_instance", "instance_id", { unique: false });
        grants.createIndex("by_lineage", "lineage_id", { unique: false });
        grants.createIndex("by_service", "audience_service_id", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.capability_bindings)) {
        const bindings = db.createObjectStore(STORES.capability_bindings, { keyPath: ["workspace_id", "service_id"] });
        bindings.createIndex("by_instance", "instance_id", { unique: false });
        bindings.createIndex("by_lineage", "lineage_id", { unique: false });
        bindings.createIndex("by_service", "service_id", { unique: false });
      }
      tx.objectStore(STORES.migrations).put({
        id: 5,
        description: "Add Capability 0.3.1 instance/grant/workspace binding stores.",
        applied_at: new Date().toISOString(),
      });
    },
  },

  {
    version: 6,
    description: "Add Capability/Security 0.4 persisted trust state, immutable targets, and authorization decision records.",
    up: (db, tx) => {
      if (!db.objectStoreNames.contains(STORES.security_state)) {
        const security = db.createObjectStore(STORES.security_state, { keyPath: "scope_id" });
        security.createIndex("by_state", "state", { unique: false });
        security.createIndex("by_snapshot", "snapshot_digest", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.security_targets)) {
        const targets = db.createObjectStore(STORES.security_targets, { keyPath: "key" });
        targets.createIndex("by_snapshot", "snapshot_digest", { unique: false });
        targets.createIndex("by_semantic", ["semantic_type", "semantic_version"], { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.authorization_decisions)) {
        const decisions = db.createObjectStore(STORES.authorization_decisions, { keyPath: "decision_id" });
        decisions.createIndex("by_workspace_service", ["workspace_id", "service_id"], { unique: false });
        decisions.createIndex("by_evaluated_at", "evaluated_at", { unique: false });
      }
      tx.objectStore(STORES.migrations).put({
        id: 6,
        description: "Add Capability/Security 0.4 persisted trust state, immutable targets, and authorization decision records.",
        applied_at: new Date().toISOString(),
      });
    },
  },

  {
    version: 7,
    description: "Add immutable atomic graph replay receipts.",
    up: (db, tx) => {
      const commits = db.createObjectStore(STORES.graph_commits, { keyPath: ["workspace_id", "service_id", "idempotency_key"] });
      commits.createIndex("by_workspace", "workspace_id", { unique: false });
      tx.objectStore(STORES.migrations).put({ id: 7, description: "Add immutable atomic graph replay receipts.", applied_at: new Date().toISOString() });
    },
  },
];

export function runMigrations(
  db: IDBDatabase,
  tx: IDBTransaction,
  fromVersion: number,
  toVersion: number,
): void {
  for (const step of STEPS) {
    if (step.version > fromVersion && step.version <= toVersion) {
      step.up(db, tx);
    }
  }
}

export function listMigrationSteps(): { version: number; description: string }[] {
  return STEPS.map((s) => ({ version: s.version, description: s.description }));
}
