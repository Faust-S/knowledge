import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,verify,createHash} from 'node:crypto';
import {T4_CANDIDATE_VERSION as VERSION,T4_MULTIPART_OPAQUE_EXTENSION as EXT,
  T4_RELATION_EVENT_EXTENSION,createT4CandidateUnsignedFrame as frame,signT4CandidateFrame as signed,
  decodeT4CandidateFrame as decode,decodeT4CandidateSigningBytes,verifyT4CandidateOutboundSignature,
  verifyT4CandidateWireFrame as receive,verifyT4CandidateHistoricalFrameSignature,
  negotiateT4CandidateMultipartCapabilities as negotiate} from '../src/network/standard-network-wire-candidate.mjs';
import {prepareT4CandidateMultipartOpaqueChunks,assembleT4CandidateMultipartOpaqueChunks,
  t4CandidateMultipartChunkSequence as sequence} from '../src/network/standard-network-multipart-opaque-chunks.mjs';
const suite='suite:ed25519',route={messageId:'message:1',sourceNodeRef:'node:A',recipientNodeRef:'node:B',
  scopeRef:'scope:1',sessionRef:'session:1',permissionRef:'permission:1',signerRef:'key:A',ownerEpoch:1,cryptoSuite:suite};
const plan=await prepareT4CandidateMultipartOpaqueChunks({changeId:'change:1',ownerRef:'owner:1',sourceContentRef:'asset:1',
  getMode:()=> 'T4_NETWORK',authorizeOriginalSealedContent:async()=>true,
  readOriginalSealedContent:async()=>({ciphertext:Buffer.alloc(524289,19),encryptionContextRef:'context:1'})});
const body={changeId:plan.manifest.changeId,changeKind:'ASSET_PUT',eventRef:'event:1',ownerRef:'owner:1',sourceRevision:1,
  contentDigest:plan.manifest.contentDigest,parents:[],multipartManifest:plan.manifest};
const advertisement={supportedVersions:[VERSION],supportedCryptoSuites:[suite],supportedCriticalExtensions:[EXT]};
const create=(messageType,body,sequence,overrides={})=>frame({...route,messageType,body,sequence,criticalExtensions:[EXT],...overrides});
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const signOriginalNodeBytes=async ({bytes})=>{decodeT4CandidateSigningBytes(bytes);return sign(null,bytes,privateKey);};
const verifyOriginalNodeSignature=async ({bytes,signature})=>verify(null,bytes,publicKey,signature);
const wire=f=>signed({unsignedFrame:f,signOriginalNodeBytes});
const code=x=>({code:x});
function ports(overrides={}){let calls={verify:0,access:0,replay:0};const decisions=new Map();return {calls,options:{
  recipientNodeRef:route.recipientNodeRef,scopeRef:route.scopeRef,requiredCryptoSuite:suite,
  supportedCriticalExtensions:[EXT],selectedCriticalExtensions:[EXT],
  verifyOriginalNodeSignature:async p=>{calls.verify++;return verifyOriginalNodeSignature(p);},
  authorizeOriginalNetwork:async p=>{calls.access++;assert.equal(p.advertisedCapabilityIsNotAuthority,true);return true;},
  persistOriginalReplayDecision:async p=>{calls.replay++;const k=[p.sourceNodeRef,p.sessionRef,p.ownerEpoch,p.sequence].join('/');
    const prior=decisions.get(k);if(prior===undefined){decisions.set(k,p.frameDigest);return 'RECORDED';}return prior===p.frameDigest?'SEEN_EXACT':'CONFLICT';},...overrides}};}

test('signed capability advertisement preserves explicit negotiation; no implicit extension',async()=>{
  const f=create('CAPABILITIES',advertisement,1),w=await wire(f);
  const {options}=ports({selectedCriticalExtensions:[]});const v=await receive({...options,wireBytes:w});
  assert.equal(v.originalSignatureVerified,true);assert.equal(v.originalBusinessApplied,false);
  const result=negotiate({local:advertisement,remote:advertisement,requiredCryptoSuite:suite});
  assert.deepEqual(result.selectedCriticalExtensions,[EXT]);assert.equal(result.originalSessionAgreementProven,false);
  assert.equal(result.subjectAuthorityGranted,false);
  const {supportedCriticalExtensions,...legacy}=advertisement;
  assert.throws(()=>negotiate({local:advertisement,remote:legacy,requiredCryptoSuite:suite}),code('WIRE_FIELDS_INVALID'));
  assert.throws(()=>negotiate({local:advertisement,remote:{...advertisement,supportedCriticalExtensions:[]},requiredCryptoSuite:suite}),code('WIRE_MULTIPART_CAPABILITIES_INVALID'));
  assert.throws(()=>negotiate({local:advertisement,remote:advertisement,requiredCryptoSuite:'suite:other'}),code('WIRE_CRYPTO_DOWNGRADE_OR_VERSION_MISMATCH'));
});
test('multipart data requires supported AND selected extensions before signature/access/replay',async()=>{
  const w=await wire(create('CHANGE_REF',body,2));
  for(const [settings,expected] of [[{supportedCriticalExtensions:[]},'WIRE_UNSUPPORTED_CRITICAL_EXTENSION'],
    [{selectedCriticalExtensions:[]},'WIRE_MULTIPART_SESSION_NOT_SELECTED']]){
    const {options,calls}=ports(settings);await assert.rejects(receive({...options,wireBytes:w}),code(expected));
    assert.deepEqual(calls,{verify:0,access:0,replay:0});
  }
  const {options,calls}=ports();assert.equal((await receive({...options,wireBytes:w})).transportVerifiedOnly,true);
  assert.deepEqual(calls,{verify:1,access:1,replay:1});
});
test('CHANGE_REF signs full manifest and original Event, only Asset and canonical sequence allowed',async()=>{
  const f=create('CHANGE_REF',body,2),w=await wire(f),decoded=decode(w);
  assert.deepEqual(decoded.body,body);assert.equal(decoded.sequence,2);
  assert.equal((await verifyT4CandidateOutboundSignature({wireBytes:w,verifyOriginalNodeSignature})).originalSignatureVerified,true);
  assert.throws(()=>create('CHANGE_REF',body,3),code('WIRE_MULTIPART_SEQUENCE_INVALID'));
  assert.throws(()=>create('CHANGE_REF',{...body,changeKind:'OBJECT_PUT'},2),code('WIRE_MULTIPART_CHANGE_REF_MISMATCH'));
  assert.throws(()=>create('CHANGE_REF',{...body,changeId:'change:wrong'},2),code('WIRE_MULTIPART_CHANGE_REF_MISMATCH'));
  assert.throws(()=>create('CHANGE_REF',{...body,contentDigest:'sha256:'+'a'.repeat(64)},2),code('WIRE_MULTIPART_CHANGE_REF_MISMATCH'));
  assert.throws(()=>create('CHANGE_REF',{...body,multipartManifest:{...body.multipartManifest,manifestDigest:'sha256:'+'f'.repeat(64)}},2),code('WIRE_MULTIPART_MANIFEST_INVALID'));
});
test('fragment address and request share exact manifest, part and chunk identity',async()=>{
  const b=plan.bodies.at(-1),{ciphertextBase64,ciphertextSha256,encryptionContextRef,...request}=b;
  assert.deepEqual(decode(await wire(create('CHUNK',b,sequence(b)))).body,b);
  assert.deepEqual(decode(await wire(create('CHUNK_REQUEST',request,9))).body,request);
  assert.throws(()=>create('CHUNK',b,3),code('WIRE_MULTIPART_SEQUENCE_INVALID'));
  assert.throws(()=>create('CHUNK',{...b,chunkIndex:1},sequence(b)),code('WIRE_MULTIPART_CHUNK_INVALID'));
  assert.throws(()=>create('CHUNK_REQUEST',{...request,partCount:1},9),code('WIRE_MULTIPART_CHUNK_REQUEST_INVALID'));
  assert.throws(()=>create('CHUNK',{...b,ciphertextSha256:'sha256:'+'b'.repeat(64)},sequence(b)),code('WIRE_MULTIPART_CHUNK_INVALID'));
});
test('old body and new body cannot be interchanged or stripped of critical extension',()=>{
  const {multipartManifest,...legacy}=body;
  for(const [type,b,s] of [['CHANGE_REF',body,2],['CHUNK',plan.bodies[0],3],['CAPABILITIES',advertisement,1]])
    assert.throws(()=>create(type,b,s,{criticalExtensions:[]}),code('WIRE_FIELDS_INVALID'));
  assert.throws(()=>create('CHANGE_REF',legacy,2),code('WIRE_FIELDS_INVALID'));
  assert.throws(()=>create('CHANGE_REF',body,2,{criticalExtensions:[EXT,T4_RELATION_EVENT_EXTENSION]}),code('WIRE_MULTIPART_EXTENSION_INVALID'));
  for(const type of ['HELLO','HEADS','DIFF_REQUEST','RESUME','RECEIVED_ACK','VERIFIED_ACK','APPLIED_ACK'])
    assert.throws(()=>create(type,{},1),code('WIRE_MULTIPART_EXTENSION_INVALID'));
  assert.equal(create('CHANGE_REF',legacy,2,{criticalExtensions:[]}).body.changeKind,'ASSET_PUT');
});
test('actual Ed25519 frames assemble one exact ciphertext; replay identity survives delivery reordering',async()=>{
  const {options,calls}=ports(),head=await wire(create('CHANGE_REF',body,2));await receive({...options,wireBytes:head});
  const frames=await Promise.all(plan.bodies.map((b,i)=>wire(create('CHUNK',b,sequence(b),{messageId:'chunk:'+i}))));
  const bodies=[];for(const w of [...frames].reverse()){const v=await receive({...options,wireBytes:w});assert.equal(v.originalBusinessApplied,false);bodies.push(decode(w).body);}
  assert.deepEqual(assembleT4CandidateMultipartOpaqueChunks({manifest:decode(head).body.multipartManifest,bodies}).ciphertext,new Uint8Array(524289).fill(19));
  assert.equal((await receive({...options,wireBytes:frames[0]})).exactPreviouslyVerifiedReplay,true);
  const conflict=await wire(create('CHUNK',plan.bodies[0],3,{messageId:'other'}));
  await assert.rejects(receive({...options,wireBytes:conflict}),code('WIRE_DURABLE_REPLAY_NOT_PROVEN'));
  assert.equal(calls.replay,68);
});
test('real signature rejects signed bytes with a mutated envelope even when body digest is unchanged',async()=>{
  const w=await wire(create('CHANGE_REF',body,2)),parsed=JSON.parse(Buffer.from(w).toString('utf8'));
  parsed.messageId='message:tampered';const tampered=Buffer.from(JSON.stringify(parsed));
  assert.equal(decode(tampered).messageId,'message:tampered');
  const {options,calls}=ports();await assert.rejects(receive({...options,wireBytes:tampered}),code('WIRE_SOURCE_SIGNATURE_NOT_VERIFIED'));
  assert.deepEqual(calls,{verify:1,access:0,replay:0});
});
test('original access is still required after a valid signature and capability selection',async()=>{
  const w=await wire(create('CHANGE_REF',body,2)),{options,calls}=ports({authorizeOriginalNetwork:async()=>false});
  await assert.rejects(receive({...options,wireBytes:w}),code('WIRE_ORIGINAL_ACCESS_DENIED'));assert.equal(calls.replay,0);
  await assert.rejects(receive({...ports().options,wireBytes:w,scopeRef:'scope:other'}),code('WIRE_WRONG_RECIPIENT_SCOPE_OR_SUITE'));
});
test('historical verification remains evidence only, never live acceptance or session negotiation',async()=>{
  const w=await wire(create('CHANGE_REF',body,2));
  const options={wireBytes:w,localNodeRef:route.recipientNodeRef,scopeRef:route.scopeRef,requiredCryptoSuite:suite,
    direction:'INBOUND',supportedCriticalExtensions:[EXT],verifyOriginalHistoricalNodeSignature:async p=>({
      schema:'IWXA_T4_ORIGINAL_HISTORICAL_SIGNATURE_V1',frameDigest:p.frameDigest,signerRef:p.signerRef,direction:'PEER',
      originalHistoricalSignatureVerified:await verifyOriginalNodeSignature(p),originalHistoricalAcceptanceProven:false,
      liveNetworkAuthorityGranted:false,trustedSigningTimeProven:false,originalBusinessApplied:false})};
  assert.equal((await verifyT4CandidateHistoricalFrameSignature(options)).liveNetworkAuthorityGranted,false);
  await assert.rejects(verifyT4CandidateHistoricalFrameSignature({...options,supportedCriticalExtensions:[]}),code('WIRE_UNSUPPORTED_CRITICAL_EXTENSION'));
});
