import {createHash} from 'node:crypto';

/*
 * P2.1: bounded transport chunking of material already sealed by the
 * ORIGINAL content owner. The cipher/keys/AEAD remain outside T4.
 * Neither this module nor a signed CHUNK proves E2EE or subject receipt.
 */
export class T4CandidateChunkError extends Error{
  constructor(code){super(code);this.name='T4CandidateChunkError';this.code=code;}
}
const fail=code=>{throw new T4CandidateChunkError(code);};
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const DIG=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const HASH=x=>'sha256:'+createHash('sha256').update(x).digest('hex');
const MAX=64*8192;
const fields=['changeId','contentDigest','chunkIndex','chunkCount',
  'ciphertextBase64','ciphertextSha256','encryptionContextRef'];
const frozen=x=>Object.freeze(x);
function mode(getMode){
  if(getMode()!=='T4_NETWORK')fail('CHUNK_NETWORK_MODE_OFF');
}
async function guard(params,operation){
  mode(params.getMode);
  const result=await params.authorizeOriginalSealedContent(frozen({
    operation,sourceContentRef:params.sourceContentRef,
    ownerRef:params.ownerRef,changeId:params.changeId,
    originalSealedContentReadAuthorityRequired:true,
    networkCapabilityIsNotBusinessAuthority:true,
  }));
  if(result!==true)fail('CHUNK_ORIGINAL_ACCESS_DENIED');
  mode(params.getMode);
}
export async function prepareT4CandidateOpaqueChunks({
  changeId,ownerRef,sourceContentRef,getMode,
  authorizeOriginalSealedContent,readOriginalSealedContent,
  chunkBytes=8192,
}={}){
  if(![changeId,ownerRef,sourceContentRef].every(ID)||
    ![getMode,authorizeOriginalSealedContent,readOriginalSealedContent]
      .every(x=>typeof x==='function')||
    !Number.isSafeInteger(chunkBytes)||chunkBytes<1||chunkBytes>8192)
    fail('CHUNK_ORIGINAL_PORTS_REQUIRED');
  const p={changeId,ownerRef,sourceContentRef,getMode,
    authorizeOriginalSealedContent};
  await guard(p,'t4.network.sealed.read');
  const original=await readOriginalSealedContent(frozen({
    changeId,ownerRef,sourceContentRef,
    originalContentEncryptorRequired:true,
  }));
  mode(getMode);
  if(!(original?.ciphertext instanceof Uint8Array)||
    !ID(original.encryptionContextRef)||
    !original.ciphertext.byteLength||
    original.ciphertext.byteLength>MAX)
    fail('CHUNK_ORIGINAL_SEALED_CONTENT_INVALID');
  const snapshot=new Uint8Array(original.ciphertext);
  await guard(p,'t4.network.sealed.readback');
  const digest=HASH(snapshot);
  const count=Math.ceil(snapshot.length/chunkBytes);
  const bodies=[];
  for(let n=0;n<count;n++){
    const bytes=snapshot.subarray(n*chunkBytes,(n+1)*chunkBytes);
    bodies.push(frozen({
      changeId,contentDigest:digest,chunkIndex:n,chunkCount:count,
      ciphertextBase64:Buffer.from(bytes).toString('base64'),
      ciphertextSha256:HASH(bytes),
      encryptionContextRef:original.encryptionContextRef,
    }));
  }
  return frozen({
    schema:'IWXA_T4_CANDIDATE_OPAQUE_CHUNK_PLAN_V1',
    changeId,sourceContentRef,ownerRef,contentDigest:digest,
    encryptionContextRef:original.encryptionContextRef,
    chunkCount:count,bodies:frozen(bodies),
    originalSealedContentPortUsed:true,
    originalSubjectWriteAuthorityGranted:false,
    contentsAreOpaqueCiphertextByPortContract:true,
    e2eeKeyManagementVerified:false,
  });
}
export function assembleT4CandidateOpaqueChunks({
  bodies,expectedChangeId,expectedContentDigest,
  expectedEncryptionContextRef,
}={}){
  if(![expectedChangeId,expectedEncryptionContextRef].every(ID)||
    !DIG(expectedContentDigest)||!Array.isArray(bodies)||
    bodies.length<1||bodies.length>64)
    fail('CHUNK_ASSEMBLY_INPUT_INVALID');
  const total=bodies[0]?.chunkCount;
  if(!Number.isSafeInteger(total)||total!==bodies.length||
    total<1||total>64)
    fail('CHUNK_ASSEMBLY_INCOMPLETE');
  const parts=new Array(total);
  for(const body of bodies){
    if(!body||typeof body!=='object'||Array.isArray(body)||
      Object.keys(body).length!==fields.length||
      fields.some(k=>!Object.hasOwn(body,k))||
      body.changeId!==expectedChangeId||
      body.contentDigest!==expectedContentDigest||
      body.encryptionContextRef!==expectedEncryptionContextRef||
      body.chunkCount!==total||
      !Number.isSafeInteger(body.chunkIndex)||
      body.chunkIndex<0||body.chunkIndex>=total||
      parts[body.chunkIndex]!==undefined||
      !DIG(body.ciphertextSha256)||
      typeof body.ciphertextBase64!=='string'||
      body.ciphertextBase64.length<4||
      body.ciphertextBase64.length>10924||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
        .test(body.ciphertextBase64))
      fail('CHUNK_ASSEMBLY_BODY_INVALID');
    const bytes=Buffer.from(body.ciphertextBase64,'base64');
    if(!bytes.length||bytes.length>8192||
      bytes.toString('base64')!==body.ciphertextBase64||
      HASH(bytes)!==body.ciphertextSha256)
      fail('CHUNK_ASSEMBLY_INTEGRITY_FAILED');
    parts[body.chunkIndex]=bytes;
  }
  if(parts.some(x=>x===undefined))fail('CHUNK_ASSEMBLY_INCOMPLETE');
  const ciphertext=Buffer.concat(parts);
  if(ciphertext.length>MAX||HASH(ciphertext)!==expectedContentDigest)
    fail('CHUNK_ASSEMBLY_INTEGRITY_FAILED');
  return frozen({
    schema:'IWXA_T4_CANDIDATE_OPAQUE_CIPHERTEXT_ASSEMBLED_V1',
    changeId:expectedChangeId,contentDigest:expectedContentDigest,
    encryptionContextRef:expectedEncryptionContextRef,
    ciphertext:new Uint8Array(ciphertext),
    chunksVerified:total,
    transportContentIntegrityVerified:true,
    e2eeConfidentialityNotProvenByTransport:true,
    originalDecryptionNotInvoked:true,
    originalBusinessApplied:false,
  });
}
