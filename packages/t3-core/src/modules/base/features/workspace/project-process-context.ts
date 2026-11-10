import type { ObjectRecord } from "../../../../kernel-client/contracts/runtime-1.3.0";
import { isSafeOpaqueId } from "../../../../shell/routing";
import {
  PROJECT_PROCESS_RESULT_SCHEMA_IDS,
  type WorkspaceRelationIndexEntry,
} from "./relation-index-model";
import {
  buildProjectProcessResultNeighbors,
  type ProjectProcessResultNeighbor,
} from "./project-process-neighbors";

export type ProjectProcessResultContextGroupId =
  | "projects"
  | "tasks"
  | "processes"
  | "results"
  | "actions"
  | "routes";

export interface ProjectProcessResultContextItem extends ProjectProcessResultNeighbor {
  neighborRevision: number;
  neighborUpdatedAt: string;
}

export interface ProjectProcessResultContextGroup {
  id: ProjectProcessResultContextGroupId;
  items: readonly ProjectProcessResultContextItem[];
}

export interface ProjectProcessResultContext {
  objectId: string;
  schemaId: string;
  revision: number;
  updatedAt: string;
  relationCount: number;
  neighborCount: number;
  groups: readonly ProjectProcessResultContextGroup[];
}

const GROUP_ORDER: readonly ProjectProcessResultContextGroupId[] = [
  "projects",
  "tasks",
  "processes",
  "results",
  "actions",
  "routes",
];

function stableCompare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function contextGroupId(schemaId: string): ProjectProcessResultContextGroupId | null {
  if (schemaId === "project") return "projects";
  if (schemaId === "task") return "tasks";
  if (schemaId === "process" || schemaId === "diagnostic-case") return "processes";
  if (schemaId === "analytical-result" || schemaId === "practice-result") return "results";
  if (schemaId === "action") return "actions";
  if (schemaId === "route") return "routes";
  return null;
}

export function buildProjectProcessResultContext(
  entries: readonly WorkspaceRelationIndexEntry[],
  objects: readonly ObjectRecord[],
  objectId: string | null,
): ProjectProcessResultContext | null {
  if (!objectId) return null;

  const objectById = new Map<string, ObjectRecord>();
  for (const object of objects) {
    if (
      PROJECT_PROCESS_RESULT_SCHEMA_IDS.has(object.schema_id) &&
      isSafeOpaqueId(object.object_id)
    ) {
      objectById.set(object.object_id, object);
    }
  }

  const focused = objectById.get(objectId);
  if (!focused) return null;

  const grouped = new Map<ProjectProcessResultContextGroupId, ProjectProcessResultContextItem[]>();
  const uniqueNeighborIds = new Set<string>();
  const neighbors = buildProjectProcessResultNeighbors(entries, objectId);

  for (const neighbor of neighbors) {
    const neighborObject = objectById.get(neighbor.neighborObjectId);
    if (!neighborObject) continue;
    const groupId = contextGroupId(neighbor.neighborSchemaId);
    if (!groupId) continue;
    uniqueNeighborIds.add(neighbor.neighborObjectId);
    const items = grouped.get(groupId) ?? [];
    items.push({
      ...neighbor,
      neighborRevision: neighborObject.revision,
      neighborUpdatedAt: neighborObject.updated_at,
    });
    grouped.set(groupId, items);
  }

  const groups = GROUP_ORDER
    .map((id) => ({
      id,
      items: (grouped.get(id) ?? []).sort(
        (a, b) =>
          stableCompare(a.neighborSchemaId, b.neighborSchemaId) ||
          stableCompare(a.neighborObjectId, b.neighborObjectId) ||
          stableCompare(a.relationKind, b.relationKind) ||
          stableCompare(a.direction, b.direction) ||
          stableCompare(a.relationId, b.relationId),
      ),
    }))
    .filter((group) => group.items.length > 0);

  return {
    objectId: focused.object_id,
    schemaId: focused.schema_id,
    revision: focused.revision,
    updatedAt: focused.updated_at,
    relationCount: neighbors.length,
    neighborCount: uniqueNeighborIds.size,
    groups,
  };
}
