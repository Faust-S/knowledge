import { CanonicalInstant } from '../foundation/time.mjs';
import { decodeCanonicalValue, encodeCanonicalValue } from './canonical-codec.mjs';

export const CANONICAL_STORAGE_SCHEMA = Object.freeze({
  id: 'IWXA_T2_CANONICAL_PERSISTENCE_V1',
  version: 1,
  stores: Object.freeze(['records', 'heads', 'audit']),
});

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CanonicalPersistenceError(`${label} must be a non-empty string`, 'INVALID_PERSISTENCE_FIELD');
  }
  return value.trim();
}

function requireHeadKind(value) {
  if (value !== 'source' && value !== 'derived') {
    throw new CanonicalPersistenceError('headKind must be source or derived', 'INVALID_HEAD_KIND');
  }
  return value;
}

function cloneWire(value) {
  return structuredClone(value);
}

function requireRefsRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CanonicalPersistenceError('refs must be a plain record', 'INVALID_PERSISTENCE_REFS');
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new CanonicalPersistenceError('refs must be a plain record', 'INVALID_PERSISTENCE_REFS');
  }
  return value;
}

function headKey(family, objectId) {
  return JSON.stringify([family, objectId]);
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
  });
}

export class CanonicalPersistenceError extends Error {
  constructor(message, code = 'CANONICAL_PERSISTENCE_ERROR') {
    super(message);
    this.name = 'CanonicalPersistenceError';
    this.code = code;
  }
}

export class MemoryCanonicalAdapter {
  #records = new Map();
  #heads = new Map();
  #audit = new Map();

  async initialize() { return CANONICAL_STORAGE_SCHEMA; }

  async commitRevision({ key, expectedHeadRecordId, record, head, audit }) {
    const current = this.#heads.get(key) ?? null;
    const currentRecordId = current?.recordId ?? null;
    if (currentRecordId !== expectedHeadRecordId) {
      throw new CanonicalPersistenceError(
        `head conflict for ${key}: expected ${String(expectedHeadRecordId)}, found ${String(currentRecordId)}`,
        'REVISION_CONFLICT',
      );
    }
    if (this.#records.has(record.recordId)) {
      throw new CanonicalPersistenceError(`duplicate record id ${record.recordId}`, 'DUPLICATE_RECORD_ID');
    }
    if (this.#audit.has(audit.auditId)) {
      throw new CanonicalPersistenceError(`duplicate audit id ${audit.auditId}`, 'DUPLICATE_AUDIT_ID');
    }

    // Prepare every fallible clone before publishing any part of the revision.
    const nextRecord = cloneWire(record);
    const nextAudit = cloneWire(audit);
    const nextHead = cloneWire(head);
    const result = cloneWire(nextHead);
    this.#records.set(nextRecord.recordId, nextRecord);
    this.#audit.set(nextAudit.auditId, nextAudit);
    this.#heads.set(key, nextHead);
    return result;
  }

  async getHead(key) {
    const value = this.#heads.get(key);
    return value == null ? null : cloneWire(value);
  }

  async getRecord(recordId) {
    const value = this.#records.get(recordId);
    return value == null ? null : cloneWire(value);
  }

  async listRecords() {
    return [...this.#records.values()].map(cloneWire);
  }

  async listAudit() {
    return [...this.#audit.values()].map(cloneWire);
  }
}

export class IndexedDbCanonicalAdapter {
  #indexedDB;
  #dbName;
  #database = null;

  constructor({ indexedDB = globalThis.indexedDB, dbName = 'iwxa-t2-canonical' } = {}) {
    if (!indexedDB || typeof indexedDB.open !== 'function') {
      throw new CanonicalPersistenceError('IndexedDB implementation is required', 'INDEXEDDB_UNAVAILABLE');
    }
    this.#indexedDB = indexedDB;
    this.#dbName = requireText(dbName, 'dbName');
  }

  async initialize() {
    if (this.#database) return CANONICAL_STORAGE_SCHEMA;
    const request = this.#indexedDB.open(this.#dbName, CANONICAL_STORAGE_SCHEMA.version);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of CANONICAL_STORAGE_SCHEMA.stores) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    };
    this.#database = await requestResult(request);
    return CANONICAL_STORAGE_SCHEMA;
  }

  async commitRevision({ key, expectedHeadRecordId, record, head, audit }) {
    const db = await this.#db();
    const transaction = db.transaction([...CANONICAL_STORAGE_SCHEMA.stores], 'readwrite');
    // Observe completion immediately; errors may arrive while a request awaits.
    const done = transactionDone(transaction);
    void done.catch(() => {});
    const records = transaction.objectStore('records');
    const heads = transaction.objectStore('heads');
    const auditStore = transaction.objectStore('audit');

    try {
      const current = await requestResult(heads.get(key));
      const currentRecordId = current?.recordId ?? null;
      if (currentRecordId !== expectedHeadRecordId) {
        throw new CanonicalPersistenceError(
          `head conflict for ${key}: expected ${String(expectedHeadRecordId)}, found ${String(currentRecordId)}`,
          'REVISION_CONFLICT',
        );
      }
      records.add(record, record.recordId);
      auditStore.add(audit, audit.auditId);
      heads.put(head, key);
      await done;
      return cloneWire(head);
    } catch (error) {
      // A synchronous add/put failure does not imply rollback of earlier writes.
      // Abort explicitly, preserve the original cause, and drain completion.
      try { transaction.abort(); } catch { /* Already completed or aborted. */ }
      await done.catch(() => {});
      if (error instanceof CanonicalPersistenceError) throw error;
      if (error?.name === 'ConstraintError') {
        throw new CanonicalPersistenceError('append-only record or audit id already exists', 'DUPLICATE_APPEND_ID');
      }
      throw error;
    }
  }

  async getHead(key) {
    const db = await this.#db();
    const transaction = db.transaction(['heads'], 'readonly');
    const value = await requestResult(transaction.objectStore('heads').get(key));
    await transactionDone(transaction);
    return value ?? null;
  }

  async getRecord(recordId) {
    const db = await this.#db();
    const transaction = db.transaction(['records'], 'readonly');
    const value = await requestResult(transaction.objectStore('records').get(recordId));
    await transactionDone(transaction);
    return value ?? null;
  }

  async listRecords() {
    const db = await this.#db();
    const transaction = db.transaction(['records'], 'readonly');
    const values = await requestResult(transaction.objectStore('records').getAll());
    await transactionDone(transaction);
    return values;
  }

  async listAudit() {
    const db = await this.#db();
    const transaction = db.transaction(['audit'], 'readonly');
    const values = await requestResult(transaction.objectStore('audit').getAll());
    await transactionDone(transaction);
    return values;
  }

  async #db() {
    await this.initialize();
    return this.#database;
  }
}

export class WriteOwnerRegistry {
  #families = new Map();
  #tokens = new WeakMap();

  register({ family, ownerId, commands, headKind = 'source' }) {
    const normalizedFamily = requireText(family, 'family');
    const normalizedOwner = requireText(ownerId, 'ownerId');
    const normalizedHeadKind = requireHeadKind(headKind);
    if (!Array.isArray(commands) || commands.length === 0) {
      throw new CanonicalPersistenceError('owner requires at least one command', 'INVALID_OWNER_COMMANDS');
    }
    const commandSet = new Set(commands.map((command) => requireText(command, 'command')));
    if (this.#families.has(normalizedFamily)) {
      throw new CanonicalPersistenceError(
        `persistent family ${normalizedFamily} already has an owner`,
        'DUPLICATE_WRITE_OWNER',
      );
    }
    const registration = Object.freeze({
      family: normalizedFamily,
      ownerId: normalizedOwner,
      commands: Object.freeze([...commandSet].sort()),
      headKind: normalizedHeadKind,
    });
    this.#families.set(normalizedFamily, registration);
    return registration;
  }

  registration(family) {
    return this.#families.get(requireText(family, 'family')) ?? null;
  }

  authorize({ family, ownerId, commandId }) {
    const registration = this.registration(family);
    if (!registration) {
      throw new CanonicalPersistenceError(`no write owner registered for ${family}`, 'WRITE_OWNER_NOT_REGISTERED');
    }
    if (registration.ownerId !== ownerId) {
      throw new CanonicalPersistenceError(
        `owner ${ownerId} cannot write ${family}; owner is ${registration.ownerId}`,
        'WRITE_OWNER_MISMATCH',
      );
    }
    if (!registration.commands.includes(commandId)) {
      throw new CanonicalPersistenceError(
        `command ${commandId} is not registered for ${family}`,
        'WRITE_COMMAND_NOT_REGISTERED',
      );
    }
    const token = Object.freeze({});
    this.#tokens.set(token, Object.freeze({ ...registration, commandId }));
    return token;
  }

  assertAuthorization(token, family) {
    const authorization = this.#tokens.get(token);
    if (!authorization || authorization.family !== family) {
      throw new CanonicalPersistenceError('valid owner authorization is required', 'WRITE_AUTHORIZATION_REQUIRED');
    }
    return authorization;
  }
}

export class CanonicalPersistenceStore {
  #adapter;
  #owners;

  constructor({ adapter, owners }) {
    const requiredAdapterMethods = ['initialize', 'commitRevision', 'getHead', 'getRecord', 'listRecords', 'listAudit'];
    if (!adapter || requiredAdapterMethods.some((method) => typeof adapter[method] !== 'function')) {
      throw new CanonicalPersistenceError(
        'canonical persistence adapter must provide initialize/commit/read/history/audit methods',
        'INVALID_PERSISTENCE_ADAPTER',
      );
    }
    if (!(owners instanceof WriteOwnerRegistry)) {
      throw new CanonicalPersistenceError('WriteOwnerRegistry is required', 'INVALID_WRITE_OWNER_REGISTRY');
    }
    this.#adapter = adapter;
    this.#owners = owners;
  }

  async initialize() {
    return this.#adapter.initialize();
  }

  async commitAuthorized({
    authorization,
    family,
    objectId,
    recordId,
    expectedRevisionId = null,
    knowledgeAt,
    payload,
    refs = {},
    operation = 'upsert',
  }) {
    const normalizedFamily = requireText(family, 'family');
    const normalizedObjectId = requireText(objectId, 'objectId');
    const normalizedRecordId = requireText(recordId, 'recordId');
    const owner = this.#owners.assertAuthorization(authorization, normalizedFamily);
    if (operation !== 'upsert' && operation !== 'tombstone') {
      throw new CanonicalPersistenceError('operation must be upsert or tombstone', 'INVALID_WRITE_OPERATION');
    }
    if (operation === 'tombstone' && payload !== null) {
      throw new CanonicalPersistenceError('tombstone payload must be null', 'INVALID_TOMBSTONE');
    }
    const instant = knowledgeAt instanceof CanonicalInstant ? knowledgeAt : CanonicalInstant.parse(knowledgeAt);
    // Snapshot canonical caller-owned values before the first await. This prevents
    // a caller from changing payload/refs while revision state is being read.
    const payloadSnapshot = decodeCanonicalValue(encodeCanonicalValue(payload));
    const refsSnapshot = decodeCanonicalValue(encodeCanonicalValue(requireRefsRecord(refs)));
    const currentHead = await this.head(normalizedFamily, normalizedObjectId);
    const currentRevisionId = currentHead?.recordId ?? null;
    if (currentRevisionId !== expectedRevisionId) {
      throw new CanonicalPersistenceError(
        `revision conflict for ${normalizedFamily}/${normalizedObjectId}: expected ${String(expectedRevisionId)}, found ${String(currentRevisionId)}`,
        'REVISION_CONFLICT',
      );
    }
    const revision = (currentHead?.revision ?? 0) + 1;
    const record = Object.freeze({
      schema: 'IWXA_T2_CANONICAL_RECORD_V1',
      family: normalizedFamily,
      objectId: normalizedObjectId,
      recordId: normalizedRecordId,
      revision,
      previousRevisionId: currentRevisionId,
      ownerId: owner.ownerId,
      commandId: owner.commandId,
      headKind: owner.headKind,
      operation,
      knowledgeAt: instant,
      payload: payloadSnapshot,
      refs: refsSnapshot,
    });
    const head = Object.freeze({
      schema: 'IWXA_T2_CANONICAL_HEAD_V1',
      family: normalizedFamily,
      objectId: normalizedObjectId,
      recordId: normalizedRecordId,
      revision,
      ownerId: owner.ownerId,
      headKind: owner.headKind,
      sourceHeadRef: owner.headKind === 'source' ? normalizedRecordId : null,
      dependencyRefs: owner.headKind === 'derived' ? refsSnapshot : {},
    });
    const audit = Object.freeze({
      schema: 'IWXA_T2_APPEND_ONLY_AUDIT_V1',
      auditId: `write:${normalizedRecordId}`,
      family: normalizedFamily,
      objectId: normalizedObjectId,
      recordId: normalizedRecordId,
      previousRevisionId: currentRevisionId,
      ownerId: owner.ownerId,
      commandId: owner.commandId,
      operation,
      knowledgeAt: instant,
    });

    const wireRecord = encodeCanonicalValue(record);
    const wireHead = encodeCanonicalValue(head);
    const wireAudit = encodeCanonicalValue(audit);
    await this.#adapter.commitRevision({
      key: headKey(normalizedFamily, normalizedObjectId),
      expectedHeadRecordId: expectedRevisionId,
      record: wireRecord,
      head: wireHead,
      audit: wireAudit,
    });
    return decodeCanonicalValue(wireRecord);
  }

  async head(family, objectId) {
    const wire = await this.#adapter.getHead(headKey(requireText(family, 'family'), requireText(objectId, 'objectId')));
    return wire == null ? null : decodeCanonicalValue(wire);
  }

  async record(recordId) {
    const wire = await this.#adapter.getRecord(requireText(recordId, 'recordId'));
    return wire == null ? null : decodeCanonicalValue(wire);
  }

  async history(family, objectId) {
    const normalizedFamily = requireText(family, 'family');
    const normalizedObjectId = requireText(objectId, 'objectId');
    const all = (await this.#adapter.listRecords()).map(decodeCanonicalValue);
    return Object.freeze(all
      .filter((record) => record.family === normalizedFamily && record.objectId === normalizedObjectId)
      .sort((left, right) => left.revision - right.revision));
  }

  async audit() {
    return Object.freeze((await this.#adapter.listAudit()).map(decodeCanonicalValue));
  }
}

export class OwnerWriteGateway {
  #owners;
  #store;

  constructor({ adapter, owners = new WriteOwnerRegistry() }) {
    this.#owners = owners;
    this.#store = new CanonicalPersistenceStore({ adapter, owners });
  }

  get owners() { return this.#owners; }

  async initialize() { return this.#store.initialize(); }

  registerOwner(spec) { return this.#owners.register(spec); }

  async execute({ ownerId, commandId, family, ...write }) {
    const authorization = this.#owners.authorize({ family, ownerId, commandId });
    return this.#store.commitAuthorized({ authorization, family, ...write });
  }

  async head(family, objectId) { return this.#store.head(family, objectId); }
  async record(recordId) { return this.#store.record(recordId); }
  async history(family, objectId) { return this.#store.history(family, objectId); }
  async audit() { return this.#store.audit(); }
}
