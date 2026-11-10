/**
 * Pure filter/sort for object-scoped history events.
 *
 * - Use the canonical `EventRecord.object_id` as object identity.
 * - The service-specific payload need not contain `object_id`.
 * - Event workspace must equal the current workspaceId.
 * - Sort by `occurred_at` desc using a safe date comparator (bad dates
 *   go last but never throw).
 * - Cap at 20 events.
 */
import type { EventRecord } from "../../../../kernel-client";
import { compareWorkspaceDatesDesc } from "../workspaces/workspace-format";

export const OBJECT_HISTORY_LIMIT = 20;

export function filterObjectEvents(
  events: readonly EventRecord[],
  workspaceId: string,
  objectId: string,
): EventRecord[] {
  const out: EventRecord[] = [];
  for (const e of events) {
    if (e.workspace_id !== workspaceId || e.object_id !== objectId) continue;
    out.push(e);
  }
  out.sort((a, b) => compareWorkspaceDatesDesc(a.occurred_at, b.occurred_at));
  return out.slice(0, OBJECT_HISTORY_LIMIT);
}
