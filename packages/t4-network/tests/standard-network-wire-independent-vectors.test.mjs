import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {
  createT4CandidateUnsignedFrame,signT4CandidateFrame,
  decodeT4CandidateFrame,verifyT4CandidateWireFrame
} from '../src/network/standard-network-wire-candidate.mjs';

const location=dirname(fileURLToPath(import.meta.url));
const fixtures=JSON.parse(readFileSync(join(location,
  'fixtures/standard-network-wire-independent-vectors.v1.json'),'utf8'));
const key=createPrivateKey({
  key:Buffer.from('302e020100300506032b657004220420'+
    fixtures.testOnlyEd25519SeedHex,'hex'),
  format:'der',type:'pkcs8',
});
const publicKey=createPublicKey(key);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>JSON.stringify(Array.isArray(value)?
  value.map(canonicalValue):canonicalValue(value));
function canonicalValue(value){
  if(Array.isArray(value))return value.map(canonicalValue);
  if(value&&typeof value==='object'){
    return Object.fromEntries(Object.keys(value).sort()
      .map(k=>[k,canonicalValue(value[k])]));
  }
  return value;
}

test('independently pinned Python / Node canonical bytes and signed Ed25519 fixtures',async()=>{
  const pub=publicKey.export({format:'der',type:'spki'});
  assert.equal(pub.subarray(pub.length-32).toString('hex'),
    fixtures.testOnlyEd25519PublicHex);
  for(const vector of fixtures.vectors){
    const unsigned=createT4CandidateUnsignedFrame({
      ...fixtures.sharedFields,messageType:vector.messageType,
      messageId:'message:golden:'+vector.sequence,
      sequence:vector.sequence,body:vector.body,
    });
    assert.equal(unsigned.bodyDigest,vector.bodyDigest,vector.name);
    const signed=Buffer.concat([
      Buffer.from('IWXA-T4-WIRE-CANDIDATE-V1\0','utf8'),
      Buffer.from(canonical(unsigned),'utf8'),
    ]);
    assert.equal(hash(signed),vector.signedBytesSha256,vector.name);
    const wire=await signT4CandidateFrame({
      unsignedFrame:unsigned,
      signOriginalNodeBytes:async({bytes})=>sign(null,Buffer.from(bytes),key),
    });
    assert.equal(hash(wire),vector.wireSha256,vector.name);
    const decoded=decodeT4CandidateFrame(wire);
    assert.equal(decoded.signatureBase64,
      vector.signatureBase64,vector.name);
    assert.equal(verify(null,signed,publicKey,
      Buffer.from(decoded.signatureBase64,'base64')),true);
    assert.equal(Buffer.from(wire).toString('utf8'),
      canonical(decoded),vector.name);
  }
});
test('network fixture signatures do not grant original business rights',async()=>{
  const vector=fixtures.vectors[1];
  const unsigned=createT4CandidateUnsignedFrame({
    ...fixtures.sharedFields,messageType:vector.messageType,
    messageId:'message:golden:'+vector.sequence,
    sequence:vector.sequence,body:vector.body,
  });
  const wire=await signT4CandidateFrame({
    unsignedFrame:unsigned,
    signOriginalNodeBytes:async({bytes})=>sign(null,Buffer.from(bytes),key),
  });
  await assert.rejects(verifyT4CandidateWireFrame({
    wireBytes:wire,recipientNodeRef:'node:bob',
    scopeRef:'scope:workspace:opaque',
    requiredCryptoSuite:'X25519_AES256GCM_ED25519',
    verifyOriginalNodeSignature:async({bytes,signature})=>
      verify(null,Buffer.from(bytes),publicKey,Buffer.from(signature)),
    authorizeOriginalNetwork:async()=>false,
    persistOriginalReplayDecision:async()=>{throw Error('must not be called');},
  }),e=>e?.code==='WIRE_ORIGINAL_ACCESS_DENIED');
});
