import {createHash} from 'node:crypto';
import {T4_NATIVE_CHUNK_BYTES as CHUNK,T4_NATIVE_MAX_CHUNKS as PER_PART,
  T4_NATIVE_MAX_CIPHERTEXT_BYTES as PART,T4_NATIVE_MULTIPART_MAX_PARTS,
  T4_NATIVE_MULTIPART_MAX_CIPHERTEXT_BYTES,T4_NATIVE_MULTIPART_PROFILE} from './original-native-content-limits.mjs';

// Candidate extension only. Existing V1 plans, captures and publication
// limits stay unchanged. A multipart transfer is ONE sealed byte string,
// ONE source Event and ONE eventual original subject mutation.
export const T4_MULTIPART_OPAQUE_EXTENSION=T4_NATIVE_MULTIPART_PROFILE;
// The native compact route already reserves HEADS and DIFF_REQUEST at
// sequence 1 in each direction. Negotiate the content profile in those
// exact signed slots, without renumbering any existing content or ACK.
export const T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION='iwxa.native-multipart-agreement.v1';
export const T4_MULTIPART_MAX_PARTS=T4_NATIVE_MULTIPART_MAX_PARTS;
export const T4_MULTIPART_MAX_CIPHERTEXT_BYTES=T4_NATIVE_MULTIPART_MAX_CIPHERTEXT_BYTES;
export const T4_MULTIPART_MAX_CHUNKS=PER_PART*T4_MULTIPART_MAX_PARTS;
const SCHEMA='IWXA_T4_OPAQUE_MULTIPART_MANIFEST_V1';
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const DIG=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const int=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const keys=(o,k)=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===k.length&&k.every(x=>Object.hasOwn(o,x));
const fail=(code,details={})=>{throw Object.assign(Error(code),{code,details:Object.freeze(details)});};
const hash=x=>'sha256:'+createHash('sha256').update(x).digest('hex');
const sorted=x=>Array.isArray(x)?x.map(sorted):x&&typeof x==='object'?
  Object.fromEntries(Object.keys(x).sort().map(k=>[k,sorted(x[k])])):x;
const manifestDigest=body=>hash('IWXA-T4-OPAQUE-MULTIPART-MANIFEST-V1\0'+JSON.stringify(sorted(body)));
const fields=['schema','changeId','contentDigest','encryptionContextRef','totalCiphertextBytes','partCount','parts','manifestDigest'];
const offerCore=()=>({profile:T4_MULTIPART_OPAQUE_EXTENSION,maxCiphertextBytes:T4_MULTIPART_MAX_CIPHERTEXT_BYTES,
  partBytes:PART,chunkBytes:CHUNK,maxParts:T4_MULTIPART_MAX_PARTS});
const offerDigest=x=>hash('IWXA-T4-NATIVE-MULTIPART-OFFER-V1\0'+JSON.stringify(sorted(x)));
export function createT4NativeMultipartOffer(){
  const core=offerCore();return Object.freeze({...core,offerDigest:offerDigest(core)});
}
export function validateT4NativeMultipartOffer(value){
  const expected=createT4NativeMultipartOffer();
  if(!keys(value,Object.keys(expected))||Object.keys(expected).some(k=>value[k]!==expected[k]))
    fail('MULTIPART_NATIVE_OFFER_INVALID');
  return expected;
}
export function createT4NativeMultipartSelection({offer,headSha256}={}){
  const selected=validateT4NativeMultipartOffer(offer);
  if(typeof headSha256!=='string'||!/^[a-f0-9]{64}$/.test(headSha256))
    fail('MULTIPART_NATIVE_SELECTION_INVALID');
  return Object.freeze({profile:selected.profile,headSha256,offerDigest:selected.offerDigest});
}
export function validateT4NativeMultipartSelection(value){
  const expected=createT4NativeMultipartSelection({offer:createT4NativeMultipartOffer(),headSha256:value?.headSha256});
  if(!keys(value,Object.keys(expected))||Object.keys(expected).some(k=>value[k]!==expected[k]))
    fail('MULTIPART_NATIVE_SELECTION_INVALID');
  return expected;
}
const addressFields=['changeId','contentDigest','manifestDigest','partIndex','partCount','partDigest','chunkIndex','chunkCount'];
const chunkFields=[...addressFields,'ciphertextBase64','ciphertextSha256','encryptionContextRef'];
const snapshot=x=>structuredClone(x);
function freezeManifest(m){return Object.freeze({...m,parts:Object.freeze(m.parts.map(p=>Object.freeze(p)))});}
export function validateT4CandidateMultipartManifest(raw){
  if(!keys(raw,fields)||!Array.isArray(raw.parts)||!int(raw.parts.length,2,T4_MULTIPART_MAX_PARTS)||
    fields.filter(k=>k!=='parts').some(k=>!['string','number'].includes(typeof raw[k]))||
    raw.parts.some(p=>!keys(p,['partIndex','byteLength','chunkCount','partDigest'])||!DIG(p.partDigest)||
      !['partIndex','byteLength','chunkCount'].every(k=>typeof p[k]==='number')))fail('MULTIPART_MANIFEST_INVALID');
  const m=snapshot(raw);
  if(m.schema!==SCHEMA||!ID(m.changeId)||!ID(m.encryptionContextRef)||!DIG(m.contentDigest)||!DIG(m.manifestDigest)||
    !int(m.totalCiphertextBytes,PART+1,T4_MULTIPART_MAX_CIPHERTEXT_BYTES)||
    !int(m.partCount,2,T4_MULTIPART_MAX_PARTS)||m.partCount!==Math.ceil(m.totalCiphertextBytes/PART)||
    !Array.isArray(m.parts)||m.parts.length!==m.partCount)fail('MULTIPART_MANIFEST_INVALID');
  for(let i=0;i<m.partCount;i++){
    const p=m.parts[i],expected=Math.min(PART,m.totalCiphertextBytes-i*PART);
    if(!keys(p,['partIndex','byteLength','chunkCount','partDigest'])||p.partIndex!==i||p.byteLength!==expected||
      p.chunkCount!==Math.ceil(expected/CHUNK)||!DIG(p.partDigest))fail('MULTIPART_MANIFEST_INVALID');
  }
  const {manifestDigest:claimed,...body}=m;
  if(manifestDigest(body)!==claimed)fail('MULTIPART_MANIFEST_DIGEST_MISMATCH');
  return freezeManifest(m);
}
function validateAddress(body,m){
  if(!ID(body.changeId)||!DIG(body.contentDigest)||!DIG(body.manifestDigest)||!DIG(body.partDigest)||
    !int(body.partCount,2,T4_MULTIPART_MAX_PARTS)||!int(body.partIndex,0,body.partCount-1)||
    !int(body.chunkCount,1,PER_PART)||!int(body.chunkIndex,0,body.chunkCount-1)||
    (body.partIndex<body.partCount-1&&body.chunkCount!==PER_PART))fail('MULTIPART_CHUNK_ADDRESS_INVALID');
  if(m){const p=m.parts[body.partIndex];
    if(body.changeId!==m.changeId||body.contentDigest!==m.contentDigest||body.manifestDigest!==m.manifestDigest||
      body.partCount!==m.partCount||!p||body.partDigest!==p.partDigest||body.chunkCount!==p.chunkCount)
      fail('MULTIPART_CHUNK_MANIFEST_MISMATCH');}
}
export function validateT4CandidateMultipartChunkRequest(raw,manifest){
  if(!keys(raw,addressFields))fail('MULTIPART_CHUNK_REQUEST_INVALID');
  validateAddress(raw,null);
  const b=snapshot(raw),m=manifest===undefined?null:validateT4CandidateMultipartManifest(manifest);
  validateAddress(b,m);return Object.freeze(b);
}
function decodeChunk(raw,m){
  if(!keys(raw,chunkFields)||typeof raw.ciphertextBase64!=='string'||raw.ciphertextBase64.length>10924||
    !ID(raw.encryptionContextRef)||!DIG(raw.ciphertextSha256))fail('MULTIPART_CHUNK_INVALID');
  validateAddress(raw,m);
  const b=snapshot(raw);validateAddress(b,m);
  if(!ID(b.encryptionContextRef)||!DIG(b.ciphertextSha256)||typeof b.ciphertextBase64!=='string'||
    b.ciphertextBase64.length<4||b.ciphertextBase64.length>10924||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b.ciphertextBase64))
    fail('MULTIPART_CHUNK_INVALID');
  const data=Buffer.from(b.ciphertextBase64,'base64');
  const full=b.partIndex<b.partCount-1||b.chunkIndex<b.chunkCount-1;
  if(!int(data.length,1,CHUNK)||(full&&data.length!==CHUNK)||data.toString('base64')!==b.ciphertextBase64||hash(data)!==b.ciphertextSha256)
    fail('MULTIPART_CHUNK_INTEGRITY_FAILED');
  if(m&&(b.encryptionContextRef!==m.encryptionContextRef||data.length!==Math.min(CHUNK,m.parts[b.partIndex].byteLength-b.chunkIndex*CHUNK)))
    fail('MULTIPART_CHUNK_MANIFEST_MISMATCH');
  return {body:Object.freeze(b),data};
}
export function validateT4CandidateMultipartChunkBody(raw,manifest){
  return decodeChunk(raw,manifest===undefined?null:validateT4CandidateMultipartManifest(manifest)).body;
}
const address=(m,p,n)=>({changeId:m.changeId,contentDigest:m.contentDigest,manifestDigest:m.manifestDigest,
  partIndex:p.partIndex,partCount:m.partCount,partDigest:p.partDigest,chunkIndex:n,chunkCount:p.chunkCount});
export function t4CandidateMultipartChunkSequence(raw){
  if(!raw||typeof raw!=='object')fail('MULTIPART_CHUNK_ADDRESS_INVALID');
  validateAddress(raw,null);return 3+raw.partIndex*PER_PART+raw.chunkIndex;
}
async function guard(p,operation){
  if(p.getMode()!=='T4_NETWORK')fail('MULTIPART_NETWORK_MODE_OFF');
  if(await p.authorizeOriginalSealedContent(Object.freeze({operation,changeId:p.changeId,ownerRef:p.ownerRef,
    sourceContentRef:p.sourceContentRef,multipartProfile:T4_MULTIPART_OPAQUE_EXTENSION,
    originalSealedContentReadAuthorityRequired:true,networkCapabilityIsNotBusinessAuthority:true}))!==true)
    fail('MULTIPART_ORIGINAL_ACCESS_DENIED');
  if(p.getMode()!=='T4_NETWORK')fail('MULTIPART_NETWORK_MODE_OFF');
}
export async function prepareT4CandidateMultipartOpaqueChunks(p={}){
  const {changeId,ownerRef,sourceContentRef,getMode,authorizeOriginalSealedContent,readOriginalSealedContent}=p;
  if(![changeId,ownerRef,sourceContentRef].every(ID)||![getMode,authorizeOriginalSealedContent,readOriginalSealedContent].every(f=>typeof f==='function'))
    fail('MULTIPART_ORIGINAL_PORTS_REQUIRED');
  const request={changeId,ownerRef,sourceContentRef,getMode,authorizeOriginalSealedContent};
  await guard(request,'t4.network.sealed.read');
  const original=await readOriginalSealedContent(Object.freeze({changeId,ownerRef,sourceContentRef,
    multipartProfile:T4_MULTIPART_OPAQUE_EXTENSION,originalContentEncryptorRequired:true}));
  if(!(original?.ciphertext instanceof Uint8Array)||!int(original.ciphertext.byteLength,PART+1,T4_MULTIPART_MAX_CIPHERTEXT_BYTES)||
    !ID(original.encryptionContextRef))fail('MULTIPART_ORIGINAL_SEALED_CONTENT_INVALID');
  const ciphertext=Buffer.from(original.ciphertext),encryptionContextRef=original.encryptionContextRef;
  await guard(request,'t4.network.sealed.readback');
  const parts=[];
  for(let i=0;i<ciphertext.length;i+=PART){
    const data=ciphertext.subarray(i,i+PART);
    parts.push({partIndex:parts.length,byteLength:data.length,chunkCount:Math.ceil(data.length/CHUNK),partDigest:hash(data)});
  }
  const core={schema:SCHEMA,changeId,contentDigest:hash(ciphertext),encryptionContextRef,totalCiphertextBytes:ciphertext.length,partCount:parts.length,parts};
  const manifest=validateT4CandidateMultipartManifest({...core,manifestDigest:manifestDigest(core)});
  const bodies=[];
  for(const part of manifest.parts)for(let n=0;n<part.chunkCount;n++){
    const start=part.partIndex*PART+n*CHUNK,end=Math.min(start+CHUNK,part.partIndex*PART+part.byteLength),data=ciphertext.subarray(start,end);
    bodies.push(Object.freeze({...address(manifest,part,n),ciphertextBase64:data.toString('base64'),ciphertextSha256:hash(data),encryptionContextRef}));
  }
  return Object.freeze({schema:'IWXA_T4_CANDIDATE_OPAQUE_MULTIPART_PLAN_V1',manifest,bodies:Object.freeze(bodies),
    ownerRef,sourceContentRef,originalSealedContentPortUsed:true,originalSubjectWriteAuthorityGranted:false,
    e2eeKeyManagementVerified:false,originalBusinessApplied:false});
}
function readChunkSet(manifest,bodies,includeCiphertext){
  const m=validateT4CandidateMultipartManifest(manifest),total=m.parts.reduce((n,p)=>n+p.chunkCount,0);
  if(!Array.isArray(bodies)||bodies.length>total)fail('MULTIPART_CHUNK_SET_INVALID');
  const slots=new Map();
  for(const raw of bodies){const {body,data}=decodeChunk(raw,m),key=t4CandidateMultipartChunkSequence(body);
    if(slots.has(key))fail('MULTIPART_CHUNK_DUPLICATE');slots.set(key,data);}
  const missing=[],completeParts=[],parts=[];
  for(const p of m.parts){
    const chunks=[];let complete=true;
    for(let n=0;n<p.chunkCount;n++){
      const a=address(m,p,n),found=slots.get(t4CandidateMultipartChunkSequence(a));
      if(found===undefined){missing.push(Object.freeze(a));complete=false;}else chunks.push(found);
    }
    if(complete){const part=Buffer.concat(chunks);
      if(part.length!==p.byteLength||hash(part)!==p.partDigest)fail('MULTIPART_PART_INTEGRITY_FAILED');
      completeParts.push(p.partIndex);parts.push(part);}
  }
  const complete=missing.length===0;
  let ciphertext;
  if(complete){ciphertext=Buffer.concat(parts);
    if(ciphertext.length!==m.totalCiphertextBytes||hash(ciphertext)!==m.contentDigest)fail('MULTIPART_CONTENT_INTEGRITY_FAILED');}
  if(includeCiphertext&&!complete)fail('MULTIPART_CHUNKS_INCOMPLETE',{missingCount:missing.length});
  const result={schema:includeCiphertext?'IWXA_T4_CANDIDATE_MULTIPART_CIPHERTEXT_ASSEMBLED_V1':'IWXA_T4_CANDIDATE_MULTIPART_CHUNK_STATUS_V1',
    changeId:m.changeId,manifestDigest:m.manifestDigest,contentDigest:m.contentDigest,encryptionContextRef:m.encryptionContextRef,
    chunkCount:total,chunksVerified:slots.size,completeParts:Object.freeze(completeParts),missing:Object.freeze(missing),complete,
    transportContentIntegrityVerified:complete,originalDecryptionNotInvoked:true,originalBusinessApplied:false};
  return Object.freeze(includeCiphertext?{...result,ciphertext:new Uint8Array(ciphertext)}:result);
}
export const inspectT4CandidateMultipartChunks=({manifest,bodies}={})=>readChunkSet(manifest,bodies,false);
export const assembleT4CandidateMultipartOpaqueChunks=({manifest,bodies}={})=>readChunkSet(manifest,bodies,true);
