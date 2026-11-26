import { WORKSPACE_VIEW_STATE_FAMILY, workspaceSavedViewObjectId } from './workspace-view-state-boundary.mjs';

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
  edit = null, pendingCreateId = null, allocateId = allocateWorkspaceViewId,
}) {
  const title = requireText(name);
  if (!title || title.length > 120 || typeof query !== 'string' || query.length > 1000
      || (logicalAreaId !== null && !requireText(logicalAreaId))) {
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
      if (view.name === title && view.logicalAreaId === logicalAreaId && view.query === query) {
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
      .every((key) => Object.hasOwn(actual, key) && actual[key] === expected[key]));
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
      (data?.logical_area_id !== null && !logicalAreaId)
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
    }));
  }

  views.sort((a, b) => a.name.localeCompare(b.name) || a.viewId.localeCompare(b.viewId));
  return Object.freeze({ views: Object.freeze(views), rejected });
}
