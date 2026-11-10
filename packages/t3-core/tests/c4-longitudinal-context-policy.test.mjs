import test from 'node:test';
import assert from 'node:assert/strict';
import { CanonicalInstant } from '../src/foundation/time.mjs';
import { MemoryCanonicalAdapter, OwnerWriteGateway } from '../src/persistence/canonical-persistence.mjs';
import {
  LongitudinalContextPolicyError,
  LongitudinalContextUniverse,
  evaluateLongitudinalContextEligibility,
  normalizeLongitudinalContextAdmission,
  planLongitudinalContextInvalidation,
} from '../src/modules/base/features/longitudinal/longitudinal-context-policy.mjs';
import {
  LONGITUDINAL_CONTEXT,
  LongitudinalContextOwner,
  isLongitudinalContextRecord,
} from '../src/modules/base/owners/longitudinal-context.mjs';

function admission(overrides = {}) {
  return {
    contextId: 'ctx-1',
    workspaceId: 'w',
    subjectId: 'subject-1',
    scope: { kind: 'process', id: 'process-1' },
    value: { status: 'active' },
    actorId: 'actor-1',
    operationId: 'op-1',
    purpose: 'deliver-case',
    needType: 'case-continuity',
    retentionUntil: '2026-12-31T00:00:00Z',
    authorityRef: 'authority-1',
    permissionRef: 'permission-1',
    sourceHeads: { sourceA: 'a1' },
    dependencyHeads: { processA: 'p1' },
    ...overrides,
  };
}

function normalized(overrides = {}) {
  return normalizeLongitudinalContextAdmission(admission(overrides));
}

function eligibleInput(context) {
  return {
    context,
    now: '2026-06-01T00:00:00Z',
    currentSourceHeads: { sourceA: 'a1' },
    currentDependencyHeads: { processA: 'p1' },
    activeAuthorityRefs: ['authority-1'],
    activePermissionRefs: ['permission-1'],
    purpose: 'deliver-case',
    needType: 'case-continuity',
  };
}

test('C4 durable admission requires accountable actor, job/process, operation, typed need, retention and exact sources', () => {
  const context = normalized();
  assert.equal(context.durableAdmission, true);
  assert.equal(context.sourceTruth, false);
  assert.equal(context.authorityRoot, false);
  assert.throws(() => normalized({ actorId: '' }), (error) => error instanceof LongitudinalContextPolicyError);
  assert.throws(
    () => normalized({ scope: { kind: 'subject', id: 'subject-1' } }),
    (error) => error.code === 'INVALID_LONGITUDINAL_CONTEXT_SCOPE',
  );
  assert.throws(
    () => normalized({ sourceHeads: {} }),
    (error) => error.code === 'MISSING_LONGITUDINAL_CONTEXT_SOURCE',
  );
});

test('C4 current-use eligibility is the fail-closed six-axis conjunction', () => {
  const context = normalized();
  const allowed = evaluateLongitudinalContextEligibility(eligibleInput(context));
  assert.equal(allowed.eligible, true);
  assert.deepEqual(allowed.failedAxes, []);

  const staleSource = evaluateLongitudinalContextEligibility({
    ...eligibleInput(context),
    currentSourceHeads: { sourceA: 'a2' },
  });
  assert.equal(staleSource.eligible, false);
  assert.deepEqual(staleSource.failedAxes, ['source']);

  const staleDependency = evaluateLongitudinalContextEligibility({
    ...eligibleInput(context),
    currentDependencyHeads: { processA: 'p2' },
  });
  assert.equal(staleDependency.eligible, false);
  assert.deepEqual(staleDependency.failedAxes, ['dependencies']);

  const noAuthority = evaluateLongitudinalContextEligibility({
    ...eligibleInput(context),
    activeAuthorityRefs: [],
  });
  assert.deepEqual(noAuthority.failedAxes, ['authority']);

  const wrongNeed = evaluateLongitudinalContextEligibility({
    ...eligibleInput(context),
    needType: 'generic-helpfulness',
  });
  assert.deepEqual(wrongNeed.failedAxes, ['purposeNeed']);

  const expired = evaluateLongitudinalContextEligibility({
    ...eligibleInput(context),
    now: '2026-12-31T00:00:00Z',
  });
  assert.deepEqual(expired.failedAxes, ['retention']);

  const noPermission = evaluateLongitudinalContextEligibility({
    ...eligibleInput(context),
    activePermissionRefs: [],
  });
  assert.deepEqual(noPermission.failedAxes, ['permission']);
});

test('C4 invalidation is derived from exact source/dependency heads and never mutates source truth', () => {
  const first = normalized();
  const second = normalized({ contextId: 'ctx-2', sourceHeads: { sourceB: 'b1' }, dependencyHeads: {} });
  const plan = planLongitudinalContextInvalidation({
    contexts: [first, second],
    currentSourceHeads: { sourceA: 'a2', sourceB: 'b1' },
    currentDependencyHeads: { processA: 'p1' },
  });
  assert.deepEqual(plan.invalidatedContextIds, ['ctx-1']);
  assert.deepEqual(plan.unaffectedContextIds, ['ctx-2']);
  assert.deepEqual(plan.reasons['ctx-1'], ['source:sourceA']);
  assert.equal(plan.revalidationRequired, true);
  assert.equal(plan.sourceTruthMutatedByPlan, false);
});

test('C4 Context Universe exposes only item-by-item eligible purpose-bounded derived views', () => {
  const universe = new LongitudinalContextUniverse();
  universe.register(normalized());
  universe.register(normalized({ contextId: 'ctx-other-purpose', purpose: 'audit-case', needType: 'audit' }));
  universe.register(normalized({ contextId: 'ctx-other-subject', subjectId: 'subject-2' }));

  const view = universe.purposeView({
    workspaceId: 'w',
    subjectId: 'subject-1',
    purpose: 'deliver-case',
    needType: 'case-continuity',
    now: '2026-06-01T00:00:00Z',
    currentSourceHeads: { sourceA: 'a1' },
    currentDependencyHeads: { processA: 'p1' },
    activeAuthorityRefs: ['authority-1'],
    activePermissionRefs: ['permission-1'],
  });

  assert.equal(view.persisted, false);
  assert.equal(view.sourceTruth, false);
  assert.equal(view.authorityRoot, false);
  assert.equal(view.physicalWorkspaceCreated, false);
  assert.deepEqual(view.entries.map((entry) => entry.contextId), ['ctx-1']);
  assert.equal(universe.size, 3);
});

test('C4 derived view expiry cannot delete accumulated persistent context', () => {
  const universe = new LongitudinalContextUniverse();
  universe.register(normalized({ retentionUntil: '2026-06-15T00:00:00Z' }));
  const expiredView = universe.purposeView({
    workspaceId: 'w',
    subjectId: 'subject-1',
    purpose: 'deliver-case',
    needType: 'case-continuity',
    now: '2026-07-01T00:00:00Z',
    currentSourceHeads: { sourceA: 'a1' },
    currentDependencyHeads: { processA: 'p1' },
    activeAuthorityRefs: ['authority-1'],
    activePermissionRefs: ['permission-1'],
  });
  assert.deepEqual(expiredView.entries, []);
  assert.equal(universe.size, 1);
});

test('C4 persistent Job/Process Context uses one derived owner with append-only revision history', async () => {
  const gateway = new OwnerWriteGateway({ adapter: new MemoryCanonicalAdapter() });
  const owner = new LongitudinalContextOwner({ gateway });
  await gateway.initialize();

  const first = await owner.admit({
    ...admission(),
    recordId: 'ctx-1@1',
    knowledgeAt: '2026-06-01T00:00:00Z',
  });
  assert.equal(first.ownerId, LONGITUDINAL_CONTEXT.ownerId);
  assert.equal(first.commandId, LONGITUDINAL_CONTEXT.commands.admit);
  assert.equal(first.headKind, 'derived');
  assert.ok(isLongitudinalContextRecord(first));

  const loaded = await owner.load('w', 'ctx-1');
  assert.equal(loaded.baseRevisionId, first.recordId);
  assert.equal(loaded.context.scope.kind, 'process');
  assert.equal(loaded.context.admission.retentionUntil instanceof CanonicalInstant, true);
  assert.equal(loaded.context.admission.retentionUntil.compare('2026-12-31T00:00:00Z'), 0);
  assert.deepEqual(loaded.dependencyRefs.sourceHeads, { sourceA: 'a1' });
  assert.deepEqual(loaded.dependencyRefs.dependencyHeads, { processA: 'p1' });

  const second = await owner.revise({
    ...admission({ value: { status: 'completed' }, sourceHeads: { sourceA: 'a2' } }),
    recordId: 'ctx-1@2',
    baseRevisionId: first.recordId,
    knowledgeAt: '2026-06-02T00:00:00Z',
  });
  assert.equal(second.commandId, LONGITUDINAL_CONTEXT.commands.revise);
  assert.equal(second.previousRevisionId, first.recordId);

  await assert.rejects(
    owner.revise({
      ...admission(),
      recordId: 'ctx-1@stale',
      baseRevisionId: first.recordId,
      knowledgeAt: '2026-06-03T00:00:00Z',
    }),
    (error) => error?.code === 'REVISION_CONFLICT',
  );

  const tombstone = await owner.release({
    workspaceId: 'w',
    contextId: 'ctx-1',
    recordId: 'ctx-1@3',
    baseRevisionId: second.recordId,
    knowledgeAt: '2026-06-04T00:00:00Z',
  });
  assert.equal(tombstone.commandId, LONGITUDINAL_CONTEXT.commands.release);
  assert.equal(tombstone.operation, 'tombstone');
  assert.equal(await owner.load('w', 'ctx-1'), null);

  const history = await owner.history('w', 'ctx-1');
  assert.deepEqual(history.map((record) => record.recordId), [first.recordId, second.recordId, tombstone.recordId]);
  assert.equal(history[0].knowledgeAt instanceof CanonicalInstant, true);
  const audit = await owner.audit();
  assert.equal(audit.length, 3);
  assert.equal(audit.every((entry) => entry.ownerId === LONGITUDINAL_CONTEXT.ownerId), true);
});

test('C4 persistent context family cannot acquire a second writer', () => {
  const gateway = new OwnerWriteGateway({ adapter: new MemoryCanonicalAdapter() });
  new LongitudinalContextOwner({ gateway });
  assert.throws(
    () => gateway.registerOwner({
      family: LONGITUDINAL_CONTEXT.family,
      ownerId: 'iwxa.workspace.rich-workspace',
      commands: ['workspace.putObject'],
      headKind: 'derived',
    }),
    (error) => error?.code === 'DUPLICATE_WRITE_OWNER',
  );
});


test('C4 derived owner rejects same-owner command supersets', () => {
  const gateway = new OwnerWriteGateway({ adapter: new MemoryCanonicalAdapter() });
  gateway.registerOwner({
    family: LONGITUDINAL_CONTEXT.family,
    ownerId: LONGITUDINAL_CONTEXT.ownerId,
    commands: [
      LONGITUDINAL_CONTEXT.commands.admit,
      LONGITUDINAL_CONTEXT.commands.revise,
      LONGITUDINAL_CONTEXT.commands.release,
      'longitudinal.context.unapproved-extra',
    ],
    headKind: 'derived',
  });
  assert.throws(
    () => new LongitudinalContextOwner({ gateway }),
    /incompatible owner registration/,
  );
});

test('C4 record classification requires exact owner and derived head kind', async () => {
  const gateway = new OwnerWriteGateway({ adapter: new MemoryCanonicalAdapter() });
  const owner = new LongitudinalContextOwner({ gateway });
  await gateway.initialize();
  const record = await owner.admit({
    ...admission(),
    recordId: 'ctx-classify@1',
    knowledgeAt: '2026-06-01T00:00:00Z',
  });
  assert.equal(isLongitudinalContextRecord(record), true);
  assert.equal(isLongitudinalContextRecord({ ...record, ownerId: 'other-owner' }), false);
  assert.equal(isLongitudinalContextRecord({ ...record, headKind: 'source' }), false);
});


test('C4 admission rejects non-canonical values and normalized head collisions', () => {
  assert.throws(
    () => normalized({ value: { score: Number.NaN } }),
    (error) => error instanceof LongitudinalContextPolicyError
      && error.code === 'INVALID_LONGITUDINAL_CONTEXT_VALUE',
  );
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(
    () => normalized({ value: cyclic }),
    (error) => error instanceof LongitudinalContextPolicyError
      && error.code === 'INVALID_LONGITUDINAL_CONTEXT_VALUE',
  );
  assert.throws(
    () => normalized({ sourceHeads: { sourceA: 'a1', ' sourceA ': 'a2' } }),
    (error) => error instanceof LongitudinalContextPolicyError
      && error.code === 'INVALID_LONGITUDINAL_CONTEXT_HEADS',
  );
});

test('C4 admission owns an immutable canonical snapshot of its value', () => {
  const value = { nested: { state: 'before' } };
  const context = normalized({ value });
  value.nested.state = 'after';
  assert.equal(context.value.nested.state, 'before');
  assert.equal(Object.isFrozen(context.value.nested), true);
  assert.throws(() => { context.value.nested.state = 'changed'; }, TypeError);
});
