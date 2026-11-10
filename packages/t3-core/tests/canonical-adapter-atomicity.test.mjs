import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCanonicalAdapter, IndexedDbCanonicalAdapter } from '../src/persistence/canonical-persistence.mjs';

function revision(id = 'r1', expected = null) {
  return {
    key: '["family","object"]', expectedHeadRecordId: expected,
    record: { recordId: id, payload: { value: 1 } },
    head: { recordId: id }, audit: { auditId: `write:${id}` },
  };
}

test('memory adapter publishes no partial revision when audit or head cloning fails', async () => {
  for (const field of ['record', 'audit', 'head']) {
    const adapter = new MemoryCanonicalAdapter();
    await adapter.commitRevision(revision());
    const candidate = revision('r2', 'r1');
    candidate[field].uncloneable = () => {};
    await assert.rejects(adapter.commitRevision(candidate), { name: 'DataCloneError' });
    assert.deepEqual((await adapter.listRecords()).map((r) => r.recordId), ['r1']);
    assert.deepEqual((await adapter.listAudit()).map((a) => a.auditId), ['write:r1']);
    assert.deepEqual(await adapter.getHead(candidate.key), { recordId: 'r1' });
  }
});

test('memory adapter keeps returned and input values isolated from stored wire data', async () => {
  const adapter = new MemoryCanonicalAdapter();
  const input = revision();
  const result = await adapter.commitRevision(input);
  input.record.payload.value = 9;
  input.head.recordId = 'changed';
  result.recordId = 'changed-again';
  assert.deepEqual(await adapter.getHead(input.key), { recordId: 'r1' });
  assert.equal((await adapter.getRecord('r1')).payload.value, 1);
});

test('concurrent memory commits have exactly one winner for an expected revision', async () => {
  const adapter = new MemoryCanonicalAdapter();
  const outcomes = await Promise.allSettled([adapter.commitRevision(revision('a')), adapter.commitRevision(revision('b'))]);
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find((r) => r.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  assert.equal((await adapter.listRecords()).length, 1);
  assert.equal((await adapter.listAudit()).length, 1);
});

// Fault-injection unit harness, not a browser/IndexedDB conformance oracle.
// It deliberately allows queued writes to commit unless the adapter aborts.
function faultDatabase({ throwAt = null, current = null, asyncFailure = false } = {}) {
  const failure = Object.assign(new Error('injected failure'), { name: asyncFailure ? 'ConstraintError' : 'DataCloneError' });
  const state = { aborts: 0, committed: [], pending: [], completionHandlerPresentAtRead: false };
  let finished = false;
  const transaction = {
    error: null,
    abort() {
      if (finished) throw new Error('already finished');
      finished = true;
      state.aborts += 1;
      state.pending.length = 0;
      queueMicrotask(() => transaction.onabort?.());
    },
    objectStore(name) {
      return {
        get() {
          state.completionHandlerPresentAtRead = typeof transaction.oncomplete === 'function';
          const request = { result: current };
          queueMicrotask(() => request.onsuccess?.());
          setImmediate(() => {
            if (finished) return;
            finished = true;
            if (asyncFailure) {
              state.pending.length = 0;
              transaction.error = failure;
              transaction.onabort?.();
            } else {
              state.committed.push(...state.pending);
              transaction.oncomplete?.();
            }
          });
          return request;
        },
        add(value) {
          if (throwAt === name) throw failure;
          state.pending.push([name, structuredClone(value)]);
        },
        put(value) {
          if (throwAt === name) throw failure;
          state.pending.push([name, structuredClone(value)]);
        },
      };
    },
  };
  const indexedDB = { open() {
    const request = { result: { transaction: () => transaction } };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  } };
  return { indexedDB, state, failure };
}

test('IndexedDB adapter aborts queued writes after synchronous failures', async () => {
  for (const throwAt of ['records', 'audit', 'heads']) {
    const { indexedDB, state, failure } = faultDatabase({ throwAt });
    const adapter = new IndexedDbCanonicalAdapter({ indexedDB });
    await assert.rejects(adapter.commitRevision(revision()), (error) => error === failure);
    await new Promise(setImmediate);
    assert.equal(state.aborts, 1);
    assert.deepEqual(state.committed, []);
    assert.equal(state.completionHandlerPresentAtRead, true);
  }
});

test('IndexedDB adapter observes transaction completion before requests and returns only after commit', async () => {
  const { indexedDB, state } = faultDatabase();
  const result = await new IndexedDbCanonicalAdapter({ indexedDB }).commitRevision(revision());
  assert.deepEqual(result, { recordId: 'r1' });
  assert.equal(state.completionHandlerPresentAtRead, true);
  assert.deepEqual(state.committed.map(([store]) => store), ['records', 'audit', 'heads']);
  assert.equal(state.aborts, 0);
});

test('IndexedDB revision conflict aborts without writes and preserves its precise error code', async () => {
  const { indexedDB, state } = faultDatabase({ current: { recordId: 'newer' } });
  await assert.rejects(new IndexedDbCanonicalAdapter({ indexedDB }).commitRevision(revision()), (error) => error.code === 'REVISION_CONFLICT');
  assert.equal(state.aborts, 1);
  assert.deepEqual(state.committed, []);
});

test('asynchronous append constraint failure remains a failed commit', async () => {
  const { indexedDB, state } = faultDatabase({ asyncFailure: true });
  await assert.rejects(new IndexedDbCanonicalAdapter({ indexedDB }).commitRevision(revision()), (error) => error.code === 'DUPLICATE_APPEND_ID');
  assert.deepEqual(state.committed, []);
});
