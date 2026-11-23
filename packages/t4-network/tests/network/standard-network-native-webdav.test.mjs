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
