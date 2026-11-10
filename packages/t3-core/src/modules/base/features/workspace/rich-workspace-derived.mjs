export const RICH_WORKSPACE_WINDOW_SIZE = 12;

function stableCompare(a, b) {
  return a === b ? 0 : a < b ? -1 : 1;
}

function clampInteger(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function buildRichWorkspaceWindow(items, requestedOffset, requestedSize = RICH_WORKSPACE_WINDOW_SIZE) {
  const source = Array.isArray(items) ? items : [];
  const size = clampInteger(requestedSize, 1, 100);
  const maxOffset = source.length === 0 ? 0 : Math.floor((source.length - 1) / size) * size;
  const offset = clampInteger(requestedOffset, 0, maxOffset);
  const windowItems = source.slice(offset, offset + size);
  return Object.freeze({
    items: Object.freeze(windowItems),
    offset,
    size,
    total: source.length,
    start: windowItems.length === 0 ? 0 : offset + 1,
    end: offset + windowItems.length,
    hasPrevious: offset > 0,
    hasNext: offset + size < source.length,
  });
}

export function buildRichWorkspaceQueues({ workspaceId, objects }) {
  const grouped = new Map();
  for (const object of objects ?? []) {
    if (!object || object.workspace_id !== workspaceId) continue;
    if (typeof object.object_id !== 'string' || typeof object.schema_id !== 'string') continue;
    if (!object.object_id || !object.schema_id) continue;
    const current = grouped.get(object.schema_id) ?? [];
    current.push(object.object_id);
    grouped.set(object.schema_id, current);
  }

  return Object.freeze(
    [...grouped.entries()]
      .sort(([left], [right]) => stableCompare(left, right))
      .map(([schemaId, objectIds]) => Object.freeze({
        id: `schema:${schemaId}`,
        schemaId,
        objectIds: Object.freeze([...objectIds].sort(stableCompare)),
        objectCount: objectIds.length,
        readOnly: true,
        groupingAuthority: 'DERIVED_LOGICAL_ONLY',
      })),
  );
}

export function buildRichWorkspaceComparePreview({ workspaceId, objects, selectedObjectIds }) {
  const uniqueIds = [...new Set((selectedObjectIds ?? []).filter((value) => typeof value === 'string' && value))];
  if (uniqueIds.length !== 2) {
    return Object.freeze({
      status: 'INCOMPLETE_SELECTION',
      requiredSelectionCount: 2,
      selectedCount: uniqueIds.length,
      items: Object.freeze([]),
    });
  }

  const byId = new Map(
    (objects ?? [])
      .filter((object) => object?.workspace_id === workspaceId)
      .map((object) => [object.object_id, object]),
  );
  const selected = uniqueIds.map((id) => byId.get(id));
  if (selected.some((object) => !object)) {
    return Object.freeze({
      status: 'SELECTION_NOT_IN_CANONICAL_SET',
      requiredSelectionCount: 2,
      selectedCount: uniqueIds.length,
      items: Object.freeze([]),
    });
  }

  return Object.freeze({
    status: 'READY',
    requiredSelectionCount: 2,
    selectedCount: 2,
    items: Object.freeze(selected.map((object) => Object.freeze({
      objectId: object.object_id,
      schemaId: object.schema_id,
      workspaceId: object.workspace_id,
      revision: object.revision,
    }))),
  });
}

export const RICH_WORKSPACE_RECEIPTS_BOUNDARY = Object.freeze({
  status: 'UNAVAILABLE_NO_GLOBAL_RECEIPT_INDEX',
  failClosed: true,
  globalReceiptIndexAvailable: false,
  reason: 'GLOBAL_RECEIPT_SUPPORT_NOT_DECLARED_BY_CURRENT_CANONICAL_RUNTIME',
});
