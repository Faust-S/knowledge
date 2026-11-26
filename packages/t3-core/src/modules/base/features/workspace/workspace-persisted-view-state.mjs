import { WORKSPACE_VIEW_STATE_FAMILY, workspaceSavedViewObjectId, isWorkspaceBusinessObjectRecord } from './workspace-view-state-boundary.mjs';

export const WORKSPACE_VIEW_STATE_COMMANDS = Object.freeze({
  save: 'workspace.view-state.save',
  delete: 'workspace.view-state.delete',
});

function requireText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function commandIsInvocable(commandsFacade, commandId) {
  if (!commandsFacade || typeof commandsFacade.has !== 'function') return false;
  try {
    return commandsFacade.has(commandId) === true;
  } catch {
    return false;
  }
}

export function workspaceViewStateCommandAvailability(commandsFacade) {
  return Object.freeze({
    save: commandIsInvocable(commandsFacade, WORKSPACE_VIEW_STATE_COMMANDS.save),
    delete: commandIsInvocable(commandsFacade, WORKSPACE_VIEW_STATE_COMMANDS.delete),
  });
}

export function buildPersistedWorkspaceSavedViewId({ workspaceId, profileId, name }) {
  const normalizedWorkspaceId = requireText(workspaceId);
  const normalizedProfileId = requireText(profileId);
  const normalizedName = requireText(name);
  if (!normalizedWorkspaceId) throw new TypeError('workspaceId must be a non-empty string');
  if (!normalizedProfileId) throw new TypeError('profileId must be a non-empty string');
  if (!normalizedName) throw new TypeError('name must be a non-empty string');

  const seed = `${normalizedWorkspaceId}\u0000${normalizedProfileId}\u0000${normalizedName.toLowerCase()}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `view-${hash.toString(16).padStart(8, '0')}`;
}

/**
 * New view identities are opaque and independent of their names. The
 * historical 32-bit function above is retained only for legacy callers.
 */
function allocateWorkspaceViewId() {
  const crypto = globalThis.crypto;
  if (typeof crypto?.getRandomValues !== 'function') {
    throw new Error('VIEW_STATE_ID_ALLOCATION_UNAVAILABLE');
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `view-${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
}

const NEW_VIEW_ID = /^view-[0-9a-f]{32}$/u;
const nameKey = (name) => name.trim().toLowerCase();

function saveError(code, message) {
  return Object.assign(new Error(message), { code });
}

/** Select one exact existing record, or reserve a new opaque identity.
 * This prepares a command only; the original owner still decides and writes.
 * A named edit carries the revision observed when the user opened that view.
 */
export function prepareWorkspacePersistedViewSave({
  workspaceId, profileId, name, logicalAreaId, query, objects,
  edit = null, pendingCreateId = null, presentation = null, allocateId = allocateWorkspaceViewId,
}) {
  const title = requireText(name);
  if (!title || title.length > 120 || typeof query !== 'string' || query.length > 1000
      || (logicalAreaId !== null && !requireText(logicalAreaId))
      || (presentation !== null && !parseWorkspaceViewPresentation(presentation))) {
    throw saveError('VIEW_STATE_SAVE_INPUT_INVALID', 'Invalid saved view name or filter.');
  }
  const projection = projectWorkspacePersistedViews({ workspaceId, profileId, objects });
  const key = nameKey(title);
  const matches = projection.views.filter((view) => nameKey(view.name) === key);
  const recordsFor = (id) => objects.filter((object) => object?.workspace_id === workspaceId
    && object.object_id === workspaceSavedViewObjectId(id));
  const exact = (id) => {
    const views = projection.views.filter((view) => view.viewId === id);
    if (views.length !== 1 || recordsFor(id).length !== 1) {
      throw saveError('VIEW_STATE_EDIT_TARGET_UNAVAILABLE', 'The saved view is no longer uniquely available.');
    }
    return views[0];
  };
  const target = (viewId, baseRevision, action) => Object.freeze({
    viewId, baseRevision, action, name: title,
  });
  if (edit !== null) {
    const view = exact(edit.viewId);
    if (!Number.isSafeInteger(edit.baseRevision) || view.baseRevision !== edit.baseRevision) {
      throw saveError('REVISION_CONFLICT', 'The selected saved view has changed. Reopen it before saving.');
    }
    if (nameKey(view.name) !== key && matches.some((match) => match.viewId !== view.viewId)) {
      throw saveError('VIEW_STATE_NAME_EXISTS', 'Another saved view already has this name.');
    }
    return target(view.viewId, edit.baseRevision, 'UPDATE');
  }
  // A user may retry a failed/unknown create, but it must keep the same ID.
  // If a fresh read already contains it, never turn that retry into an update.
  if (pendingCreateId !== null) {
    if (!NEW_VIEW_ID.test(pendingCreateId)) throw new Error('VIEW_STATE_PENDING_ID_INVALID');
    if (recordsFor(pendingCreateId).length) {
      const view = exact(pendingCreateId);
      if (view.name === title && view.logicalAreaId === logicalAreaId && view.query === query
        && workspaceViewPresentationMatches(view.presentation, presentation)) {
        return target(view.viewId, view.baseRevision, 'ALREADY_SAVED');
      }
      throw saveError('VIEW_STATE_CREATE_REVIEW_REQUIRED', 'The previous save is present with different content. Open it before editing.');
    }
    if (matches.length) {
      throw saveError('VIEW_STATE_CREATE_REVIEW_REQUIRED', 'Another saved view now has this name. Open it before editing.');
    }
    return target(pendingCreateId, 0, 'CREATE');
  }
  // Compatibility: saving the unique existing name updates that record, not
  // a hash derived from the name. Ambiguous names require an explicit edit.
  if (matches.length > 1) {
    throw saveError('VIEW_STATE_NAME_AMBIGUOUS', 'Select the saved view you want to edit.');
  }
  if (matches.length === 1) {
    const view = exact(matches[0].viewId);
    return target(view.viewId, view.baseRevision, 'UPDATE');
  }
  const viewId = allocateId();
  if (typeof viewId !== 'string' || !NEW_VIEW_ID.test(viewId) || recordsFor(viewId).length) {
    throw saveError('VIEW_STATE_ID_COLLISION', 'A new saved view identity could not be allocated.');
  }
  return target(viewId, 0, 'CREATE');
}

/** Check the exact saved content as well as the receipt identity/revision. */
export function workspaceSavedViewDataMatches(actual, expected) {
  return Boolean(actual && expected && actual.version === 1 && expected.version === 1
    && ['view_id', 'name', 'profile_id', 'logical_area_id', 'query']
      .every((key) => Object.hasOwn(actual, key) && actual[key] === expected[key])
    && (expected.presentation === undefined ? actual.presentation === undefined
      : Boolean(parseWorkspaceViewPresentation(expected.presentation))
        && workspaceViewPresentationMatches(actual.presentation, expected.presentation)));
}

// A presentation is only a set of revision-bound references to objects already
// in this Workspace. It never contains business payloads or grants access.
const VIEW_MODES = new Set(['browse', 'queues', 'compare', 'receipts', 'canvas']);
const VIEW_SELECTION_LIMIT = 256;
const OBJECT_ID = /^[A-Za-z0-9._:-]{1,128}$/u;

function parseViewObjectRef(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== 2 || typeof value.object_id !== 'string'
      || !OBJECT_ID.test(value.object_id) || !Number.isSafeInteger(value.revision)
      || value.revision < 1) return null;
  return Object.freeze({ object_id: value.object_id, revision: value.revision });
}

/** Layout belongs to the existing saved view, not to an object or executor. */
export function reconcileWorkspaceCanvasLayout(selectedObjectIds, layout = null) {
  const columns = layout?.columns === 1 ? 1 : 2;
  const detailed = new Set(Array.isArray(layout?.detailed) ? layout.detailed : []);
  const wide = new Set(Array.isArray(layout?.wide) ? layout.wide : []);
  return Object.freeze({ columns,
    detailed: Object.freeze(selectedObjectIds.filter((id) => detailed.has(id))),
    wide: Object.freeze(selectedObjectIds.filter((id) => wide.has(id))),
  });
}

function parseCanvasLayout(value, selectedObjectIds) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== 3 || (value.columns !== 1 && value.columns !== 2)) return null;
  const admitted = new Set(selectedObjectIds);
  for (const refs of [value.detailed, value.wide]) {
    if (!Array.isArray(refs) || refs.length > selectedObjectIds.length
        || new Set(refs).size !== refs.length || refs.some((id) => !admitted.has(id))) return null;
  }
  return reconcileWorkspaceCanvasLayout(selectedObjectIds, value);
}

export function moveWorkspaceCanvasMaterial(selectedObjectIds, objectId, direction) {
  if (!Array.isArray(selectedObjectIds) || selectedObjectIds.length > VIEW_SELECTION_LIMIT
      || new Set(selectedObjectIds).size !== selectedObjectIds.length || ![-1, 1].includes(direction)) {
    throw new Error('VIEW_STATE_PRESENTATION_INVALID');
  }
  const next = [...selectedObjectIds];
  const index = next.indexOf(objectId), target = index + direction;
  if (index >= 0 && target >= 0 && target < next.length) {
    [next[index], next[target]] = [next[target], next[index]];
  }
  return Object.freeze(next);
}

export function parseWorkspaceViewPresentation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== (value.mode === 'canvas' ? 5 : 4) || value.version !== 1
      || !VIEW_MODES.has(value.mode) || !Array.isArray(value.selected)
      || value.selected.length > VIEW_SELECTION_LIMIT) return null;
  const selected = [], ids = new Set();
  for (const entry of value.selected) {
    const ref = parseViewObjectRef(entry);
    if (!ref || ids.has(ref.object_id)) return null;
    selected.push(ref); ids.add(ref.object_id);
  }
  const detail = value.detail === null ? null : parseViewObjectRef(value.detail);
  if (value.detail !== null && !detail) return null;
  // The same selected object and detail cannot pin different revisions.
  if (detail && selected.some((ref) => ref.object_id === detail.object_id && ref.revision !== detail.revision)) return null;
  const canvas = value.mode === 'canvas' ? parseCanvasLayout(value.canvas, [...ids]) : null;
  if (value.mode === 'canvas' ? !canvas : Object.hasOwn(value, 'canvas')) return null;
  return Object.freeze({ version: 1, mode: value.mode, selected: Object.freeze(selected), detail, ...(canvas ? { canvas } : {}) });
}

export function workspaceViewPresentationMatches(actual, expected) {
  if (actual == null || expected == null) return actual == null && expected == null;
  const left = parseWorkspaceViewPresentation(actual), right = parseWorkspaceViewPresentation(expected);
  if (!left || !right || left.mode !== right.mode || left.selected.length !== right.selected.length) return false;
  const equalRef = (a, b) => a === null || b === null ? a === b
    : a.object_id === b.object_id && a.revision === b.revision;
  return equalRef(left.detail, right.detail) && left.selected.every((ref, i) => equalRef(ref, right.selected[i]))
    && JSON.stringify(left.canvas ?? null) === JSON.stringify(right.canvas ?? null);
}

function scopedViewObjectIndex(workspaceId, objects) {
  const index = new Map();
  if (!requireText(workspaceId) || !Array.isArray(objects)) throw new Error('VIEW_STATE_OBJECT_CATALOG_INVALID');
  for (const object of objects) {
    if (!object || object.workspace_id !== workspaceId || typeof object.object_id !== 'string'
      || !OBJECT_ID.test(object.object_id)) continue;
    const duplicate = index.has(object.object_id);
    const business = isWorkspaceBusinessObjectRecord(object);
    const ref = parseViewObjectRef({ object_id: object.object_id, revision: object.revision });
    index.set(object.object_id, duplicate || !business || !ref ? null : ref);
  }
  return index;
}

/** Capture the current selection, not a second copy of the selected data. */
export function captureWorkspaceViewPresentation({ workspaceId, objects, mode, selectedObjectIds, detailObjectId, canvasLayout = null }) {
  if (!VIEW_MODES.has(mode) || !Array.isArray(selectedObjectIds) || selectedObjectIds.length > VIEW_SELECTION_LIMIT
      || new Set(selectedObjectIds).size !== selectedObjectIds.length) {
    throw saveError('VIEW_STATE_PRESENTATION_INVALID', 'The view mode or selection is invalid.');
  }
  const index = scopedViewObjectIndex(workspaceId, objects);
  const exact = (id) => {
    const ref = index.get(id);
    if (!ref) throw saveError('VIEW_STATE_SELECTION_CHANGED', 'A selected object is no longer uniquely available.');
    return ref;
  };
  const selected = selectedObjectIds.map(exact);
  const detail = detailObjectId === null ? null : exact(detailObjectId);
  if (mode === 'browse' && selected.length === 0 && detail === null) return null;
  return parseWorkspaceViewPresentation({ version: 1, mode, selected, detail,
    ...(mode === 'canvas' ? { canvas: reconcileWorkspaceCanvasLayout(selectedObjectIds, canvasLayout) } : {}),
  });
}

/** Restore only exact, currently admitted object revisions. No writes or
 * execution are implied by viewing the restored selection. */
export function restoreWorkspaceViewPresentation({ workspaceId, objects, presentation }) {
  const parsed = presentation == null ? null : parseWorkspaceViewPresentation(presentation);
  if (presentation != null && !parsed) throw new Error('VIEW_STATE_PRESENTATION_INVALID');
  const index = scopedViewObjectIndex(workspaceId, objects);
  const changed = new Set(), unavailable = new Set();
  const current = (ref) => {
    const latest = index.get(ref.object_id);
    if (!latest) { unavailable.add(ref.object_id); return null; }
    if (latest.revision !== ref.revision) { changed.add(ref.object_id); return null; }
    return latest.object_id;
  };
  const selected = parsed ? parsed.selected.map(current).filter((id) => id !== null) : [];
  const detail = parsed?.detail ? current(parsed.detail) : null;
  return Object.freeze({ mode: parsed?.mode ?? 'browse', selectedObjectIds: Object.freeze(selected),
    detailObjectId: detail, changedCount: changed.size, unavailableCount: unavailable.size,
    ...(parsed?.mode === 'canvas' ? { canvasLayout: reconcileWorkspaceCanvasLayout(selected, parsed.canvas) } : {}),
  });
}

/** The canvas mounts only current, uniquely admitted records. References in
 * a saved view must first pass restoreWorkspaceViewPresentation; the caller
 * supplies that admitted selection. No second payload store is produced. */
export function projectWorkspaceCanvasMaterials({ workspaceId, objects, selectedObjectIds }) {
  if (!Array.isArray(selectedObjectIds) || selectedObjectIds.length > VIEW_SELECTION_LIMIT
      || new Set(selectedObjectIds).size !== selectedObjectIds.length) {
    return Object.freeze({ status: 'INVALID_SELECTION', items: Object.freeze([]), unavailableCount: 0 });
  }
  const index = scopedViewObjectIndex(workspaceId, objects);
  const records = new Map();
  for (const object of objects) {
    if (object?.workspace_id !== workspaceId || !index.get(object.object_id)) continue;
    records.set(object.object_id, object);
  }
  const items = selectedObjectIds.map((id) => records.get(id)).filter(Boolean);
  return Object.freeze({ status: 'READY', items: Object.freeze(items), unavailableCount: selectedObjectIds.length - items.length });
}

export function projectWorkspacePersistedViews({ workspaceId, profileId, objects }) {
  const normalizedWorkspaceId = requireText(workspaceId);
  const normalizedProfileId = requireText(profileId);
  if (!normalizedWorkspaceId) throw new TypeError('workspaceId must be a non-empty string');
  if (!normalizedProfileId) throw new TypeError('profileId must be a non-empty string');
  if (!Array.isArray(objects)) throw new TypeError('objects must be an array');

  const views = [];
  let rejected = 0;

  for (const object of objects) {
    if (!object || object.schema_id !== WORKSPACE_VIEW_STATE_FAMILY) continue;
    if (object.workspace_id !== normalizedWorkspaceId) {
      rejected += 1;
      continue;
    }

    const data = object.data;
    const viewId = requireText(data?.view_id);
    const name = requireText(data?.name);
    const payloadProfileId = requireText(data?.profile_id);
    const logicalAreaId = data?.logical_area_id === null ? null : requireText(data?.logical_area_id);
    const query = typeof data?.query === 'string' ? data.query : null;
    const presentation = data?.presentation === undefined ? null : parseWorkspaceViewPresentation(data.presentation);
    const revision = Number.isInteger(object.revision) && object.revision > 0 ? object.revision : null;
    let canonicalObjectId = null;
    try { canonicalObjectId = viewId ? workspaceSavedViewObjectId(viewId) : null; } catch { canonicalObjectId = null; }

    if (
      data?.version !== 1 ||
      !viewId ||
      !name ||
      payloadProfileId !== normalizedProfileId ||
      query == null ||
      revision == null ||
      canonicalObjectId == null ||
      object.object_id !== canonicalObjectId ||
      (data?.logical_area_id !== null && !logicalAreaId) ||
      (data?.presentation !== undefined && !presentation)
    ) {
      rejected += 1;
      continue;
    }

    views.push(Object.freeze({
      objectId: object.object_id,
      revision,
      viewId,
      title: name,
      name,
      profileId: payloadProfileId,
      logicalAreaId,
      query,
      baseRevision: revision,
      persisted: true,
      source: 'WORKSPACE_VIEW_STATE_OWNER',
      ...(presentation ? { presentation } : {}),
    }));
  }

  views.sort((a, b) => a.name.localeCompare(b.name) || a.viewId.localeCompare(b.viewId));
  return Object.freeze({ views: Object.freeze(views), rejected });
}
