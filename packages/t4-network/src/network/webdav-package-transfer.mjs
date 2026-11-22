/** Opaque original-owner package transport. No codec, Kernel, signer or business Store. */
import { createHash } from 'node:crypto';
import { createPlacementPolicy } from '../contracts/hosted-context-boundary.mjs';
export class T4TransferError extends Error {
  constructor(code, details = {}) { super(code); this.name = 'T4TransferError'; this.code = code; this.details = Object.freeze({ ...details }); }
}
const fail = (code, details) => { throw new T4TransferError(code, details); };
export const packageSha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digest = (v) => { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) fail('EXPECTED_DIGEST_REQUIRED'); return v; };
const strongETag = (v) => { if (typeof v !== 'string' || !/^"[\x21\x23-\x7e]+"$/.test(v)) fail('STRONG_ETAG_REQUIRED'); return v; };
function checkedKey(v) {
  if (typeof v !== 'string' || v.length > 240 || !v.endsWith('.iwxa')) fail('INVALID_PACKAGE_KEY');
  const parts = v.split('/');
  if (parts.some(p => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(p) || p === '..')) fail('INVALID_PACKAGE_KEY');
  return parts.map(encodeURIComponent).join('/');
}
export function createWebDavPackageTransport(options = {}) {
  const { baseUrl, locationRef, placementPolicy, getMode, authorize, getAuthorizationHeader,
    fetchImpl = globalThis.fetch, maxBytes = 16 * 1024 * 1024, timeoutMs = 15000,
    allowHttpLoopbackFixture = false } = options;
  if (![getMode, authorize, getAuthorizationHeader, fetchImpl].every(f => typeof f === 'function')) fail('HOST_PORTS_REQUIRED');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 256 * 1024 * 1024) fail('INVALID_SIZE_LIMIT');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 120000) fail('INVALID_TIMEOUT');
  let base; try { base = new URL(baseUrl); } catch { fail('INVALID_ENDPOINT'); }
  if (base.username || base.password || base.search || base.hash || !base.pathname.endsWith('/')) fail('INVALID_ENDPOINT');
  const fixture = allowHttpLoopbackFixture === true && base.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(base.hostname);
  if (base.protocol !== 'https:' && !fixture) fail('TLS_REQUIRED');
  const policy = createPlacementPolicy(placementPolicy);
  if (!policy.allowedLocations.includes(locationRef)) fail('LOCATION_NOT_PERMITTED');
  let closed = false; const active = new Set();
  const assertMode = () => {
    if (closed) fail('TRANSPORT_CLOSED');
    if (getMode() !== 'T4_NETWORK' || policy.primaryPlacement === 'LOCAL_ONLY') fail('NETWORK_NOT_PERMITTED');
  };
  const guard = async (ctx) => { assertMode(); if (await authorize(ctx) !== true) fail('AUTHORIZATION_DENIED'); assertMode(); };
  const receipt = (state, key, sha256, etag, size) => Object.freeze({ schema:'IWXA_T4_TRANSPORT_RECEIPT_V1',
    state,key,sha256,etag,size,locationRef,workspaceId:policy.workspaceId,observedAt:new Date().toISOString(),
    workspaceApplied:false,signatureVerified:false,automaticRetryAllowed:false });
  async function request(method, key, headers, body, sha256) {
    const path = checkedKey(key);
    const ctx = Object.freeze({ operation:method === 'PUT' ? 't4.package.publish' : 't4.package.read',
      key,sha256,locationRef,workspaceId:policy.workspaceId,authorityRoot:policy.authorityRoot,
      writeOwnerRef:policy.writeOwnerRef,objectFamily:policy.objectFamily });
    await guard(ctx);
    const auth = await getAuthorizationHeader(ctx);
    if (typeof auth !== 'string' || !/^(Basic|Bearer) [^\r\n]+$/.test(auth)) fail('CREDENTIAL_REQUIRED');
    await guard(ctx);
    const controller = new AbortController(); active.add(controller);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const release = () => { clearTimeout(timer); active.delete(controller); };
    try {
      assertMode();
      const response = await fetchImpl(new URL(path, base), { method,redirect:'manual',cache:'no-store',
        signal:controller.signal,headers:{...headers,Authorization:auth},...(body ? {body} : {}) });
      if (response.status >= 300 && response.status < 400) { controller.abort(); fail('REDIRECT_REFUSED'); }
      return {response,controller,release,ctx};
    } catch (error) {
      controller.abort(); release();
      if (error instanceof T4TransferError) throw error;
      fail(method === 'PUT' ? 'OUTCOME_UNKNOWN' : 'NETWORK_UNAVAILABLE', {operation:method,automaticRetryAllowed:false});
    }
  }
  async function readBytes(response, controller) {
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) { controller.abort(); fail('PACKAGE_TOO_LARGE'); }
    if (!response.body) fail('EMPTY_BODY');
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      while (true) {
        const {value,done} = await reader.read(); if (done) break;
        assertMode(); size += value.byteLength;
        if (size > maxBytes) { controller.abort(); fail('PACKAGE_TOO_LARGE'); }
        chunks.push(value);
      }
      if (!size) fail('EMPTY_BODY'); return Buffer.concat(chunks,size);
    } catch (error) {
      controller.abort(); if (error instanceof T4TransferError) throw error;
      fail('NETWORK_UNAVAILABLE',{automaticRetryAllowed:false});
    } finally { reader.releaseLock(); }
  }
  async function getSnapshot({key,expectedSha256,expectedETag} = {}) {
    digest(expectedSha256); checkedKey(key);
    const headers = expectedETag === undefined ? {} : {'If-Match':strongETag(expectedETag)};
    const call = await request('GET',key,headers,null,expectedSha256);
    try {
      const r = call.response;
      if (r.status === 404) fail('REMOTE_NOT_FOUND');
      if (r.status === 412) fail('REMOTE_CONFLICT');
      if ([401,403].includes(r.status)) fail('REMOTE_AUTHORIZATION_DENIED');
      if (r.status !== 200) fail('REMOTE_READ_FAILED',{status:r.status});
      const bytes = await readBytes(r,call.controller);
      if (packageSha256(bytes) !== expectedSha256) fail('DIGEST_MISMATCH');
      await guard(call.ctx);
      // Weak/missing ETag is only metadata, never a content hash or authority proof.
      return Object.freeze({bytes,receipt:receipt('DOWNLOADED_VERIFIED_BYTES',key,expectedSha256,r.headers.get('etag'),bytes.length)});
    } finally { call.controller.abort(); call.release(); }
  }
  async function putSnapshot({key,bytes,expectedSha256,expectedETag,createOnly = false} = {}) {
    digest(expectedSha256); checkedKey(key);
    if (!(bytes instanceof Uint8Array) || !bytes.length) fail('PACKAGE_BYTES_REQUIRED');
    if (bytes.length > maxBytes) fail('PACKAGE_TOO_LARGE');
    const snapshot = Buffer.from(bytes); // Copy before any await.
    if (packageSha256(snapshot) !== expectedSha256) fail('DIGEST_MISMATCH');
    if (createOnly !== true || expectedETag !== undefined) fail('IMMUTABLE_WRITE_REQUIRED');
    if (key !== `${expectedSha256}.iwxa`) fail('DIGEST_KEY_REQUIRED');
    const call = await request('PUT',key,{'If-None-Match':'*','Content-Type':'application/octet-stream'},snapshot,expectedSha256);
    let alreadyPresent = false;
    try {
      const status = call.response.status;
      if (status === 412) alreadyPresent = true;
      else if ([401,403].includes(status)) fail('REMOTE_AUTHORIZATION_DENIED');
      else if ([409,413,423,507].includes(status)) fail('REMOTE_WRITE_REFUSED',{status});
      else if (![200,201,204].includes(status)) fail('OUTCOME_UNKNOWN',{status,automaticRetryAllowed:false});
    } finally { call.controller.abort(); call.release(); }
    try {
      const readback = await getSnapshot({key,expectedSha256});
      return receipt(alreadyPresent ? 'ALREADY_PRESENT_VERIFIED' : 'PUBLISHED_AND_READ_BACK',key,expectedSha256,readback.receipt.etag,snapshot.length);
    } catch (error) { fail('OUTCOME_UNKNOWN',{cause:error.code ?? 'READBACK_FAILED',acknowledgedWrite:!alreadyPresent,automaticRetryAllowed:false}); }
  }
  async function inspectOutcome({key,expectedSha256} = {}) {
    const result = await getSnapshot({key,expectedSha256});
    return Object.freeze({...result.receipt,state:'EXPECTED_BYTES_PRESENT',historicalWriteProven:false,automaticRetryAllowed:false});
  }
  function close() { closed = true; for (const c of active) c.abort(); active.clear(); }
  return Object.freeze({putSnapshot,getSnapshot,inspectOutcome,close});
}
