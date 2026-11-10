import { normalizeLongitudinalContextAdmission } from '../features/longitudinal/longitudinal-context-policy.mjs';

const FAMILY = 'iwxa.longitudinal.context';
const OWNER_ID = 'iwxa.longitudinal.context-owner';
const SCHEMA_VERSION = '1.0.0';
const ADMIT_COMMAND = 'longitudinal.context.admit';
const REVISE_COMMAND = 'longitudinal.context.revise';
const RELEASE_COMMAND = 'longitudinal.context.release';

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`);
  return value.trim();
}

export const LONGITUDINAL_CONTEXT = Object.freeze({
  family: FAMILY,
  ownerId: OWNER_ID,
  schemaVersion: SCHEMA_VERSION,
  commands: Object.freeze({ admit: ADMIT_COMMAND, revise: REVISE_COMMAND, release: RELEASE_COMMAND }),
  headKind: 'derived',
});

export function longitudinalContextObjectId(workspaceId, contextId) {
  return `longitudinal-context:${encodeURIComponent(requireText(workspaceId, 'workspaceId'))}:${encodeURIComponent(requireText(contextId, 'contextId'))}`;
}

export function registerLongitudinalContextOwner(gateway) {
  if (!gateway || typeof gateway.registerOwner !== 'function' || !gateway.owners) {
    throw new TypeError('OwnerWriteGateway-compatible gateway is required');
  }
  const existing = gateway.owners.registration(FAMILY);
  if (existing) {
    const requiredCommands = [ADMIT_COMMAND, REVISE_COMMAND, RELEASE_COMMAND];
    const commandsMatch = existing.commands.length === requiredCommands.length
      && requiredCommands.every((command) => existing.commands.includes(command));
    if (existing.ownerId !== OWNER_ID || existing.headKind !== 'derived' || !commandsMatch) {
      throw new Error(`incompatible owner registration for ${FAMILY}`);
    }
    return existing;
  }
  return gateway.registerOwner({
    family: FAMILY,
    ownerId: OWNER_ID,
    commands: [ADMIT_COMMAND, REVISE_COMMAND, RELEASE_COMMAND],
    headKind: 'derived',
  });
}

function dependencyRefs(context) {
  return Object.freeze({
    workspaceId: context.workspaceId,
    scope: Object.freeze({ ...context.scope }),
    sourceHeads: context.sourceHeads,
    dependencyHeads: context.dependencyHeads,
    authorityRef: context.admission.authorityRef,
    permissionRef: context.admission.permissionRef,
  });
}

export class LongitudinalContextOwner {
  #gateway;

  constructor({ gateway }) {
    this.#gateway = gateway;
    registerLongitudinalContextOwner(gateway);
  }

  async admit({ recordId, knowledgeAt, ...input }) {
    const context = normalizeLongitudinalContextAdmission(input);
    return this.#gateway.execute({
      ownerId: OWNER_ID,
      commandId: ADMIT_COMMAND,
      family: FAMILY,
      objectId: longitudinalContextObjectId(context.workspaceId, context.contextId),
      recordId: requireText(recordId, 'recordId'),
      expectedRevisionId: null,
      knowledgeAt,
      payload: Object.freeze({ ...context, schemaVersion: SCHEMA_VERSION }),
      refs: dependencyRefs(context),
      operation: 'upsert',
    });
  }

  async revise({ recordId, baseRevisionId, knowledgeAt, ...input }) {
    const context = normalizeLongitudinalContextAdmission(input);
    return this.#gateway.execute({
      ownerId: OWNER_ID,
      commandId: REVISE_COMMAND,
      family: FAMILY,
      objectId: longitudinalContextObjectId(context.workspaceId, context.contextId),
      recordId: requireText(recordId, 'recordId'),
      expectedRevisionId: requireText(baseRevisionId, 'baseRevisionId'),
      knowledgeAt,
      payload: Object.freeze({ ...context, schemaVersion: SCHEMA_VERSION }),
      refs: dependencyRefs(context),
      operation: 'upsert',
    });
  }

  async release({ workspaceId, contextId, recordId, baseRevisionId, knowledgeAt }) {
    return this.#gateway.execute({
      ownerId: OWNER_ID,
      commandId: RELEASE_COMMAND,
      family: FAMILY,
      objectId: longitudinalContextObjectId(workspaceId, contextId),
      recordId: requireText(recordId, 'recordId'),
      expectedRevisionId: requireText(baseRevisionId, 'baseRevisionId'),
      knowledgeAt,
      payload: null,
      refs: Object.freeze({ workspaceId: requireText(workspaceId, 'workspaceId') }),
      operation: 'tombstone',
    });
  }

  async load(workspaceId, contextId) {
    const objectId = longitudinalContextObjectId(workspaceId, contextId);
    const head = await this.#gateway.head(FAMILY, objectId);
    if (!head) return null;
    const record = await this.#gateway.record(head.recordId);
    if (!record || record.operation === 'tombstone') return null;
    return Object.freeze({
      objectId,
      baseRevisionId: record.recordId,
      revision: record.revision,
      knowledgeAt: record.knowledgeAt,
      context: record.payload,
      dependencyRefs: head.dependencyRefs,
    });
  }

  async history(workspaceId, contextId) {
    return this.#gateway.history(
      FAMILY,
      longitudinalContextObjectId(workspaceId, contextId),
    );
  }

  async audit() {
    return this.#gateway.audit();
  }
}

export function isLongitudinalContextRecord(record) {
  return Boolean(
    record
    && record.family === FAMILY
    && record.ownerId === OWNER_ID
    && record.headKind === 'derived'
  );
}
