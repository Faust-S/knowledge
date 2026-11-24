import {createHash} from 'node:crypto';
import {T4_ORIGINAL_SOURCE_SESSION_EXTENSION} from './standard-network-wire-candidate.mjs';
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const POS=x=>Number.isSafeInteger(x)&&x>=1;
const fail=code=>{throw Object.assign(Error(code),{code});};
const key=(domain,fields)=>createHash('sha256').update('IWXA-T4-FRAME-INDEX-V1\0'+domain+'\0')
  .update(JSON.stringify(fields)).digest('hex')+'.t4i';
function peer(input){
  const {sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch}=input??{};
  if(![sourceNodeRef,recipientNodeRef,scopeRef].every(ID)||sourceNodeRef===recipientNodeRef||!POS(ownerEpoch))
    fail('FRAME_INDEX_SCOPE_INVALID');
  return [sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch];
}
// A slot is a transport address, never an original signature or authority.
export function t4NativeSessionFrameIndexKey(input){
  if(!ID(input?.sessionRef)||!POS(input.sequence))fail('FRAME_INDEX_SLOT_INVALID');
  return key('session',[...peer(input),input.sessionRef,input.sequence]);
}
export function t4NativeSourceHeadIndexKey(input){
  if(!ID(input?.familyRef)||!POS(input.predecessorEventCount)||
    input.predecessorEventCount>=Number.MAX_SAFE_INTEGER)fail('FRAME_INDEX_HEAD_INVALID');
  // A different predecessor digest at the same count must contend for the
  // same immutable slot, not become another address.
  return key('source-head',[...peer(input),input.familyRef,input.predecessorEventCount]);
}
export function t4NativeFrameIndexKeys(frame){
  const keys=[t4NativeSessionFrameIndexKey(frame)];
  if(frame.messageType==='HEADS'&&frame.criticalExtensions?.includes(T4_ORIGINAL_SOURCE_SESSION_EXTENSION)){
    if(frame.sequence!==1||frame.body.ownerEpoch!==frame.ownerEpoch)fail('FRAME_INDEX_HEAD_INVALID');
    keys.push(t4NativeSourceHeadIndexKey({...frame,familyRef:frame.body.familyRef,
      predecessorEventCount:frame.body.sourceSession?.predecessorEventCount}));
  }
  return Object.freeze(keys);
}
export function encodeT4NativeFrameIndex(sha256){
  if(!SHA(sha256))fail('FRAME_INDEX_DIGEST_INVALID');
  return Buffer.from(JSON.stringify({schema:'IWXA_T4_FRAME_ADDRESS_V1',frameSha256:sha256}),'utf8');
}
export function decodeT4NativeFrameIndex(raw){
  if(!(raw instanceof Uint8Array)||!raw.length||raw.length>256)fail('FRAME_INDEX_BYTES_INVALID');
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{fail('FRAME_INDEX_BYTES_INVALID');}
  if(value?.schema!=='IWXA_T4_FRAME_ADDRESS_V1'||!SHA(value.frameSha256)||
    !Buffer.from(raw).equals(encodeT4NativeFrameIndex(value.frameSha256)))fail('FRAME_INDEX_BYTES_INVALID');
  return value.frameSha256;
}
