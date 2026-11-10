import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeActivity,
  normalizeCase,
  normalizeEvent,
  normalizeProcessDefinition,
  normalizeProcessRun,
} from '../src/modules/base/features/project-process/project-process.mjs';
import {
  deriveObjectCentricProcessObservation,
  deriveProcessIntelligence,
} from '../src/modules/base/features/project-process/process-intelligence.mjs';

function fixture() {
  const definition = normalizeProcessDefinition({
    workspaceId: 'w',
    definitionId: 'definition-1',
    versionId: 'v1',
    name: 'Order flow',
    domainApplicability: ['generic'],
    activityIds: ['A', 'B'],
  });
  const run = normalizeProcessRun({
    workspaceId: 'w',
    runId: 'run-1',
    definitionId: 'definition-1',
    projectId: 'project-1',
    workId: 'work-1',
    status: 'running',
  });
  const cases = [
    normalizeCase({ workspaceId: 'w', caseId: 'case-1', projectId: 'project-1', runId: 'run-1', status: 'done' }),
    normalizeCase({ workspaceId: 'w', caseId: 'case-2', projectId: 'project-1', runId: 'run-1', status: 'open' }),
  ];
  const activities = [
    normalizeActivity({ workspaceId: 'w', activityId: 'activity-1', runId: 'run-1', caseId: 'case-1', definitionActivityId: 'A', status: 'done', startedAt: '2026-09-16T00:00:01Z', finishedAt: '2026-09-16T00:00:03Z' }),
    normalizeActivity({ workspaceId: 'w', activityId: 'activity-2', runId: 'run-1', caseId: 'case-1', definitionActivityId: 'B', status: 'done', startedAt: '2026-09-16T00:00:04Z', finishedAt: '2026-09-16T00:00:08Z' }),
    normalizeActivity({ workspaceId: 'w', activityId: 'activity-3', runId: 'run-1', caseId: 'case-2', definitionActivityId: 'B', status: 'done', startedAt: '2026-09-16T00:00:02Z', finishedAt: '2026-09-16T00:00:05Z' }),
  ];
  const events = [
    normalizeEvent({ workspaceId: 'w', eventId: 'event-2', runId: 'run-1', caseId: 'case-1', activityId: 'activity-2', eventType: 'complete', occurredAt: '2026-09-16T00:00:08Z', evidenceRefs: ['evidence:2'] }),
    normalizeEvent({ workspaceId: 'w', eventId: 'event-1', runId: 'run-1', caseId: 'case-1', activityId: 'activity-1', eventType: 'complete', occurredAt: '2026-09-16T00:00:03Z', evidenceRefs: ['evidence:1'] }),
  ];
  return { definition, run, cases, activities, events };
}

test('C3 process observation is object-centric derived projection with non-authoritative time linearization', () => {
  const input = fixture();
  const observation = deriveObjectCentricProcessObservation(input);
  assert.equal(observation.sourceTruth, false);
  assert.equal(observation.derived, true);
  assert.equal(observation.prerequisite, 'COMMON_TIME_PROVENANCE');
  assert.equal(observation.linearizationAuthority, 'NON_AUTHORITATIVE_TIME_THEN_ID');
  assert.deepEqual(observation.observations.map((item) => item.eventId), ['event-1', 'event-2']);
  assert.deepEqual(observation.observations[0].objects.map((item) => item.kind), [
    'processDefinition', 'processRun', 'project', 'work', 'case', 'activity',
  ]);
});

test('C3 process intelligence derives case variants, conformance and exact duration metrics', () => {
  const intelligence = deriveProcessIntelligence(fixture());
  assert.equal(intelligence.sourceTruth, false);
  assert.equal(intelligence.operationalTruth, false);
  assert.equal(intelligence.complete, true);
  assert.equal(intelligence.conformance.evaluatedCaseCount, 2);
  assert.equal(intelligence.conformance.conformantCaseCount, 1);
  assert.equal(intelligence.conformance.nonconformantCaseCount, 1);
  assert.equal(intelligence.variants.length, 2);
  const metricA = intelligence.metrics.activityDurations.find((item) => item.definitionActivityId === 'A');
  assert.equal(metricA.occurrenceCount, 1);
  assert.equal(metricA.measuredCount, 1);
  assert.equal(metricA.totalNanoseconds, 2_000_000_000n);
  assert.equal(metricA.minNanoseconds, 2_000_000_000n);
  assert.equal(metricA.maxNanoseconds, 2_000_000_000n);
});

test('C3 process intelligence exposes unresolved object references instead of inventing joins', () => {
  const input = fixture();
  input.events.push(normalizeEvent({
    workspaceId: 'w',
    eventId: 'event-3',
    runId: 'run-1',
    caseId: 'missing-case',
    eventType: 'note',
    occurredAt: '2026-09-16T00:00:09Z',
    evidenceRefs: ['evidence:3'],
  }));
  const intelligence = deriveProcessIntelligence(input);
  assert.equal(intelligence.complete, false);
  assert.deepEqual(intelligence.observation.unresolvedRefs, ['case:missing-case']);
});

test('C3 process intelligence fails closed without explicit event provenance', () => {
  const input = fixture();
  const bad = { ...input.events[0], evidenceRefs: [] };
  assert.throws(
    () => deriveProcessIntelligence({ ...input, events: [bad] }),
    (error) => error?.code === 'MISSING_PROCESS_INTELLIGENCE_PROVENANCE',
  );
});

test('C3 process intelligence rejects cross-Workspace and foreign-run source objects', () => {
  const input = fixture();
  assert.throws(
    () => deriveProcessIntelligence({ ...input, cases: [{ ...input.cases[0], workspaceId: 'other' }] }),
    (error) => error?.code === 'CROSS_WORKSPACE_PROJECT_PROCESS_RELATION',
  );
  assert.throws(
    () => deriveProcessIntelligence({ ...input, activities: [{ ...input.activities[0], runId: 'other-run' }] }),
    (error) => error?.code === 'PROCESS_INTELLIGENCE_RUN_MISMATCH',
  );
});

test('C3 missing activity timing makes case conformance unevaluable instead of guessing order', () => {
  const input = fixture();
  const untimed = normalizeActivity({
    workspaceId: 'w',
    activityId: 'activity-untimed',
    runId: 'run-1',
    caseId: 'case-1',
    definitionActivityId: 'A',
    status: 'planned',
  });
  const intelligence = deriveProcessIntelligence({
    ...input,
    cases: [input.cases[0]],
    activities: [untimed, input.activities[1]],
    events: [],
  });
  assert.equal(intelligence.conformance.unevaluableCaseCount, 1);
  assert.equal(intelligence.conformance.cases[0].conformant, null);
  assert.deepEqual(intelligence.conformance.cases[0].unresolvedActivityIds, ['activity-untimed']);
});
