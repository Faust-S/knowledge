import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {
  summarizeT3ProcessIntelligence,
  projectT3ProcessFromOriginalOwner,
} from '../k05_agent06_t3_process.mjs';

// The *real* public T3 owner is checked out on an exact SHA by CI. No copy of
// its process engine, no private checkout, no user business events.
const ownerRoot = process.env.K05_T3_OWNER_ROOT;
assert.ok(ownerRoot, 'T3 pinned public owner root is required');
const folder = join(resolve(ownerRoot), 'src/modules/base/features/project-process');
const originals = await import(pathToFileURL(join(folder, 'project-process.mjs')).href);
const intelligence = await import(pathToFileURL(join(folder, 'process-intelligence.mjs')).href);
const {
  normalizeProcessDefinition, normalizeProcessRun, normalizeCase,
  normalizeActivity, normalizeEvent,
} = originals;
const {deriveProcessIntelligence} = intelligence;

function fixture({untimed=false, provenance=true}={}) {
  const definition = normalizeProcessDefinition({
    workspaceId: 'iwxa-test-workspace', definitionId: 'process-1',
    versionId: 'v1', name: 'Synthetic approved procurement process',
    domainApplicability: ['generic'], activityIds: ['A'],
  });
  const run = normalizeProcessRun({
    workspaceId: 'iwxa-test-workspace', runId: 'run-1',
    definitionId: 'process-1', projectId: 'project-1',
    workId: 'work-1', status: 'running',
  });
  const cases = [normalizeCase({
    workspaceId: 'iwxa-test-workspace', runId: 'run-1',
    projectId: 'project-1', caseId: 'case-1', status: 'done',
  })];
  const activities = [normalizeActivity({
    workspaceId: 'iwxa-test-workspace', runId: 'run-1',
    caseId: 'case-1', activityId: 'step-1', definitionActivityId: 'A',
    status: untimed ? 'planned' : 'done',
    ...(untimed ? {} : {
      startedAt:'2026-11-10T12:00:00Z', finishedAt:'2026-11-10T12:00:03Z',
    }),
  })];
  const events = untimed ? [] : [normalizeEvent({
    workspaceId: 'iwxa-test-workspace', runId: 'run-1',
    caseId: 'case-1', activityId:'step-1', eventId:'event-1',
    eventType:'complete', occurredAt:'2026-11-10T12:00:03Z',
    evidenceRefs: provenance ? ['evidence:synthetic-not-real'] : [],
  })];
  return {definition, run, cases, activities, events};
}

test('K05 invokes pinned original T3 Process Intelligence, never a copied engine', () => {
  const result = projectT3ProcessFromOriginalOwner(deriveProcessIntelligence,fixture());
  assert.equal(result.status,'OWNER_DERIVED_COMPLETE_NOT_OPERATIONAL_TRUTH');
  assert.equal(result.case_count, 1);
  assert.equal(result.event_count, 1);
  assert.equal(result.activity_count, 1);
  assert.equal(result.measured_activity_count, 1);
  assert.equal(result.sum_activity_time_nanoseconds, '3000000000');
  assert.equal(result.sum_activity_time_status, 'DERIVED_ONLY');
  assert.equal(result.process_cycle_time_ms, null);
  assert.equal(result.accepted_result_count, null);
  assert.equal(result.actual_roi_status, 'NOT_MEASURABLE');
  assert.equal(result.original_owner_evidence_readback,'NOT_VERIFIED');
  const exported = JSON.stringify(result);
  for (const privateItem of [
    'iwxa-test-workspace','process-1','run-1','case-1','step-1',
    'evidence:synthetic-not-real',
  ]) assert.equal(exported.includes(privateItem), false);
});

test('T3 untimed source cannot claim complete duration or process improvement', () => {
  const result = projectT3ProcessFromOriginalOwner(
    deriveProcessIntelligence,fixture({untimed:true}));
  assert.equal(result.status,'OWNER_DERIVED_PARTIAL');
  assert.equal(result.missing_activity_time_count,1);
  assert.equal(result.sum_activity_time_nanoseconds,null);
  assert.equal(result.process_cycle_time_ms,null);
});

test('Original T3 owner rejects missing provenance before K05 can project', () => {
  assert.throws(
    () => projectT3ProcessFromOriginalOwner(
      deriveProcessIntelligence, fixture({provenance:false})),
    error => error?.code === 'MISSING_PROCESS_INTELLIGENCE_PROVENANCE',
  );
});

test('K05 rejects forged observed truth, business truth or fake provenance', () => {
  const real = deriveProcessIntelligence(fixture());
  for (const mutated of [
    {...real,sourceTruth:true},
    {...real,operationalTruth:true},
    {...real,observation: {...real.observation,observations:[
      {...real.observation.observations[0],evidenceRefs:[]},
    ]}},
  ]) {
    assert.throws(() => summarizeT3ProcessIntelligence(mutated), /K05_T3_/);
  }
});

test('K05 cannot accept a forged owner duration or inconsistent denominator', () => {
  const real = deriveProcessIntelligence(fixture());
  const corrupted = {...real, metrics:{...real.metrics, activityDurations:[
    {...real.metrics.activityDurations[0],totalNanoseconds: 1n},
  ]}};
  assert.throws(() => summarizeT3ProcessIntelligence(corrupted),
    error => error?.code === 'K05_T3_ACTIVITY_DURATION_INVALID');
  assert.throws(() => summarizeT3ProcessIntelligence({
    ...real, conformance:{...real.conformance,evaluatedCaseCount:2},
  }), /K05_T3_CONFORMANCE_DENOMINATOR_INVALID/);
});

test('K05 requires the original owner derivation port', () => {
  assert.throws(() => projectT3ProcessFromOriginalOwner(null, fixture()),
    /K05_T3_OWNER_DERIVER_REQUIRED/);
});
