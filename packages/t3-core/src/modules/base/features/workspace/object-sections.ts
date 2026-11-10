/**
 * Projection of a Workspace's objects into the sections declared by its
 * profile definition.
 *
 * Rules:
 *   - A section with `schemaIds.length > 0` collects objects whose
 *     `schema_id` matches. Each object appears in AT MOST one such
 *     section (the first, by definition order). Duplicate schema_id
 *     across two normal sections is a definition bug — the projection is
 *     deterministic and tested.
 *   - A section with `schemaIds.length === 0` is a catch-all: it
 *     receives every object regardless of schema_id, and it does NOT
 *     "claim" any schema_id (so unknown-section computation ignores it).
 *   - The unknown section is appended only when at least one object's
 *     schema_id is unclaimed by any normal section.
 *   - The input array is never mutated.
 */
import type { ObjectRecord } from "../../../../kernel-client";
import type { WorkspaceProfileDefinition } from "../../../../profiles/definition";

export interface WorkspaceObjectSectionResult {
  id: string;
  title: string;
  description?: string;
  emptyTitle: string;
  emptyDescription: string;
  objects: readonly ObjectRecord[];
  isUnknown: boolean;
  isCatchAll: boolean;
}

export function buildWorkspaceObjectSections(
  definition: WorkspaceProfileDefinition,
  objects: readonly ObjectRecord[],
): WorkspaceObjectSectionResult[] {
  // Determine, for each normal section, which schema_ids it owns.
  // Duplicates across normal sections resolve to the first-declared owner.
  const owner = new Map<string, string>(); // schema_id → section.id
  for (const s of definition.sections) {
    if (s.schemaIds.length === 0) continue;
    for (const sid of s.schemaIds) {
      if (!owner.has(sid)) owner.set(sid, s.id);
    }
  }

  const buckets = new Map<string, ObjectRecord[]>();
  const unknown: ObjectRecord[] = [];

  for (const obj of objects) {
    const ownerId = owner.get(obj.schema_id);
    if (ownerId) {
      const arr = buckets.get(ownerId) ?? [];
      arr.push(obj);
      buckets.set(ownerId, arr);
    } else {
      unknown.push(obj);
    }
  }

  const result: WorkspaceObjectSectionResult[] = [];
  for (const s of definition.sections) {
    if (s.schemaIds.length === 0) {
      // Catch-all: every object.
      result.push({
        id: s.id,
        title: s.title,
        description: s.description,
        emptyTitle: s.emptyTitle,
        emptyDescription: s.emptyDescription,
        objects: [...objects],
        isUnknown: false,
        isCatchAll: true,
      });
    } else {
      result.push({
        id: s.id,
        title: s.title,
        description: s.description,
        emptyTitle: s.emptyTitle,
        emptyDescription: s.emptyDescription,
        objects: buckets.get(s.id) ?? [],
        isUnknown: false,
        isCatchAll: false,
      });
    }
  }

  if (unknown.length > 0) {
    result.push({
      id: "__unknown__",
      title: definition.unknownObjectsSection.title,
      description: definition.unknownObjectsSection.description,
      emptyTitle: definition.unknownObjectsSection.title,
      emptyDescription: definition.unknownObjectsSection.description,
      objects: unknown,
      isUnknown: true,
      isCatchAll: false,
    });
  }

  return result;
}
