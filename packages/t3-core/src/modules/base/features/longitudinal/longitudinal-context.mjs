import { BitemporalFact } from '../../../../foundation/bitemporal.mjs';
import { CanonicalInstant } from '../../../../foundation/time.mjs';

function requireId(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LongitudinalContextError(`${label} must be a non-empty string`, 'INVALID_LONGITUDINAL_ID');
  }
  return value.trim();
}

function instant(value, label) {
  try { return value instanceof CanonicalInstant ? value : CanonicalInstant.parse(value); }
  catch { throw new LongitudinalContextError(`${label} must be a canonical instant`, 'INVALID_LONGITUDINAL_TIME'); }
}

function compareObservation(a, b) {
  const effective = a.effective.from.compare(b.effective.from);
  if (effective !== 0) return effective;
  const knowledge = a.knowledge.from.compare(b.knowledge.from);
  if (knowledge !== 0) return knowledge;
  return a.id.localeCompare(b.id);
}

export class LongitudinalContextError extends Error {
  constructor(message, code = 'LONGITUDINAL_CONTEXT_ERROR') {
    super(message);
    this.name = 'LongitudinalContextError';
    this.code = code;
  }
}

export class LongitudinalObservation {
  constructor({
    id,
    subjectId,
    aspect,
    value,
    effective,
    knowledge,
    quality,
    provenanceId,
  }, { evidenceLedger = null } = {}) {
    const normalizedSubjectId = requireId(subjectId, 'subjectId');
    const normalizedAspect = requireId(aspect, 'aspect');
    const normalizedProvenanceId = requireId(provenanceId, 'provenanceId');

    if (evidenceLedger) {
      if (typeof evidenceLedger.get !== 'function') {
        throw new LongitudinalContextError('evidenceLedger must provide get(id)', 'INVALID_EVIDENCE_LEDGER');
      }
      try { evidenceLedger.get(normalizedProvenanceId); }
      catch {
        throw new LongitudinalContextError(
          `unknown provenance record: ${normalizedProvenanceId}`,
          'UNKNOWN_LONGITUDINAL_PROVENANCE',
        );
      }
    }

    this.subjectId = normalizedSubjectId;
    this.aspect = normalizedAspect;
    this.value = value;
    this.fact = new BitemporalFact({
      id,
      payload: Object.freeze({ subjectId: normalizedSubjectId, aspect: normalizedAspect, value }),
      effective,
      knowledge,
      quality,
      provenanceId: normalizedProvenanceId,
    });
    Object.freeze(this);
  }

  get id() { return this.fact.id; }
  get effective() { return this.fact.effective; }
  get knowledge() { return this.fact.knowledge; }
  get quality() { return this.fact.quality; }
  get provenanceId() { return this.fact.provenanceId; }

  isVisible({ effectiveAt, knownAt }) {
    return this.fact.isVisible({ effectiveAt, knownAt });
  }
}

export class LongitudinalContextIndex {
  #observations = [];
  #byId = new Map();
  #evidenceLedger;

  constructor({ evidenceLedger = null } = {}) {
    if (evidenceLedger && typeof evidenceLedger.get !== 'function') {
      throw new LongitudinalContextError('evidenceLedger must provide get(id)', 'INVALID_EVIDENCE_LEDGER');
    }
    this.#evidenceLedger = evidenceLedger;
  }

  append(input) {
    const observation = input instanceof LongitudinalObservation
      ? input
      : new LongitudinalObservation(input, { evidenceLedger: this.#evidenceLedger });

    if (this.#evidenceLedger) {
      try { this.#evidenceLedger.get(observation.provenanceId); }
      catch {
        throw new LongitudinalContextError(
          `unknown provenance record: ${observation.provenanceId}`,
          'UNKNOWN_LONGITUDINAL_PROVENANCE',
        );
      }
    }
    if (this.#byId.has(observation.id)) {
      throw new LongitudinalContextError(`duplicate observation id: ${observation.id}`, 'DUPLICATE_LONGITUDINAL_OBSERVATION');
    }
    this.#observations.push(observation);
    this.#byId.set(observation.id, observation);
    return observation;
  }

  get(id) {
    const observation = this.#byId.get(id);
    if (!observation) throw new LongitudinalContextError(`unknown observation: ${id}`, 'UNKNOWN_LONGITUDINAL_OBSERVATION');
    return observation;
  }

  all() {
    return Object.freeze([...this.#observations].sort(compareObservation));
  }

  timeline({ subjectId, aspect = null, knownAt = null }) {
    const normalizedSubjectId = requireId(subjectId, 'subjectId');
    const normalizedAspect = aspect == null ? null : requireId(aspect, 'aspect');
    const knowledgePoint = knownAt == null ? null : instant(knownAt, 'knownAt');

    return Object.freeze(
      this.#observations
        .filter((observation) => observation.subjectId === normalizedSubjectId)
        .filter((observation) => normalizedAspect == null || observation.aspect === normalizedAspect)
        .filter((observation) => knowledgePoint == null || observation.knowledge.contains(knowledgePoint))
        .sort(compareObservation),
    );
  }

  at({ subjectId, aspect = null, effectiveAt, knownAt }) {
    const normalizedSubjectId = requireId(subjectId, 'subjectId');
    const normalizedAspect = aspect == null ? null : requireId(aspect, 'aspect');
    const effectivePoint = instant(effectiveAt, 'effectiveAt');
    const knowledgePoint = instant(knownAt, 'knownAt');

    return Object.freeze(
      this.#observations
        .filter((observation) => observation.subjectId === normalizedSubjectId)
        .filter((observation) => normalizedAspect == null || observation.aspect === normalizedAspect)
        .filter((observation) => observation.isVisible({ effectiveAt: effectivePoint, knownAt: knowledgePoint }))
        .sort(compareObservation),
    );
  }

  snapshot({ subjectId, effectiveAt, knownAt }) {
    const normalizedSubjectId = requireId(subjectId, 'subjectId');
    const effectivePoint = instant(effectiveAt, 'effectiveAt');
    const knowledgePoint = instant(knownAt, 'knownAt');
    const visible = this.at({
      subjectId: normalizedSubjectId,
      effectiveAt: effectivePoint,
      knownAt: knowledgePoint,
    });

    const grouped = new Map();
    for (const observation of visible) {
      const candidates = grouped.get(observation.aspect) ?? [];
      candidates.push(observation);
      grouped.set(observation.aspect, candidates);
    }

    const aspects = [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([aspect, candidates]) => Object.freeze({
        aspect,
        candidateCount: candidates.length,
        candidates: Object.freeze([...candidates].sort(compareObservation)),
      }));

    return Object.freeze({
      subjectId: normalizedSubjectId,
      effectiveAt: effectivePoint,
      knownAt: knowledgePoint,
      aspects: Object.freeze(aspects),
    });
  }
}
