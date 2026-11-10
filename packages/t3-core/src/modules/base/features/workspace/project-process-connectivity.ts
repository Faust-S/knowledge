import type { ObjectRecord } from "../../../../kernel-client/contracts/runtime-1.3.0";
import { isSafeOpaqueId } from "../../../../shell/routing";
import {
  PROJECT_PROCESS_RESULT_SCHEMA_IDS,
  type WorkspaceRelationIndexEntry,
} from "./relation-index-model";

export interface ProjectProcessResultComponent {
  objectIds: readonly string[];
}

export interface ProjectProcessResultConnectivity {
  objectCount: number;
  componentCount: number;
  connectedObjectCount: number;
  isolatedObjectCount: number;
  components: readonly ProjectProcessResultComponent[];
  focusedObjectId: string | null;
  focusedComponentObjectCount: number;
  focusedReachableObjectCount: number;
  outsideFocusedComponentObjectCount: number;
}

function stableCompare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function isAdmittedObject(object: ObjectRecord): boolean {
  return PROJECT_PROCESS_RESULT_SCHEMA_IDS.has(object.schema_id) && isSafeOpaqueId(object.object_id);
}

/**
 * Structural connectivity only. Components are derived from admitted canonical
 * RelationRecord edges and admitted PPR ObjectRecord identities. They are not
 * process stages, dependency groups, execution order, causality or workflow state.
 */
export function buildProjectProcessResultConnectivity(
  entries: readonly WorkspaceRelationIndexEntry[],
  objects: readonly ObjectRecord[],
  focusedObjectId: string | null,
): ProjectProcessResultConnectivity {
  const objectIds = [...new Set(objects.filter(isAdmittedObject).map((object) => object.object_id))].sort(stableCompare);
  const admitted = new Set(objectIds);
  const adjacency = new Map<string, Set<string>>(objectIds.map((objectId) => [objectId, new Set<string>()]));

  for (const entry of entries) {
    const from = entry.relation.from_object_id;
    const to = entry.relation.to_object_id;
    if (!admitted.has(from) || !admitted.has(to)) continue;
    adjacency.get(from)!.add(to);
    adjacency.get(to)!.add(from);
  }

  const visited = new Set<string>();
  const components: ProjectProcessResultComponent[] = [];
  for (const start of objectIds) {
    if (visited.has(start)) continue;
    const queue = [start];
    const component: string[] = [];
    visited.add(start);
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      const neighbors = [...(adjacency.get(current) ?? [])].sort(stableCompare);
      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    component.sort(stableCompare);
    components.push({ objectIds: component });
  }

  components.sort((a, b) => stableCompare(a.objectIds[0] ?? "", b.objectIds[0] ?? ""));
  const isolatedObjectCount = objectIds.filter(
    (objectId) => (adjacency.get(objectId)?.size ?? 0) === 0,
  ).length;
  const connectedObjectCount = objectIds.length - isolatedObjectCount;

  const validFocusedObjectId = focusedObjectId && admitted.has(focusedObjectId) ? focusedObjectId : null;
  const focusedComponent = validFocusedObjectId
    ? components.find((component) => component.objectIds.includes(validFocusedObjectId)) ?? null
    : null;
  const focusedComponentObjectCount = focusedComponent?.objectIds.length ?? 0;

  return {
    objectCount: objectIds.length,
    componentCount: components.length,
    connectedObjectCount,
    isolatedObjectCount,
    components,
    focusedObjectId: validFocusedObjectId,
    focusedComponentObjectCount,
    focusedReachableObjectCount: focusedComponent ? Math.max(0, focusedComponent.objectIds.length - 1) : 0,
    outsideFocusedComponentObjectCount: focusedComponent ? objectIds.length - focusedComponent.objectIds.length : 0,
  };
}
