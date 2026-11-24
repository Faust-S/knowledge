import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,verify} from 'node:crypto';
import {
  createT4CandidateUnsignedFrame,signT4CandidateFrame,
  decodeT4CandidateFrame,negotiateT4CandidateCapabilities,
  verifyT4CandidateWireFrame,T4_CANDIDATE_VERSION,T4_RELATION_EVENT_EXTENSION,
  T4_SUBJECT_DELETE_EXTENSION,validT4NativeOriginalEventRevision,
} from '../src/network/standard-network-wire-candidate.mjs';

const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const originalSigner=(async({bytes,signerRef})=>{
  assert.equal(signerRef,'key:source:1');
  return sign(null,Buffer.from(bytes),privateKey);
});
const cryptoSuite='X25519_AES256GCM_ED25519';
const D='sha256:'+'a'.repeat(64);
const E='sha256:'+'b'.repeat(64);
const base={
  messageType:'CHANGE_REF',messageId:'message:one',
  sourceNodeRef:'node:source',recipientNodeRef:'node:receiver',
  scopeRef:'scope:opaque:one',sessionRef:'session:one',
  permissionRef:'original:access:ref',signerRef:'key:source:1',
  sequence:1,ownerEpoch:2,cryptoSuite,criticalExtensions:[],
  body:{
    changeId:'change:one',changeKind:'OBJECT_PUT',
    eventRef:'original:event:1',ownerRef:'original:owner',
    sourceRevision:7,contentDigest:D,parents:[E],
  },
};
const code=expected=>error=>{
  assert.equal(error?.code,expected,String(error));return true;
};
const create=(overrides={})=>createT4CandidateUnsignedFrame({
  ...base,...overrides,
});
const wire=async(overrides={})=>signT4CandidateFrame({
  unsignedFrame:create(overrides),signOriginalNodeBytes:originalSigner,
});
function trustedPorts(){
  const records=new Map();
  const observations={verifications:0,authorizations:0,replayWrites:0};
  let allow=true,verifyKey=publicKey;
  return{
    records,observations,setAllowed:v=>{allow=v;},
    setKey:v=>{verifyKey=v;},
    ports:{
      recipientNodeRef:'node:receiver',scopeRef:'scope:opaque:one',
      requiredCryptoSuite:cryptoSuite,supportedCriticalExtensions:[],
      verifyOriginalNodeSignature:async({bytes,signature,signerRef})=>{
        observations.verifications++;
        return signerRef==='key:source:1'&&
          verify(null,Buffer.from(bytes),verifyKey,
            Buffer.from(signature));
      },
      authorizeOriginalNetwork:async proof=>{
        observations.authorizations++;
        return allow&&proof.operation==='t4.network.receive.CHANGE_REF'&&
          proof.permissionRef==='original:access:ref'&&
          proof.ownerEpoch===2;
      },
      persistOriginalReplayDecision:async proof=>{
        observations.replayWrites++;
        const id=[proof.sourceNodeRef,proof.sessionRef,proof.ownerEpoch,
          proof.sequence].join(':');
        const prev=records.get(id);
        if(!prev){records.set(id,proof.frameDigest);return 'RECORDED';}
        return prev===proof.frameDigest?'SEEN_EXACT':'CONFLICT';
      },
    },
  };
}
test('signed canonical wire frame validates original Ed25519 bytes and stays transport only',async()=>{
  const bytes=await wire();
  const frame=decodeT4CandidateFrame(bytes);
  assert.equal(frame.bodyDigest.length,71);
  assert.equal(frame.messageType,'CHANGE_REF');
  assert.equal(frame.protocolVersion,T4_CANDIDATE_VERSION);
  assert.equal(frame.signatureBase64.length,88);
  const t=trustedPorts();
  const verdict=await verifyT4CandidateWireFrame({
    wireBytes:bytes,...t.ports,
  });
  assert.equal(verdict.originalSignatureVerified,true);
  assert.equal(verdict.originalAccessVerified,true);
  assert.equal(verdict.originalReplayCheckpointRecorded,true);
  assert.equal(verdict.exactPreviouslyVerifiedReplay,false);
  assert.equal(verdict.originalBusinessApplied,false);
  assert.equal(verdict.originalSubjectMutationInvoked,false);
  assert.equal(t.observations.replayWrites,1);
});
test('verified duplicate frame is recognized with same durable replay store after restart',async()=>{
  const bytes=await wire(),t=trustedPorts();
  await verifyT4CandidateWireFrame({wireBytes:bytes,...t.ports});
  const result=await verifyT4CandidateWireFrame({
    wireBytes:bytes,...t.ports,
  });
  assert.equal(result.exactPreviouslyVerifiedReplay,true);
  assert.equal(t.records.size,1);
});
test('different signed payload reusing same session and sequence is rejected by original durable CAS',async()=>{
  const t=trustedPorts();
  await verifyT4CandidateWireFrame({wireBytes:await wire(),...t.ports});
  const modified=await wire({body:{
    ...base.body,changeId:'change:another',
  }});
  await assert.rejects(verifyT4CandidateWireFrame({
    wireBytes:modified,...t.ports,
  }),code('WIRE_DURABLE_REPLAY_NOT_PROVEN'));
  assert.equal(t.records.size,1);
});
test('unauthorized source may neither apply nor write a replay checkpoint',async()=>{
  const t=trustedPorts();t.setAllowed(false);
  await assert.rejects(verifyT4CandidateWireFrame({
    wireBytes:await wire(),...t.ports,
  }),code('WIRE_ORIGINAL_ACCESS_DENIED'));
  assert.equal(t.records.size,0);
  assert.equal(t.observations.replayWrites,0);
});
test('signature made with wrong original key fails before access and CAS',async()=>{
  const t=trustedPorts(),other=generateKeyPairSync('ed25519');
  t.setKey(other.publicKey);
  await assert.rejects(verifyT4CandidateWireFrame({
    wireBytes:await wire(),...t.ports,
  }),code('WIRE_SOURCE_SIGNATURE_NOT_VERIFIED'));
  assert.equal(t.observations.authorizations,0);
  assert.equal(t.observations.replayWrites,0);
});
test('network cannot grant original rights without all three original trust ports',async()=>{
  const t=trustedPorts();
  const {persistOriginalReplayDecision,...withoutCAS}=t.ports;
  await assert.rejects(verifyT4CandidateWireFrame({
    wireBytes:await wire(),...withoutCAS,
  }),code('WIRE_ORIGINAL_TRUST_PORTS_REQUIRED'));
});
test('wrong receiver, scope or suite is refused before signature verification',async()=>{
  const t=trustedPorts(),bytes=await wire();
  for(const patch of [{recipientNodeRef:'node:attacker'},
    {scopeRef:'scope:other'},{requiredCryptoSuite:'OTHER_SUITE'}]){
    await assert.rejects(verifyT4CandidateWireFrame({
      wireBytes:bytes,...t.ports,...patch,
    }),code('WIRE_WRONG_RECIPIENT_SCOPE_OR_SUITE'));
  }
  assert.equal(t.observations.verifications,0);
});
test('unexpected critical extension is rejected before trust ports',async()=>{
  const t=trustedPorts(),bytes=await wire({
    criticalExtensions:['security:unknown'],
  });
  await assert.rejects(verifyT4CandidateWireFrame({
    wireBytes:bytes,...t.ports,
  }),code('WIRE_UNSUPPORTED_CRITICAL_EXTENSION'));
  assert.equal(t.observations.verifications,0);
});
test('body tampering without a new valid signature is refused',async()=>{
  const t=trustedPorts(),bytes=await wire();
  const original=JSON.parse(Buffer.from(bytes).toString('utf8'));
  original.body.sourceRevision=8;
  const altered=Buffer.from(JSON.stringify(original),'utf8');
  await assert.rejects(verifyT4CandidateWireFrame({
    wireBytes:altered,...t.ports,
  }),e=>['WIRE_NONCANONICAL_OR_DUPLICATE_KEYS',
    'WIRE_BODY_DIGEST_INVALID'].includes(e.code));
  assert.equal(t.observations.replayWrites,0);
});
test('JSON with duplicate keys or whitespace is not a canonical wire frame',async()=>{
  const original=Buffer.from(await wire()).toString('utf8');
  await assert.rejects(Promise.resolve().then(()=>decodeT4CandidateFrame(
    Buffer.from(original.replace(/^\{/,'{"schema":"bogus",'),'utf8'))),
  code('WIRE_NONCANONICAL_OR_DUPLICATE_KEYS'));
  await assert.rejects(Promise.resolve().then(()=>decodeT4CandidateFrame(
    Buffer.from(' '+original,'utf8'))),
  code('WIRE_NONCANONICAL_OR_DUPLICATE_KEYS'));
});
test('unknown envelope fields and invented subject authority are rejected',()=>{
  assert.throws(()=>create({originalAccessGranted:true}),
    code('WIRE_FIELDS_INVALID'));
  assert.throws(()=>create({body:{...base.body,grant:true}}),
    code('WIRE_FIELDS_INVALID'));
  assert.throws(()=>create({messageType:'OBJECT_DELETE'}),
    code('WIRE_TYPE_UNSUPPORTED'));
});
test('client does not accept unsafe number, invalid Unicode or normalization ambiguity',()=>{
  assert.throws(()=>create({sequence:1.5}),code('WIRE_HEADER_INVALID'));
  assert.throws(()=>create({body:{...base.body,
    changeId:'abc\uD800'}}),code('WIRE_STRING_INVALID'));
  assert.throws(()=>create({body:{...base.body,
    changeId:'e\u0301'}}),code('WIRE_STRING_INVALID'));
});
test('large arrays, nesting and oversized inputs fail closed',async()=>{
  assert.throws(()=>create({body:{...base.body,
    parents:Array.from({length:65},(_,i)=>'sha256:'+
      i.toString(16).padStart(64,'0'))}}),code('WIRE_ARRAY_LIMIT'));
  const oversized=Buffer.alloc(32769,0x20);
  assert.throws(()=>decodeT4CandidateFrame(oversized),
    code('WIRE_BYTES_INVALID'));
});
test('HEADS, DIFF, RESUME and all ACK stages have strict independent shapes',()=>{
  const cases=[
    ['HEADS',{familyRef:'family:one',ownerEpoch:2,heads:[D,E]}],
    ['DIFF_REQUEST',{familyRef:'family:one',fromHeads:[D]}],
    ['RESUME',{familyRef:'family:one',
      checkpointDigest:D,ownerEpoch:2}],
    ['RECEIVED_ACK',{changeId:'change:one',contentDigest:D,
      ackRef:'ack:one'}],
    ['VERIFIED_ACK',{changeId:'change:one',contentDigest:D,
      ackRef:'ack:two'}],
    ['APPLIED_ACK',{changeId:'change:one',contentDigest:D,
      ackRef:'ack:three',recipientEventRef:'original:event:two',
      recipientRevision:7,recipientStateDigest:E}],
  ];
  for(const [messageType,body] of cases){
    const frame=create({messageType,body});
    assert.equal(frame.messageType,messageType);
  }
  assert.throws(()=>create({
    messageType:'APPLIED_ACK',
    body:{changeId:'change:one',contentDigest:D,ackRef:'ack:three'},
  }),code('WIRE_FIELDS_INVALID'));
});
test('a cryptographically signed APPLIED_ACK is not a verified original business Result',async()=>{
  const ack=await wire({
    messageType:'APPLIED_ACK',
    body:{changeId:'change:one',contentDigest:D,ackRef:'ack:three',
      recipientEventRef:'original:event:two',
      recipientRevision:7,recipientStateDigest:E},
  });
  const t=trustedPorts();
  t.ports.authorizeOriginalNetwork=async()=>true;
  const result=await verifyT4CandidateWireFrame({
    wireBytes:ack,...t.ports,
  });
  assert.equal(result.messageType,'APPLIED_ACK');
  assert.equal(result.signedAppliedAckIsNotOriginalResult,true);
  assert.equal(result.originalBusinessApplied,false);
});
test('capability advertisement never authorizes a node or establishes encryption',()=>{
  const local={supportedVersions:[T4_CANDIDATE_VERSION],
    supportedCryptoSuites:[cryptoSuite]};
  const remote={supportedVersions:[T4_CANDIDATE_VERSION],
    supportedCryptoSuites:[cryptoSuite,'LEGACY_SUITE']};
  const r=negotiateT4CandidateCapabilities({
    local,remote,requiredCryptoSuite:cryptoSuite,
  });
  assert.equal(r.candidateNegotiationOnly,true);
  assert.equal(r.encryptedChannelEstablished,false);
  assert.equal(r.subjectAuthorityGranted,false);
  assert.equal(r.peerIdentityVerified,false);
  assert.throws(()=>negotiateT4CandidateCapabilities({
    local,remote,requiredCryptoSuite:'LEGACY_SUITE',
  }),code('WIRE_CRYPTO_DOWNGRADE_OR_VERSION_MISMATCH'));
});
test('unknown protocol version and invalid signed base64 fail closed',async()=>{
  const t=trustedPorts();
  const raw=JSON.parse(Buffer.from(await wire()).toString('utf8'));
  raw.protocolVersion='iwxa.t4.net/2';
  const altered=Buffer.from(JSON.stringify(raw));
  await assert.rejects(verifyT4CandidateWireFrame({
    wireBytes:altered,...t.ports,
  }),e=>['WIRE_NONCANONICAL_OR_DUPLICATE_KEYS',
    'WIRE_HEADER_INVALID'].includes(e.code));
  raw.protocolVersion=T4_CANDIDATE_VERSION;
  raw.signatureBase64='AAAA';
  assert.throws(()=>decodeT4CandidateFrame(Buffer.from(
    JSON.stringify(raw))),e=>['WIRE_NONCANONICAL_OR_DUPLICATE_KEYS',
    'WIRE_SIGNATURE_INVALID'].includes(e.code));
});

test('cross-runtime canonical wire forbids Unicode object keys with divergent UTF-16 sorting',()=>{
  assert.throws(()=>create({body:{
    ...base.body,['status\u{1F600}']:'untrusted',
  }}),code('WIRE_OBJECT_KEYS_INVALID'));
  assert.throws(()=>create({body:{
    ...base.body,['e\u0301']:'untrusted',
  }}),code('WIRE_OBJECT_KEYS_INVALID'));
});


test('Relation CHANGE_REF requires explicit critical extension and actual null revision',async()=>{
  const body={...base.body,changeKind:'RELATION_PUT',sourceRevision:null};
  assert.throws(()=>create({body}),code('WIRE_CHANGE_REF_INVALID'));
  assert.throws(()=>create({body:{...body,sourceRevision:1},
    criticalExtensions:[T4_RELATION_EVENT_EXTENSION]}),code('WIRE_CHANGE_REF_INVALID'));
  assert.throws(()=>create({criticalExtensions:[T4_RELATION_EVENT_EXTENSION]}),
    code('WIRE_CHANGE_REF_INVALID'));
  const bytes=await wire({body,criticalExtensions:[T4_RELATION_EVENT_EXTENSION]});
  assert.equal(decodeT4CandidateFrame(bytes).body.sourceRevision,null);
  const t=trustedPorts();
  await assert.rejects(verifyT4CandidateWireFrame({wireBytes:bytes,...t.ports}),
    code('WIRE_UNSUPPORTED_CRITICAL_EXTENSION'));
  assert.equal(t.observations.replayWrites,0);
  const verified=await verifyT4CandidateWireFrame({wireBytes:bytes,...t.ports,
    supportedCriticalExtensions:[T4_RELATION_EVENT_EXTENSION]});
  assert.equal(verified.originalSignatureVerified,true);
  assert.equal(verified.originalBusinessApplied,false);
});
test('Relation APPLIED_ACK cannot encode synthetic numeric revision or omit extension',()=>{
  const body={changeId:'change:one',contentDigest:D,ackRef:'ack:one',
    recipientEventRef:'original:recipient:event',recipientRevision:null,recipientStateDigest:E};
  assert.throws(()=>create({messageType:'APPLIED_ACK',body}),
    code('WIRE_APPLIED_ACK_EVIDENCE_INVALID'));
  assert.throws(()=>create({messageType:'APPLIED_ACK',body:{...body,recipientRevision:1},
    criticalExtensions:[T4_RELATION_EVENT_EXTENSION]}),code('WIRE_APPLIED_ACK_EVIDENCE_INVALID'));
  assert.equal(create({messageType:'APPLIED_ACK',body,
    criticalExtensions:[T4_RELATION_EVENT_EXTENSION]}).body.recipientRevision,null);
  assert.throws(()=>create({messageType:'HEADS',body:{familyRef:'family:one',
    ownerEpoch:2,heads:[E]},criticalExtensions:[T4_RELATION_EVENT_EXTENSION]}),
    code('WIRE_RELATION_EVENT_EXTENSION_INVALID'));
});

for(const kind of ['ASSET_DELETE','RELATION_DELETE']){
  test(kind+' uses a mandatory critical deletion extension and null revision',async()=>{
    const body={...base.body,changeKind:kind,sourceRevision:null};
    assert.throws(()=>create({body}),code('WIRE_CHANGE_REF_INVALID'));
    assert.throws(()=>create({body,criticalExtensions:[T4_RELATION_EVENT_EXTENSION]}),
      code('WIRE_CHANGE_REF_INVALID'));
    assert.throws(()=>create({body:{...body,sourceRevision:2},
      criticalExtensions:[T4_SUBJECT_DELETE_EXTENSION]}),code('WIRE_CHANGE_REF_INVALID'));
    const bytes=await wire({body,criticalExtensions:[T4_SUBJECT_DELETE_EXTENSION]});
    assert.equal(decodeT4CandidateFrame(bytes).body.sourceRevision,null);
    const t=trustedPorts();
    await assert.rejects(verifyT4CandidateWireFrame({wireBytes:bytes,...t.ports}),
      code('WIRE_UNSUPPORTED_CRITICAL_EXTENSION'));
    assert.equal(t.observations.replayWrites,0);
    assert.equal((await verifyT4CandidateWireFrame({wireBytes:bytes,...t.ports,
      supportedCriticalExtensions:[T4_SUBJECT_DELETE_EXTENSION]})).originalBusinessApplied,false);
    assert.equal(validT4NativeOriginalEventRevision(kind,null,2),true);
    assert.equal(validT4NativeOriginalEventRevision(kind,2,2),false);
  });
}
test('deletion ACK is Event evidence, not a numeric or RelationPut revision',()=>{
  const body={changeId:'change:one',contentDigest:D,ackRef:'ack:delete',
    recipientEventRef:'original:event:delete',recipientRevision:null,recipientStateDigest:E};
  assert.throws(()=>create({messageType:'APPLIED_ACK',body}),
    code('WIRE_APPLIED_ACK_EVIDENCE_INVALID'));
  assert.throws(()=>create({messageType:'APPLIED_ACK',body:{...body,recipientRevision:2},
    criticalExtensions:[T4_SUBJECT_DELETE_EXTENSION]}),code('WIRE_APPLIED_ACK_EVIDENCE_INVALID'));
  assert.throws(()=>create({messageType:'APPLIED_ACK',body,
    criticalExtensions:[T4_SUBJECT_DELETE_EXTENSION,T4_RELATION_EVENT_EXTENSION]}),
    code('WIRE_SUBJECT_DELETE_EXTENSION_INVALID'));
  assert.equal(create({messageType:'APPLIED_ACK',body,
    criticalExtensions:[T4_SUBJECT_DELETE_EXTENSION]}).body.recipientRevision,null);
  assert.throws(()=>create({criticalExtensions:[T4_SUBJECT_DELETE_EXTENSION]}),
    code('WIRE_CHANGE_REF_INVALID'));
});
