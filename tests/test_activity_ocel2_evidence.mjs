import assert from 'node:assert/strict';
import test from 'node:test';
import {buildSyntheticOcel2Example, inspectSyntheticOcel2,
  OCEL2_SYNTHETIC_SCHEMA} from '../modules/activity-base-anonymizer/ocel2-evidence.mjs';
import {sha256Canonical, ActivityHold} from '../modules/activity-base-anonymizer/engine.mjs';
const clone = structuredClone;
async function repin(data) {
  data.source_pin.ocel_sha256 = await sha256Canonical(data.ocel2);
  return data;
}
async function blocked(data, code) {
  await assert.rejects(inspectSyntheticOcel2(data), (e) => e instanceof ActivityHold && e.code === code);
}
async function modify(change) {
  const source = await buildSyntheticOcel2Example();
  change(source);
  return repin(source);
}
test('official four OCEL JSON collections are understood with multiple objects per event', async () => {
  const source = await buildSyntheticOcel2Example();
  assert.deepEqual(Object.keys(source.ocel2).sort(), ['eventTypes', 'events', 'objectTypes', 'objects']);
  const view = await inspectSyntheticOcel2(source);
  assert.equal(view.object_type_count, 2);
  assert.equal(view.event_type_count, 3);
  assert.equal(view.shared_event_count, 3);
  assert.equal(view.object_views.length, 2);
  const ordered = view.object_views.find((x) => x.observed_successions.length === 2);
  const shared = view.object_views.find((x) => x.observed_successions.length === 0);
  assert.ok(ordered && shared);
  assert.equal(ordered.observed_object_count, 3);
  assert.deepEqual(ordered.observed_successions.map((x) => x.object_trace_occurrences), [3, 3]);
  assert.equal(shared.observed_object_count, 3);
  assert.ok(ordered.observed_successions.every(x => x.relation.includes('NOT_CAUSAL_DEPENDENCY')));
});
test('never promises BPMN, DMN, CMMN, W3C PROV, anonymization or IWXA export', async () => {
  const output = await inspectSyntheticOcel2(await buildSyntheticOcel2Example());
  assert.equal(output.status, 'STRUCTURE_PRESERVED_REVIEW_REQUIRED');
  assert.equal(output.export_allowed, false);
  assert.equal(output.iwxa_package, null);
  assert.equal(output.anonymity, 'NOT_ESTABLISHED');
  assert.equal(output.standard_readiness.ocel2, 'JSON_RESTRICTED_PROFILE_PARSED_NOT_FULL_STANDARD_CONFORMANCE');
  for (const name of ['bpmn', 'dmn', 'cmmn', 'prov', 'xes']) {
    assert.match(output.standard_readiness[name], /NOT_|UNKNOWN|NO_|CANDIDATE/);
  }
});
test('structured preview excludes raw IDs, private attributes, source pins and exact times', async () => {
  const source = await buildSyntheticOcel2Example();
  const out = JSON.stringify(await inspectSyntheticOcel2(source));
  for (const leak of ['ORDER_PRIVATE', 'RESOURCE_PRIVATE', 'EVENT_PRIVATE',
    'person.name@example.invalid', 'SYNTH_SECRET_NEVER_TRANSFER',
    'SYNTH_SUBJECT_PRIVATE', 'SYNTH_PRIVATE_SOURCE', 'revision-01',
    '2026-01-', source.source_pin.ocel_sha256, 'registered', 'allocated',
    'completed', 'order', 'resource', 'privateNote']) {
    assert.equal(out.includes(leak), false, leak);
  }
});
test('raw OCEL without synthetic provenance wrapper is refused', async () => {
  const source = await buildSyntheticOcel2Example();
  await blocked(source.ocel2, 'OCEL_ENVELOPE_INVALID');
  source.schema = 'OCEL2/RAW';
  await blocked(source, 'OCEL_SYNTHETIC_ENVELOPE_REQUIRED');
});
test('foreign scope fails without any source snippets', async () => {
  const source = await buildSyntheticOcel2Example();
  source.source_pin.subject_scope = 'FOREIGN_ORGANIZATION_PRIVATE';
  await blocked(source, 'OCEL_FOREIGN_SUBJECT_REJECTED');
});
test('changed source byte fails exact pinned SHA', async () => {
  const source = await buildSyntheticOcel2Example();
  source.ocel2.events[0].attributes[0].value = 'changed';
  await blocked(source, 'OCEL_SOURCE_PIN_DIGEST_MISMATCH');
});
test('timestamp order is checked, equal-time object events cannot fabricate a path', async () => {
  const source = await modify((data) => {
    data.ocel2.events[1].time = data.ocel2.events[0].time;
  });
  const result = await inspectSyntheticOcel2(source);
  assert.equal(result.status, 'HOLD');
  assert.ok(result.reason_codes.includes('AMBIGUOUS_SAME_TIME_OBJECT_EVENTS'));
  const chosen = result.object_views.find((v) => v.observed_successions.length);
  assert.equal(chosen.observed_successions.every((x) => x.object_trace_occurrences === 2), true);
});
test('unknown or dangling object and duplicate event IDs are refused', async () => {
  await blocked(await modify((source) => {source.ocel2.events[0].relationships[0].objectId = 'missing';}),
    'OCEL_E2O_DANGLING_OBJECT');
  await blocked(await modify((source) => {source.ocel2.events[0].id = source.ocel2.events[1].id;}),
    'OCEL_EVENT_ID_OR_TYPE_INVALID');
  await blocked(await modify((source) => {source.ocel2.objects[0].type = 'unregistered';}),
    'OCEL_OBJECT_ID_OR_TYPE_INVALID');
});
test('unsupported arbitrary fields and unknown attribute types hold', async () => {
  await blocked(await modify((source) => {source.ocel2.events[0].access_key = 'secret';}),
    'OCEL_EVENT_SHAPE_INVALID');
  await blocked(await modify((source) => {source.ocel2.eventTypes[0].attributes[0].type = 'javascript';}),
    'OCEL_EVENT_TYPE_INVALID');
  await blocked(await modify((source) => {source.ocel2.events[0].attributes[0].name = 'unregistered';}),
    'OCEL_ATTRIBUTE_TYPE_OR_TIME_INVALID');
});
test('event-to-object qualifier duplicates are blocked, not counted twice', async () => {
  await blocked(await modify((source) => {
    source.ocel2.events[0].relationships.push({objectId: source.ocel2.events[0].relationships[0].objectId,
      qualifier: 'different'});
  }), 'OCEL_E2O_AMBIGUOUS_QUALIFIER');
});
test('object-to-object relationships remain unadmitted dependencies', async () => {
  const source = await modify((data) => {
    data.ocel2.objects[0].relationships = [{objectId: data.ocel2.objects[1].id, qualifier: 'consumes'}];
  });
  const result = await inspectSyntheticOcel2(source);
  assert.equal(result.declared_object_link_count, 1);
  assert.equal(result.status, 'HOLD');
  assert.ok(result.reason_codes.includes('O2O_DEPENDENCY_REQUIRES_RISK_REVIEW'));
  await blocked(await modify((data) => {
    data.ocel2.objects[0].relationships = [{objectId: 'ghost', qualifier: 'links'}];
  }), 'OCEL_O2O_DANGLING_OBJECT');
});
test('rare full object trace stays HOLD despite common event types', async () => {
  const source = await modify((data) => {
    data.ocel2.events.find((e) => e.id === 'EVENT_PRIVATE_2_C').type = 'allocated';
  });
  const result = await inspectSyntheticOcel2(source);
  assert.equal(result.status, 'HOLD');
  assert.ok(result.reason_codes.includes('RARE_OBJECT_TRACE_TOPOLOGY'));
});
test('observed order never changes with input array order, and input is not mutated', async () => {
  const original = await buildSyntheticOcel2Example();
  const before = clone(original);
  const reversed = clone(original);
  reversed.ocel2.objects.reverse();
  reversed.ocel2.events.reverse();
  await repin(reversed);
  assert.deepEqual(await inspectSyntheticOcel2(original), await inspectSyntheticOcel2(reversed));
  assert.deepEqual(original, before);
});
test('restricted parser supports official OCEL 2.0 minimal example shape and JSON text roundtrip', async () => {
  const source = await buildSyntheticOcel2Example();
  source.ocel2 = {
    eventTypes: [{name: 'create-order', attributes: [{name: 'total-items', type: 'integer'}]}],
    objectTypes: [{name: 'order', attributes: [{name: 'item', type: 'integer'}]}],
    events: [{id: 'e1', type: 'create-order', time: '1970-01-01T00:00:00Z',
      attributes: [{name: 'total-items', value: 1}],
      relationships: [{objectId: 'o1', qualifier: 'item'}]}],
    objects: [{id: 'o1', type: 'order',
      attributes: [{name: 'item', time: '1970-01-01T00:00:00Z', value: 1}]}],
  };
  await repin(source);
  const fromObject = await inspectSyntheticOcel2(source);
  const fromJsonText = await inspectSyntheticOcel2(JSON.parse(JSON.stringify(source)));
  assert.deepEqual(fromObject, fromJsonText);
  assert.equal(fromObject.status, 'HOLD');
  assert.equal(fromObject.object_views[0].observed_object_count, 1);
});
test('invalid ISO calendar rollover and unknown OCEL top-level structures fail closed', async () => {
  await blocked(await modify((s) => {s.ocel2.events[0].time = '2026-02-30T12:00:00Z';}),
    'OCEL_EVENT_TIMESTAMP_INVALID');
  await blocked(await modify((s) => {s.ocel2.extension = {secret: 'raw data'};}),
    'OCEL_TOP_LEVEL_UNSUPPORTED');
});