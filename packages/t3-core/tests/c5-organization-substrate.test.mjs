import test from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceLedger } from '../src/foundation/provenance.mjs';
import {
  OrganizationSubstrate,
  OrganizationSubstrateError,
} from '../src/modules/base/features/organization/organization-substrate.mjs';

function evidence() {
  const ledger = new EvidenceLedger();
  ledger.appendSource({ id: 'src-org', sourceType: 'fixture', sourceRef: 'org', payload: {}, observedAt: '2026-01-01T00:00:00Z' });
  ledger.appendSource({ id: 'src-role', sourceType: 'fixture', sourceRef: 'role', payload: {}, observedAt: '2026-01-02T00:00:00Z' });
  ledger.appendSource({ id: 'src-change', sourceType: 'fixture', sourceRef: 'change', payload: {}, observedAt: '2026-04-01T00:00:00Z' });
  return ledger;
}

function interval(from = '2026-01-01T00:00:00Z', to = null) {
  return { from, to };
}

function build() {
  const substrate = new OrganizationSubstrate({ evidenceLedger: evidence() });
  substrate.registerUnit({ id: 'org-root', kind: 'organization', label: 'Root' });
  substrate.registerUnit({ id: 'unit-a', kind: 'unit', label: 'A' });
  substrate.registerUnit({ id: 'unit-b', kind: 'unit', label: 'B' });
  return substrate;
}

test('C5 represents organization topology explicitly without turning it into authority', () => {
  const substrate = build();
  substrate.appendRelation({
    id: 'rel-a', fromUnitId: 'org-root', toUnitId: 'unit-a', kind: 'contains',
    effective: interval(), knowledge: interval(), provenanceId: 'src-org',
  });
  substrate.appendRelation({
    id: 'rel-b', fromUnitId: 'org-root', toUnitId: 'unit-b', kind: 'contains',
    effective: interval(), knowledge: interval(), provenanceId: 'src-org',
  });

  const relations = substrate.relationsAt({ effectiveAt: '2026-02-01T00:00:00Z', knownAt: '2026-02-01T00:00:00Z' });
  assert.deepEqual(relations.map((item) => item.toUnitId), ['unit-a', 'unit-b']);
  assert.equal('authority' in relations[0], false);
  assert.equal('permissions' in relations[0], false);
});

test('C5 role assignments are scoped and bitemporal instead of implicit global membership', () => {
  const substrate = build();
  substrate.appendAssignment({
    id: 'assign-a', subjectId: 'person-1', unitId: 'unit-a', roleId: 'reviewer',
    effective: interval(), knowledge: interval('2026-01-01T00:00:00Z', '2026-04-01T00:00:00Z'), provenanceId: 'src-role',
  });
  substrate.appendAssignment({
    id: 'assign-b', subjectId: 'person-1', unitId: 'unit-b', roleId: 'reviewer',
    effective: interval(), knowledge: interval('2026-04-01T00:00:00Z'), provenanceId: 'src-change',
  });

  assert.deepEqual(
    substrate.assignmentsAt({ subjectId: 'person-1', effectiveAt: '2026-02-01T00:00:00Z', knownAt: '2026-03-01T00:00:00Z' }).map((item) => item.unitId),
    ['unit-a'],
  );
  assert.deepEqual(
    substrate.assignmentsAt({ subjectId: 'person-1', effectiveAt: '2026-02-01T00:00:00Z', knownAt: '2026-05-01T00:00:00Z' }).map((item) => item.unitId),
    ['unit-b'],
  );
});

test('C5 subject context exposes only explicit active assignments and their units', () => {
  const substrate = build();
  substrate.appendAssignment({
    id: 'assign-a', subjectId: 'person-1', unitId: 'unit-a', roleId: 'operator',
    effective: interval(), knowledge: interval(), provenanceId: 'src-role',
  });
  substrate.appendAssignment({
    id: 'assign-other', subjectId: 'person-2', unitId: 'unit-b', roleId: 'operator',
    effective: interval(), knowledge: interval(), provenanceId: 'src-role',
  });

  const context = substrate.contextForSubject({ subjectId: 'person-1', effectiveAt: '2026-02-01T00:00:00Z', knownAt: '2026-02-01T00:00:00Z' });
  assert.deepEqual(context.assignments.map((item) => item.id), ['assign-a']);
  assert.deepEqual(context.units.map((item) => item.id), ['unit-a']);
});

test('C5 fails closed on unknown units, provenance and duplicate records', () => {
  const substrate = build();
  assert.throws(
    () => substrate.appendRelation({ id: 'bad-rel', fromUnitId: 'org-root', toUnitId: 'missing', kind: 'contains', effective: interval(), knowledge: interval(), provenanceId: 'src-org' }),
    (error) => error instanceof OrganizationSubstrateError && error.code === 'UNKNOWN_ORGANIZATION_RELATION_ENDPOINT',
  );
  assert.throws(
    () => substrate.appendAssignment({ id: 'bad-prov', subjectId: 'person-1', unitId: 'unit-a', roleId: 'operator', effective: interval(), knowledge: interval(), provenanceId: 'missing' }),
    (error) => error instanceof OrganizationSubstrateError && error.code === 'UNKNOWN_ORGANIZATION_PROVENANCE',
  );

  substrate.appendAssignment({ id: 'assign-a', subjectId: 'person-1', unitId: 'unit-a', roleId: 'operator', effective: interval(), knowledge: interval(), provenanceId: 'src-role' });
  assert.throws(
    () => substrate.appendAssignment({ id: 'assign-a', subjectId: 'person-1', unitId: 'unit-a', roleId: 'operator', effective: interval(), knowledge: interval(), provenanceId: 'src-role' }),
    (error) => error instanceof OrganizationSubstrateError && error.code === 'DUPLICATE_ORGANIZATION_ASSIGNMENT',
  );
});
