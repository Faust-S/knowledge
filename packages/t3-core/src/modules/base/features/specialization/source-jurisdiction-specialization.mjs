import { BitemporalFact } from '../../../../foundation/bitemporal.mjs';
import { CanonicalInstant } from '../../../../foundation/time.mjs';

function requireId(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SourceSpecializationError(`${label} must be a non-empty string`, 'INVALID_SPECIALIZATION_ID');
  }
  return value.trim();
}

function instant(value, label) {
  try { return value instanceof CanonicalInstant ? value : CanonicalInstant.parse(value); }
  catch { throw new SourceSpecializationError(`${label} must be a canonical instant`, 'INVALID_SPECIALIZATION_TIME'); }
}

function assertProvenance(evidenceLedger, provenanceId) {
  const id = requireId(provenanceId, 'provenanceId');
  if (!evidenceLedger) return id;
  if (typeof evidenceLedger.get !== 'function') {
    throw new SourceSpecializationError('evidenceLedger must provide get(id)', 'INVALID_EVIDENCE_LEDGER');
  }
  try { evidenceLedger.get(id); }
  catch { throw new SourceSpecializationError(`unknown provenance record: ${id}`, 'UNKNOWN_SPECIALIZATION_PROVENANCE'); }
  return id;
}

export class SourceSpecializationError extends Error {
  constructor(message, code = 'SOURCE_SPECIALIZATION_ERROR') {
    super(message);
    this.name = 'SourceSpecializationError';
    this.code = code;
  }
}

export class JurisdictionRef {
  constructor({ id, scheme, code, parentId = null, label = null }) {
    this.id = requireId(id, 'jurisdiction.id');
    this.scheme = requireId(scheme, 'jurisdiction.scheme');
    this.code = requireId(code, 'jurisdiction.code');
    this.parentId = parentId == null ? null : requireId(parentId, 'jurisdiction.parentId');
    if (this.parentId === this.id) {
      throw new SourceSpecializationError('jurisdiction cannot be its own parent', 'SELF_JURISDICTION_PARENT');
    }
    this.label = label == null ? null : String(label);
    Object.freeze(this);
  }
}

export class SourceSpecializationBinding {
  constructor({
    id,
    sourceId,
    specializationId,
    jurisdictionIds,
    effective,
    knowledge,
    provenanceId,
  }, { evidenceLedger = null } = {}) {
    if (!Array.isArray(jurisdictionIds) || jurisdictionIds.length === 0) {
      throw new SourceSpecializationError('jurisdictionIds must contain at least one explicit jurisdiction', 'MISSING_SPECIALIZATION_JURISDICTION');
    }
    const normalizedJurisdictions = [...new Set(jurisdictionIds.map((value) => requireId(value, 'jurisdictionId')))];
    this.sourceId = requireId(sourceId, 'sourceId');
    this.specializationId = requireId(specializationId, 'specializationId');
    this.jurisdictionIds = Object.freeze(normalizedJurisdictions.sort());
    this.fact = new BitemporalFact({
      id,
      payload: Object.freeze({
        sourceId: this.sourceId,
        specializationId: this.specializationId,
        jurisdictionIds: this.jurisdictionIds,
      }),
      effective,
      knowledge,
      provenanceId: assertProvenance(evidenceLedger, provenanceId),
    });
    Object.freeze(this);
  }
  get id() { return this.fact.id; }
  get provenanceId() { return this.fact.provenanceId; }
  isVisible(query) { return this.fact.isVisible(query); }
}

export class SourceJurisdictionSpecializationIndex {
  #jurisdictions = new Map();
  #bindings = new Map();
  #evidenceLedger;

  constructor({ evidenceLedger = null } = {}) {
    if (evidenceLedger && typeof evidenceLedger.get !== 'function') {
      throw new SourceSpecializationError('evidenceLedger must provide get(id)', 'INVALID_EVIDENCE_LEDGER');
    }
    this.#evidenceLedger = evidenceLedger;
  }

  registerJurisdiction(input) {
    const value = input instanceof JurisdictionRef ? input : new JurisdictionRef(input);
    if (this.#jurisdictions.has(value.id)) {
      throw new SourceSpecializationError(`duplicate jurisdiction: ${value.id}`, 'DUPLICATE_JURISDICTION');
    }
    if (value.parentId && !this.#jurisdictions.has(value.parentId)) {
      throw new SourceSpecializationError(`unknown jurisdiction parent: ${value.parentId}`, 'UNKNOWN_JURISDICTION_PARENT');
    }
    this.#jurisdictions.set(value.id, value);
    return value;
  }

  appendBinding(input) {
    const binding = input instanceof SourceSpecializationBinding
      ? input
      : new SourceSpecializationBinding(input, { evidenceLedger: this.#evidenceLedger });
    for (const jurisdictionId of binding.jurisdictionIds) {
      if (!this.#jurisdictions.has(jurisdictionId)) {
        throw new SourceSpecializationError(`unknown specialization jurisdiction: ${jurisdictionId}`, 'UNKNOWN_SPECIALIZATION_JURISDICTION');
      }
    }
    if (this.#bindings.has(binding.id)) {
      throw new SourceSpecializationError(`duplicate specialization binding: ${binding.id}`, 'DUPLICATE_SPECIALIZATION_BINDING');
    }
    if (this.#evidenceLedger) assertProvenance(this.#evidenceLedger, binding.provenanceId);
    this.#bindings.set(binding.id, binding);
    return binding;
  }

  jurisdiction(id) {
    const value = this.#jurisdictions.get(requireId(id, 'jurisdictionId'));
    if (!value) throw new SourceSpecializationError(`unknown jurisdiction: ${id}`, 'UNKNOWN_JURISDICTION');
    return value;
  }

  jurisdictions() {
    return Object.freeze([...this.#jurisdictions.values()].sort((a, b) => a.scheme.localeCompare(b.scheme) || a.code.localeCompare(b.code) || a.id.localeCompare(b.id)));
  }

  bindingsAt({ effectiveAt, knownAt, sourceId = null, jurisdictionId = null } = {}) {
    const effectivePoint = instant(effectiveAt, 'effectiveAt');
    const knowledgePoint = instant(knownAt, 'knownAt');
    const source = sourceId == null ? null : requireId(sourceId, 'sourceId');
    const jurisdiction = jurisdictionId == null ? null : requireId(jurisdictionId, 'jurisdictionId');
    if (jurisdiction != null && !this.#jurisdictions.has(jurisdiction)) {
      throw new SourceSpecializationError(`unknown jurisdiction: ${jurisdiction}`, 'UNKNOWN_JURISDICTION');
    }
    return Object.freeze(
      [...this.#bindings.values()]
        .filter((binding) => source == null || binding.sourceId === source)
        .filter((binding) => jurisdiction == null || binding.jurisdictionIds.includes(jurisdiction))
        .filter((binding) => binding.isVisible({ effectiveAt: effectivePoint, knownAt: knowledgePoint }))
        .sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.specializationId.localeCompare(b.specializationId) || a.id.localeCompare(b.id)),
    );
  }

  resolveSource({ sourceId, effectiveAt, knownAt }) {
    const source = requireId(sourceId, 'sourceId');
    const bindings = this.bindingsAt({ sourceId: source, effectiveAt, knownAt });
    return Object.freeze({
      sourceId: source,
      candidateCount: bindings.length,
      candidates: bindings,
    });
  }
}
