/**
 * Pure, testable model for the in-memory object catalog surface inside a
 * Workspace: search, sort and pagination. No I/O, no React.
 *
 * Search is DELIBERATELY scoped to `object_id` and `schema_id`. Payload
 * (`data`) is never inspected here — the shell has no schema semantics
 * and the payload can be sensitive.
 */
import type { ObjectRecord } from "../../../../kernel-client";
import {
  compareWorkspaceDatesDesc,
  compareWorkspaceIds,
} from "../workspaces/workspace-format";
import type { WorkspaceObjectSectionResult } from "./object-sections";

export const OBJECT_CATALOG_PAGE_SIZE = 12;

export type ObjectCatalogSortId =
  | "updated"
  | "created"
  | "id"
  | "type";

export interface ObjectCatalogSortOption {
  id: ObjectCatalogSortId;
  label: string;
}

export const OBJECT_CATALOG_SORTS: readonly ObjectCatalogSortOption[] = [
  { id: "updated", label: "Недавно обновлённые" },
  { id: "created", label: "Недавно созданные" },
  { id: "id",      label: "По идентификатору" },
  { id: "type",    label: "По типу" },
];

export function filterObjectsByQuery(
  objects: readonly ObjectRecord[],
  rawQuery: string,
): ObjectRecord[] {
  const q = rawQuery.trim().toLocaleLowerCase("ru-RU");
  if (!q) return [...objects];
  return objects.filter((o) => {
    const id = o.object_id.toLocaleLowerCase("ru-RU");
    const schema = o.schema_id.toLocaleLowerCase("ru-RU");
    return id.includes(q) || schema.includes(q);
  });
}

export function sortObjects(
  objects: readonly ObjectRecord[],
  sort: ObjectCatalogSortId,
): ObjectRecord[] {
  const arr = [...objects];
  switch (sort) {
    case "updated":
      arr.sort((a, b) => {
        const d = compareWorkspaceDatesDesc(a.updated_at, b.updated_at);
        return d !== 0 ? d : compareWorkspaceIds(a.object_id, b.object_id);
      });
      return arr;
    case "created":
      arr.sort((a, b) => {
        const d = compareWorkspaceDatesDesc(a.created_at, b.created_at);
        return d !== 0 ? d : compareWorkspaceIds(a.object_id, b.object_id);
      });
      return arr;
    case "id":
      arr.sort((a, b) => compareWorkspaceIds(a.object_id, b.object_id));
      return arr;
    case "type":
      arr.sort((a, b) => {
        const t = compareWorkspaceIds(a.schema_id, b.schema_id);
        return t !== 0 ? t : compareWorkspaceIds(a.object_id, b.object_id);
      });
      return arr;
  }
}

export interface PaginationResult<T> {
  pageItems: readonly T[];
  normalizedPage: number;
  totalPages: number;
  /** 1-based index of the first shown item, 0 when list is empty. */
  startIndex: number;
  /** 1-based index of the last shown item, 0 when list is empty. */
  endIndex: number;
  total: number;
}

export function paginate<T>(
  items: readonly T[],
  requestedPage: number,
  pageSize: number = OBJECT_CATALOG_PAGE_SIZE,
): PaginationResult<T> {
  const total = items.length;
  const size = Math.max(1, Math.floor(pageSize));
  const totalPages = Math.max(1, Math.ceil(total / size));
  const clamped = Math.min(
    Math.max(0, Math.floor(requestedPage)),
    totalPages - 1,
  );
  const start = clamped * size;
  const pageItems = items.slice(start, start + size);
  return {
    pageItems,
    normalizedPage: clamped,
    totalPages,
    total,
    startIndex: total === 0 ? 0 : start + 1,
    endIndex: total === 0 ? 0 : start + pageItems.length,
  };
}

/**
 * Pick the initial section id for a Workspace view.
 *
 * Rules (from T2-03B §5):
 *   - first definition section wins;
 *   - Generic exposes an `all` catch-all which naturally satisfies that;
 *   - if there is no first section but there IS an unknown bucket, use it;
 *   - when there are no objects, still return the first definition section
 *     so its profile-specific empty state is shown.
 */
export function pickInitialSectionId(
  sections: readonly WorkspaceObjectSectionResult[],
): string | null {
  const firstDefinition = sections.find((s) => !s.isUnknown);
  if (firstDefinition) return firstDefinition.id;
  const unknown = sections.find((s) => s.isUnknown);
  if (unknown) return unknown.id;
  return null;
}
