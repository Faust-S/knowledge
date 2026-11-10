import type { WorkspaceRelationIndexEntry } from "./relation-index-model";

export interface ProjectProcessResultNeighbor {
  relationId: string;
  relationKind: string;
  direction: "incoming" | "outgoing";
  neighborObjectId: string;
  neighborSchemaId: string;
}

function stableCompare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function buildProjectProcessResultNeighbors(
  entries: readonly WorkspaceRelationIndexEntry[],
  objectId: string | null,
): ProjectProcessResultNeighbor[] {
  if (!objectId) return [];
  const neighbors: ProjectProcessResultNeighbor[] = [];
  for (const entry of entries) {
    if (entry.relation.from_object_id === objectId) {
      neighbors.push({
        relationId: entry.relation.relation_id,
        relationKind: entry.relation.kind,
        direction: "outgoing",
        neighborObjectId: entry.relation.to_object_id,
        neighborSchemaId: entry.toSchemaId,
      });
    } else if (entry.relation.to_object_id === objectId) {
      neighbors.push({
        relationId: entry.relation.relation_id,
        relationKind: entry.relation.kind,
        direction: "incoming",
        neighborObjectId: entry.relation.from_object_id,
        neighborSchemaId: entry.fromSchemaId,
      });
    }
  }
  return neighbors.sort(
    (a, b) =>
      stableCompare(a.direction, b.direction) ||
      stableCompare(a.relationKind, b.relationKind) ||
      stableCompare(a.neighborObjectId, b.neighborObjectId) ||
      stableCompare(a.relationId, b.relationId),
  );
}
