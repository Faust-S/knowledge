import test from 'node:test';
import assert from 'node:assert/strict';
import {createCipheriv,createDecipheriv,randomBytes,generateKeyPairSync,
  sign,verify} from 'node:crypto';
import {
  prepareT4CandidateOpaqueChunks,assembleT4CandidateOpaqueChunks,
} from '../src/network/standard-network-opaque-chunks.mjs';
import {
  createT4CandidateUnsignedFrame,signT4CandidateFrame,
  verifyT4CandidateWireFrame,decodeT4CandidateFrame,
} from '../src/network/standard-network-wire-candidate.mjs';

const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const encryptionKey=randomBytes(32),iv=randomBytes(12),aad=Buffer.from(
  'change:t4:test:encrypted:1','utf8');
function encryptedFixture(){
  const plaintext=Buffer.from(Array.from({length:28000},(_,i)=>
    String.fromCharCode(32+(i*31%90))).join(''),'utf8');
  const cipher=createCipheriv('aes-256-gcm',encryptionKey,iv);
  cipher.setAAD(aad);
  const bytes=Buffer.concat([cipher.update(plaintext),cipher.final()]);
  return{plaintext,ciphertext:Buffer.concat([bytes,cipher.getAuthTag()])};
}
const source=encryptedFixture();
let calls=0;
const ports=(extra={})=>({
  changeId:'change:encrypted:1',ownerRef:'owner:source',
  sourceContentRef:'original:asset:sealed:1',getMode:()=> 'T4_NETWORK',
  authorizeOriginalSealedContent:async()=>true,
  readOriginalSealedContent:async()=>{
    calls++;return{ciphertext:new Uint8Array(source.ciphertext),
      encryptionContextRef:'crypto:original:epoch:7'};
  },...extra,
});
const err=code=>e=>e?.code===code;
const digest='sha256:'+'a'.repeat(64);
function decodePlain(ciphertext){
  const bytes=Buffer.from(ciphertext);
  const tag=bytes.subarray(-16),sealed=bytes.subarray(0,-16);
  const cipher=createDecipheriv('aes-256-gcm',encryptionKey,iv);
  cipher.setAAD(aad);cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(sealed),cipher.final()]);
}
test('opaque ciphertext chunk plan derives from authorized owner port, not a new Store or cryptosystem',async()=>{
  calls=0;
  const p=await prepareT4CandidateOpaqueChunks({
    ...ports(),chunkBytes:8192,
  });
  assert.equal(calls,1);
  assert.equal(p.chunkCount,4);
  assert.equal(p.bodies.length,4);
  assert.equal(p.originalSealedContentPortUsed,true);
  assert.equal(p.e2eeKeyManagementVerified,false);
  const reconstructed=assembleT4CandidateOpaqueChunks({
    bodies:[...p.bodies].reverse(),
    expectedChangeId:p.changeId,expectedContentDigest:p.contentDigest,
    expectedEncryptionContextRef:p.encryptionContextRef,
  });
  assert.equal(reconstructed.transportContentIntegrityVerified,true);
  assert.equal(reconstructed.originalBusinessApplied,false);
  assert.deepEqual(decodePlain(reconstructed.ciphertext),source.plaintext);
});
test('each encrypted CHUNK frame is signed and checked without invoking original Result',async()=>{
  const plan=await prepareT4CandidateOpaqueChunks(ports());
  const replay=new Map();
  for(const body of plan.bodies){
    const unsigned=createT4CandidateUnsignedFrame({
      messageType:'CHUNK',
      messageId:'message:chunk:'+body.chunkIndex,
      sourceNodeRef:'node:source',recipientNodeRef:'node:recipient',
      sessionRef:'session:chunks:one',scopeRef:'scope:chunks',
      permissionRef:'original:permission:read',
      signerRef:'key:original:source',sequence:body.chunkIndex+1,
      ownerEpoch:7,cryptoSuite:'X25519_AES256GCM_ED25519',
      body,
    });
    const signed=await signT4CandidateFrame({
      unsignedFrame:unsigned,
      signOriginalNodeBytes:async({bytes})=>
        sign(null,Buffer.from(bytes),privateKey),
    });
    const parsed=decodeT4CandidateFrame(signed);
    assert.equal(parsed.messageType,'CHUNK');
    const result=await verifyT4CandidateWireFrame({
      wireBytes:signed,recipientNodeRef:'node:recipient',
      scopeRef:'scope:chunks',
      requiredCryptoSuite:'X25519_AES256GCM_ED25519',
      verifyOriginalNodeSignature:async({bytes,signature})=>
        verify(null,Buffer.from(bytes),publicKey,Buffer.from(signature)),
      authorizeOriginalNetwork:async()=>true,
      persistOriginalReplayDecision:async v=>{
        if(replay.has(v.sequence))return 'CONFLICT';
        replay.set(v.sequence,v.frameDigest);return 'RECORDED';
      },
    });
    assert.equal(result.originalBusinessApplied,false);
    assert.equal(result.originalSubjectMutationInvoked,false);
  }
  assert.equal(replay.size,plan.chunkCount);
});
test('missing, duplicate and modified ciphertext chunks are not accepted',async()=>{
  const p=await prepareT4CandidateOpaqueChunks(ports());
  const args={expectedChangeId:p.changeId,
    expectedContentDigest:p.contentDigest,
    expectedEncryptionContextRef:p.encryptionContextRef};
  assert.throws(()=>assembleT4CandidateOpaqueChunks({
    ...args,bodies:p.bodies.slice(0,-1),
  }),err('CHUNK_ASSEMBLY_INCOMPLETE'));
  const duplicate=[...p.bodies];duplicate[1]=p.bodies[0];
  assert.throws(()=>assembleT4CandidateOpaqueChunks({
    ...args,bodies:duplicate,
  }),err('CHUNK_ASSEMBLY_BODY_INVALID'));
  const changed=[...p.bodies];
  const b=changed[1];changed[1]={...b,ciphertextBase64:
    Buffer.from('forged encrypted bytes').toString('base64')};
  assert.throws(()=>assembleT4CandidateOpaqueChunks({
    ...args,bodies:changed,
  }),err('CHUNK_ASSEMBLY_INTEGRITY_FAILED'));
});
test('compromised owner scope cannot silently change encryption context or total digest',async()=>{
  const p=await prepareT4CandidateOpaqueChunks(ports());
  assert.throws(()=>assembleT4CandidateOpaqueChunks({
    bodies:p.bodies,expectedChangeId:p.changeId,
    expectedContentDigest:digest,
    expectedEncryptionContextRef:p.encryptionContextRef,
  }),err('CHUNK_ASSEMBLY_BODY_INVALID'));
  assert.throws(()=>assembleT4CandidateOpaqueChunks({
    bodies:p.bodies,expectedChangeId:p.changeId,
    expectedContentDigest:p.contentDigest,
    expectedEncryptionContextRef:'crypto:epoch:8',
  }),err('CHUNK_ASSEMBLY_BODY_INVALID'));
});
test('revocation and local T3 mode prevent even reading sealed original content',async()=>{
  let reads=0;
  await assert.rejects(prepareT4CandidateOpaqueChunks(ports({
    authorizeOriginalSealedContent:async()=>false,
    readOriginalSealedContent:async()=>{reads++;return null;},
  })),err('CHUNK_ORIGINAL_ACCESS_DENIED'));
  await assert.rejects(prepareT4CandidateOpaqueChunks(ports({
    getMode:()=> 'LOCAL_T3',
    readOriginalSealedContent:async()=>{reads++;return null;},
  })),err('CHUNK_NETWORK_MODE_OFF'));
  assert.equal(reads,0);
});
test('CHUNK_REQUEST cannot request invalid or out-of-range indexes',()=>{
  const base={
    messageType:'CHUNK_REQUEST',messageId:'message:want:1',
    sourceNodeRef:'node:recipient',recipientNodeRef:'node:source',
    sessionRef:'session:chunks:one',scopeRef:'scope:chunks',
    permissionRef:'original:permission:read',
    signerRef:'key:original:recipient',
    sequence:1,ownerEpoch:7,cryptoSuite:'X25519_AES256GCM_ED25519',
  };
  const body={changeId:'change:encrypted:1',
    contentDigest:digest,chunkIndex:1,chunkCount:4};
  assert.equal(createT4CandidateUnsignedFrame({...base,body})
    .messageType,'CHUNK_REQUEST');
  assert.throws(()=>createT4CandidateUnsignedFrame({
    ...base,body:{...body,chunkIndex:4},
  }),err('WIRE_CHUNK_REQUEST_INVALID'));
});
test('modified original buffer after authorized read cannot mutate frozen planned bytes',async()=>{
  const mutable=new Uint8Array(source.ciphertext);
  let n=0;
  const p=await prepareT4CandidateOpaqueChunks(ports({
    readOriginalSealedContent:async()=>({
      ciphertext:mutable,encryptionContextRef:'crypto:original:epoch:7',
    }),
    authorizeOriginalSealedContent:async()=>{
      if(++n===2)mutable.fill(0);
      return true;
    },
  }));
  const x=assembleT4CandidateOpaqueChunks({
    bodies:p.bodies,
    expectedChangeId:p.changeId,
    expectedContentDigest:p.contentDigest,
    expectedEncryptionContextRef:p.encryptionContextRef,
  });
  assert.deepEqual(decodePlain(x.ciphertext),source.plaintext);
});

test('encryption context is snapshotted with ciphertext across original authorization readback',async()=>{
  const original={ciphertext:new Uint8Array(source.ciphertext),encryptionContextRef:'crypto:original:epoch:7'};
  let checks=0;
  const p=await prepareT4CandidateOpaqueChunks(ports({readOriginalSealedContent:async()=>original,
    authorizeOriginalSealedContent:async()=>{if(++checks===2)original.encryptionContextRef='crypto:foreign:epoch:8';return true;}}));
  assert.equal(p.encryptionContextRef,'crypto:original:epoch:7');
  assert.ok(p.bodies.every(b=>b.encryptionContextRef===p.encryptionContextRef));
});
test('custom chunk size cannot exceed the 64-frame protocol capacity',async()=>{
  await assert.rejects(prepareT4CandidateOpaqueChunks(ports({chunkBytes:1})),err('CHUNK_TRANSPORT_CAPACITY_EXCEEDED'));
  const bytes=new Uint8Array(64).fill(3);
  const p=await prepareT4CandidateOpaqueChunks(ports({chunkBytes:1,
    readOriginalSealedContent:async()=>({ciphertext:bytes,encryptionContextRef:'crypto:original:epoch:7'})}));
  assert.equal(p.chunkCount,64);
  assert.deepEqual(assembleT4CandidateOpaqueChunks({bodies:p.bodies,expectedChangeId:p.changeId,
    expectedContentDigest:p.contentDigest,expectedEncryptionContextRef:p.encryptionContextRef}).ciphertext,bytes);
});
