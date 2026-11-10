/**
 * Deterministic sort for workspace object lists.
 *
 * `updated_at` DESC with a stable tie-break by `object_id`. Never
 * mutates the input array. Objects with equal (updated_at, object_id)
 * pairs stay in their original order relative to each other.
 */
import type { ObjectRecord } from "../../../../kernel-client";

export function sortWorkspaceObjects(
  objects: readonly ObjectRecord[],
): ObjectRecord[] {
  return [...objects].sort((a, b) => {
    if (a.updated_at !== b.updated_at) {
      return a.updated_at < b.updated_at ? 1 : -1;
    }
    if (a.object_id === b.object_id) return 0;
    return a.object_id < b.object_id ? -1 : 1;
  });
}
