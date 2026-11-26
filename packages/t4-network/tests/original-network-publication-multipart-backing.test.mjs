import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign,verify} from 'node:crypto';
import {createT4CandidateUnsignedFrame,signT4CandidateFrame,decodeT4CandidateFrame,
  T4_ORIGINAL_SOURCE_SESSION_EXTENSION} from '../src/network/standard-network-wire-candidate.mjs';
import {prepareT4CandidateMultipartOpaqueChunks,T4_MULTIPART_OPAQUE_EXTENSION as EXT,
  T4_MULTIPART_MAX_CIPHERTEXT_BYTES,assembleT4CandidateMultipartOpaqueChunks}
  from '../src/network/standard-network-multipart-opaque-chunks.mjs';
import {createT4OriginalMultipartBacking as build,readT4OriginalMultipartBacking as read,
  verifyT4OriginalMultipartBackingSignatures as verifyBacking,T4_MULTIPART_BACKING_MAX_RECORD_BYTES}
  from '../src/network/original-network-publication-multipart-backing.mjs';
const sorted=x=>Array.isArray(x)?x.map(sorted):x&&typeof x==='object'?
  Object.fromEntries(Object.keys(x).sort().map(k=>[k,sorted(x[k])])):x;
const hex=x=>createHash('sha256').update(x).digest('hex');
const digest=(domain,x)=>hex('IWXA-T4-ORIGINAL-'+domain+'-V1\0'+JSON.stringify(sorted(x)));
const d=x=>'sha256:'+hex(x);
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const signature=async p=>sign(null,p.bytes,privateKey);
const verifyOriginalNodeSignature=async p=>verify(null,p.bytes,publicKey,p.signature);
const family={workspaceId:'workspace:subject',originalWriteOwnerRef:'owner:1',sourceNodeRef:'node:source',recipientNodeRef:'node:recipient',scopeRef:'scope:1'};
const key={...family,ownerEpoch:1,sourceEventId:'event:source:1'};
const session={schema:'IWXA_T4_ORIGINAL_NATIVE_CAPTURE_SESSION_V1',...key,sourceRevision:3,
  sourceEventDigest:d('event'),sourcePrefixDigestBefore:d('before'),sourcePrefixDigestAfter:d('after'),
  capturedWindowDigest:d('window'),capturedSha256:hex('asset'),changeKind:'ASSET_PUT',
  familyRef:'family:t4:'+digest('NATIVE-FAMILY',family),sessionRef:'session:t4:'+digest('NATIVE-SESSION',key),
  changeId:'change:t4:'+digest('NATIVE-CHANGE',key)};
const route={sourceNodeRef:session.sourceNodeRef,recipientNodeRef:session.recipientNodeRef,
  scopeRef:session.scopeRef,sessionRef:session.sessionRef,ownerEpoch:session.ownerEpoch,
  cryptoSuite:'suite:ed25519',permissionRef:'permission:source',signerRef:'signer:source'};
const signed=async (messageType,body,sequence,criticalExtensions,overrides={})=>signT4CandidateFrame({
  unsignedFrame:createT4CandidateUnsignedFrame({...route,messageType,body,sequence,criticalExtensions,messageId:'message:'+sequence,...overrides}),
  signOriginalNodeBytes:signature});
const headWireBytes=await signed('HEADS',{familyRef:session.familyRef,ownerEpoch:session.ownerEpoch,heads:[session.sourcePrefixDigestAfter],
  sourceSession:{predecessorEventId:'event:source:previous',predecessorEventCount:2,predecessorPrefixDigest:session.sourcePrefixDigestBefore,
    sourceEventId:session.sourceEventId,sourceEventDigest:session.sourceEventDigest,sourceRevision:session.sourceRevision,changeKind:'ASSET_PUT',
    capturedWindowDigest:session.capturedWindowDigest,capturedSha256:session.capturedSha256}},1,[T4_ORIGINAL_SOURCE_SESSION_EXTENSION]);
const technicalWorkspaceId='workspace:technical';
const checkpointRef='t4:net:publish:'+digest('PUBLICATION-KEY',{sessionRef:session.sessionRef,localNodeRef:session.sourceNodeRef,technicalWorkspaceId});
const rootAnchor={revision:3,chainHash:d('root-chain'),presentEventId:'event:root:3',headSha256:hex(headWireBytes)};
const anchor={session,technicalWorkspaceId,checkpointRef,rootAnchor,headWireBytes};
async function fixture(n=524289){
  const opaque=await prepareT4CandidateMultipartOpaqueChunks({changeId:session.changeId,ownerRef:session.originalWriteOwnerRef,sourceContentRef:'asset:1',
    getMode:()=> 'T4_NETWORK',authorizeOriginalSealedContent:async()=>true,
    readOriginalSealedContent:async()=>({ciphertext:Buffer.alloc(n,23),encryptionContextRef:'context:1'})});
  const body={changeId:session.changeId,changeKind:'ASSET_PUT',eventRef:session.sourceEventId,ownerRef:session.originalWriteOwnerRef,
    sourceRevision:session.sourceRevision,contentDigest:opaque.manifest.contentDigest,parents:[session.sourcePrefixDigestBefore],multipartManifest:opaque.manifest};
  const wireBytes=[await signed('CHANGE_REF',body,2,[EXT]),...await Promise.all(opaque.bodies.map((b,i)=>signed('CHUNK',b,i+3,[EXT])))];
  return {...anchor,wireBytes,opaque,body};
}
const small=await fixture(),candidate=build(small);
const input={...anchor,plan:candidate.plan,segments:candidate.segments};
const code=x=>({code:x});
function changeFrame(w,changes){const decoded=decodeT4CandidateFrame(w);return signed(decoded.messageType,decoded.body,decoded.sequence,decoded.criticalExtensions,changes);}

test('existing root identity, deterministic plan, exact bounded segments and cold byte reconstruction',()=>{
  assert.equal(candidate.plan.segments.length,2);assert.equal(candidate.plan.frameCount,66);
  assert.deepEqual(candidate.plan.segments.map(x=>x.frameCount),[64,1]);
  assert.equal(candidate.originalPublicationStateCreated,false);assert.equal(candidate.originalRootReservationRequired,true);
  assert.ok(candidate.segments.every(s=>Buffer.byteLength(JSON.stringify(s))<=T4_MULTIPART_BACKING_MAX_RECORD_BYTES));
  assert.ok(Buffer.byteLength(JSON.stringify(candidate.plan))<32000);
  assert.equal(build({...small,wireBytes:[...small.wireBytes].reverse()}).plan.planDigest,candidate.plan.planDigest);
  const cold=JSON.parse(JSON.stringify({plan:candidate.plan,segments:candidate.segments}));
  const r=read({...anchor,...cold,segments:cold.segments.reverse()});
  assert.deepEqual(r.wireBytes,small.wireBytes);assert.equal(r.originalSignatureVerified,false);
  assert.equal(r.originalObjectEventReadbackVerified,false);assert.equal(r.originalBusinessApplied,false);
});
test('actual signatures on head and all reconstructed frames use existing outbound verifier',async()=>{
  let verified=0;
  const r=await verifyBacking({...input,verifyOriginalNodeSignature:async p=>{verified++;return verifyOriginalNodeSignature(p);}});
  assert.equal(verified,67);assert.equal(r.originalSignatureVerified,true);assert.equal(r.originalPublicationAuthorityGranted,false);
  assert.deepEqual(r.wireBytes,small.wireBytes);
});
test('same manifest cannot be inserted into another session, source, recipient, epoch, scope or suite',async()=>{
  for(const change of [{sessionRef:'session:other'},{sourceNodeRef:'node:foreign'},{recipientNodeRef:'node:foreign'},
    {ownerEpoch:2},{scopeRef:'scope:other'},{cryptoSuite:'suite:other'}]){
    const w=[...small.wireBytes];w[1]=await changeFrame(w[1],change);
    assert.throws(()=>build({...small,wireBytes:w}),code('MULTIPART_BACKING_ROUTE_MISMATCH'));
  }
});
test('wrong original source event, owner, revision or predecessor is not a backing plan',async()=>{
  for(const change of [{eventRef:'event:other'},{ownerRef:'owner:other'},{sourceRevision:4},{parents:[d('other')]}]){
    const w=[...small.wireBytes];w[0]=await signed('CHANGE_REF',{...small.body,...change},2,[EXT]);
    assert.throws(()=>build({...small,wireBytes:w}),code('MULTIPART_BACKING_CHANGE_MISMATCH'));
  }
});
test('root, head, exact session and root revision cannot be substituted',()=>{
  assert.throws(()=>build({...small,checkpointRef:'t4:net:publish:other'}),code('MULTIPART_BACKING_ROOT_INVALID'));
  assert.throws(()=>build({...small,session:{...session,sessionRef:'session:other'}}),code('MULTIPART_BACKING_SESSION_INVALID'));
  assert.throws(()=>build({...small,rootAnchor:{...rootAnchor,headSha256:hex('wrong')}}),code('MULTIPART_BACKING_HEAD_MISMATCH'));
  assert.throws(()=>read({...input,rootAnchor:{...rootAnchor,revision:4}}),code('MULTIPART_BACKING_ROOT_CHANGED'));
  assert.throws(()=>read({...input,rootAnchor:{...rootAnchor,chainHash:d('other')}}),code('MULTIPART_BACKING_ROOT_CHANGED'));
});
test('duplicate message ids, sequences, missing frames and extra frames fail closed',async()=>{
  const w=[...small.wireBytes];w[1]=await changeFrame(w[1],{messageId:'message:1'});
  assert.throws(()=>build({...small,wireBytes:w}),code('MULTIPART_BACKING_FRAME_ORDER_INVALID'));
  assert.throws(()=>build({...small,wireBytes:[...small.wireBytes.slice(0,-1),small.wireBytes[1]]}),code('MULTIPART_BACKING_FRAME_ORDER_INVALID'));
  assert.throws(()=>build({...small,wireBytes:small.wireBytes.slice(0,-1)}),code('MULTIPART_BACKING_FRAME_COUNT_INVALID'));
  assert.throws(()=>build({...small,wireBytes:[...small.wireBytes,small.wireBytes[1]]}),code('MULTIPART_BACKING_FRAME_ORDER_INVALID'));
});
test('root-selected plan rejects missing, duplicate or tampered content segments',()=>{
  const {segments,plan}=structuredClone(candidate);
  assert.throws(()=>read({...anchor,plan,segments:segments.slice(0,1)}),code('MULTIPART_BACKING_PLAN_INVALID'));
  assert.throws(()=>read({...anchor,plan,segments:[segments[0],segments[0]]}),code('MULTIPART_BACKING_SEGMENT_INVALID'));
  segments[0].recordDigest=d('tampered');
  assert.throws(()=>read({...anchor,plan,segments}),code('MULTIPART_BACKING_PLAN_CHANGED'));
  const fresh=structuredClone(candidate);fresh.plan.segments[0].frameCount=1;
  assert.throws(()=>read({...anchor,...fresh}),code('MULTIPART_BACKING_PLAN_CHANGED'));
  const altered=structuredClone(candidate);altered.segments[0].entries[0].sha256=hex('altered');
  assert.throws(()=>read({...anchor,...altered}),code('MULTIPART_BACKING_FRAME_CHANGED'));
});
test('structurally consistent but forged signed bytes never pass existing signature verifier',async()=>{
  const w=[...small.wireBytes],decoded=decodeT4CandidateFrame(w[1]);decoded.messageId='message:tampered';
  w[1]=new Uint8Array(Buffer.from(JSON.stringify(decoded)));
  const result=build({...small,wireBytes:w});
  assert.equal(read({...anchor,...result}).originalSignatureVerified,false);
  await assert.rejects(verifyBacking({...anchor,...result,verifyOriginalNodeSignature}),code('WIRE_SOURCE_SIGNATURE_NOT_VERIFIED'));
});
test('maximum 8 MiB sealed batch is separated into 16 bounded content records, no wire payload copied into root descriptors',async()=>{
  const max=await fixture(T4_MULTIPART_MAX_CIPHERTEXT_BYTES),result=build(max);
  assert.equal(result.segments.length,16);assert.equal(result.plan.frameCount,1025);
  assert.ok(result.segments.every(s=>Buffer.byteLength(JSON.stringify(s))<=T4_MULTIPART_BACKING_MAX_RECORD_BYTES));
  assert.ok(Buffer.byteLength(JSON.stringify(result.plan))<32000);
  assert.ok(result.segments.every(s=>s.entries.length===64));
  const r=read({...anchor,...result});assert.deepEqual(r.wireBytes,max.wireBytes);
  const assembled=assembleT4CandidateMultipartOpaqueChunks({manifest:max.opaque.manifest,bodies:r.wireBytes.slice(1).map(w=>decodeT4CandidateFrame(w).body)});
  assert.equal(assembled.ciphertext.length,T4_MULTIPART_MAX_CIPHERTEXT_BYTES);assert.equal(assembled.contentDigest,result.plan.contentDigest);
});
