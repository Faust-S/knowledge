/** Opaque original-owner package transport. No codec, Kernel, signer or business Store. */
import { createHash } from 'node:crypto';
import { createPlacementPolicy } from '../contracts/hosted-context-boundary.mjs';
import {decodeT4WebDavFrameAddressList,MAX_T4_FRAME_LIST_BYTES} from './webdav-frame-address-list.mjs';
import {originalHostLifetimeMode} from './original-host-lifetime.mjs';
import {encodeT4NativeFrameIndex,decodeT4NativeFrameIndex} from './original-network-frame-address.mjs';
export class T4TransferError extends Error {
  constructor(code, details = {}, cause) { super(code, cause===undefined?undefined:{cause}); this.name = 'T4TransferError'; this.code = code; this.details = Object.freeze({ ...details }); }
}
const fail = (code, details, cause) => { throw new T4TransferError(code, details, cause); };
// A temporary transport failure is not authority to repeat a PUT or Kernel write.
const TEMPORARY_HTTP=new Set([408,429,500,502,503,504]);
export function isT4RecoverableWebDavError(error){
  if(!(error instanceof T4TransferError))return false;
  if(error.code==='NETWORK_UNAVAILABLE')return true;
  if(['REMOTE_READ_FAILED','REMOTE_INDEX_READ_FAILED','REMOTE_FRAME_LIST_FAILED',
    'REMOTE_INDEX_WRITE_OUTCOME_UNKNOWN'].includes(error.code))
    return TEMPORARY_HTTP.has(error.details.status);
  if(error.code==='OUTCOME_UNKNOWN')
    return error.details.operation==='PUT'||TEMPORARY_HTTP.has(error.details.status)||
      (error.cause instanceof T4TransferError&&error.cause.code!=='OUTCOME_UNKNOWN'&&
        isT4RecoverableWebDavError(error.cause));
  return false;
}
export const packageSha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digest = (v) => { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) fail('EXPECTED_DIGEST_REQUIRED'); return v; };
const strongETag = (v) => { if (typeof v !== 'string' || !/^"[\x21\x23-\x7e]+"$/.test(v)) fail('STRONG_ETAG_REQUIRED'); return v; };
function checkedKey(v, keySuffix) {
  if (typeof v !== 'string' || v.length > 240 || !v.endsWith(keySuffix)) fail('INVALID_PACKAGE_KEY');
  const parts = v.split('/');
  if (parts.some(p => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(p) || p === '..')) fail('INVALID_PACKAGE_KEY');
  return parts.map(encodeURIComponent).join('/');
}
export function createWebDavPackageTransport(options = {}) {
  const { baseUrl, locationRef, placementPolicy, getMode, authorize, getAuthorizationHeader,
    fetchImpl = globalThis.fetch, maxBytes = 16 * 1024 * 1024, timeoutMs = 15000,
    allowHttpLoopbackFixture = false, keySuffix = '.iwxa', candidateNetworkWire = false,
    indexedNetworkWire = false } = options;
  if (!['.iwxa','.t4d','.t4n'].includes(keySuffix)) fail('WIRE_SUFFIX_UNSUPPORTED');
  if(typeof indexedNetworkWire!=='boolean'||(indexedNetworkWire&&(keySuffix!=='.t4n'||candidateNetworkWire!==true)))
    fail('NETWORK_INDEX_PROFILE_INVALID');
  if (keySuffix === '.t4n' && candidateNetworkWire !== true) fail('NETWORK_WIRE_CANDIDATE_OPT_IN_REQUIRED');
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
  const live=()=>{};
  const assertLive=check=>{assertMode();check();};
  const guard = async (ctx,check=live) => { assertLive(check); if (await authorize(ctx) !== true) fail('AUTHORIZATION_DENIED'); assertLive(check); };
  const receipt = (state, key, sha256, etag, size) => Object.freeze({ schema:'IWXA_T4_TRANSPORT_RECEIPT_V1',
    state,key,sha256,etag,size,locationRef,workspaceId:policy.workspaceId,observedAt:new Date().toISOString(),
    workspaceApplied:false,signatureVerified:false,automaticRetryAllowed:false });
  const indexKey=key=>{if(typeof key!=='string'||!(/^[a-f0-9]{64}\.t4i$/).test(key))fail('NETWORK_INDEX_KEY_INVALID');return key;};
  async function request(method, key, headers, body, sha256,check=live,index=false) {
    const discovery=method==='PROPFIND';
    if(discovery&&(keySuffix!=='.t4n'||key!==null||candidateNetworkWire!==true))
      fail('FRAME_DISCOVERY_NOT_PERMITTED');
    if(index&&(!indexedNetworkWire||discovery))fail('NETWORK_INDEX_PROFILE_INVALID');
    const path = discovery?'':index?indexKey(key):checkedKey(key,keySuffix);
    const isDelta = keySuffix === '.t4d', isNetwork = keySuffix === '.t4n';
    const op = index?'t4.network.frame.index':isNetwork ? 't4.network.frame' : isDelta ? 't4.delta' : 't4.package';
    const ctx = Object.freeze({ operation:op+(discovery?'.discover':method==='PUT' ? '.publish' : '.read'),
      ...(discovery?{collectionOnly:true,depth:1}:{key,sha256}),locationRef,workspaceId:policy.workspaceId,authorityRoot:policy.authorityRoot,
      writeOwnerRef:policy.writeOwnerRef,objectFamily:policy.objectFamily });
    await guard(ctx,check);
    const auth = await getAuthorizationHeader(ctx);
    assertLive(check);
    if (typeof auth !== 'string' || !/^(Basic|Bearer) [^\r\n]+$/.test(auth)) fail('CREDENTIAL_REQUIRED');
    await guard(ctx,check);
    const controller = new AbortController(); active.add(controller);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const release = () => { clearTimeout(timer); active.delete(controller); };
    try {
      assertLive(check);
      const response = await fetchImpl(new URL(path, base), { method,redirect:'manual',cache:'no-store',
        signal:controller.signal,headers:{...headers,Authorization:auth},...(body ? {body} : {}) });
      assertLive(check);
      if (response.status >= 300 && response.status < 400) { controller.abort(); fail('REDIRECT_REFUSED'); }
      return {response,controller,release,ctx};
    } catch (error) {
      controller.abort(); release();
      if (error instanceof T4TransferError) throw error;
      if(error?.code==='ORIGINAL_HOST_LIFETIME_ENDED'&&method!=='PUT')throw error;
      fail(method === 'PUT' ? 'OUTCOME_UNKNOWN' : 'NETWORK_UNAVAILABLE', {operation:method,automaticRetryAllowed:false});
    }
  }
  async function readBytes(response, controller,limit=maxBytes,check=live) {
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) { controller.abort(); fail('PACKAGE_TOO_LARGE'); }
    if (!response.body) fail('EMPTY_BODY');
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      while (true) {
        const {value,done} = await reader.read(); assertLive(check); if (done) break;
        size += value.byteLength;
        if (size > limit) { controller.abort(); fail('PACKAGE_TOO_LARGE'); }
        chunks.push(value);
      }
      if (!size) fail('EMPTY_BODY'); return Buffer.concat(chunks,size);
    } catch (error) {
      controller.abort(); if (error instanceof T4TransferError||error?.code==='ORIGINAL_HOST_LIFETIME_ENDED') throw error;
      fail('NETWORK_UNAVAILABLE',{automaticRetryAllowed:false});
    } finally { reader.releaseLock(); }
  }
  async function getSnapshot({key,expectedSha256,expectedETag} = {},check=live) {
    digest(expectedSha256); checkedKey(key,keySuffix);
    const headers = expectedETag === undefined ? {} : {'If-Match':strongETag(expectedETag)};
    const call = await request('GET',key,headers,null,expectedSha256,check);
    try {
      const r = call.response;
      if (r.status === 404) fail('REMOTE_NOT_FOUND');
      if (r.status === 412) fail('REMOTE_CONFLICT');
      if ([401,403].includes(r.status)) fail('REMOTE_AUTHORIZATION_DENIED');
      if (r.status !== 200) fail('REMOTE_READ_FAILED',{status:r.status});
      const bytes = await readBytes(r,call.controller,maxBytes,check);
      if (packageSha256(bytes) !== expectedSha256) fail('DIGEST_MISMATCH');
      await guard(call.ctx,check);
      // Weak/missing ETag is only metadata, never a content hash or authority proof.
      return Object.freeze({bytes,receipt:receipt('DOWNLOADED_VERIFIED_BYTES',key,expectedSha256,r.headers.get('etag'),bytes.length)});
    } finally { call.controller.abort(); call.release(); }
  }
  async function putSnapshot({key,bytes,expectedSha256,expectedETag,createOnly = false} = {},check=live) {
    digest(expectedSha256); checkedKey(key,keySuffix);
    if (!(bytes instanceof Uint8Array) || !bytes.length) fail('PACKAGE_BYTES_REQUIRED');
    if (bytes.length > maxBytes) fail('PACKAGE_TOO_LARGE');
    const snapshot = Buffer.from(bytes); // Copy before any await.
    if (packageSha256(snapshot) !== expectedSha256) fail('DIGEST_MISMATCH');
    if (createOnly !== true || expectedETag !== undefined) fail('IMMUTABLE_WRITE_REQUIRED');
    if (key !== `${expectedSha256}${keySuffix}`) fail('DIGEST_KEY_REQUIRED');
    const call = await request('PUT',key,{'If-None-Match':'*','Content-Type':keySuffix === '.t4n' ? 'application/vnd.iwxa.t4-network-candidate+json' : keySuffix === '.t4d' ? 'application/vnd.iwxa.t4-delta+json' : 'application/octet-stream'},snapshot,expectedSha256,check);
    let alreadyPresent = false;
    try {
      const status = call.response.status;
      if (status === 412) alreadyPresent = true;
      else if ([401,403].includes(status)) fail('REMOTE_AUTHORIZATION_DENIED');
      else if ([409,413,423,507].includes(status)) fail('REMOTE_WRITE_REFUSED',{status});
      else if (![200,201,204].includes(status)) fail('OUTCOME_UNKNOWN',{status,automaticRetryAllowed:false});
    } finally { call.controller.abort(); call.release(); }
    try {
      const readback = await getSnapshot({key,expectedSha256},check);
      return receipt(alreadyPresent ? 'ALREADY_PRESENT_VERIFIED' : 'PUBLISHED_AND_READ_BACK',key,expectedSha256,readback.receipt.etag,snapshot.length);
    } catch (error) { fail('OUTCOME_UNKNOWN',{cause:error.code ?? 'READBACK_FAILED',acknowledgedWrite:!alreadyPresent,automaticRetryAllowed:false},error); }
  }
  async function inspectOutcome({key,expectedSha256} = {},check=live) {
    const result = await getSnapshot({key,expectedSha256},check);
    return Object.freeze({...result.receipt,state:'EXPECTED_BYTES_PRESENT',historicalWriteProven:false,automaticRetryAllowed:false});
  }
  async function getNativeFrameIndex({key}={},check=live){
    indexKey(key);
    const call=await request('GET',key,{},null,null,check,true);
    try{
      const r=call.response;
      if(r.status===404){await guard(call.ctx,check);return null;}
      if([401,403].includes(r.status))fail('REMOTE_AUTHORIZATION_DENIED');
      if(r.status!==200)fail('REMOTE_INDEX_READ_FAILED',{status:r.status});
      const bytes=await readBytes(r,call.controller,Math.min(maxBytes,256),check);
      const frameSha256=decodeT4NativeFrameIndex(bytes);
      await guard(call.ctx,check);
      return Object.freeze({schema:'IWXA_T4_NATIVE_FRAME_INDEX_READ_V1',key,frameSha256,
        addressMetadataIsNotSignatureOrAuthority:true,originalBusinessApplied:false});
    }finally{call.controller.abort();call.release();}
  }
  async function putNativeFrameIndex({key,frameSha256}={},check=live){
    indexKey(key);const bytes=encodeT4NativeFrameIndex(frameSha256);
    const call=await request('PUT',key,{'If-None-Match':'*','Content-Type':'application/vnd.iwxa.t4-frame-address+json'},
      bytes,frameSha256,check,true);
    try{
      const status=call.response.status;
      if([401,403].includes(status))fail('REMOTE_AUTHORIZATION_DENIED');
      if(![200,201,204,412].includes(status))fail('REMOTE_INDEX_WRITE_OUTCOME_UNKNOWN',{status});
    }finally{call.controller.abort();call.release();}
    const readback=await getNativeFrameIndex({key},check);
    if(readback===null)fail('REMOTE_INDEX_WRITE_OUTCOME_UNKNOWN');
    if(readback.frameSha256!==frameSha256)fail('REMOTE_INDEX_SLOT_CONFLICT');
    return readback;
  }
  async function listNativeFrameAddresses(check=live){
    if(keySuffix!=='.t4n'||candidateNetworkWire!==true)fail('FRAME_DISCOVERY_NOT_PERMITTED');
    const call=await request('PROPFIND',null,{Depth:'1','Content-Type':'application/xml; charset=utf-8'},
      '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>',null,check);
    try{
      const r=call.response;
      if([401,403].includes(r.status))fail('REMOTE_AUTHORIZATION_DENIED');
      if(r.status!==207)fail('REMOTE_FRAME_LIST_FAILED',{status:r.status});
      const contentType=r.headers.get('content-type')??'';
      if(!/^(?:text|application)\/xml(?:\s*;|$)/i.test(contentType))fail('REMOTE_FRAME_LIST_CONTENT_TYPE_INVALID');
      const bytes=await readBytes(r,call.controller,MAX_T4_FRAME_LIST_BYTES,check);
      const listing=decodeT4WebDavFrameAddressList(bytes,base.href);
      await guard(call.ctx,check);
      return listing;
    }finally{call.controller.abort();call.release();}
  }
  function close() { closed = true; for (const c of active) c.abort(); active.clear(); }
  function scopedPort(check=live){
    return Object.freeze({
      putSnapshot:input=>putSnapshot(input,check),getSnapshot:input=>getSnapshot(input,check),
      inspectOutcome:input=>inspectOutcome(input,check),close,
      ...(keySuffix==='.t4n'?{listNativeFrameAddresses:()=>listNativeFrameAddresses(check),
        nativeFrameIndexVersion:indexedNetworkWire?1:0,
        ...(indexedNetworkWire?{getNativeFrameIndex:input=>getNativeFrameIndex(input,check),
          putNativeFrameIndex:input=>putNativeFrameIndex(input,check)}:{})}:{}),
      forOriginalHostLifetime:isHostActive=>{
        const mode=originalHostLifetimeMode(()=>{check();return getMode();},isHostActive);
        return scopedPort(()=>{mode();});
      },
      wireKind:keySuffix === '.t4n' ? 'T4_NETWORK_CANDIDATE' : null});
  }
  return scopedPort();
}
