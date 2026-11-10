import type { ObjectRecord } from "../../../../kernel-client/contracts/runtime-1.3.0";
import { isSafeOpaqueId } from "../../../../shell/routing";
import {
  PROJECT_PROCESS_RESULT_SCHEMA_IDS,
  type WorkspaceRelationIndexEntry,
} from "./relation-index-model";

export interface ProjectProcessResultPathHop {
  relationId: string;
  relationKind: string;
  relationDirection: "forward" | "reverse";
  fromObjectId: string;
  toObjectId: string;
}

export interface ProjectProcessResultPath {
  objectIds: readonly string[];
  hops: readonly ProjectProcessResultPathHop[];
}

interface AdjacencyStep {
  nextObjectId: string;
  hop: ProjectProcessResultPathHop;
}

function stableCompare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compareStep(a: AdjacencyStep, b: AdjacencyStep): number {
  return (
    stableCompare(a.nextObjectId, b.nextObjectId) ||
    stableCompare(a.hop.relationKind, b.hop.relationKind) ||
    stableCompare(a.hop.relationId, b.hop.relationId) ||
    stableCompare(a.hop.relationDirection, b.hop.relationDirection)
  );
}

/**
 * Finds a deterministic shortest structural path between two admitted objects
 * in the visible Project / Process / Result canonical RelationRecord graph.
 * Traversal is bidirectional for navigation while every hop preserves whether
 * it follows or reverses the stored RelationRecord direction. This is graph
 * reachability only: it must never be presented as execution order, dependency,
 * causality or workflow state unless the relation kind itself carries it.
 *
 * The return shape is the canonical-source compatibility projection of the P4.6
 * donor contract; admission, ordering, hop bounds and direction semantics are
 * kept exact.
 */
export function findProjectProcessResultShortestPath(
  entries: readonly WorkspaceRelationIndexEntry[],
  objects: readonly ObjectRecord[],
  fromObjectId: string | null,
  toObjectId: string | null,
  maxHops = 8,
): ProjectProcessResultPath | null {
  if (!fromObjectId || !toObjectId) return null;

  const objectById = new Map<string, ObjectRecord>();
  for (const object of objects) {
    if (
      PROJECT_PROCESS_RESULT_SCHEMA_IDS.has(object.schema_id) &&
      isSafeOpaqueId(object.object_id)
    ) {
      objectById.set(object.object_id, object);
    }
  }
  if (!objectById.has(fromObjectId) || !objectById.has(toObjectId)) return null;
  if (fromObjectId === toObjectId) {
    return { objectIds: [fromObjectId], hops: [] };
  }

  const boundedMaxHops = Math.max(0, Math.floor(maxHops));
  if (boundedMaxHops === 0) return null;

  const adjacency = new Map<string, AdjacencyStep[]>();
  const add = (objectId: string, step: AdjacencyStep) => {
    const steps = adjacency.get(objectId) ?? [];
    steps.push(step);
    adjacency.set(objectId, steps);
  };

  for (const entry of entries) {
    const fromId = entry.relation.from_object_id;
    const toId = entry.relation.to_object_id;
    if (!objectById.has(fromId) || !objectById.has(toId)) continue;
    add(fromId, {
      nextObjectId: toId,
      hop: {
        relationId: entry.relation.relation_id,
        relationKind: entry.relation.kind,
        relationDirection: "forward",
        fromObjectId: fromId,
        toObjectId: toId,
      },
    });
    add(toId, {
      nextObjectId: fromId,
      hop: {
        relationId: entry.relation.relation_id,
        relationKind: entry.relation.kind,
        relationDirection: "reverse",
        fromObjectId: toId,
        toObjectId: fromId,
      },
    });
  }
  for (const steps of adjacency.values()) steps.sort(compareStep);

  const queue: Array<{ objectId: string; objectIds: string[]; hops: ProjectProcessResultPathHop[] }> = [
    { objectId: fromObjectId, objectIds: [fromObjectId], hops: [] },
  ];
  const visited = new Set<string>([fromObjectId]);
  let cursor = 0;

  while (cursor < queue.length) {
    const current = queue[cursor++];
    if (current.hops.length >= boundedMaxHops) continue;
    for (const step of adjacency.get(current.objectId) ?? []) {
      if (visited.has(step.nextObjectId)) continue;
      const nextObjectIds = [...current.objectIds, step.nextObjectId];
      const nextHops = [...current.hops, step.hop];
      if (step.nextObjectId === toObjectId) {
        return { objectIds: nextObjectIds, hops: nextHops };
      }
      visited.add(step.nextObjectId);
      queue.push({ objectId: step.nextObjectId, objectIds: nextObjectIds, hops: nextHops });
    }
  }

  return null;
}
