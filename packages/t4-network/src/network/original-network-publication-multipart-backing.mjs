import {createHash} from 'node:crypto';
import {decodeT4CandidateFrame,verifyT4CandidateOutboundSignature,
  T4_ORIGINAL_SOURCE_SESSION_EXTENSION} from './standard-network-wire-candidate.mjs';
import {T4_MULTIPART_OPAQUE_EXTENSION,T4_MULTIPART_MAX_CHUNKS,
  validateT4CandidateMultipartManifest,assembleT4CandidateMultipartOpaqueChunks}
  from './standard-network-multipart-opaque-chunks.mjs';

// Candidate content backing for the existing original publication root.
// No Store, CAS state, permission, transmission, or subject mutation lives here.
// The caller must reserve the selected plan through the original root CAS,
// then verify its original Object/Event readbacks before admitting publication.
const PLAN='IWXA_T4_ORIGINAL_MULTIPART_BACKING_PLAN_V1';
const SEGMENT='IWXA_T4_ORIGINAL_MULTIPART_BACKING_SEGMENT_V1';
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const DIG=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const integer=x=>Number.isSafeInteger(x)&&x>=1;
const fail=code=>{throw Object.assign(Error(code),{code});};
const sorted=x=>Array.isArray(x)?x.map(sorted):x&&typeof x==='object'?
  Object.fromEntries(Object.keys(x).sort().map(k=>[k,sorted(x[k])])):x;
const canonical=x=>JSON.stringify(sorted(x));
const same=(a,b)=>canonical(a)===canonical(b);
const hex=x=>createHash('sha256').update(x).digest('hex');
const digest=(domain,x)=>'sha256:'+createHash('sha256').update(domain+'\0').update(canonical(x)).digest('hex');
const keys=(x,expected)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  Object.keys(x).length===expected.length&&expected.every(k=>Object.hasOwn(x,k));
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
export const T4_MULTIPART_BACKING_MAX_RECORD_BYTES=1024*1024;
export const T4_MULTIPART_BACKING_SEGMENT_PREFIX='t4:net:publish-content:';
const budget=x=>{if(Buffer.byteLength(canonical(x),'utf8')>T4_MULTIPART_BACKING_MAX_RECORD_BYTES)
  fail('MULTIPART_BACKING_RECORD_TOO_LARGE');};
const fields=['schema','workspaceId','originalWriteOwnerRef','sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch',
  'sourceEventId','sourceRevision','sourceEventDigest','sourcePrefixDigestBefore','sourcePrefixDigestAfter',
  'capturedWindowDigest','capturedSha256','changeKind','familyRef','sessionRef','changeId'];
function validateSession(s){
  if(!keys(s,fields)||s.schema!=='IWXA_T4_ORIGINAL_NATIVE_CAPTURE_SESSION_V1'||s.changeKind!=='ASSET_PUT'||
    !['workspaceId','originalWriteOwnerRef','sourceNodeRef','recipientNodeRef','scopeRef','sourceEventId',
      'familyRef','sessionRef','changeId'].every(k=>ID(s[k]))||s.sourceNodeRef===s.recipientNodeRef||
    !integer(s.ownerEpoch)||!integer(s.sourceRevision)||!SHA(s.capturedSha256)||
    !['sourceEventDigest','sourcePrefixDigestBefore','sourcePrefixDigestAfter','capturedWindowDigest'].every(k=>DIG(s[k]))||
    s.sourcePrefixDigestBefore===s.sourcePrefixDigestAfter)fail('MULTIPART_BACKING_SESSION_INVALID');
  // These are the existing original publication identity derivations. Never
  // derive a second family, session, change or publication root for a part.
  const {workspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch,sourceEventId}=s;
  const family={workspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,scopeRef};
  const key={...family,ownerEpoch,sourceEventId};
  const original=(name,value)=>digest('IWXA-T4-ORIGINAL-'+name+'-V1',value).slice(7);
  if(s.familyRef!=='family:t4:'+original('NATIVE-FAMILY',family)||
    s.sessionRef!=='session:t4:'+original('NATIVE-SESSION',key)||s.changeId!=='change:t4:'+original('NATIVE-CHANGE',key))
    fail('MULTIPART_BACKING_SESSION_INVALID');
  return structuredClone(s);
}
function frame(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.byteLength>32768)fail('MULTIPART_BACKING_FRAME_INVALID');
  const data=Buffer.from(bytes),decoded=decodeT4CandidateFrame(data);
  const wireText=data.toString('utf8');
  return {decoded,entry:{sequence:decoded.sequence,messageType:decoded.messageType,sha256:hex(data),wireText}};
}
function readEntry(e){
  if(!keys(e,['sequence','messageType','sha256','wireText'])||typeof e.wireText!=='string'||e.wireText.length>32768||!SHA(e.sha256))
    fail('MULTIPART_BACKING_FRAME_INVALID');
  const f=frame(Buffer.from(e.wireText,'utf8'));
  if(!same(f.entry,e))fail('MULTIPART_BACKING_FRAME_CHANGED');
  return f;
}
function route(f,s,head){
  if(!['sourceNodeRef','recipientNodeRef','scopeRef','sessionRef','ownerEpoch'].every(k=>f[k]===s[k])||
    (head&&f.cryptoSuite!==head.cryptoSuite))fail('MULTIPART_BACKING_ROUTE_MISMATCH');
}
function anchor({session,technicalWorkspaceId,checkpointRef,rootAnchor,headWireBytes}={}){
  const s=validateSession(session);
  if(!ID(technicalWorkspaceId)||technicalWorkspaceId===s.workspaceId||
    checkpointRef!=='t4:net:publish:'+digest('IWXA-T4-ORIGINAL-PUBLICATION-KEY-V1',{
      sessionRef:s.sessionRef,localNodeRef:s.sourceNodeRef,technicalWorkspaceId}).slice(7)||
    !keys(rootAnchor,['revision','chainHash','presentEventId','headSha256'])||!integer(rootAnchor.revision)||
    !DIG(rootAnchor.chainHash)||!ID(rootAnchor.presentEventId)||!SHA(rootAnchor.headSha256))fail('MULTIPART_BACKING_ROOT_INVALID');
  const h=frame(headWireBytes),b=h.decoded.body,a=b.sourceSession;route(h.decoded,s);
  if(h.decoded.sequence!==1||h.decoded.messageType!=='HEADS'||
    !same(h.decoded.criticalExtensions,[T4_ORIGINAL_SOURCE_SESSION_EXTENSION])||
    h.entry.sha256!==rootAnchor.headSha256||b.familyRef!==s.familyRef||b.ownerEpoch!==s.ownerEpoch||
    !same(b.heads,[s.sourcePrefixDigestAfter])||!a||a.predecessorPrefixDigest!==s.sourcePrefixDigestBefore||
    !['sourceEventId','sourceEventDigest','sourceRevision','changeKind','capturedWindowDigest','capturedSha256'].every(k=>a[k]===s[k]))
    fail('MULTIPART_BACKING_HEAD_MISMATCH');
  return {session:s,technicalWorkspaceId,checkpointRef,rootAnchor:structuredClone(rootAnchor),head:h};
}
function validateContentFrame(f,a){
  route(f,a.session,a.head.decoded);
  if(!same(f.criticalExtensions,[T4_MULTIPART_OPAQUE_EXTENSION]))fail('MULTIPART_BACKING_EXTENSION_REQUIRED');
  if(f.messageType!=='CHANGE_REF'&&f.messageType!=='CHUNK')fail('MULTIPART_BACKING_FRAME_TYPE_INVALID');
  if(f.body.changeId!==a.session.changeId)fail('MULTIPART_BACKING_CHANGE_MISMATCH');
}
function content(a,entries){
  if(!Array.isArray(entries)||entries.length<66||entries.length>T4_MULTIPART_MAX_CHUNKS+1)fail('MULTIPART_BACKING_FRAME_COUNT_INVALID');
  const frames=entries.map(readEntry).sort((x,y)=>x.entry.sequence-y.entry.sequence);
  const messages=new Set([a.head.decoded.messageId]);
  for(let i=0;i<frames.length;i++){
    const f=frames[i].decoded;validateContentFrame(f,a);
    if(f.sequence!==i+2||messages.has(f.messageId)||f.messageType!==(i===0?'CHANGE_REF':'CHUNK'))
      fail('MULTIPART_BACKING_FRAME_ORDER_INVALID');
    messages.add(f.messageId);
  }
  const change=frames[0].decoded.body,s=a.session;
  if(change.eventRef!==s.sourceEventId||change.changeKind!==s.changeKind||change.ownerRef!==s.originalWriteOwnerRef||
    change.sourceRevision!==s.sourceRevision||!same(change.parents,[s.sourcePrefixDigestBefore]))fail('MULTIPART_BACKING_CHANGE_MISMATCH');
  const manifest=validateT4CandidateMultipartManifest(change.multipartManifest);
  const assembled=assembleT4CandidateMultipartOpaqueChunks({manifest,bodies:frames.slice(1).map(f=>f.decoded.body)});
  return {frames,manifest,assembled};
}
function planOf(a,c){
  const binding={session:a.session,technicalWorkspaceId:a.technicalWorkspaceId,checkpointRef:a.checkpointRef,rootAnchor:a.rootAnchor};
  const bindingDigest=digest('IWXA-T4-MULTIPART-BACKING-BINDING-V1',binding);
  const segments=c.manifest.parts.map(p=>{
    const entries=c.frames.slice(1).filter(f=>f.decoded.body.partIndex===p.partIndex).map(f=>f.entry);
    const data={schema:SEGMENT,bindingDigest,checkpointRef:a.checkpointRef,manifestDigest:c.manifest.manifestDigest,
      partIndex:p.partIndex,entries};
    const recordDigest=digest('IWXA-T4-MULTIPART-BACKING-SEGMENT-V1',data);
    const objectId=T4_MULTIPART_BACKING_SEGMENT_PREFIX+recordDigest.slice(7);
    const record={...data,recordDigest,objectId};budget(record);return freeze(record);
  });
  const descriptors=segments.map(s=>({partIndex:s.partIndex,objectId:s.objectId,recordDigest:s.recordDigest,
    firstSequence:s.entries[0].sequence,lastSequence:s.entries.at(-1).sequence,frameCount:s.entries.length}));
  const planCore={schema:PLAN,binding,bindingDigest,manifestDigest:c.manifest.manifestDigest,
    contentDigest:c.manifest.contentDigest,changeRef:c.frames[0].entry,segments:descriptors,frameCount:c.frames.length};
  const plan={...planCore,planDigest:digest('IWXA-T4-MULTIPART-BACKING-PLAN-V1',planCore)};budget(plan);
  return freeze({plan,segments,originalRootReservationRequired:true,originalPublicationStateCreated:false,
    originalObjectEventReadbackVerified:false,originalBusinessApplied:false});
}
export function createT4OriginalMultipartBacking({wireBytes,...p}={}){
  const a=anchor(p);
  if(!Array.isArray(wireBytes)||wireBytes.length<66||wireBytes.length>T4_MULTIPART_MAX_CHUNKS+1)
    fail('MULTIPART_BACKING_FRAME_COUNT_INVALID');
  const c=content(a,wireBytes.map(w=>frame(w).entry));return planOf(a,c);
}
// Reconstruct against the exact original root-selected plan. A valid segment
// by itself is NEVER a reservation, PREPARE, PRESENT, or authorization.
export function readT4OriginalMultipartBacking({plan,segments,...p}={}){
  const a=anchor(p);
  if(!plan||typeof plan!=='object'||!keys(plan,['schema','binding','bindingDigest','manifestDigest','contentDigest','changeRef',
    'segments','frameCount','planDigest'])||!Array.isArray(plan.segments)||plan.segments.length<2||plan.segments.length>16||
    !Array.isArray(segments)||segments.length!==plan.segments.length)fail('MULTIPART_BACKING_PLAN_INVALID');
  if(!keys(plan.binding,['session','technicalWorkspaceId','checkpointRef','rootAnchor'])||
    !keys(plan.binding.rootAnchor,['revision','chainHash','presentEventId','headSha256'])||
    !same(validateSession(plan.binding.session),a.session)||
    plan.segments.some(x=>!keys(x,['partIndex','objectId','recordDigest','firstSequence','lastSequence','frameCount']))||
    !same(plan.binding,{session:a.session,technicalWorkspaceId:a.technicalWorkspaceId,checkpointRef:a.checkpointRef,rootAnchor:a.rootAnchor}))
    fail('MULTIPART_BACKING_ROOT_CHANGED');
  const entries=[plan.changeRef],seen=new Set();
  for(const s of segments){
    if(!keys(s,['schema','bindingDigest','checkpointRef','manifestDigest','partIndex','entries','recordDigest','objectId'])||
      !Array.isArray(s.entries)||s.entries.length<1||s.entries.length>64||!ID(s.objectId)||seen.has(s.objectId))
      fail('MULTIPART_BACKING_SEGMENT_INVALID');
    seen.add(s.objectId);entries.push(...s.entries);
  }
  const c=content(a,entries),expected=planOf(a,c);
  const observed=[...segments].sort((x,y)=>x.partIndex-y.partIndex);
  if(!same(expected.plan,plan)||!same(expected.segments,observed))fail('MULTIPART_BACKING_PLAN_CHANGED');
  return Object.freeze({wireBytes:Object.freeze(c.frames.map(f=>new Uint8Array(Buffer.from(f.entry.wireText,'utf8')))),
    planDigest:plan.planDigest,contentDigest:plan.contentDigest,exactSignedBytesReconstructed:true,
    originalSignatureVerified:false,originalObjectEventReadbackVerified:false,originalPublicationStateCreated:false,
    originalBusinessApplied:false});
}
// Reuse the existing signature verifier, never turn structural reconstruction
// into original authority. Snapshot all bytes before the first async call.
export async function verifyT4OriginalMultipartBackingSignatures({verifyOriginalNodeSignature,...input}={}){
  if(typeof verifyOriginalNodeSignature!=='function')fail('MULTIPART_BACKING_SIGNER_REQUIRED');
  if(!(input.headWireBytes instanceof Uint8Array))fail('MULTIPART_BACKING_FRAME_INVALID');
  const head=Buffer.from(input.headWireBytes),result=readT4OriginalMultipartBacking({...input,headWireBytes:head});
  for(const wireBytes of [head,...result.wireBytes])await verifyT4CandidateOutboundSignature({wireBytes,verifyOriginalNodeSignature});
  return Object.freeze({...result,originalSignatureVerified:true,originalPublicationAuthorityGranted:false});
}
