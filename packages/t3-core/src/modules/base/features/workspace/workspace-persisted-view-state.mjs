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
