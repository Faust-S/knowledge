import { BitemporalFact } from '../../../../foundation/bitemporal.mjs';
import { CanonicalInstant } from '../../../../foundation/time.mjs';

function requireId(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new OrganizationSubstrateError(`${label} must be a non-empty string`, 'INVALID_ORGANIZATION_ID');
  }
  return value.trim();
}

function instant(value, label) {
  try { return value instanceof CanonicalInstant ? value : CanonicalInstant.parse(value); }
  catch { throw new OrganizationSubstrateError(`${label} must be a canonical instant`, 'INVALID_ORGANIZATION_TIME'); }
}

function assertProvenance(evidenceLedger, provenanceId) {
  const id = requireId(provenanceId, 'provenanceId');
  if (!evidenceLedger) return id;
  if (typeof evidenceLedger.get !== 'function') {
    throw new OrganizationSubstrateError('evidenceLedger must provide get(id)', 'INVALID_EVIDENCE_LEDGER');
  }
  try { evidenceLedger.get(id); }
  catch { throw new OrganizationSubstrateError(`unknown provenance record: ${id}`, 'UNKNOWN_ORGANIZATION_PROVENANCE'); }
  return id;
}

export class OrganizationSubstrateError extends Error {
  constructor(message, code = 'ORGANIZATION_SUBSTRATE_ERROR') {
    super(message);
    this.name = 'OrganizationSubstrateError';
    this.code = code;
  }
}

export class OrganizationUnit {
  constructor({ id, kind, label = null }) {
    this.id = requireId(id, 'unit.id');
    this.kind = requireId(kind, 'unit.kind');
    this.label = label == null ? null : String(label);
    Object.freeze(this);
  }
}

export class OrganizationRelation {
  constructor({ id, fromUnitId, toUnitId, kind, effective, knowledge, provenanceId }, { evidenceLedger = null } = {}) {
    const from = requireId(fromUnitId, 'fromUnitId');
    const to = requireId(toUnitId, 'toUnitId');
    if (from === to) throw new OrganizationSubstrateError('organization relation cannot target the same unit', 'SELF_ORGANIZATION_RELATION');
    this.fromUnitId = from;
    this.toUnitId = to;
    this.kind = requireId(kind, 'relation.kind');
    this.fact = new BitemporalFact({
      id,
      payload: Object.freeze({ fromUnitId: from, toUnitId: to, kind: this.kind }),
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

export class OrganizationAssignment {
  constructor({ id, subjectId, unitId, roleId, effective, knowledge, provenanceId }, { evidenceLedger = null } = {}) {
    this.subjectId = requireId(subjectId, 'subjectId');
    this.unitId = requireId(unitId, 'unitId');
    this.roleId = requireId(roleId, 'roleId');
    this.fact = new BitemporalFact({
      id,
      payload: Object.freeze({ subjectId: this.subjectId, unitId: this.unitId, roleId: this.roleId }),
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

export class OrganizationSubstrate {
  #units = new Map();
  #relations = new Map();
  #assignments = new Map();
  #evidenceLedger;

  constructor({ evidenceLedger = null } = {}) {
    if (evidenceLedger && typeof evidenceLedger.get !== 'function') {
      throw new OrganizationSubstrateError('evidenceLedger must provide get(id)', 'INVALID_EVIDENCE_LEDGER');
    }
    this.#evidenceLedger = evidenceLedger;
  }

  registerUnit(input) {
    const unit = input instanceof OrganizationUnit ? input : new OrganizationUnit(input);
    if (this.#units.has(unit.id)) throw new OrganizationSubstrateError(`duplicate organization unit: ${unit.id}`, 'DUPLICATE_ORGANIZATION_UNIT');
    this.#units.set(unit.id, unit);
    return unit;
  }

  appendRelation(input) {
    const relation = input instanceof OrganizationRelation
      ? input
      : new OrganizationRelation(input, { evidenceLedger: this.#evidenceLedger });
    if (!this.#units.has(relation.fromUnitId) || !this.#units.has(relation.toUnitId)) {
      throw new OrganizationSubstrateError('organization relation endpoints must already exist', 'UNKNOWN_ORGANIZATION_RELATION_ENDPOINT');
    }
    if (this.#relations.has(relation.id)) throw new OrganizationSubstrateError(`duplicate organization relation: ${relation.id}`, 'DUPLICATE_ORGANIZATION_RELATION');
    if (this.#evidenceLedger) assertProvenance(this.#evidenceLedger, relation.provenanceId);
    this.#relations.set(relation.id, relation);
    return relation;
  }

  appendAssignment(input) {
    const assignment = input instanceof OrganizationAssignment
      ? input
      : new OrganizationAssignment(input, { evidenceLedger: this.#evidenceLedger });
    if (!this.#units.has(assignment.unitId)) {
      throw new OrganizationSubstrateError(`unknown assignment unit: ${assignment.unitId}`, 'UNKNOWN_ORGANIZATION_ASSIGNMENT_UNIT');
    }
    if (this.#assignments.has(assignment.id)) throw new OrganizationSubstrateError(`duplicate organization assignment: ${assignment.id}`, 'DUPLICATE_ORGANIZATION_ASSIGNMENT');
    if (this.#evidenceLedger) assertProvenance(this.#evidenceLedger, assignment.provenanceId);
    this.#assignments.set(assignment.id, assignment);
    return assignment;
  }

  unit(id) {
    const value = this.#units.get(requireId(id, 'unitId'));
    if (!value) throw new OrganizationSubstrateError(`unknown organization unit: ${id}`, 'UNKNOWN_ORGANIZATION_UNIT');
    return value;
  }

  units() {
    return Object.freeze([...this.#units.values()].sort((a, b) => a.id.localeCompare(b.id)));
  }

  relationsAt({ effectiveAt, knownAt, kind = null } = {}) {
    const effectivePoint = instant(effectiveAt, 'effectiveAt');
    const knowledgePoint = instant(knownAt, 'knownAt');
    const normalizedKind = kind == null ? null : requireId(kind, 'kind');
    return Object.freeze(
      [...this.#relations.values()]
        .filter((relation) => normalizedKind == null || relation.kind === normalizedKind)
        .filter((relation) => relation.isVisible({ effectiveAt: effectivePoint, knownAt: knowledgePoint }))
        .sort((a, b) => a.kind.localeCompare(b.kind) || a.fromUnitId.localeCompare(b.fromUnitId) || a.toUnitId.localeCompare(b.toUnitId) || a.id.localeCompare(b.id)),
    );
  }

  assignmentsAt({ effectiveAt, knownAt, subjectId = null, unitId = null, roleId = null } = {}) {
    const effectivePoint = instant(effectiveAt, 'effectiveAt');
    const knowledgePoint = instant(knownAt, 'knownAt');
    const subject = subjectId == null ? null : requireId(subjectId, 'subjectId');
    const unit = unitId == null ? null : requireId(unitId, 'unitId');
    const role = roleId == null ? null : requireId(roleId, 'roleId');
    return Object.freeze(
      [...this.#assignments.values()]
        .filter((assignment) => subject == null || assignment.subjectId === subject)
        .filter((assignment) => unit == null || assignment.unitId === unit)
        .filter((assignment) => role == null || assignment.roleId === role)
        .filter((assignment) => assignment.isVisible({ effectiveAt: effectivePoint, knownAt: knowledgePoint }))
        .sort((a, b) => a.unitId.localeCompare(b.unitId) || a.roleId.localeCompare(b.roleId) || a.subjectId.localeCompare(b.subjectId) || a.id.localeCompare(b.id)),
    );
  }

  contextForSubject({ subjectId, effectiveAt, knownAt }) {
    const subject = requireId(subjectId, 'subjectId');
    const assignments = this.assignmentsAt({ subjectId: subject, effectiveAt, knownAt });
    const unitIds = [...new Set(assignments.map((assignment) => assignment.unitId))].sort();
    return Object.freeze({
      subjectId: subject,
      assignments,
      units: Object.freeze(unitIds.map((id) => this.unit(id))),
    });
  }
}
