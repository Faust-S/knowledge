import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

function requireText(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CheckpointSemanticError(`${label} must be a non-empty string`, 'INVALID_CHECKPOINT_FIELD');
  }
  return value;
}

function sortedRecord(input, label) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new CheckpointSemanticError(`${label} must be an object`, 'INVALID_CHECKPOINT_FIELD');
  }
  return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [requireText(key, `${label} key`), requireText(value, `${label}.${key}`)]));
}

function canonicalize(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CheckpointSemanticError('non-finite numbers are not canonical', 'NON_CANONICAL_CHECKPOINT');
    return JSON.stringify(value);
  }
  if (!value || typeof value !== 'object') {
    throw new CheckpointSemanticError('unsupported canonical checkpoint value', 'NON_CANONICAL_CHECKPOINT');
  }
  if (seen.has(value)) throw new CheckpointSemanticError('checkpoint payload must not contain cycles', 'NON_CANONICAL_CHECKPOINT');
  seen.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item, seen)).join(',')}]`;
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new CheckpointSemanticError('checkpoint payload must contain plain objects only', 'NON_CANONICAL_CHECKPOINT');
    }
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key], seen)}`).join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value) || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function constantTimeHexEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length || left.length % 2 !== 0) return false;
  try {
    return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
  } catch {
    return false;
  }
}

export class CheckpointSemanticError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'CheckpointSemanticError';
    this.code = code;
  }
}

export class HmacSha256CheckpointAuthenticator {
  #key;

  constructor({ keyId, key }) {
    this.keyId = requireText(keyId, 'keyId');
    if (!(typeof key === 'string' || Buffer.isBuffer(key) || ArrayBuffer.isView(key))) {
      throw new CheckpointSemanticError('HMAC key material is required', 'INVALID_CHECKPOINT_AUTHENTICATOR');
    }
    this.#key = Buffer.from(key);
    if (this.#key.length < 16) {
      throw new CheckpointSemanticError('HMAC key must be at least 16 bytes', 'INVALID_CHECKPOINT_AUTHENTICATOR');
    }
    Object.freeze(this);
  }

  signDigest(digest) {
    requireText(digest, 'digest');
    return deepFreeze({
      algorithm: 'HMAC-SHA256',
      keyId: this.keyId,
      tag: createHmac('sha256', this.#key).update(digest).digest('hex'),
    });
  }

  verifyDigest(digest, proof) {
    if (!proof || proof.algorithm !== 'HMAC-SHA256' || proof.keyId !== this.keyId) return false;
    const expected = createHmac('sha256', this.#key).update(digest).digest('hex');
    return constantTimeHexEqual(expected, proof.tag);
  }
}

export function createAuthenticatedCheckpoint({
  id,
  sourceHeads,
  derivedHeads = {},
  previousCheckpointDigest = null,
  authenticator,
}) {
  if (!authenticator || typeof authenticator.signDigest !== 'function') {
    throw new CheckpointSemanticError('checkpoint authenticator required', 'CHECKPOINT_AUTHENTICATOR_REQUIRED');
  }
  const payload = deepFreeze({
    schema: 'IWXA_T2_AUTHENTICATED_CHECKPOINT_V1',
    id: requireText(id, 'checkpoint id'),
    previousCheckpointDigest: previousCheckpointDigest == null ? null : requireText(previousCheckpointDigest, 'previousCheckpointDigest'),
    sourceHeads: sortedRecord(sourceHeads, 'sourceHeads'),
    derivedHeads: sortedRecord(derivedHeads, 'derivedHeads'),
  });
  const digest = sha256(canonicalize(payload));
  const proof = authenticator.signDigest(digest);
  return deepFreeze({ payload, digest, proof });
}

export function verifyAuthenticatedCheckpoint(checkpoint, authenticator) {
  if (!checkpoint || typeof checkpoint !== 'object' || !checkpoint.payload || !checkpoint.proof) {
    throw new CheckpointSemanticError('invalid checkpoint object', 'INVALID_CHECKPOINT');
  }
  const payload = checkpoint.payload;
  const expectedKeys = ['derivedHeads','id','previousCheckpointDigest','schema','sourceHeads'];
  const actualKeys = Object.keys(payload).sort();
  if (
    Object.getPrototypeOf(payload) !== Object.prototype ||
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key,index) => key !== expectedKeys[index]) ||
    payload.schema !== 'IWXA_T2_AUTHENTICATED_CHECKPOINT_V1'
  ) {
    throw new CheckpointSemanticError('checkpoint payload schema is invalid', 'INVALID_CHECKPOINT');
  }
  requireText(payload.id, 'checkpoint id');
  if (payload.previousCheckpointDigest != null) requireText(payload.previousCheckpointDigest, 'previousCheckpointDigest');
  sortedRecord(payload.sourceHeads, 'sourceHeads');
  sortedRecord(payload.derivedHeads, 'derivedHeads');
  if (!authenticator || typeof authenticator.verifyDigest !== 'function') {
    throw new CheckpointSemanticError('checkpoint authenticator required', 'CHECKPOINT_AUTHENTICATOR_REQUIRED');
  }
  const digest = sha256(canonicalize(checkpoint.payload));
  if (!constantTimeHexEqual(digest, checkpoint.digest)) {
    throw new CheckpointSemanticError('checkpoint payload digest mismatch', 'CHECKPOINT_DIGEST_MISMATCH');
  }
  if (!authenticator.verifyDigest(digest, checkpoint.proof)) {
    throw new CheckpointSemanticError('checkpoint authentication failed', 'CHECKPOINT_AUTHENTICATION_FAILED');
  }
  return true;
}

function normalizeDependency(dependency) {
  if (!dependency || typeof dependency !== 'object') {
    throw new CheckpointSemanticError('dependency must be an object', 'INVALID_DEPENDENCY');
  }
  if (dependency.kind === 'source') {
    return deepFreeze({ kind: 'source', id: requireText(dependency.id, 'source dependency id'), headRef: requireText(dependency.headRef, 'source dependency headRef') });
  }
  if (dependency.kind === 'derived') {
    return deepFreeze({ kind: 'derived', id: requireText(dependency.id, 'derived dependency id'), revisionRef: requireText(dependency.revisionRef, 'derived dependency revisionRef') });
  }
  throw new CheckpointSemanticError('dependency kind must be source or derived', 'INVALID_DEPENDENCY');
}

export function sourceDependency(id, headRef) {
  return normalizeDependency({ kind: 'source', id, headRef });
}

export function derivedDependency(id, revisionRef) {
  return normalizeDependency({ kind: 'derived', id, revisionRef });
}

export class IncrementalInvalidationIndex {
  #derived = new Map();

  registerDerived({ id, revisionRef, dependencies }) {
    const derivedId = requireText(id, 'derived id');
    if (this.#derived.has(derivedId)) {
      throw new CheckpointSemanticError(`duplicate derived identity ${derivedId}`, 'DUPLICATE_DERIVED_IDENTITY');
    }
    if (!Array.isArray(dependencies) || dependencies.length === 0) {
      throw new CheckpointSemanticError('derived object requires at least one dependency', 'INVALID_DEPENDENCY');
    }
    const record = deepFreeze({
      id: derivedId,
      revisionRef: requireText(revisionRef, 'revisionRef'),
      dependencies: dependencies.map(normalizeDependency),
    });
    this.#derived.set(derivedId, record);
    return record;
  }

  planFromCheckpoint(checkpoint, nextSourceHeads, authenticator) {
    verifyAuthenticatedCheckpoint(checkpoint, authenticator);
    const nextHeads = sortedRecord(nextSourceHeads, 'nextSourceHeads');
    const priorHeads = checkpoint.payload.sourceHeads;
    const sourceIds = new Set([...Object.keys(priorHeads), ...Object.keys(nextHeads)]);
    const changedSourceIds = [...sourceIds].filter((id) => priorHeads[id] !== nextHeads[id]).sort();
    const invalidated = new Set();

    for (const record of this.#derived.values()) {
      if (record.dependencies.some((dependency) => dependency.kind === 'source' && changedSourceIds.includes(dependency.id))) {
        invalidated.add(record.id);
      }
    }

    let changed = true;
    while (changed) {
      changed = false;
      for (const record of this.#derived.values()) {
        if (invalidated.has(record.id)) continue;
        if (record.dependencies.some((dependency) => dependency.kind === 'derived' && invalidated.has(dependency.id))) {
          invalidated.add(record.id);
          changed = true;
        }
      }
    }

    const invalidatedDerivedIds = [...invalidated].sort();
    const unaffectedDerivedIds = [...this.#derived.keys()].filter((id) => !invalidated.has(id)).sort();
    return deepFreeze({
      fromCheckpointDigest: checkpoint.digest,
      changedSourceIds,
      invalidatedDerivedIds,
      unaffectedDerivedIds,
      sourceHeadsMutatedByPlan: false,
    });
  }
}
