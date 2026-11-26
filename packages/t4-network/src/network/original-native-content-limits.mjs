// One capacity definition for the current native V2 sealed envelope and
// V1 opaque chunk transport. Do not alter historical wire bytes or cursors.
export const T4_NATIVE_CHUNK_BYTES=8192;
export const T4_NATIVE_MAX_CHUNKS=64;
export const T4_NATIVE_MAX_CIPHERTEXT_BYTES=T4_NATIVE_CHUNK_BYTES*T4_NATIVE_MAX_CHUNKS;
export const T4_NATIVE_MULTIPART_MAX_PARTS=16;
export const T4_NATIVE_MULTIPART_MAX_CIPHERTEXT_BYTES=T4_NATIVE_MAX_CIPHERTEXT_BYTES*T4_NATIVE_MULTIPART_MAX_PARTS;
export const T4_NATIVE_MULTIPART_PROFILE='iwxa.opaque-content-multipart.v1';
export const T4_NATIVE_SEALED_HEADER_MAX_BYTES=4096;
export const T4_NATIVE_SEALED_PREFIX_BYTES=6;
export const T4_NATIVE_SEALED_TAG_BYTES=16;
// The recipient-specific header is not available at source capture time.
// Reserve the full admitted header rather than risk an unsendable commit.
export const T4_NATIVE_MAX_CAPTURE_PLAINTEXT_BYTES=T4_NATIVE_MAX_CIPHERTEXT_BYTES-
  T4_NATIVE_SEALED_HEADER_MAX_BYTES-T4_NATIVE_SEALED_PREFIX_BYTES-T4_NATIVE_SEALED_TAG_BYTES;
export const T4_NATIVE_MULTIPART_MAX_CAPTURE_PLAINTEXT_BYTES=T4_NATIVE_MULTIPART_MAX_CIPHERTEXT_BYTES-
  T4_NATIVE_SEALED_HEADER_MAX_BYTES-T4_NATIVE_SEALED_PREFIX_BYTES-T4_NATIVE_SEALED_TAG_BYTES;
// Canonical delta includes base64 and metadata: this is an upper bound
// before computing the exact canonical length, never the advertised raw cap.
export const T4_NATIVE_MULTIPART_MAX_RAW_ASSET_BYTES=Math.floor(T4_NATIVE_MULTIPART_MAX_CAPTURE_PLAINTEXT_BYTES/4)*3;
export function requireT4NativeCaptureCapacity(byteLength,{enableMultipart=false}={}){
  if(typeof enableMultipart!=='boolean')
    throw Object.assign(Error('T4_NATIVE_CAPTURE_PROFILE_INVALID'),{code:'T4_NATIVE_CAPTURE_PROFILE_INVALID'});
  if(!Number.isSafeInteger(byteLength)||byteLength<1)
    throw Object.assign(Error('T4_NATIVE_CAPTURE_SIZE_INVALID'),{code:'T4_NATIVE_CAPTURE_SIZE_INVALID'});
  if(enableMultipart){
    if(byteLength>T4_NATIVE_MULTIPART_MAX_CAPTURE_PLAINTEXT_BYTES)
      throw Object.assign(Error('T4_NATIVE_MULTIPART_CONTENT_LIMIT_EXCEEDED'),{
        code:'T4_NATIVE_MULTIPART_CONTENT_LIMIT_EXCEEDED',details:Object.freeze({plaintextBytes:byteLength,
          maxPlaintextBytes:T4_NATIVE_MULTIPART_MAX_CAPTURE_PLAINTEXT_BYTES,originalMutationAttempted:false})});
    return byteLength;
  }
  if(byteLength>T4_NATIVE_MAX_CAPTURE_PLAINTEXT_BYTES)
    throw Object.assign(Error('T4_NATIVE_CONTENT_REQUIRES_MULTIPART'),{
      code:'T4_NATIVE_CONTENT_REQUIRES_MULTIPART',
      details:Object.freeze({plaintextBytes:byteLength,maxPlaintextBytes:T4_NATIVE_MAX_CAPTURE_PLAINTEXT_BYTES,
        originalMutationAttempted:false,multipartImplemented:false})});
  return byteLength;
}

// Selection is based on exact canonical capture bytes after the Event exists.
// At preflight the same function accepts a conservative reserved length.
export function selectT4NativeAssetContentProfile(byteLength,options={}){
  requireT4NativeCaptureCapacity(byteLength,options);
  return byteLength>T4_NATIVE_MAX_CAPTURE_PLAINTEXT_BYTES?T4_NATIVE_MULTIPART_PROFILE:null;
}
