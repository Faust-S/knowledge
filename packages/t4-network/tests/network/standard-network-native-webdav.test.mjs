import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,verify} from 'node:crypto';
import {
  createWebDavPackageTransport
} from '../../src/network/webdav-package-transfer.mjs';
import {
  createT4CandidateUnsignedFrame,signT4CandidateFrame
} from '../../src/network/standard-network-wire-candidate.mjs';
import {
  createT4CandidateFrameTransport
} from '../../src/network/standard-network-wire-transport.mjs';

if(!process.env.T4_TEST_URL||!process.env.T4_TEST_AUTH)
  throw Error('Run inside scripts/qualify_webdav.py');
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const suite='X25519_AES256GCM_ED25519';
const policy={
  objectFamily:'owner-exported-package',workspaceId:'test-person-a',
  authorityRoot:'original-owner-a',writeOwnerRef:'original-exchange-a',
  primaryPlacement:'LOCAL_PRIMARY_HOSTED_REPLICA',
  allowedLocations:['test-webdav'],retentionClass:'test',
  recoveryClass:'test',universalCloudMaster:false,subjectActionAuthority:false,
};
const code=expected=>err=>{
  assert.equal(err?.code,expected,String(err));return true;
};
let sequence=0;
const makeBytes=async(type='HEADS',overrides={})=>{
  sequence++;
  const body=type==='HEADS'?{
    familyRef:'family:orders',ownerEpoch:2,
    heads:['sha256:'+'c'.repeat(64)],
  }:{
    familyRef:'family:orders',
    fromHeads:['sha256:'+'c'.repeat(64)],
  };
  const unsigned=createT4CandidateUnsignedFrame({
    messageType:type,messageId:'wire:test:'+process.pid+':'+sequence,
    sourceNodeRef:'node:one',recipientNodeRef:'node:two',
    sessionRef:'session:two-physical-nodes-candidate',
    scopeRef:'scope:opaque',
    permissionRef:'access:original:grant',
    signerRef:'original:key:source',sequence,ownerEpoch:2,
    cryptoSuite:suite,criticalExtensions:[],body,...overrides,
  });
  return signT4CandidateFrame({
    unsignedFrame:unsigned,
    signOriginalNodeBytes:async({bytes})=>
      sign(null,Buffer.from(bytes),privateKey),
  });
};
const makeTransport=(mode=()=> 'T4_NETWORK',authorization=async()=>true,
  fetchImpl=fetch)=>createWebDavPackageTransport({
  baseUrl:process.env.T4_TEST_URL,locationRef:'test-webdav',
  placementPolicy:policy,keySuffix:'.t4n',
  candidateNetworkWire:true,
  getMode:mode,authorize:authorization,
  getAuthorizationHeader:async()=>process.env.T4_TEST_AUTH,
  fetchImpl,
});
function host(role,transport,options={}){
  const nodeRef=role==='source'?'node:one':'node:two';
  let sessionRef='original:host:session:'+role,allowed=true;
  const replay=options.replay??new Map();
  let checks=0;
  const wire=createT4CandidateFrameTransport({
    wireTransport:transport,
    getMode:options.mode??(()=> 'T4_NETWORK'),
    originalHostNodeRef:nodeRef,originalHostScopeRef:'scope:opaque',
    readOriginalHostContext:async()=>({
      nodeRef,scopeRef:'scope:opaque',
      originalOwnerRef:'original:owner:one',
      hostSessionRef:sessionRef,
    }),
    authorizeOriginalHostWire:async p=>{
      checks++;
      return allowed&&p.originalHostNodeRef===nodeRef&&
        p.originalOwnerRef==='original:owner:one';
    },
    verifyOriginalNodeSignature:async({bytes,signature,signerRef})=>
      signerRef==='original:key:source'&&
      verify(null,Buffer.from(bytes),publicKey,Buffer.from(signature)),
    authorizeOriginalNetwork:async p=>allowed&&
      p.sourceNodeRef==='node:one'&&
      p.recipientNodeRef==='node:two'&&
      p.permissionRef==='access:original:grant'&&
      p.scopeRef==='scope:opaque'&&p.ownerEpoch===2,
    persistOriginalReplayDecision:async p=>{
      const id=p.sourceNodeRef+'-'+p.sessionRef+'-'+p.ownerEpoch+
        '-'+p.sequence;
      if(!replay.has(id)){replay.set(id,p.frameDigest);return 'RECORDED';}
      return replay.get(id)===p.frameDigest?'SEEN_EXACT':'CONFLICT';
    },
  });
  return {
    wire,replay,readChecks:()=>checks,
    revoke:()=>{allowed=false;},changeSession:()=>{sessionRef+=':changed';},
  };
}
test('real HTTPS/WebDAV transfers native signed T4 HEADS without an .iwxa Exchange',async()=>{
  const sourceTransport=makeTransport(),recipientTransport=makeTransport();
  const a=host('source',sourceTransport),b=host('recipient',recipientTransport);
  try{
    const published=await a.wire.publishSignedFrame({
      wireBytes:await makeBytes(),
    });
    assert.equal(published.originalT3ExchangeCalled,false);
    assert.match(published.key,/^[a-f0-9]{64}\.t4n$/);
    assert.equal(published.immutableTransportReadback,true);
    const got=await b.wire.readAndVerifySignedFrame({
      key:published.key,expectedSha256:published.sha256,
      requiredCryptoSuite:suite,
    });
    assert.equal(got.signedMessageType,'HEADS');
    assert.equal(got.originalSignatureVerified,true);
    assert.equal(got.originalAccessVerified,true);
    assert.equal(got.originalBusinessApplied,false);
    assert.equal(got.originalT3ExchangeCalled,false);
    assert.equal(b.replay.size,1);
  }finally{sourceTransport.close();recipientTransport.close();}
});
test('receiver restart with same durable original replay checkpoint does not reapply',async()=>{
  const transport=makeTransport(),source=host('source',transport);
  const replay=new Map();
  try{
    const sent=await source.wire.publishSignedFrame({
      wireBytes:await makeBytes(),
    });
    let incoming=host('recipient',transport,{replay});
    const first=await incoming.wire.readAndVerifySignedFrame({
      key:sent.key,expectedSha256:sent.sha256,requiredCryptoSuite:suite,
    });
    assert.equal(first.exactPreviouslyVerifiedReplay,false);
    incoming=host('recipient',transport,{replay}); // fresh Host process model
    const second=await incoming.wire.readAndVerifySignedFrame({
      key:sent.key,expectedSha256:sent.sha256,requiredCryptoSuite:suite,
    });
    assert.equal(second.exactPreviouslyVerifiedReplay,true);
    assert.equal(replay.size,1);
  }finally{transport.close();}
});
test('unknown network publication ACK is inspected with no second upload',async()=>{
  let puts=0;
  const transport=makeTransport(()=> 'T4_NETWORK',async()=>true,
    async(...args)=>{
      const response=await fetch(...args);
      if(args[1]?.method==='PUT'){
        puts++;await response.arrayBuffer();throw Error('simulate ACK lost');
      }
      return response;
    });
  const source=host('source',transport);
  const wireBytes=await makeBytes('DIFF_REQUEST');
  const {createHash}=await import('node:crypto');
  const sha=createHash('sha256').update(wireBytes).digest('hex');
  try{
    await assert.rejects(source.wire.publishSignedFrame({wireBytes}),
      code('WIRE_NETWORK_PUBLICATION_OUTCOME_UNKNOWN'));
    const read=await source.wire.inspectUnknownPublication({
      key:sha+'.t4n',expectedSha256:sha,
    });
    assert.equal(read.exactBytesPresent,true);
    assert.equal(read.historicalNetworkWriteProven,false);
    assert.equal(read.automaticNetworkRetryAllowed,false);
    assert.equal(puts,1);
  }finally{transport.close();}
});
test('wrong original recipient rights block replay checkpoint despite valid HTTPS response',async()=>{
  const t=makeTransport(),a=host('source',t),b=host('recipient',t);
  try{
    const sent=await a.wire.publishSignedFrame({
      wireBytes:await makeBytes(),
    });
    b.revoke();
    await assert.rejects(b.wire.readAndVerifySignedFrame({
      key:sent.key,expectedSha256:sent.sha256,
      requiredCryptoSuite:suite,
    }),code('WIRE_HOST_NETWORK_AUTHORIZATION_DENIED'));
    assert.equal(b.replay.size,0);
  }finally{t.close();}
});
test('LOCAL_T3 prevents all requests of native network frame transport',async()=>{
  let requests=0;
  const mode=()=> 'LOCAL_T3';
  const t=makeTransport(mode,async()=>true,
    async()=>{requests++;throw Error('unexpected network use');});
  const actor=host('source',t,{mode});
  try{
    await assert.rejects(actor.wire.publishSignedFrame({
      wireBytes:await makeBytes(),
    }),code('WIRE_HOST_NETWORK_MODE_OFF'));
    assert.equal(requests,0);
  }finally{t.close();}
});
test('network candidate suffix requires explicit opt-in, never reuses .iwxa',()=>{
  assert.throws(()=>createWebDavPackageTransport({
    baseUrl:process.env.T4_TEST_URL,locationRef:'test-webdav',
    placementPolicy:policy,keySuffix:'.t4n',
    getMode:()=> 'T4_NETWORK',authorize:async()=>true,
    getAuthorizationHeader:async()=>process.env.T4_TEST_AUTH,
  }),code('NETWORK_WIRE_CANDIDATE_OPT_IN_REQUIRED'));
});


test('real HTTPS/WebDAV carries ordered signed opaque AES-GCM chunks, recipient verifies and assembles without T3 Exchange',async()=>{
  const {createCipheriv,createDecipheriv,randomBytes}=await import('node:crypto');
  const {prepareT4CandidateOpaqueChunks,assembleT4CandidateOpaqueChunks}=
    await import('../../src/network/standard-network-opaque-chunks.mjs');
  const key=randomBytes(32),iv=randomBytes(12),
    plaintext=randomBytes(9500),
    cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from('original:change:sealed:1'));
  const encrypted=Buffer.concat([
    cipher.update(plaintext),cipher.final(),
  ]);
  const sealed=Buffer.concat([encrypted,cipher.getAuthTag()]);
  const chunks=await prepareT4CandidateOpaqueChunks({
    changeId:'change:sealed:1',ownerRef:'original:owner:one',
    sourceContentRef:'original:asset:sealed:1',getMode:()=> 'T4_NETWORK',
    authorizeOriginalSealedContent:async p=>
      p.operation.startsWith('t4.network.sealed.')&&
      p.ownerRef==='original:owner:one',
    readOriginalSealedContent:async()=>({
      ciphertext:new Uint8Array(sealed),
      encryptionContextRef:'original:crypto:epoch:one',
    }),
    chunkBytes:4096,
  });
  assert.equal(chunks.chunkCount,3);
  const outgoing=makeTransport(),incoming=makeTransport();
  const source=host('source',outgoing),recipient=host('recipient',incoming);
  const verified=[];
  try{
    for(const body of chunks.bodies){
      sequence++;
      const frame=createT4CandidateUnsignedFrame({
        messageType:'CHUNK',
        messageId:'wire:sealed:'+process.pid+':'+sequence,
        sourceNodeRef:'node:one',recipientNodeRef:'node:two',
        sessionRef:'session:sealed:one',scopeRef:'scope:opaque',
        permissionRef:'access:original:grant',
        signerRef:'original:key:source',sequence,ownerEpoch:2,
        cryptoSuite:suite,criticalExtensions:[],body,
      });
      const wireBytes=await signT4CandidateFrame({
        unsignedFrame:frame,
        signOriginalNodeBytes:async({bytes})=>
          sign(null,Buffer.from(bytes),privateKey),
      });
      const published=await source.wire.publishSignedFrame({
        wireBytes,
      });
      const received=await recipient.wire.readAndVerifySignedFrame({
        key:published.key,expectedSha256:published.sha256,
        requiredCryptoSuite:suite,
      });
      assert.equal(received.signedMessageType,'CHUNK');
      assert.equal(received.originalBusinessApplied,false);
      verified.push(received.verifiedBody);
    }
    const assembled=assembleT4CandidateOpaqueChunks({
      bodies:verified.reverse(),expectedChangeId:chunks.changeId,
      expectedContentDigest:chunks.contentDigest,
      expectedEncryptionContextRef:chunks.encryptionContextRef,
    });
    assert.equal(assembled.transportContentIntegrityVerified,true);
    assert.equal(assembled.originalBusinessApplied,false);
    const combined=Buffer.from(assembled.ciphertext),
      tag=combined.subarray(-16),
      dec=createDecipheriv('aes-256-gcm',key,iv);
    dec.setAAD(Buffer.from('original:change:sealed:1'));
    dec.setAuthTag(tag);
    const decoded=Buffer.concat([
      dec.update(combined.subarray(0,-16)),dec.final(),
    ]);
    assert.deepEqual(decoded,plaintext);
    assert.equal(recipient.replay.size,3);
  }finally{outgoing.close();incoming.close();}
});


test('real Apache carries complete bidirectional signed HEADS/DIFF/CHANGE/CHUNK/ACK dialogue with two independent signer keys',async()=>{
  const {randomBytes,createCipheriv}=await import('node:crypto');
  const {prepareT4CandidateOpaqueChunks,assembleT4CandidateOpaqueChunks}=
    await import('../../src/network/standard-network-opaque-chunks.mjs');
  const {createT4CandidateFrameTransport}=
    await import('../../src/network/standard-network-wire-transport.mjs');
  const {validateT4CandidatePeerTranscript}=
    await import('../../src/network/standard-network-peer-transcript.mjs');
  const {T4_CANDIDATE_VERSION}=
    await import('../../src/network/standard-network-wire-candidate.mjs');
  const keys={
    SOURCE:generateKeyPairSync('ed25519'),
    RECIPIENT:generateKeyPairSync('ed25519'),
  };
  const node={SOURCE:'node:peer:source',RECIPIENT:'node:peer:recipient'};
  const signer={SOURCE:'original:key:peer:source',
    RECIPIENT:'original:key:peer:recipient'};
  const sourceRef='original:owner:source',scopeRef='scope:peer:one',
    sessionRef='session:peer:one',familyRef='family:original:notes',
    changeId='change:peer:seven',epoch=4;
  const k=randomBytes(32),iv=randomBytes(12),
    plaintext=randomBytes(10500),
    encrypt=createCipheriv('aes-256-gcm',k,iv);
  encrypt.setAAD(Buffer.from(changeId));
  const sealed=Buffer.concat([
    encrypt.update(plaintext),encrypt.final(),encrypt.getAuthTag(),
  ]);
  const chunks=await prepareT4CandidateOpaqueChunks({
    changeId,ownerRef:sourceRef,
    sourceContentRef:'original:sealed:asset:one',
    getMode:()=> 'T4_NETWORK',
    authorizeOriginalSealedContent:async()=>true,
    readOriginalSealedContent:async()=>({
      ciphertext:new Uint8Array(sealed),
      encryptionContextRef:'crypto:peer:epoch:one',
    }),
    chunkBytes:4096,
  });
  assert.equal(chunks.chunkCount,3);
  const replay={SOURCE:new Map(),RECIPIENT:new Map()},counts={
    SOURCE:0,RECIPIENT:0,
  },transcript=[];
  const transports={SOURCE:makeTransport(),RECIPIENT:makeTransport()};
  function endpoint(role){
    return createT4CandidateFrameTransport({
      wireTransport:transports[role],getMode:()=> 'T4_NETWORK',
      originalHostNodeRef:node[role],originalHostScopeRef:scopeRef,
      readOriginalHostContext:async()=>({
        nodeRef:node[role],scopeRef,
        originalOwnerRef:sourceRef,
        hostSessionRef:'original:session:'+role,
      }),
      authorizeOriginalHostWire:async proof=>
        proof.originalOwnerRef===sourceRef&&
        proof.originalHostNodeRef===node[role]&&
        proof.originalNetworkHostAuthorityRequired===true,
      verifyOriginalNodeSignature:async proof=>{
        const from=Object.entries(signer)
          .find(([,v])=>v===proof.signerRef)?.[0];
        return from?verify(null,Buffer.from(proof.bytes),
          keys[from].publicKey,Buffer.from(proof.signature)):false;
      },
      authorizeOriginalNetwork:async proof=>
        proof.scopeRef===scopeRef&&
        proof.permissionRef==='original:permission:peer'&&
        proof.sourceNodeRef!==proof.recipientNodeRef&&
        proof.ownerEpoch===epoch,
      persistOriginalReplayDecision:async proof=>{
        const id=proof.sourceNodeRef+'/'+proof.sessionRef+'/'+
          proof.ownerEpoch+'/'+proof.sequence;
        const prev=replay[role].get(id);
        if(!prev){replay[role].set(id,proof.frameDigest);return 'RECORDED';}
        return prev===proof.frameDigest?'SEEN_EXACT':'CONFLICT';
      },
    });
  }
  let source=endpoint('SOURCE'),recipient=endpoint('RECIPIENT');
  async function exchange(role,type,body){
    const other=role==='SOURCE'?'RECIPIENT':'SOURCE';
    const seq=++counts[role];
    const unsigned=createT4CandidateUnsignedFrame({
      messageType:type,
      messageId:'peer:message:'+role+':'+seq,
      sourceNodeRef:node[role],recipientNodeRef:node[other],
      signerRef:signer[role],sessionRef,scopeRef,
      permissionRef:'original:permission:peer',
      sequence:seq,ownerEpoch:epoch,cryptoSuite:suite,body,
    });
    const bytes=await signT4CandidateFrame({
      unsignedFrame:unsigned,
      signOriginalNodeBytes:async({bytes})=>sign(null,Buffer.from(bytes),
        keys[role].privateKey),
    });
    const published=await (role==='SOURCE'?source:recipient)
      .publishSignedFrame({wireBytes:bytes});
    const result=await (other==='SOURCE'?source:recipient)
      .readAndVerifySignedFrame({
        key:published.key,expectedSha256:published.sha256,
        requiredCryptoSuite:suite,
      });
    assert.equal(result.originalBusinessApplied,false);
    transcript.push(result);
    return result;
  }
  const capabilities={
    supportedVersions:[T4_CANDIDATE_VERSION],
    supportedCryptoSuites:[suite],
  };
  const head='sha256:'+'3'.repeat(64);
  const change={
    changeId,changeKind:'ASSET_PUT',
    eventRef:'original:event:seven',ownerRef:sourceRef,sourceRevision:7,
    contentDigest:chunks.contentDigest,parents:[],
  };
  try{
    await exchange('SOURCE','HELLO',capabilities);
    await exchange('RECIPIENT','HELLO',capabilities);
    await exchange('SOURCE','CAPABILITIES',capabilities);
    await exchange('RECIPIENT','CAPABILITIES',capabilities);
    await exchange('SOURCE','HEADS',{
      familyRef,ownerEpoch:epoch,heads:[head],
    });
    await exchange('RECIPIENT','DIFF_REQUEST',{
      familyRef,fromHeads:[],
    });
    await exchange('SOURCE','CHANGE_REF',change);
    const recovered=[];
    for(const body of chunks.bodies){
      await exchange('RECIPIENT','CHUNK_REQUEST',{
        changeId,contentDigest:chunks.contentDigest,
        chunkIndex:body.chunkIndex,chunkCount:chunks.chunkCount,
      });
      const received=await exchange('SOURCE','CHUNK',body);
      recovered.push(received.verifiedBody);
    }
    const assembled=assembleT4CandidateOpaqueChunks({
      bodies:recovered,expectedChangeId:changeId,
      expectedContentDigest:chunks.contentDigest,
      expectedEncryptionContextRef:chunks.encryptionContextRef,
    });
    assert.deepEqual(Buffer.from(assembled.ciphertext),sealed);
    await exchange('RECIPIENT','RECEIVED_ACK',{
      changeId,contentDigest:chunks.contentDigest,
      ackRef:'ack:received:seven',
    });
    await exchange('RECIPIENT','VERIFIED_ACK',{
      changeId,contentDigest:chunks.contentDigest,
      ackRef:'ack:verified:seven',
    });
    const checked=validateT4CandidatePeerTranscript({
      receipts:transcript,
      sourceNodeRef:node.SOURCE,recipientNodeRef:node.RECIPIENT,
      scopeRef,sessionRef,familyRef,
      originalWriteOwnerRef:sourceRef,
      expectedChangeId:changeId,
      expectedEncryptionContextRef:chunks.encryptionContextRef,
      ownerEpoch:epoch,requiredCryptoSuite:suite,
    });
    assert.equal(checked.signedNegotiationAndSequenceVerified,true);
    assert.equal(checked.verifiedEncryptedChunkCount,3);
    assert.equal(checked.signedReceivedAndVerifiedAckPresent,true);
    assert.equal(checked.originalBusinessApplied,false);
    assert.equal(checked.originalT3ExchangeRequired,false);
    assert.equal(checked.durableOriginalSessionPhaseCheckpointProven,false);
    const swapped=[...transcript];
    [swapped[7],swapped[8]]=[swapped[8],swapped[7]];
    assert.throws(()=>validateT4CandidatePeerTranscript({
      receipts:swapped,sourceNodeRef:node.SOURCE,
      recipientNodeRef:node.RECIPIENT,scopeRef,sessionRef,
      familyRef,originalWriteOwnerRef:sourceRef,
      expectedChangeId:changeId,
      expectedEncryptionContextRef:chunks.encryptionContextRef,
      ownerEpoch:epoch,requiredCryptoSuite:suite,
    }),e=>e.code==='PEER_TRANSCRIPT_STAGE_OR_TRUST_INVALID');
  }finally{
    transports.SOURCE.close();transports.RECIPIENT.close();
  }
});
