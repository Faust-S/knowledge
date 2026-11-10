import { CanonicalInstant } from './time.mjs';

function instant(value, label) {
  try { return value instanceof CanonicalInstant ? value : CanonicalInstant.parse(value); }
  catch { throw new BitemporalError(`${label} must be a canonical instant`, 'INVALID_TEMPORAL_BOUND'); }
}

export class BitemporalError extends Error {
  constructor(message, code = 'BITEMPORAL_ERROR') { super(message); this.name = 'BitemporalError'; this.code = code; }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item, seen);
  } else {
    for (const child of Object.values(value)) deepFreeze(child, seen);
  }
  return Object.freeze(value);
}

export class TemporalInterval {
  constructor({ from, to = null }) {
    this.from = instant(from, 'from');
    this.to = to == null ? null : instant(to, 'to');
    if (this.to && this.from.compare(this.to) >= 0) throw new BitemporalError('interval requires from < to', 'INVALID_TEMPORAL_INTERVAL');
    Object.freeze(this);
  }
  contains(value) {
    const v = instant(value, 'value');
    return this.from.compare(v) <= 0 && (this.to == null || v.compare(this.to) < 0);
  }
}

const FRESHNESS_STATES = new Set(['fresh', 'stale', 'unknown']);
const UNCERTAINTY_KINDS = new Set(['none', 'estimated', 'conflicting', 'incomplete', 'unknown']);

export class EvidenceQuality {
  constructor({ freshness = 'unknown', uncertainty = 'unknown', observedAt = null, validUntil = null, notes = [] } = {}) {
    if (!FRESHNESS_STATES.has(freshness)) throw new BitemporalError('invalid freshness state', 'INVALID_FRESHNESS');
    if (!UNCERTAINTY_KINDS.has(uncertainty)) throw new BitemporalError('invalid uncertainty kind', 'INVALID_UNCERTAINTY');
    this.freshness = freshness;
    this.uncertainty = uncertainty;
    this.observedAt = observedAt == null ? null : instant(observedAt, 'observedAt');
    this.validUntil = validUntil == null ? null : instant(validUntil, 'validUntil');
    if (this.observedAt && this.validUntil && this.observedAt.compare(this.validUntil) > 0) throw new BitemporalError('observedAt cannot be after validUntil', 'INVALID_FRESHNESS_WINDOW');
    if (!Array.isArray(notes)) throw new BitemporalError('notes must be an array', 'INVALID_EVIDENCE_QUALITY_NOTES');
    this.notes = deepFreeze([...notes]);
    Object.freeze(this);
  }

  evaluateAt(now) {
    const t = instant(now, 'now');
    if (this.validUntil && t.compare(this.validUntil) >= 0) return Object.freeze({ freshness: 'stale', uncertainty: this.uncertainty });
    return Object.freeze({ freshness: this.freshness, uncertainty: this.uncertainty });
  }
}

export class BitemporalFact {
  constructor({ id, payload, effective, knowledge, quality = new EvidenceQuality(), provenanceId = null }) {
    if (typeof id !== 'string' || id.trim() === '') throw new TypeError('id must be a non-empty string');
    this.id = id.trim();
    this.payload = payload && typeof payload === 'object' ? deepFreeze(payload) : payload;
    this.effective = effective instanceof TemporalInterval ? effective : new TemporalInterval(effective);
    this.knowledge = knowledge instanceof TemporalInterval ? knowledge : new TemporalInterval(knowledge);
    this.quality = quality instanceof EvidenceQuality ? quality : new EvidenceQuality(quality);
    this.provenanceId = provenanceId;
    Object.freeze(this);
  }

  isVisible({ effectiveAt, knownAt }) {
    return this.effective.contains(effectiveAt) && this.knowledge.contains(knownAt);
  }
}

export class BitemporalIndex {
  #facts = [];
  append(fact) {
    const value = fact instanceof BitemporalFact ? fact : new BitemporalFact(fact);
    if (this.#facts.some((existing) => existing.id === value.id)) throw new BitemporalError(`duplicate fact id: ${value.id}`, 'DUPLICATE_FACT_ID');
    this.#facts.push(value);
    return value;
  }
  query({ effectiveAt, knownAt }) {
    return Object.freeze(this.#facts.filter((fact) => fact.isVisible({ effectiveAt, knownAt })));
  }
  all() { return Object.freeze([...this.#facts]); }
}
