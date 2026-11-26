import test from 'node:test';
import assert from 'node:assert/strict';
import {T4_NATIVE_MAX_CIPHERTEXT_BYTES,T4_NATIVE_MAX_CAPTURE_PLAINTEXT_BYTES,
  T4_NATIVE_SEALED_HEADER_MAX_BYTES,T4_NATIVE_SEALED_PREFIX_BYTES,T4_NATIVE_SEALED_TAG_BYTES,
  requireT4NativeCaptureCapacity,T4_NATIVE_MULTIPART_MAX_CAPTURE_PLAINTEXT_BYTES,
  T4_NATIVE_MULTIPART_MAX_CIPHERTEXT_BYTES,T4_NATIVE_MULTIPART_PROFILE,selectT4NativeAssetContentProfile} from '../src/network/original-native-content-limits.mjs';
test('K105 reserve includes complete maximum sealed envelope overhead',()=>{
  const max=T4_NATIVE_MAX_CAPTURE_PLAINTEXT_BYTES;
  assert.equal(max+T4_NATIVE_SEALED_HEADER_MAX_BYTES+T4_NATIVE_SEALED_PREFIX_BYTES+
    T4_NATIVE_SEALED_TAG_BYTES,T4_NATIVE_MAX_CIPHERTEXT_BYTES);
  assert.equal(requireT4NativeCaptureCapacity(max),max);
  assert.throws(()=>requireT4NativeCaptureCapacity(max+1),e=>e.code==='T4_NATIVE_CONTENT_REQUIRES_MULTIPART');
  for(const x of [0,-1,NaN,1.5,undefined])assert.throws(()=>requireT4NativeCaptureCapacity(x),
    e=>e.code==='T4_NATIVE_CAPTURE_SIZE_INVALID');
});

test('K150 exact canonical boundary selects one profile and preserves complete maximum authenticated envelope overhead',()=>{
  const old=T4_NATIVE_MAX_CAPTURE_PLAINTEXT_BYTES,max=T4_NATIVE_MULTIPART_MAX_CAPTURE_PLAINTEXT_BYTES;
  assert.equal(max+T4_NATIVE_SEALED_HEADER_MAX_BYTES+T4_NATIVE_SEALED_PREFIX_BYTES+T4_NATIVE_SEALED_TAG_BYTES,
    T4_NATIVE_MULTIPART_MAX_CIPHERTEXT_BYTES);
  assert.equal(selectT4NativeAssetContentProfile(old,{enableMultipart:true}),null);
  assert.equal(selectT4NativeAssetContentProfile(old+1,{enableMultipart:true}),T4_NATIVE_MULTIPART_PROFILE);
  assert.equal(selectT4NativeAssetContentProfile(max,{enableMultipart:true}),T4_NATIVE_MULTIPART_PROFILE);
  assert.throws(()=>selectT4NativeAssetContentProfile(old+1),{code:'T4_NATIVE_CONTENT_REQUIRES_MULTIPART'});
  assert.throws(()=>selectT4NativeAssetContentProfile(max+1,{enableMultipart:true}),{code:'T4_NATIVE_MULTIPART_CONTENT_LIMIT_EXCEEDED'});
  assert.throws(()=>selectT4NativeAssetContentProfile(old,{enableMultipart:'true'}),{code:'T4_NATIVE_CAPTURE_PROFILE_INVALID'});
});
