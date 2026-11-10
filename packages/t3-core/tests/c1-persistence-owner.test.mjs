import test from 'node:test';
import assert from 'node:assert/strict';
import { ExactDecimal } from '../src/foundation/exact-decimal.mjs';
import { ExactMoney, ExactQuantity } from '../src/foundation/quantity-money.mjs';
import { CanonicalInstant } from '../src/foundation/time.mjs';
import { BitemporalFact, EvidenceQuality, TemporalInterval } from '../src/foundation/bitemporal.mjs';
import { CausalEvent, CausalLink } from '../src/foundation/causal-order.mjs';
import {
  canonicalParse,
  canonicalStringify,
  CanonicalPersistenceError,
  MemoryCanonicalAdapter,
  OwnerWriteGateway,
} from '../src/persistence/index.mjs';

test('canonical codec round-trips exact and semantic foundation values', () => {
  const value = {
    decimal: ExactDecimal.parse('10.250'),
    quantity: new ExactQuantity('12.5', 'kg'),
    money: new ExactMoney('19.99', 'USD'),
    instant: new CanonicalInstant(1234567890123456789n),
    fact: new BitemporalFact({
      id: 'fact-1',
      payload: { exact: ExactDecimal.parse('0.125') },
      effective: new TemporalInterval({ from: new CanonicalInstant(10n), to: new CanonicalInstant(20n) }),
      knowledge: new TemporalInterval({ from: new CanonicalInstant(15n) }),
      quality: new EvidenceQuality({ freshness: 'fresh', uncertainty: 'none' }),
      provenanceId: 'evidence-1',
    }),
    event: new CausalEvent({ id: 'event-1', effectiveTimeRef: 'fact-1', knowledgeTimeRef: 'fact-1', metadata: { source: 'owner' } }),
    link: new CausalLink({ id: 'link-1', causeId: 'event-1', effectId: 'event-2', evidenceRef: 'evidence-1' }),
    rawBigInt: 999999999999999999999n,
  };

  const decoded = canonicalParse(canonicalStringify(value));
  assert.equal(decoded.decimal.toString(), '10.25');
  assert.equal(decoded.quantity.value.toString(), '12.5');
  assert.equal(decoded.quantity.unit, 'kg');
  assert.equal(decoded.money.amount.toString(), '19.99');
  assert.equal(decoded.money.currency, 'USD');
  assert.equal(decoded.instant.epochNanoseconds, 1234567890123456789n);
  assert.equal(decoded.fact.payload.exact.toString(), '0.125');
  assert.equal(decoded.fact.provenanceId, 'evidence-1');
  assert.equal(decoded.event.id, 'event-1');
  assert.equal(decoded.link.evidenceRef, 'evidence-1');
  assert.equal(decoded.rawBigInt, 999999999999999999999n);
});

test('exactly one owner controls a persistent family and writes are append-only', async () => {
  const gateway = new OwnerWriteGateway({ adapter: new MemoryCanonicalAdapter() });
  gateway.registerOwner({
    family: 'iwxa.ritual',
    ownerId: 'iwxa.ritual.owner',
    commands: ['ritual.create', 'ritual.update', 'ritual.retract'],
    headKind: 'source',
  });

  assert.throws(
    () => gateway.registerOwner({ family: 'iwxa.ritual', ownerId: 'workspace', commands: ['put'] }),
    (error) => error instanceof CanonicalPersistenceError && error.code === 'DUPLICATE_WRITE_OWNER',
  );

  await assert.rejects(
    gateway.execute({
      family: 'iwxa.ritual', ownerId: 'workspace', commandId: 'put', objectId: 'ritual-1', recordId: 'r-1',
      expectedRevisionId: null, knowledgeAt: new CanonicalInstant(1n), payload: { title: 'Morning' },
    }),
    (error) => error instanceof CanonicalPersistenceError && error.code === 'WRITE_OWNER_MISMATCH',
  );

  const first = await gateway.execute({
    family: 'iwxa.ritual', ownerId: 'iwxa.ritual.owner', commandId: 'ritual.create', objectId: 'ritual-1', recordId: 'r-1',
    expectedRevisionId: null, knowledgeAt: new CanonicalInstant(1n), payload: { title: 'Morning' },
  });
  assert.equal(first.revision, 1);
  assert.equal((await gateway.head('iwxa.ritual', 'ritual-1')).sourceHeadRef, 'r-1');

  const second = await gateway.execute({
    family: 'iwxa.ritual', ownerId: 'iwxa.ritual.owner', commandId: 'ritual.update', objectId: 'ritual-1', recordId: 'r-2',
    expectedRevisionId: 'r-1', knowledgeAt: new CanonicalInstant(2n), payload: { title: 'Morning focus' },
    refs: { provenanceId: 'evidence-9', bitemporalFactId: 'fact-9' },
  });
  assert.equal(second.revision, 2);
  assert.equal(second.previousRevisionId, 'r-1');

  const history = await gateway.history('iwxa.ritual', 'ritual-1');
  assert.deepEqual(history.map((record) => record.recordId), ['r-1', 'r-2']);
  assert.equal(history[0].payload.title, 'Morning');
  assert.equal(history[1].payload.title, 'Morning focus');

  const audit = await gateway.audit();
  assert.deepEqual(audit.map((event) => event.recordId), ['r-1', 'r-2']);
  assert.deepEqual(audit.map((event) => event.commandId), ['ritual.create', 'ritual.update']);
});

test('stale expected revision fails closed and does not append an audit event', async () => {
  const gateway = new OwnerWriteGateway({ adapter: new MemoryCanonicalAdapter() });
  gateway.registerOwner({ family: 'iwxa.signal', ownerId: 'iwxa.signal.owner', commands: ['signal.record'] });
  await gateway.execute({
    family: 'iwxa.signal', ownerId: 'iwxa.signal.owner', commandId: 'signal.record', objectId: 'signal-1', recordId: 's-1',
    expectedRevisionId: null, knowledgeAt: new CanonicalInstant(1n), payload: { status: 'new' },
  });

  await assert.rejects(
    gateway.execute({
      family: 'iwxa.signal', ownerId: 'iwxa.signal.owner', commandId: 'signal.record', objectId: 'signal-1', recordId: 's-stale',
      expectedRevisionId: null, knowledgeAt: new CanonicalInstant(2n), payload: { status: 'stale-write' },
    }),
    (error) => error instanceof CanonicalPersistenceError && error.code === 'REVISION_CONFLICT',
  );
  assert.equal((await gateway.audit()).length, 1);
  assert.equal(await gateway.record('s-stale'), null);
});

test('derived heads retain dependency refs without claiming source ownership', async () => {
  const gateway = new OwnerWriteGateway({ adapter: new MemoryCanonicalAdapter() });
  gateway.registerOwner({
    family: 'iwxa.context.projection', ownerId: 'iwxa.context.owner', commands: ['context.rebuild'], headKind: 'derived',
  });
  await gateway.execute({
    family: 'iwxa.context.projection', ownerId: 'iwxa.context.owner', commandId: 'context.rebuild', objectId: 'ctx-1', recordId: 'ctx-r1',
    expectedRevisionId: null, knowledgeAt: new CanonicalInstant(3n), payload: { summary: 'derived' },
    refs: { sourceHeads: { 'iwxa.ritual/ritual-1': 'r-2' }, invalidationCheckpoint: 'cp-1' },
  });
  const head = await gateway.head('iwxa.context.projection', 'ctx-1');
  assert.equal(head.headKind, 'derived');
  assert.equal(head.sourceHeadRef, null);
  assert.equal(head.dependencyRefs.sourceHeads['iwxa.ritual/ritual-1'], 'r-2');
});


test('canonical write snapshots payload and refs before asynchronous head lookup', async () => {
  const adapter = new MemoryCanonicalAdapter();
  const originalGetHead = adapter.getHead.bind(adapter);
  let releaseHead;
  let enteredHead;
  const entered = new Promise((resolve) => { enteredHead = resolve; });
  const gate = new Promise((resolve) => { releaseHead = resolve; });
  adapter.getHead = async (key) => {
    enteredHead();
    await gate;
    return originalGetHead(key);
  };

  const gateway = new OwnerWriteGateway({ adapter });
  gateway.registerOwner({
    family: 'iwxa.snapshot',
    ownerId: 'iwxa.snapshot.owner',
    commands: ['snapshot.write'],
    headKind: 'derived',
  });
  const payload = { nested: { state: 'before' } };
  const refs = { source: { head: 'before' } };
  const pending = gateway.execute({
    family: 'iwxa.snapshot',
    ownerId: 'iwxa.snapshot.owner',
    commandId: 'snapshot.write',
    objectId: 'object-1',
    recordId: 'record-1',
    expectedRevisionId: null,
    knowledgeAt: new CanonicalInstant(10n),
    payload,
    refs,
  });
  await entered;
  payload.nested.state = 'after';
  refs.source.head = 'after';
  releaseHead();
  const committed = await pending;
  assert.equal(committed.payload.nested.state, 'before');
  assert.equal(committed.refs.source.head, 'before');
  const head = await gateway.head('iwxa.snapshot', 'object-1');
  assert.equal(head.dependencyRefs.source.head, 'before');
});


test('canonical persistence fails fast for incomplete adapters', () => {
  assert.throws(
    () => new OwnerWriteGateway({ adapter: { commitRevision() {} } }),
    (error) => error instanceof CanonicalPersistenceError && error.code === 'INVALID_PERSISTENCE_ADAPTER',
  );
});

test('dependency refs require a record root and cannot become primitive derived-head metadata', async () => {
  for (const refs of [null, 'source-head', ['r-1']]) {
    const gateway = new OwnerWriteGateway({ adapter: new MemoryCanonicalAdapter() });
    gateway.registerOwner({
      family: 'iwxa.derived.strict',
      ownerId: 'iwxa.derived.owner',
      commands: ['derived.rebuild'],
      headKind: 'derived',
    });
    await assert.rejects(
      gateway.execute({
        family: 'iwxa.derived.strict',
        ownerId: 'iwxa.derived.owner',
        commandId: 'derived.rebuild',
        objectId: 'd-1',
        recordId: 'd-r1',
        expectedRevisionId: null,
        knowledgeAt: new CanonicalInstant(1n),
        payload: { ok: true },
        refs,
      }),
      (error) => error instanceof CanonicalPersistenceError && error.code === 'INVALID_PERSISTENCE_REFS',
    );
    assert.equal(await gateway.head('iwxa.derived.strict', 'd-1'), null);
    assert.deepEqual(await gateway.audit(), []);
  }
});
