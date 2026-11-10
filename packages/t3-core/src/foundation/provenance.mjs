import { CanonicalInstant } from './time.mjs';

function requireId(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`);
  return value.trim();
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item, seen);
  } else {
    for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
  }
  return Object.freeze(value);
}

function freezeRecord(record) {
  if (record.payload && typeof record.payload === 'object') deepFreeze(record.payload);
  if (record.actor && typeof record.actor === 'object') deepFreeze(record.actor);
  if (record.sources) Object.freeze(record.sources);
  return Object.freeze(record);
}

export class ProvenanceError extends Error {
  constructor(message, code = 'PROVENANCE_ERROR') { super(message); this.name = 'ProvenanceError'; this.code = code; }
}

export class EvidenceLedger {
  #records = [];
  #byId = new Map();

  appendSource({ id, sourceType, sourceRef, payload, observedAt, actor = null }) {
    return this.#append({
      id,
      kind: 'source',
      sourceType: requireId(sourceType, 'sourceType'),
      sourceRef: requireId(sourceRef, 'sourceRef'),
      payload,
      observedAt: observedAt instanceof CanonicalInstant ? observedAt : CanonicalInstant.parse(observedAt),
      actor,
      sources: [],
    });
  }

  appendDerivation({ id, sources, rule, payload, observedAt, actor = null }) {
    const sourceIds = this.#requireExistingSources(sources);
    return this.#append({
      id,
      kind: 'derivation',
      rule: requireId(rule, 'rule'),
      payload,
      observedAt: observedAt instanceof CanonicalInstant ? observedAt : CanonicalInstant.parse(observedAt),
      actor,
      sources: sourceIds,
    });
  }

  appendCorrection({ id, targetId, replacementPayload, reason, observedAt, actor = null, sources = [] }) {
    const target = this.get(targetId);
    if (target.kind !== 'source' && target.kind !== 'derivation') {
      throw new ProvenanceError(
        'correction target must be an original source or derivation record',
        'INVALID_CORRECTION_TARGET',
      );
    }
    const extraSources = this.#requireExistingSources(sources, { allowEmpty: true });
    return this.#append({
      id,
      kind: 'correction',
      targetId: target.id,
      reason: requireId(reason, 'reason'),
      payload: replacementPayload,
      observedAt: observedAt instanceof CanonicalInstant ? observedAt : CanonicalInstant.parse(observedAt),
      actor,
      sources: Object.freeze([target.id, ...extraSources.filter((sourceId) => sourceId !== target.id)]),
    });
  }

  appendRetraction({ id, targetId, reason, observedAt, actor = null, sources = [] }) {
    const target = this.get(targetId);
    if (target.kind !== 'source' && target.kind !== 'derivation') {
      throw new ProvenanceError(
        'retraction target must be an original source or derivation record',
        'INVALID_RETRACTION_TARGET',
      );
    }
    const extraSources = this.#requireExistingSources(sources, { allowEmpty: true });
    return this.#append({
      id,
      kind: 'retraction',
      targetId: target.id,
      reason: requireId(reason, 'reason'),
      payload: null,
      observedAt: observedAt instanceof CanonicalInstant ? observedAt : CanonicalInstant.parse(observedAt),
      actor,
      sources: Object.freeze([target.id, ...extraSources.filter((sourceId) => sourceId !== target.id)]),
    });
  }

  get(id) {
    const record = this.#byId.get(id);
    if (!record) throw new ProvenanceError(`unknown evidence record: ${id}`, 'UNKNOWN_EVIDENCE_RECORD');
    return record;
  }

  all() { return Object.freeze([...this.#records]); }

  lineage(id) {
    const visited = new Set();
    const ordered = [];
    const visit = (recordId) => {
      if (visited.has(recordId)) return;
      visited.add(recordId);
      const record = this.get(recordId);
      for (const sourceId of record.sources) visit(sourceId);
      ordered.push(record);
    };
    visit(id);
    return Object.freeze(ordered);
  }

  current(targetId) {
    const base = this.get(targetId);
    if (base.kind === 'correction' || base.kind === 'retraction') {
      throw new ProvenanceError('current() requires an original source or derivation record id', 'INVALID_CURRENT_ROOT');
    }
    let selected = base;
    let retracted = false;
    for (const record of this.#records) {
      if (record.targetId !== targetId) continue;
      if (record.kind === 'correction') {
        // Retraction is terminal for the same source/derivation identity. Later
        // evidence remains in history but cannot reactivate that identity.
        if (!retracted) selected = record;
      } else if (record.kind === 'retraction') {
        retracted = true;
      }
    }
    return Object.freeze({
      root: base,
      currentRecord: selected,
      payload: retracted ? null : selected.payload,
      retracted,
      history: Object.freeze(this.#records.filter((record) => record.id === targetId || record.targetId === targetId)),
    });
  }

  #append(input) {
    const id = requireId(input.id, 'id');
    if (this.#byId.has(id)) throw new ProvenanceError(`duplicate evidence id: ${id}`, 'DUPLICATE_EVIDENCE_ID');
    const record = freezeRecord({ ...input, id, sequence: this.#records.length });
    this.#records.push(record);
    this.#byId.set(id, record);
    return record;
  }

  #requireExistingSources(sources, { allowEmpty = false } = {}) {
    if (!Array.isArray(sources)) throw new ProvenanceError('sources must be an array', 'INVALID_DERIVATION_SOURCES');
    if (!allowEmpty && sources.length === 0) {
      throw new ProvenanceError('at least one existing source record is required', 'MISSING_DERIVATION_SOURCE');
    }
    const sourceIds = sources.map((sourceId) => this.get(sourceId).id);
    if (new Set(sourceIds).size !== sourceIds.length) {
      throw new ProvenanceError('sources must not contain duplicate evidence ids', 'DUPLICATE_DERIVATION_SOURCE');
    }
    return Object.freeze(sourceIds);
  }
}
