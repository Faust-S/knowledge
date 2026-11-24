import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildSyntheticOcel2Example, prepareLocalOcel2Discovery, inspectSyntheticOcel2}
  from '../modules/activity-base-anonymizer/ocel2-evidence.mjs';
import {compareRust4pmDiscovery, R4PM_VERSION}
  from '../modules/activity-base-anonymizer/r4pm-comparison.mjs';
import {sha256Canonical} from '../modules/activity-base-anonymizer/engine.mjs';

const script = fileURLToPath(new URL('../tools/activity-ocel-r4pm-review.mjs', import.meta.url));
async function source() { return (await buildSyntheticOcel2Example()).ocel2; }
function call(raw, {env = process.env, args = []} = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    input: typeof raw === 'string' ? raw : JSON.stringify(raw),
    encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 45000, env,
  });
  assert.ifError(result.error);
  assert.equal(result.stderr, '');
  return {code: result.status, value: JSON.parse(result.stdout)};
}
test('projection removes raw identities, labels, attributes and exact dates; preserves shared events', async () => {
  const raw = await source();
  const original = structuredClone(raw);
  const p = await prepareLocalOcel2Discovery(raw);
  assert.deepEqual(raw, original);
  assert.equal(p.shared_event_count, 3);
  assert.equal(p.source_sha256, await sha256Canonical(raw));
  assert.equal(p.projected_sha256, await sha256Canonical(p.ocel2));
  const output = JSON.stringify(p.ocel2);
  for (const value of ['ORDER_PRIVATE', 'RESOURCE_PRIVATE', 'EVENT_PRIVATE', 'person.name',
    'SYNTH_SECRET', 'privateNote', 'registered', 'allocated', 'completed', '2026-01-', 'resource'])
    assert.equal(output.includes(value), false, value);
  assert.equal(p.ocel2.events.filter(e => e.relationships.length === 2).length, 3);
  const route = p.object_views.find(v => v.trace_variants[0].sequence.length === 3);
  assert.equal(route.trace_variants.length, 1);
  assert.equal(route.trace_variants[0].object_trace_count, 3);
  assert.equal(route.trace_variants[0].sequence[1].shared_object_types.length, 1);
  assert.equal(route.trace_variants[0].sequence[1].own_qualifiers.length, 1);
});
test('projection is unchanged when source array and relation order changes', async () => {
  const raw = await source();
  const before = await prepareLocalOcel2Discovery(raw);
  raw.events.reverse(); raw.objects.reverse(); raw.eventTypes.reverse(); raw.objectTypes.reverse();
  for (const event of raw.events) event.relationships.reverse();
  const after = await prepareLocalOcel2Discovery(raw);
  assert.deepEqual(after.ocel2, before.ocel2);
  assert.deepEqual(after.object_views, before.object_views);
  assert.equal(after.projected_sha256, before.projected_sha256);
});
test('object-to-object relationship is preserved, not declared a causal dependency', async () => {
  const raw = await source();
  raw.objects[0].relationships = [{objectId: raw.objects[1].id, qualifier: 'PRIVATE_RELATION'}];
  const p = await prepareLocalOcel2Discovery(raw);
  assert.equal(p.declared_object_link_count, 1);
  assert.equal(p.risk_screen_status, 'HOLD');
  assert.ok(p.reason_codes.includes('O2O_DEPENDENCY_REQUIRES_RISK_REVIEW'));
  assert.equal(p.ocel2.objects.flatMap(o => o.relationships).length, 1);
  assert.doesNotMatch(JSON.stringify(p.ocel2), /PRIVATE_RELATION/);
});
test('equal instants with different precision must not become an ordered trace', async () => {
  const wrapped = await buildSyntheticOcel2Example();
  wrapped.ocel2.events[1].time = wrapped.ocel2.events[0].time.replace('Z', '.000Z');
  wrapped.source_pin.ocel_sha256 = await sha256Canonical(wrapped.ocel2);
  const result = await inspectSyntheticOcel2(wrapped);
  assert.ok(result.reason_codes.includes('AMBIGUOUS_SAME_TIME_OBJECT_EVENTS'));
  await assert.rejects(prepareLocalOcel2Discovery(wrapped.ocel2), {code: 'OCEL_DISCOVERY_AMBIGUOUS_TIME'});
});
test('fractional instant follows integral instant even when lexical order disagrees', async () => {
  const wrapped = await buildSyntheticOcel2Example();
  wrapped.ocel2.events[1].time = wrapped.ocel2.events[0].time.replace('Z', '.100Z');
  wrapped.source_pin.ocel_sha256 = await sha256Canonical(wrapped.ocel2);
  const v = await inspectSyntheticOcel2(wrapped);
  assert.ok(!v.reason_codes.includes('RARE_OBJECT_TRACE_TOPOLOGY'));
  const p = await prepareLocalOcel2Discovery(wrapped.ocel2);
  assert.equal(p.object_views.find(v => v.trace_variants[0].sequence.length === 3).trace_variants.length, 1);
});
test('unobserved object and ambiguous order never fabricate a complete external trace', async () => {
  const raw = await source();
  raw.objects.push({id: 'UNOBSERVED_PRIVATE', type: raw.objects[0].type, attributes: []});
  await assert.rejects(prepareLocalOcel2Discovery(raw), {code: 'OCEL_DISCOVERY_UNOBSERVED_OBJECTS'});
  const tied = await source();
  tied.events[1].time = tied.events[0].time;
  const result = call(tied);
  assert.equal(result.code, 2);
  assert.equal(result.value.code, 'OCEL_DISCOVERY_AMBIGUOUS_TIME');
});
test('external result cannot omit or alter an object type, occurrence, start or counted adjacency', async () => {
  const prepared = await prepareLocalOcel2Discovery(await source());
  const external = {engine: 'r4pm', version: R4PM_VERSION, operation: 'discover_dfg_from_ocel',
    object_type_to_dfg: {}};
  assert.throws(() => compareRust4pmDiscovery(prepared, external), {code: 'OCEL_R4PM_OBJECT_TYPE_MISMATCH'});
  // Deliberately construct a comparison fixture only for negative unit tests.
  // The integration cases below always execute the actual Rust4PM worker.
  for (const view of prepared.object_views) {
    const activities = {}, edges = new Map(), starts = new Set(), ends = new Set();
    for (const variant of view.trace_variants) {
      const seq = variant.sequence.map(row => row.activity_alias);
      starts.add(seq[0]); ends.add(seq.at(-1));
      for (const name of seq) activities[name] = (activities[name] ?? 0) + variant.object_trace_count;
      for (let i = 1; i < seq.length; i++) {
        const key = JSON.stringify([seq[i-1], seq[i]]);
        edges.set(key, (edges.get(key) ?? 0) + variant.object_trace_count);
      }
    }
    external.object_type_to_dfg[view.object_type_alias] = {activities,
      directly_follows_relations: [...edges].map(([key, value]) => [JSON.parse(key), value]),
      start_activities: [...starts], end_activities: [...ends]};
  }
  assert.equal(compareRust4pmDiscovery(prepared, external).status, 'LOCAL_DFG_MATCH');
  const graph = Object.values(external.object_type_to_dfg).find(g => g.directly_follows_relations.length);
  graph.directly_follows_relations[0][1]++;
  assert.throws(() => compareRust4pmDiscovery(prepared, external), {code: 'OCEL_R4PM_DFG_MISMATCH'});
  graph.directly_follows_relations[0][1]--;
  graph.start_activities = [];
  assert.throws(() => compareRust4pmDiscovery(prepared, external), {code: 'OCEL_R4PM_DFG_MISMATCH'});
});
test('actual Rust4PM independently matches the object-centric graph and retains multi-object variants', async () => {
  const result = call(await source());
  assert.equal(result.code, 0, JSON.stringify(result.value));
  assert.equal(result.value.version, R4PM_VERSION);
  assert.equal(result.value.status, 'LOCAL_DFG_MATCH');
  assert.equal(result.value.export_allowed, false);
  assert.equal(result.value.anonymity, 'NOT_ESTABLISHED');
  assert.equal(result.value.shared_event_count, 3);
  const order = result.value.object_views.find(v => v.directly_follows.length === 2);
  assert.deepEqual(order.directly_follows.map(e => e.object_trace_occurrences), [3, 3]);
  assert.equal(order.trace_variants[0].object_trace_count, 3);
  assert.equal(order.activities.length, 3);
});
test('actual Rust4PM preserves repeated operations rather than deduplicating them', async () => {
  const raw = await source();
  raw.events.push({...structuredClone(raw.events[1]), id: 'EXTRA_PRIVATE_EVENT',
    time: raw.events[1].time.replace('12:01:00', '12:01:30')});
  const result = call(raw);
  assert.equal(result.code, 0, JSON.stringify(result.value));
  assert.equal(result.value.risk_screen_status, 'HOLD');
  assert.ok(result.value.object_views.some(v => v.directly_follows.some(
    e => e.from === e.to && e.object_trace_occurrences === 1)));
  assert.ok(result.value.object_views.some(v => v.trace_variants.length === 2));
});
test('missing engine, malformed input and arguments return a typed local HOLD', async () => {
  const missing = call(await source(), {env: {...process.env, IWXA_ACTIVITY_R4PM_PYTHON: 'iwxa-nonexistent-r4pm-python'}});
  assert.equal(missing.code, 2);
  assert.equal(missing.value.code, 'OCEL_R4PM_ENGINE_UNAVAILABLE_OR_FAILED');
  assert.equal(missing.value.export_allowed, false);
  const malformed = call('PRIVATE_MALFORMED');
  assert.equal(malformed.value.code, 'OCEL_R4PM_INVALID_JSON');
  assert.doesNotMatch(JSON.stringify(malformed.value), /PRIVATE_MALFORMED/);
  const argumentsResult = call(await source(), {args: ['PRIVATE_PATH']});
  assert.equal(argumentsResult.value.code, 'OCEL_R4PM_ARGUMENTS_NOT_SUPPORTED');
  assert.doesNotMatch(JSON.stringify(argumentsResult.value), /PRIVATE_PATH/);
});
