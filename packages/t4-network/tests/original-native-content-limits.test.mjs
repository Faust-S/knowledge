import test from 'node:test';
import assert from 'node:assert/strict';
import {T4_NATIVE_MAX_CIPHERTEXT_BYTES,T4_NATIVE_MAX_CAPTURE_PLAINTEXT_BYTES,
  T4_NATIVE_SEALED_HEADER_MAX_BYTES,T4_NATIVE_SEALED_PREFIX_BYTES,T4_NATIVE_SEALED_TAG_BYTES,
  requireT4NativeCaptureCapacity} from '../src/network/original-native-content-limits.mjs';
test('K105 reserve includes complete maximum sealed envelope overhead',()=>{
  const max=T4_NATIVE_MAX_CAPTURE_PLAINTEXT_BYTES;
  assert.equal(max+T4_NATIVE_SEALED_HEADER_MAX_BYTES+T4_NATIVE_SEALED_PREFIX_BYTES+
    T4_NATIVE_SEALED_TAG_BYTES,T4_NATIVE_MAX_CIPHERTEXT_BYTES);
  assert.equal(requireT4NativeCaptureCapacity(max),max);
  assert.throws(()=>requireT4NativeCaptureCapacity(max+1),e=>e.code==='T4_NATIVE_CONTENT_REQUIRES_MULTIPART');
  for(const x of [0,-1,NaN,1.5,undefined])assert.throws(()=>requireT4NativeCaptureCapacity(x),
    e=>e.code==='T4_NATIVE_CAPTURE_SIZE_INVALID');
});
