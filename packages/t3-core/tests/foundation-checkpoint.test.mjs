import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CheckpointSemanticError,
  HmacSha256CheckpointAuthenticator,
  IncrementalInvalidationIndex,
  createAuthenticatedCheckpoint,
  derivedDependency,
  sourceDependency,
  verifyAuthenticatedCheckpoint,
} from '../src/foundation/checkpoint.mjs';

const auth = () => new HmacSha256CheckpointAuthenticator({ keyId: 'test-key', key: '0123456789abcdef0123456789abcdef' });

test('canonical checkpoint digest is independent of object key insertion order', () => {
  const a = createAuthenticatedCheckpoint({ id: 'cp-1', sourceHeads: { alpha: 'a1', beta: 'b1' }, derivedHeads: { y: 'y1', x: 'x1' }, authenticator: auth() });
  const b = createAuthenticatedCheckpoint({ id: 'cp-1', sourceHeads: { beta: 'b1', alpha: 'a1' }, derivedHeads: { x: 'x1', y: 'y1' }, authenticator: auth() });
  assert.equal(a.digest, b.digest);
  assert.equal(a.proof.tag, b.proof.tag);
  assert.equal(verifyAuthenticatedCheckpoint(a, auth()), true);
});

test('payload tampering fails digest verification', () => {
  const checkpoint = createAuthenticatedCheckpoint({ id: 'cp-1', sourceHeads: { alpha: 'a1' }, authenticator: auth() });
  const tampered = { ...checkpoint, payload: { ...checkpoint.payload, sourceHeads: { alpha: 'a2' } } };
  assert.throws(() => verifyAuthenticatedCheckpoint(tampered, auth()), (error) => error instanceof CheckpointSemanticError && error.code === 'CHECKPOINT_DIGEST_MISMATCH');
});

test('wrong authentication key fails closed', () => {
  const checkpoint = createAuthenticatedCheckpoint({ id: 'cp-1', sourceHeads: { alpha: 'a1' }, authenticator: auth() });
  const wrong = new HmacSha256CheckpointAuthenticator({ keyId: 'test-key', key: 'ffffffffffffffffffffffffffffffff' });
  assert.throws(() => verifyAuthenticatedCheckpoint(checkpoint, wrong), (error) => error instanceof CheckpointSemanticError && error.code === 'CHECKPOINT_AUTHENTICATION_FAILED');
});

test('source head change invalidates only direct and transitive dependents', () => {
  const checkpoint = createAuthenticatedCheckpoint({ id: 'cp-1', sourceHeads: { alpha: 'a1', beta: 'b1' }, authenticator: auth() });
  const index = new IncrementalInvalidationIndex();
  index.registerDerived({ id: 'd-alpha', revisionRef: 'r1', dependencies: [sourceDependency('alpha', 'a1')] });
  index.registerDerived({ id: 'd-beta', revisionRef: 'r1', dependencies: [sourceDependency('beta', 'b1')] });
  index.registerDerived({ id: 'd-composed', revisionRef: 'r1', dependencies: [derivedDependency('d-alpha', 'r1'), derivedDependency('d-beta', 'r1')] });
  const plan = index.planFromCheckpoint(checkpoint, { alpha: 'a2', beta: 'b1' }, auth());
  assert.deepEqual(plan.changedSourceIds, ['alpha']);
  assert.deepEqual(plan.invalidatedDerivedIds, ['d-alpha', 'd-composed']);
  assert.deepEqual(plan.unaffectedDerivedIds, ['d-beta']);
  assert.equal(plan.sourceHeadsMutatedByPlan, false);
});

test('unchanged source heads produce an empty invalidation plan', () => {
  const checkpoint = createAuthenticatedCheckpoint({ id: 'cp-1', sourceHeads: { alpha: 'a1' }, authenticator: auth() });
  const index = new IncrementalInvalidationIndex();
  index.registerDerived({ id: 'd-alpha', revisionRef: 'r1', dependencies: [sourceDependency('alpha', 'a1')] });
  const plan = index.planFromCheckpoint(checkpoint, { alpha: 'a1' }, auth());
  assert.deepEqual(plan.changedSourceIds, []);
  assert.deepEqual(plan.invalidatedDerivedIds, []);
  assert.deepEqual(plan.unaffectedDerivedIds, ['d-alpha']);
});

test('checkpoint may bind previous authenticated digest without treating it as causal ordering', () => {
  const first = createAuthenticatedCheckpoint({ id: 'cp-1', sourceHeads: { alpha: 'a1' }, authenticator: auth() });
  const second = createAuthenticatedCheckpoint({ id: 'cp-2', sourceHeads: { alpha: 'a2' }, previousCheckpointDigest: first.digest, authenticator: auth() });
  assert.equal(second.payload.previousCheckpointDigest, first.digest);
  assert.equal(verifyAuthenticatedCheckpoint(second, auth()), true);
});


test('invalidation planning requires authenticated checkpoint verification', () => {
  const checkpoint = createAuthenticatedCheckpoint({ id: 'cp-auth', sourceHeads: { alpha: 'a1' }, authenticator: auth() });
  const index = new IncrementalInvalidationIndex();
  index.registerDerived({ id: 'd-alpha', revisionRef: 'r1', dependencies: [sourceDependency('alpha', 'a1')] });
  assert.throws(
    () => index.planFromCheckpoint(checkpoint, { alpha: 'a2' }),
    (error) => error instanceof CheckpointSemanticError && error.code === 'CHECKPOINT_AUTHENTICATOR_REQUIRED',
  );
  const tampered = { ...checkpoint, payload: { ...checkpoint.payload, sourceHeads: { alpha: 'forged' } } };
  assert.throws(
    () => index.planFromCheckpoint(tampered, { alpha: 'a2' }, auth()),
    (error) => error instanceof CheckpointSemanticError && error.code === 'CHECKPOINT_DIGEST_MISMATCH',
  );
});

test('checkpoint verification rejects payload shape drift', () => {
  const checkpoint = createAuthenticatedCheckpoint({ id: 'cp-shape', sourceHeads: { alpha: 'a1' }, authenticator: auth() });
  const extra = { ...checkpoint, payload: { ...checkpoint.payload, extra: true } };
  assert.throws(
    () => verifyAuthenticatedCheckpoint(extra, auth()),
    (error) => error instanceof CheckpointSemanticError && error.code === 'INVALID_CHECKPOINT',
  );
});
