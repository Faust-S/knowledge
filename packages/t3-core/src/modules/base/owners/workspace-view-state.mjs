import { canonicalClone } from '../../../persistence/canonical-codec.mjs';

const FAMILY = 'iwxa.workspace.internal.saved-view';
const OWNER_ID = 'iwxa.workspace.view-state';
const SCHEMA_VERSION = '1.0.0';
const SAVE_COMMAND = 'workspace.view-state.save';
const DELETE_COMMAND = 'workspace.view-state.delete';

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`);
  return value.trim();
}

function requireBaseRevision(value) {
  if (!Number.isInteger(value) || value < 0) throw new TypeError('base_revision must be a non-negative integer');
  return value;
}

function storageObjectId(workspaceId, objectId) {
  return `runtime12:${encodeURIComponent(workspaceId)}:${encodeURIComponent(objectId)}`;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function immutableCanonicalSnapshot(value) {
  return deepFreeze(canonicalClone(value));
}

function revisionConflict(expected, found) {
  const error = new Error(`revision conflict: expected ${String(expected)}, found ${String(found)}`);
  error.code = 'REVISION_CONFLICT';
  return error;
}

function assertRuntimeEnvelope(input) {
  const workspaceId = requireText(input?.workspace_id, 'workspace_id');
  const objectId = requireText(input?.object_id, 'object_id');
  if (input?.schema_id !== FAMILY) throw new Error('VIEW_STATE_SCHEMA_MISMATCH');
  if (input?.schema_version !== SCHEMA_VERSION) throw new Error('VIEW_STATE_SCHEMA_VERSION_MISMATCH');
  if (input?.extensions?.owner_module !== OWNER_ID) throw new Error('VIEW_STATE_OWNER_MODULE_MISMATCH');
  return { workspaceId, objectId, baseRevision: requireBaseRevision(input.base_revision) };
}

export const WORKSPACE_VIEW_STATE = Object.freeze({
  family: FAMILY,
  ownerId: OWNER_ID,
  schemaVersion: SCHEMA_VERSION,
  commands: Object.freeze({ save: SAVE_COMMAND, delete: DELETE_COMMAND }),
});

export function registerWorkspaceViewStateOwner(gateway) {
  if (!gateway || typeof gateway.registerOwner !== 'function' || !gateway.owners) {
    throw new TypeError('OwnerWriteGateway-compatible gateway is required');
  }
  const existing = gateway.owners.registration(FAMILY);
  if (existing) {
    const expectedCommands = [SAVE_COMMAND, DELETE_COMMAND].sort();
    const commandsMatch = existing.commands.length === expectedCommands.length
      && expectedCommands.every((command, index) => existing.commands[index] === command);
    if (existing.ownerId !== OWNER_ID || existing.headKind !== 'source' || !commandsMatch) {
      throw new Error(`incompatible owner registration for ${FAMILY}`);
    }
    return existing;
  }
  return gateway.registerOwner({
    family: FAMILY,
    ownerId: OWNER_ID,
    commands: [SAVE_COMMAND, DELETE_COMMAND],
    headKind: 'source',
  });
}

export class WorkspaceViewStateOwner {
  #gateway;
  #now;

  constructor({ gateway, now = () => new Date().toISOString() }) {
    registerWorkspaceViewStateOwner(gateway);
    this.#gateway = gateway;
    this.#now = now;
  }

  hasOperation(operationId) {
    return operationId === 't1.putObject' || operationId === 't1.deleteObject' || operationId === 't1.getObject';
  }

  async #current(workspaceId, objectId) {
    const storageId = storageObjectId(workspaceId, objectId);
    const head = await this.#gateway.head(FAMILY, storageId);
    if (!head) return { storageId, head: null, record: null, revision: 0 };
    const record = await this.#gateway.record(head.recordId);
    return { storageId, head, record, revision: head.revision };
  }

  async putObject(input) {
    const { workspaceId, objectId, baseRevision } = assertRuntimeEnvelope(input);
    const dataSnapshot = immutableCanonicalSnapshot(input.data);
    const current = await this.#current(workspaceId, objectId);
    if (baseRevision !== current.revision) throw revisionConflict(baseRevision, current.revision);
    const nextRevision = current.revision + 1;
    const runtimeObject = Object.freeze({
      workspace_id: workspaceId,
      object_id: objectId,
      schema_id: FAMILY,
      schema_version: SCHEMA_VERSION,
      revision: nextRevision,
      data: dataSnapshot,
      extensions: Object.freeze({ owner_module: OWNER_ID }),
    });
    await this.#gateway.execute({
      ownerId: OWNER_ID,
      commandId: SAVE_COMMAND,
      family: FAMILY,
      objectId: current.storageId,
      recordId: `${current.storageId}@${nextRevision}`,
      expectedRevisionId: current.head?.recordId ?? null,
      knowledgeAt: this.#now(),
      payload: runtimeObject,
      refs: Object.freeze({ workspaceId, runtimeObjectId: objectId }),
      operation: 'upsert',
    });
    return Object.freeze({ object: runtimeObject, event: input.event ?? null, deduplicated: false });
  }

  async deleteObject(input) {
    const workspaceId = requireText(input?.workspace_id, 'workspace_id');
    const objectId = requireText(input?.object_id, 'object_id');
    const baseRevision = requireBaseRevision(input?.base_revision);
    const current = await this.#current(workspaceId, objectId);
    if (!current.head || baseRevision !== current.revision) throw revisionConflict(baseRevision, current.revision);
    const nextRevision = current.revision + 1;
    await this.#gateway.execute({
      ownerId: OWNER_ID,
      commandId: DELETE_COMMAND,
      family: FAMILY,
      objectId: current.storageId,
      recordId: `${current.storageId}@${nextRevision}`,
      expectedRevisionId: current.head.recordId,
      knowledgeAt: this.#now(),
      payload: null,
      refs: Object.freeze({ workspaceId, runtimeObjectId: objectId }),
      operation: 'tombstone',
    });
    return Object.freeze({
      object: Object.freeze({ workspace_id: workspaceId, object_id: objectId, revision: nextRevision }),
      event: input.event ?? null,
      deduplicated: false,
    });
  }

  async getObject(input) {
    const workspaceId = requireText(input?.workspace_id, 'workspace_id');
    const objectId = requireText(input?.object_id, 'object_id');
    const current = await this.#current(workspaceId, objectId);
    if (!current.record || current.record.operation === 'tombstone') return null;
    return current.record.payload;
  }
}

export function isWorkspaceViewStateRecord(record) {
  return Boolean(record && (record.family === FAMILY || record.schema_id === FAMILY));
}
