// Internal adapter for an already authenticated and confidential ORIGINAL
// peer-owner call. This is NOT a new T4 wire frame, storage location, HTTP
// listener, authority, or public Kernel route. A carrier confers no rights.
import {createHash} from 'node:crypto';
import {snapshot} from '../../../t3-core/src/t3/access/core.mjs';
import {strictJson} from '../../../t3-core/src/t3/access/strict-json.mjs';
import {createT4OriginalReplacementOwnerHistoryRequest,validateT4OriginalReplacementOwnerHistorySnapshot}
  from './original-network-replacement-owner-history.mjs';
import {decodeT4CandidateFrame} from './standard-network-wire-candidate.mjs';

const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=code=>{throw Object.assign(Error(code),{code});};
const RESPONSE='IWXA_T4_ORIGINAL_REPLACEMENT_OWNER_CALL_RESULT_V1';
const REQUEST_LIMIT=32768,RESPONSE_LIMIT=4*1024*1024,FRAME_LIMIT=32768,BATCH_LIMIT=1024*1024;
function exactKeys(v,keys){return v&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));}
function request(raw){
  const r=createT4OriginalReplacementOwnerHistoryRequest(raw);
  if(!same(raw,r))fail('REPLACEMENT_HISTORY_CARRIER_REQUEST_INVALID');return r;
}
function encode(value,limit){
  const out=Buffer.from(JSON.stringify(value),'utf8');
  if(!out.length||out.length>limit)fail('REPLACEMENT_HISTORY_CARRIER_SIZE_INVALID');
  return new Uint8Array(out);
}
function decode(bytes,limit){
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>limit)fail('REPLACEMENT_HISTORY_CARRIER_SIZE_INVALID');
  try{
    const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),value=strictJson(text,{maxLength:limit});
    if(JSON.stringify(value)!==text)fail('REPLACEMENT_HISTORY_CARRIER_ENCODING_INVALID');
    return value;
  }catch{fail('REPLACEMENT_HISTORY_CARRIER_ENCODING_INVALID');}
}
export function encodeT4OriginalReplacementHistoryRequest(raw){const r=request(raw);snapshot(r);return encode(r,REQUEST_LIMIT);}
export function decodeT4OriginalReplacementHistoryRequest(bytes){const r=request(decode(bytes,REQUEST_LIMIT));snapshot(r);return r;}
function mapSnapshot(raw,r,encoding){
  if(raw===null)return null;
  const v=validateT4OriginalReplacementOwnerHistorySnapshot(raw,r);
  if(!exactKeys(v,['schema','request','role','state','phaseCheckpointRef','originalHistoricalEvidenceOnly','originalOwnerReadOnly',
    'liveNetworkAuthorityGranted','originalSubjectMutationInvoked','originalT3HostCursorWriteInvoked','phase','retiredPhase','publication','acceptedAck','retiredAck']))
    fail('REPLACEMENT_HISTORY_CARRIER_SNAPSHOT_INVALID');
  const {publication,...meta}=v;snapshot(meta);
  if(publication===null)return v;
  const {frames,...pub}=publication;snapshot(pub);
  if(pub.schema!=='IWXA_T4_ORIGINAL_HISTORICAL_PUBLISHED_BATCH_V1'||!same(pub.session,r.session)||
    !Array.isArray(frames)||!frames.length||frames.length>80)fail('REPLACEMENT_HISTORY_CARRIER_BATCH_INVALID');
  let total=0;
  const mapped=frames.map((raw,i)=>{
    const {wireBytes,wireBytesBase64,...rest}=raw;snapshot(rest);
    if(!SHA(rest.sha256)||rest.key!==rest.sha256+'.t4n'||rest.sequence!==i+1||rest.sessionRef!==r.session.sessionRef)
      fail('REPLACEMENT_HISTORY_CARRIER_FRAME_INVALID');
    let bytes;
    if(encoding){
      if(!(wireBytes instanceof Uint8Array)||wireBytesBase64!==undefined)fail('REPLACEMENT_HISTORY_CARRIER_FRAME_INVALID');
      bytes=Buffer.from(wireBytes);
    }else{
      if(wireBytes!==undefined||typeof wireBytesBase64!=='string'||wireBytesBase64.length>Math.ceil(FRAME_LIMIT/3)*4)
        fail('REPLACEMENT_HISTORY_CARRIER_FRAME_INVALID');
      bytes=Buffer.from(wireBytesBase64,'base64');
      if(bytes.toString('base64')!==wireBytesBase64)fail('REPLACEMENT_HISTORY_CARRIER_FRAME_INVALID');
    }
    total+=bytes.length;
    if(!bytes.length||bytes.length>FRAME_LIMIT||total>BATCH_LIMIT||createHash('sha256').update(bytes).digest('hex')!==rest.sha256)
      fail('REPLACEMENT_HISTORY_CARRIER_FRAME_INVALID');
    const frame=decodeT4CandidateFrame(bytes),c=r.session;
    if(frame.sourceNodeRef!==r.ownerNodeRef||frame.recipientNodeRef!==(r.ownerNodeRef===c.sourceNodeRef?c.recipientNodeRef:c.sourceNodeRef)||
      frame.scopeRef!==c.scopeRef||frame.ownerEpoch!==c.ownerEpoch||frame.sessionRef!==c.sessionRef||frame.sequence!==rest.sequence||frame.messageType!==rest.messageType)
      fail('REPLACEMENT_HISTORY_CARRIER_FRAME_INVALID');
    return {...rest,...(encoding?{wireBytesBase64:bytes.toString('base64')}:{wireBytes:new Uint8Array(bytes)})};
  });
  return {...v,publication:{...pub,frames:mapped}};
}
export function encodeT4OriginalReplacementHistoryResponse(raw,rawRequest){
  const r=request(rawRequest);return encode({schema:RESPONSE,request:r,snapshot:mapSnapshot(raw,r,true)},RESPONSE_LIMIT);
}
export function decodeT4OriginalReplacementHistoryResponse(bytes,rawRequest){
  const r=request(rawRequest),v=decode(bytes,RESPONSE_LIMIT);
  if(!exactKeys(v,['schema','request','snapshot'])||v.schema!==RESPONSE||!same(v.request,r))fail('REPLACEMENT_HISTORY_CARRIER_RESPONSE_MISMATCH');
  return mapSnapshot(v.snapshot,r,false);
}

// Context comes from the installed authenticated transport, NOT the request
// bytes. It must be checked before and after the one bounded call.
function connection({readOriginalPeerContext,getMode,localNodeRef,peerNodeRef,scopeRef,ownerEpoch}){
  if(![readOriginalPeerContext,getMode].every(f=>typeof f==='function')||![localNodeRef,peerNodeRef,scopeRef].every(ID)||
    localNodeRef===peerNodeRef||!Number.isSafeInteger(ownerEpoch)||ownerEpoch<1)fail('REPLACEMENT_HISTORY_CARRIER_PORTS_REQUIRED');
  const mode=()=>{if(getMode()!=='T4_NETWORK')fail('REPLACEMENT_HISTORY_NETWORK_MODE_OFF');};
  const read=async()=>{
    mode();const p=structuredClone(await readOriginalPeerContext());mode();
    if(p?.nodeRef!==peerNodeRef||!ID(p.originalPeerSessionRef)||!Number.isSafeInteger(p.contextEpoch)||p.contextEpoch<0||
      p.scopeRef!==scopeRef||p.ownerEpoch!==ownerEpoch||p.originalPeerAuthenticated!==true||p.originalConfidentialChannelVerified!==true)
      fail('REPLACEMENT_HISTORY_CARRIER_PEER_UNBOUND');
    return Object.freeze({nodeRef:p.nodeRef,originalPeerSessionRef:p.originalPeerSessionRef,contextEpoch:p.contextEpoch,
      scopeRef,ownerEpoch,originalPeerAuthenticated:true,originalConfidentialChannelVerified:true});
  };
  const unchanged=async prior=>{if(!same(prior,await read()))fail('REPLACEMENT_HISTORY_CARRIER_PEER_CHANGED');};
  const route=(raw,inbound)=>{
    const r=request(raw),c=r.session;
    if(r.requesterNodeRef!==(inbound?peerNodeRef:localNodeRef)||r.ownerNodeRef!==(inbound?localNodeRef:peerNodeRef)||
      c.scopeRef!==scopeRef||c.ownerEpoch!==ownerEpoch)fail('REPLACEMENT_HISTORY_CARRIER_ROUTE_MISMATCH');return r;
  };
  return {read,unchanged,route};
}
export function createT4OriginalReplacementHistoryClient({invokeOriginalPeerHistory,...ports}={}){
  if(typeof invokeOriginalPeerHistory!=='function')fail('REPLACEMENT_HISTORY_CARRIER_PORTS_REQUIRED');
  const c=connection(ports);
  return async raw=>{
    const r=c.route(raw,false),bytes=encodeT4OriginalReplacementHistoryRequest(r),prior=await c.read();
    const rawResult=await invokeOriginalPeerHistory({requestBytes:bytes,originalPeerContext:prior});
    if(!(rawResult instanceof Uint8Array)||rawResult.length>RESPONSE_LIMIT)fail('REPLACEMENT_HISTORY_CARRIER_SIZE_INVALID');
    const result=new Uint8Array(rawResult);
    await c.unchanged(prior);return decodeT4OriginalReplacementHistoryResponse(result,r);
  };
}
export function createT4OriginalReplacementHistoryServer({readOriginalReplacementOwnerHistory,...ports}={}){
  if(typeof readOriginalReplacementOwnerHistory!=='function')fail('REPLACEMENT_HISTORY_CARRIER_PORTS_REQUIRED');
  const c=connection(ports);
  return async bytes=>{
    const r=c.route(decodeT4OriginalReplacementHistoryRequest(bytes),true),prior=await c.read();
    const result=encodeT4OriginalReplacementHistoryResponse(await readOriginalReplacementOwnerHistory({request:r,peerContext:{nodeRef:prior.nodeRef,
      originalPeerSessionRef:prior.originalPeerSessionRef,contextEpoch:prior.contextEpoch}}),r);
    await c.unchanged(prior);return result;
  };
}
