import type {
  ObjectRecord,
  ObjectWithRelations,
  RelationRecord,
} from "../../../../kernel-client/contracts/runtime-1.3.0";
import { isSafeOpaqueId } from "../../../../shell/routing";

export const RELATION_INDEX_MAX_SOURCE_OBJECTS = 100;
export const RELATION_INDEX_MAX_CONCURRENCY = 4;

export type RelationIndexPreset =
  | "all"
  | "cross-schema"
  | "same-schema"
  | "project-process-result";

export const PROJECT_PROCESS_RESULT_SCHEMA_IDS = Object.freeze(new Set([
  "project",
  "task",
  "process",
  "diagnostic-case",
  "analytical-result",
  "practice-result",
  "action",
  "route",
]));

export type RelationIndexSourceResult =
  | { sourceObjectId: string; state: "ready"; detail: ObjectWithRelations }
  | { sourceObjectId: string; state: "missing" }
  | { sourceObjectId: string; state: "error" };

export interface WorkspaceRelationIndexEntry {
  relation: RelationRecord;
  fromSchemaId: string;
  toSchemaId: string;
}

export interface WorkspaceRelationIndexDiagnostics {
  sourceLoadFailures: number;
  sourceMissing: number;
  sourceIdentityMismatches: number;
  rejectedRelations: number;
  relationIdConflicts: number;
}

export interface WorkspaceRelationIndexModel {
  entries: readonly WorkspaceRelationIndexEntry[];
  relationKinds: readonly string[];
  diagnostics: WorkspaceRelationIndexDiagnostics;
  loadedSources: number;
  isTruncated: boolean;
}

export interface ProjectProcessResultOverview {
  edgeCount: number;
  objectCount: number;
  connectedObjectCount: number;
  isolatedObjectCount: number;
  schemaCounts: readonly { schemaId: string; objectCount: number }[];
}

export interface ProjectProcessResultFocusOption {
  objectId: string;
  schemaId: string;
  incomingEdgeCount: number;
  outgoingEdgeCount: number;
  neighborCount: number;
}

function stableCompare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function relationSignature(r: RelationRecord): string {
  return JSON.stringify([
    r.relation_id,
    r.workspace_id,
    r.from_object_id,
    r.to_object_id,
    r.kind,
    r.created_at,
    r.created_by_service,
  ]);
}

function compareEntries(a: WorkspaceRelationIndexEntry, b: WorkspaceRelationIndexEntry): number {
  return (
    stableCompare(a.relation.kind, b.relation.kind) ||
    stableCompare(a.relation.from_object_id, b.relation.from_object_id) ||
    stableCompare(a.relation.to_object_id, b.relation.to_object_id) ||
    stableCompare(a.relation.relation_id, b.relation.relation_id)
  );
}

function emptyDiagnostics(): WorkspaceRelationIndexDiagnostics {
  return {
    sourceLoadFailures: 0,
    sourceMissing: 0,
    sourceIdentityMismatches: 0,
    rejectedRelations: 0,
    relationIdConflicts: 0,
  };
}

export function selectRelationIndexSources(
  objects: readonly ObjectRecord[],
): { objects: readonly ObjectRecord[]; isTruncated: boolean } {
  const ordered = [...objects].sort((a, b) => stableCompare(a.object_id, b.object_id));
  return {
    objects: ordered.slice(0, RELATION_INDEX_MAX_SOURCE_OBJECTS),
    isTruncated: ordered.length > RELATION_INDEX_MAX_SOURCE_OBJECTS,
  };
}

export async function loadRelationIndexSources(input: {
  workspaceId: string;
  sourceObjects: readonly ObjectRecord[];
  getObject: (workspaceId: string, objectId: string) => Promise<ObjectWithRelations | null>;
}): Promise<RelationIndexSourceResult[]> {
  const { workspaceId, sourceObjects, getObject } = input;
  const results: RelationIndexSourceResult[] = new Array(sourceObjects.length);
  let next = 0;

  const worker = async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= sourceObjects.length) return;
      const sourceObjectId = sourceObjects[index].object_id;
      try {
        const detail = await getObject(workspaceId, sourceObjectId);
        results[index] = detail
          ? { sourceObjectId, state: "ready", detail }
          : { sourceObjectId, state: "missing" };
      } catch {
        results[index] = { sourceObjectId, state: "error" };
      }
    }
  };

  const workerCount = Math.min(RELATION_INDEX_MAX_CONCURRENCY, sourceObjects.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export function buildWorkspaceRelationIndex(input: {
  workspaceId: string;
  objects: readonly ObjectRecord[];
  sources: readonly RelationIndexSourceResult[];
  isTruncated?: boolean;
}): WorkspaceRelationIndexModel {
  const { workspaceId, objects, sources, isTruncated = false } = input;
  const diagnostics = emptyDiagnostics();
  const knownObjects = new Map(objects.map((o) => [o.object_id, o]));
  const byRelationId = new Map<string, Map<string, RelationRecord>>();
  const seenSignaturesByRelationId = new Map<string, Set<string>>();
  let loadedSources = 0;

  const consider = (
    relation: RelationRecord,
    sourceObjectId: string,
    direction: "outgoing" | "incoming",
  ) => {
    const nearEndpoint = direction === "outgoing" ? relation.from_object_id : relation.to_object_id;
    const signature = relationSignature(relation);
    let seenSignatures = seenSignaturesByRelationId.get(relation.relation_id);
    if (!seenSignatures) {
      seenSignatures = new Set();
      seenSignaturesByRelationId.set(relation.relation_id, seenSignatures);
    }
    seenSignatures.add(signature);

    const valid =
      relation.workspace_id === workspaceId &&
      nearEndpoint === sourceObjectId &&
      isSafeOpaqueId(relation.from_object_id) &&
      isSafeOpaqueId(relation.to_object_id) &&
      knownObjects.has(relation.from_object_id) &&
      knownObjects.has(relation.to_object_id);

    if (!valid) {
      diagnostics.rejectedRelations += 1;
      return;
    }

    let signatures = byRelationId.get(relation.relation_id);
    if (!signatures) {
      signatures = new Map();
      byRelationId.set(relation.relation_id, signatures);
    }
    signatures.set(signature, relation);
  };

  for (const source of sources) {
    if (source.state === "error") {
      diagnostics.sourceLoadFailures += 1;
      continue;
    }
    if (source.state === "missing") {
      diagnostics.sourceMissing += 1;
      continue;
    }

    const { detail, sourceObjectId } = source;
    const catalogSource = knownObjects.get(sourceObjectId);
    if (
      !catalogSource ||
      detail.object.workspace_id !== workspaceId ||
      detail.object.object_id !== sourceObjectId ||
      detail.object.schema_id !== catalogSource.schema_id ||
      detail.object.revision !== catalogSource.revision ||
      !isSafeOpaqueId(detail.object.object_id)
    ) {
      diagnostics.sourceIdentityMismatches += 1;
      continue;
    }

    loadedSources += 1;
    for (const relation of detail.relations.outgoing) consider(relation, sourceObjectId, "outgoing");
    for (const relation of detail.relations.incoming) consider(relation, sourceObjectId, "incoming");
  }

  const entries: WorkspaceRelationIndexEntry[] = [];
  for (const [relationId, seenSignatures] of seenSignaturesByRelationId.entries()) {
    if (seenSignatures.size !== 1) {
      diagnostics.relationIdConflicts += 1;
      continue;
    }
    const signatures = byRelationId.get(relationId);
    if (!signatures || signatures.size !== 1) continue;
    const relation = signatures.values().next().value as RelationRecord;
    const from = knownObjects.get(relation.from_object_id);
    const to = knownObjects.get(relation.to_object_id);
    if (!from || !to) {
      diagnostics.rejectedRelations += 1;
      continue;
    }
    entries.push({ relation, fromSchemaId: from.schema_id, toSchemaId: to.schema_id });
  }

  entries.sort(compareEntries);
  const relationKinds = [...new Set(entries.map((e) => e.relation.kind))].sort(stableCompare);
  return { entries, relationKinds, diagnostics, loadedSources, isTruncated };
}

export function projectWorkspaceRelationIndex(
  entries: readonly WorkspaceRelationIndexEntry[],
  preset: RelationIndexPreset,
  relationKind: string | null,
): WorkspaceRelationIndexEntry[] {
  return entries.filter((entry) => {
    if (relationKind && entry.relation.kind !== relationKind) return false;
    if (preset === "cross-schema") return entry.fromSchemaId !== entry.toSchemaId;
    if (preset === "same-schema") return entry.fromSchemaId === entry.toSchemaId;
    if (preset === "project-process-result") {
      return (
        PROJECT_PROCESS_RESULT_SCHEMA_IDS.has(entry.fromSchemaId) &&
        PROJECT_PROCESS_RESULT_SCHEMA_IDS.has(entry.toSchemaId)
      );
    }
    return true;
  });
}

export function relationIndexHasDiagnostics(diagnostics: WorkspaceRelationIndexDiagnostics): boolean {
  return Object.values(diagnostics).some((value) => value > 0);
}

export function buildProjectProcessResultOverview(
  entries: readonly WorkspaceRelationIndexEntry[],
  objects: readonly ObjectRecord[] = [],
): ProjectProcessResultOverview {
  const objectSchemas = new Map<string, string>();
  for (const object of objects) {
    if (PROJECT_PROCESS_RESULT_SCHEMA_IDS.has(object.schema_id) && isSafeOpaqueId(object.object_id)) {
      objectSchemas.set(object.object_id, object.schema_id);
    }
  }
  const connectedObjectIds = new Set<string>();
  for (const entry of entries) {
    if (PROJECT_PROCESS_RESULT_SCHEMA_IDS.has(entry.fromSchemaId)) {
      objectSchemas.set(entry.relation.from_object_id, entry.fromSchemaId);
      connectedObjectIds.add(entry.relation.from_object_id);
    }
    if (PROJECT_PROCESS_RESULT_SCHEMA_IDS.has(entry.toSchemaId)) {
      objectSchemas.set(entry.relation.to_object_id, entry.toSchemaId);
      connectedObjectIds.add(entry.relation.to_object_id);
    }
  }
  const counts = new Map<string, number>();
  for (const schemaId of objectSchemas.values()) {
    counts.set(schemaId, (counts.get(schemaId) ?? 0) + 1);
  }
  return {
    edgeCount: entries.length,
    objectCount: objectSchemas.size,
    connectedObjectCount: connectedObjectIds.size,
    isolatedObjectCount: Math.max(0, objectSchemas.size - connectedObjectIds.size),
    schemaCounts: [...counts.entries()]
      .sort(([a], [b]) => stableCompare(a, b))
      .map(([schemaId, objectCount]) => ({ schemaId, objectCount })),
  };
}

export function buildProjectProcessResultFocusOptions(
  entries: readonly WorkspaceRelationIndexEntry[],
  objects: readonly ObjectRecord[] = [],
): ProjectProcessResultFocusOption[] {
  const byObject = new Map<string, {
    schemaId: string;
    incomingEdgeCount: number;
    outgoingEdgeCount: number;
    neighbors: Set<string>;
  }>();

  const ensure = (objectId: string, schemaId: string) => {
    let item = byObject.get(objectId);
    if (!item) {
      item = {
        schemaId,
        incomingEdgeCount: 0,
        outgoingEdgeCount: 0,
        neighbors: new Set<string>(),
      };
      byObject.set(objectId, item);
    }
    return item;
  };

  for (const object of objects) {
    if (PROJECT_PROCESS_RESULT_SCHEMA_IDS.has(object.schema_id) && isSafeOpaqueId(object.object_id)) {
      ensure(object.object_id, object.schema_id);
    }
  }
  for (const entry of entries) {
    const from = ensure(entry.relation.from_object_id, entry.fromSchemaId);
    const to = ensure(entry.relation.to_object_id, entry.toSchemaId);
    from.outgoingEdgeCount += 1;
    to.incomingEdgeCount += 1;
    from.neighbors.add(entry.relation.to_object_id);
    to.neighbors.add(entry.relation.from_object_id);
  }

  return [...byObject.entries()]
    .sort(([a], [b]) => stableCompare(a, b))
    .map(([objectId, item]) => ({
      objectId,
      schemaId: item.schemaId,
      incomingEdgeCount: item.incomingEdgeCount,
      outgoingEdgeCount: item.outgoingEdgeCount,
      neighborCount: item.neighbors.size,
    }));
}

export function focusProjectProcessResultEntries(
  entries: readonly WorkspaceRelationIndexEntry[],
  objectId: string | null,
): WorkspaceRelationIndexEntry[] {
  if (!objectId) return [...entries];
  return entries.filter(
    (entry) =>
      entry.relation.from_object_id === objectId ||
      entry.relation.to_object_id === objectId,
  );
}
