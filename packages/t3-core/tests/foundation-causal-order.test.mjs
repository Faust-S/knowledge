import test from 'node:test';
import assert from 'node:assert/strict';
import { CausalPartialOrder, CausalSemanticError } from '../src/foundation/causal-order.mjs';

function event(id, effectiveTimeRef, knowledgeTimeRef) {
  return { id, effectiveTimeRef, knowledgeTimeRef, metadata: { label: id } };
}

test('timestamps and insertion order do not create causal precedence', () => {
  const order = new CausalPartialOrder();
  order.recordEvent(event('late-known', 'effective:2025-01-01', 'knowledge:2026-09-15'));
  order.recordEvent(event('early-known', 'effective:2026-09-15', 'knowledge:2025-01-01'));
  assert.equal(order.relation('late-known', 'early-known'), 'UNORDERED');
  assert.equal(order.relation('early-known', 'late-known'), 'UNORDERED');
});

test('explicit evidence-backed link establishes partial order', () => {
  const order = new CausalPartialOrder();
  order.recordEvent(event('a', 'eff:a', 'know:a'));
  order.recordEvent(event('b', 'eff:b', 'know:b'));
  order.recordLink({ id: 'link:a:b', causeId: 'a', effectId: 'b', evidenceRef: 'evidence:17' });
  assert.equal(order.relation('a', 'b'), 'BEFORE');
  assert.equal(order.relation('b', 'a'), 'AFTER');
});

test('delayed evidence can add a causal link without rewriting either event', () => {
  const order = new CausalPartialOrder();
  const a = order.recordEvent(event('a', 'eff:a', 'know:a'));
  const b = order.recordEvent(event('b', 'eff:b', 'know:b'));
  assert.equal(order.relation('a', 'b'), 'UNORDERED');
  order.recordLink({ id: 'delayed-proof', causeId: 'a', effectId: 'b', evidenceRef: 'evidence:arrived-later' });
  assert.equal(order.getEvent('a'), a);
  assert.equal(order.getEvent('b'), b);
  assert.equal(order.relation('a', 'b'), 'BEFORE');
});

test('transitive causal precedence is derived only from explicit links', () => {
  const order = new CausalPartialOrder();
  for (const id of ['a', 'b', 'c']) order.recordEvent(event(id, `eff:${id}`, `know:${id}`));
  order.recordLink({ id: 'ab', causeId: 'a', effectId: 'b', evidenceRef: 'e:ab' });
  order.recordLink({ id: 'bc', causeId: 'b', effectId: 'c', evidenceRef: 'e:bc' });
  assert.equal(order.relation('a', 'c'), 'BEFORE');
  assert.deepEqual(order.descendants('a'), ['b', 'c']);
  assert.deepEqual(order.ancestors('c'), ['a', 'b']);
});

test('cycle creation fails closed', () => {
  const order = new CausalPartialOrder();
  for (const id of ['a', 'b', 'c']) order.recordEvent(event(id, `eff:${id}`, `know:${id}`));
  order.recordLink({ id: 'ab', causeId: 'a', effectId: 'b', evidenceRef: 'e:ab' });
  order.recordLink({ id: 'bc', causeId: 'b', effectId: 'c', evidenceRef: 'e:bc' });
  assert.throws(
    () => order.recordLink({ id: 'ca', causeId: 'c', effectId: 'a', evidenceRef: 'e:ca' }),
    (error) => error instanceof CausalSemanticError && error.code === 'CAUSAL_CYCLE',
  );
});

test('snapshot explicitly marks array order as non-authoritative', () => {
  const order = new CausalPartialOrder();
  order.recordEvent(event('a', 'eff:a', 'know:a'));
  const snapshot = order.snapshot();
  assert.equal(snapshot.orderingSemantics, 'PARTIAL_ORDER_ONLY');
  assert.equal(snapshot.arrayOrderAuthoritative, false);
});


test('causal identities are canonicalized and metadata rejects non-plain containers', () => {
  const order = new CausalPartialOrder();
  const eventA = order.recordEvent({ id: '  a  ', effectiveTimeRef: '  eff:a  ', knowledgeTimeRef: '  know:a  ', metadata: {} });
  assert.equal(eventA.id, 'a');
  assert.equal(eventA.effectiveTimeRef, 'eff:a');
  assert.equal(eventA.knowledgeTimeRef, 'know:a');
  assert.throws(
    () => order.recordEvent({ id: 'map', effectiveTimeRef: 'e', knowledgeTimeRef: 'k', metadata: new Map() }),
    (error) => error instanceof CausalSemanticError && error.code === 'INVALID_CAUSAL_METADATA',
  );
});

test('causal metadata cycles are cloned and frozen without recursion failure', () => {
  const metadata = {};
  metadata.self = metadata;
  const order = new CausalPartialOrder();
  const event = order.recordEvent({ id: 'cyclic', effectiveTimeRef: 'e', knowledgeTimeRef: 'k', metadata });
  assert.equal(event.metadata.self, event.metadata);
  assert.equal(Object.isFrozen(event.metadata), true);
});
