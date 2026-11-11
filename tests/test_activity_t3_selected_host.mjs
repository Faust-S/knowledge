import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectSelectedT3Activity, T3ActivityHold} from
  '../modules/activity-base-anonymizer/t3-selected-host.mjs';

const W = 'ws:chosen';
const now = '2026-11-11T10:00:00Z';
const S = 'SYNTHETIC_PRIVATE_PERSON_NOT_TO_COPY';
function sample() {
  const nodes = Array.from({length: 3}, (_, index) => ({
    object_id: `order:${index}`, revision: 2,
    schema_id: 'synthetic.domain.order', schema_version: '1.0.0',
    semantic_kind: 'Process',
  }));
  const events = nodes.flatMap((node, index) => [
    {event_id: `event:${index}:1`, event_type: 'synthetic.started', semantic_kind: 'Event',
      occurred_at: '2026-11-11T10:00:00Z', object_ref: {object_id: node.object_id, revision: 1},
      correlation_id: S},
    {event_id: `event:${index}:2`, event_type: 'synthetic.finished', semantic_kind: 'Event',
      occurred_at: '2026-11-11T10:01:00Z', object_ref: {object_id: node.object_id, revision: 2},
      causation_id: `secret:${S}`},
  ]);
  return {workspace_id: W, nodes, events, relations: [], unresolved: [],
    unmapped: {object_ids: [], event_ids: [], relation_ids: []}};
}
function host(view = sample()) {
  const selection = Object.freeze({workspace_id: W});
  const owner = {workspace_id: W, kind: 'PERSONAL', actor_id: S};
  let called = 0;
  const context = {kernel: {}, currentWorkspace: {
    get: () => selection, subscribe: () => () => {},
  }};
  const signedAccess = {
    currentContext: () => owner, authorize: () => {}, verifyDecisionBinding: () => true,
    actionFor: () => {}, operationDigest: () => {},
  };
  const readActivityFromWorkspaceContext = async () => {
    called += 1; return view;
  };
  return {context, signedAccess, readActivityFromWorkspaceContext,
    bindings: {objects: [], events: []}, getCalls: () => called};
}
const inspect = x => inspectSelectedT3Activity(x);

test('only the existing Host owns the read; returned object uses aliases and no source IDs', async () => {
  const h = host();
  const data = await inspect(h);
  assert.equal(h.getCalls(), 1);
  assert.equal(data.status, 'STRUCTURE_PRESERVED_REVIEW_REQUIRED');
  assert.equal(data.structural_candidate.length, 1);
  assert.equal(data.structural_candidate[0].cohort_band, '3-9');
  assert.equal(data.structural_candidate[0].object_local_successions.length, 1);
  assert.equal(data.structural_candidate[0].object_local_successions[0].cohort_band, '3-9');
  assert.equal(data.export_allowed, false);
  assert.equal(data.iwxa_package, null);
  assert.equal(data.anonymity, 'NOT_ESTABLISHED');
  for (const secret of [S, W, 'synthetic.domain.order', 'synthetic.started', 'synthetic.finished',
    '2026-11-11', 'order:0', 'event:0']) assert.equal(JSON.stringify(data).includes(secret), false, secret);
});

test('source is unchanged and event ordering is independent of input order', async () => {
  const input = sample();
  const before = structuredClone(input);
  const first = await inspect(host(input));
  const reversed = structuredClone(input);
  reversed.nodes.reverse(); reversed.events.reverse();
  const second = await inspect(host(reversed));
  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
});

test('signed Access owner and original T3 reader are mandatory before source read', async () => {
  const h = host(); h.signedAccess = null;
  await assert.rejects(inspect(h), {code: 'T3_SIGNED_ACTIVITY_OWNER_REQUIRED'});
  assert.equal(h.getCalls(), 0);
  const other = host(); other.readActivityFromWorkspaceContext = null;
  await assert.rejects(inspect(other), {code: 'T3_ORIGINAL_D2_READER_REQUIRED'});
  assert.equal(other.getCalls(), 0);
});

test('wrong signed selection cannot invoke T3 reader', async () => {
  const h = host();h.signedAccess.currentContext = () => ({kind: 'CORP', workspace_id: 'ws:other'});
  await assert.rejects(inspect(h), {code: 'T3_SIGNED_CONTEXT_MISMATCH'});
  assert.equal(h.getCalls(), 0);
});

test('source selection changing while Host reads rejects result', async () => {
  const h = host();
  h.context.currentWorkspace.get = () => ({workspace_id: W});
  await assert.rejects(inspect(h), {code: 'T3_SELECTED_CONTEXT_CHANGED_AFTER_READ'});
});

test('Host read refusal never echoes a private exception', async () => {
  const h = host();
  h.readActivityFromWorkspaceContext = async () => {throw Error(S);};
  await assert.rejects(inspect(h), e => e instanceof T3ActivityHold &&
    e.code === 'T3_AUTHORITATIVE_READ_REFUSED' && !e.message.includes(S));
});

test('unmapped and unresolved data block a derived graph', async () => {
  const v = sample();v.unmapped.object_ids.push('SECRET_UNKNOWN_OBJECT');
  let r = await inspect(host(v));
  assert.equal(r.status, 'HOLD');assert.equal(r.structural_candidate, null);
  assert.ok(r.reason_codes.includes('T3_D2_UNMAPPED_SOURCE_RECORD'));
  assert.equal(JSON.stringify(r).includes('SECRET_UNKNOWN_OBJECT'), false);
  const other = sample();other.unresolved.push({source_id: 'object:missing', relation: 'unknown', reason: 'unknown_ref'});
  r = await inspect(host(other));
  assert.ok(r.reason_codes.includes('T3_D2_UNRESOLVED_SOURCE_LINK'));
});

test('missing object ref never creates a fake E2O link or graph', async () => {
  const v = sample();v.events[0].object_ref = null;
  const r = await inspect(host(v));
  assert.equal(r.status, 'HOLD');
  assert.ok(r.reason_codes.includes('T3_D2_EVENT_OBJECT_UNVERIFIED'));
  assert.equal(r.structural_candidate, null);
});

test('tie in timestamps is uncertainty, never a synthetic sequential edge', async () => {
  const v = sample();v.events[1].occurred_at = v.events[0].occurred_at;
  const r = await inspect(host(v));
  assert.equal(r.status, 'HOLD');
  assert.ok(r.reason_codes.includes('T3_D2_OBJECT_EVENT_ORDER_UNKNOWN'));
});

test('rarity of full object-local path gives HOLD despite many events', async () => {
  const v = sample();v.nodes.pop();v.events = v.events.filter(e => e.object_ref.object_id !== 'order:2');
  const r = await inspect(host(v));
  assert.equal(r.status, 'HOLD');
  assert.ok(r.reason_codes.includes('T3_D2_RARE_OBJECT_ROUTE'));
});

test('single object relation is not silently sanitized into an anonymous process', async () => {
  const v = sample();v.relations.push({source_id:'order:0',target_id:'order:1',
    relation:'supplier_of',source_revision:2});
  const r = await inspect(host(v));
  assert.equal(r.status, 'HOLD');
  assert.ok(r.reason_codes.includes('T3_D2_RARE_OBJECT_RELATION'));
  assert.ok(r.reason_codes.includes('T3_D2_RELATION_PRIVACY_REVIEW_REQUIRED'));
  assert.equal(JSON.stringify(r).includes('supplier_of'), false);
});

test('foreign or unsupported source response must be denied', async () => {
  const foreign = sample();foreign.workspace_id = 'ws:foreign';
  await assert.rejects(inspect(host(foreign)), {code: 'T3_SOURCE_WORKSPACE_MISMATCH'});
  const unknown = sample();unknown.new_future_payload = {secret: S};
  await assert.rejects(inspect(host(unknown)), {code: 'T3_D2_SHAPE_UNSUPPORTED'});
});

test('object revision and event reference must be consistent', async () => {
  const v = sample();v.events[0].object_ref.revision = 99;
  await assert.rejects(inspect(host(v)), {code: 'T3_D2_EVENT_REFERENCE_STALE'});
});

test('T3 D2 never proves causal rules, BPMN execution or full OCEL conformance', async () => {
  const r = await inspect(host());
  assert.equal(r.semantic_mapping, 'T0_T1_D2_ONLY_NOT_OCEL2_CONFORMANCE');
  assert.ok(r.structural_candidate[0].object_local_successions.every(x =>
    x.relation === 'OBSERVED_OBJECT_LOCAL_ORDER_NOT_CAUSAL_DEPENDENCY'));
  for (const word of ['BPMN_CONFORMANT', 'DMN_VERIFIED', 'OCEL2_FULLY_CONFORMANT'])
    assert.equal(JSON.stringify(r).includes(word), false);
});