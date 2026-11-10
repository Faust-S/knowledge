import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCanonicalValue, CanonicalCodecError } from '../src/persistence/canonical-codec.mjs';

test('malformed quality notes cannot be coerced into a canonical array', () => {
  for (const notes of ['abc', {}, null, undefined]) {
    assert.throws(
      () => decodeCanonicalValue({ $iwxaType: 'evidence-quality', notes }),
      (error) => error instanceof CanonicalCodecError && error.code === 'INVALID_CANONICAL_TAG_SHAPE',
    );
  }
});
