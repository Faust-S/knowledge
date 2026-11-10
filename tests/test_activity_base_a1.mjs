import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeSnapshot, buildSyntheticExample, sha256Canonical, ActivityHold,
  A0_SCHEMA, A1_SCHEMA} from '../modules/activity-base-anonymizer/engine.mjs';

async function refuses(input, expected) {
  await assert.rejects(analyzeSnapshot(input), (err) => err instanceof ActivityHold && err.code === expected);
}
const clone = (x) => structuredClone(x);
async function repin(snapshot) {
  for (const pin of snapshot.source_versions) {
    const items = snapshot.events.filter((e) => e.source_id === pin.source_id && e.source_revision === pin.revision);
    pin.events_sha256 = await sha256Canonical(items.sort((a, b) => a.event_id.localeCompare(b.event_id, 'en')));
  }
  return snapshot;
}

test('A1 synthesizes two process types, three roles, and five distinct states', async () => {
  const {preview} = await analyzeSnapshot(await buildSyntheticExample());
  assert.equal(preview.processes.length, 2);
  assert.equal(preview.role_count, 3);
  assert.deepEqual(preview.processes.map((p) => p.states.length), [5, 4]);
  assert.deepEqual(preview.processes.map((p) => p.observed_successions.length), [4, 3]);
  assert.ok(preview.processes.every((p) => p.trace_count === 3));
  assert.ok(preview.processes.every((p) => p.observed_successions.every((e) => e.trace_occurrences === 3)));
});

test('source pins produce exact internal lineage and never claim host attestation', async () => {
  const input = await buildSyntheticExample();
  const {preview, internalEvidence} = await analyzeSnapshot(input);
  assert.equal(preview.source_pin_count, 1);
  assert.equal(internalEvidence.length, input.events.length);
  assert.ok(internalEvidence.every((e) => e.source_id === input.source_versions[0].source_id && e.revision === input.source_versions[0].revision));
  assert.equal(preview.provenance_verification, 'SYNTHETIC_DIGEST_MATCH_NOT_AUTHORITY');
  assert.equal(preview.anonymous, false);
  assert.equal(preview.export_allowed, false);
  assert.equal(preview.iwxa_package, null);
});

test('preview excludes synthetic identifiers, payload, dates, raw roles and hashes', async () => {
  const input = await buildSyntheticExample();
  const {preview} = await analyzeSnapshot(input);
  const output = JSON.stringify(preview);
  for (const secret of ['RARE_SYNTHETIC_ACTOR_Z9', 'private@example.invalid',
    'SYNTHETIC_TOKEN_NEVER_RELEASE', 'synthetic_subject_a', 'synthetic_source_001',
    'synthetic_revision_001', 'fulfilment_case_1', 'reviewer', 'worker', 'approved',
    input.source_versions[0].events_sha256]) {
    assert.equal(output.includes(secret), false, secret);
  }
});

test('same verified graph is independent of source event order', async () => {
  const source = await buildSyntheticExample();
  const reversed = clone(source);
  reversed.events.reverse();
  const [left, right] = await Promise.all([analyzeSnapshot(source), analyzeSnapshot(reversed)]);
  assert.deepEqual(left.preview, right.preview);
});

test('analysis does not modify input, including original secrets', async () => {
  const input = await buildSyntheticExample();
  const before = clone(input);
  await analyzeSnapshot(input);
  assert.deepEqual(input, before);
});

test('tampered event bytes violate pinned revision', async () => {
  const input = await buildSyntheticExample();
  input.events[0].payload.secret = 'MUTATED';
  await refuses(input, 'SOURCE_PIN_DIGEST_MISMATCH');
});

test('modified role or status invalidates source pin', async () => {
  const input = await buildSyntheticExample();
  input.events[0].role_binding = 'surprise-role';
  await refuses(input, 'SOURCE_PIN_DIGEST_MISMATCH');
});

test('missing source ref or pin is rejected', async () => {
  const input = await buildSyntheticExample();
  input.events[0].source_id = 'no-source';
  await refuses(input, 'EVENT_SOURCE_UNPINNED');
});

test('source pin must belong to selected subject', async () => {
  const input = await buildSyntheticExample();
  input.source_versions[0].subject_scope = 'synthetic_subject_b';
  await refuses(input, 'SOURCE_SUBJECT_MISMATCH');
});

test('event source must belong to selected subject even if pin updated', async () => {
  const input = await buildSyntheticExample();
  input.events[0].subject_scope = 'synthetic_subject_b';
  await refuses(input, 'SUBJECT_SCOPE_VIOLATION');
});

test('same event cannot be included in multiple traces', async () => {
  const input = await buildSyntheticExample();
  input.events[1].event_id = input.events[0].event_id;
  await refuses(input, 'EVENT_ID_MISSING_OR_DUPLICATE');
});

test('unobserved stage remains unverified and does not create shortcut edge', async () => {
  const input = await buildSyntheticExample();
  for (const event of input.events) if (event.process_binding === 'fulfilment' && event.ordinal === 3) {
    event.status = 'inferred';
  }
  await repin(input);
  const {preview} = await analyzeSnapshot(input);
  assert.equal(preview.unverified_event_count, 3);
  assert.equal(preview.processes[0].states.length, 4);
  assert.equal(preview.processes[0].observed_successions.length, 2);
  assert.ok(preview.processes[0].observed_successions.every((e) => e.trace_occurrences === 3));
});

test('all-inferred input refuses to hallucinate completed activity', async () => {
  const input = await buildSyntheticExample();
  input.events.forEach((e) => { e.status = 'inferred'; });
  await repin(input);
  await refuses(input, 'NO_OBSERVED_STAGES');
});

test('case sequence with gap or duplicate cannot be repaired by guess', async () => {
  const input = await buildSyntheticExample();
  input.events[0].ordinal = 19;
  await repin(input);
  await refuses(input, 'CASE_SEQUENCE_GAP_OR_DUPLICATE');
});

test('live schemas, real data and invalid claims cannot be passed through demo adapter', async () => {
  const input = await buildSyntheticExample();
  input.schema = 'T3_READ_SNAPSHOT/0.1';
  await refuses(input, 'UNSUPPORTED_OR_NON_SYNTHETIC_INPUT');
});

test('A0 compatibility supports existing synthetic fixture without source pins', async () => {
  const input = await buildSyntheticExample();
  input.schema = A0_SCHEMA;
  delete input.source_versions;
  const {preview} = await analyzeSnapshot(input);
  assert.equal(preview.stage, 'A0_SYNTHETIC_BASELINE');
  assert.equal(preview.source_pin_count, 0);
  assert.equal(preview.processes.length, 2);
});

test('duplicate pins and unused pins are refused', async () => {
  const input = await buildSyntheticExample();
  input.source_versions.push(clone(input.source_versions[0]));
  await refuses(input, 'SOURCE_PIN_DUPLICATE');
  input.source_versions[1].revision = 'extra_unused';
  await refuses(input, 'SOURCE_PIN_NOT_USED');
});

test('A1 uses no globals for network and no generated package', async () => {
  const result = await analyzeSnapshot(await buildSyntheticExample());
  assert.equal(result.preview.iwxa_package, null);
  assert.equal(typeof result.preview.export_allowed, 'boolean');
  assert.equal(result.preview.export_allowed, false);
  assert.equal(A1_SCHEMA, 'IWXA_SYNTHETIC_A1_SNAPSHOT/0.1');
});