// Candidate T4 extension of the ORIGINAL signed T3 Access registry.
// Pure verification and transition derivation only: no registry, key store,
// authority issuer, device scheduler or subject-write permission is created.
import {createPublicKey,verify,sign,generateKeyPairSync,diffieHellman,randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import {canonical,copy,digest,fields,identifier,insist,timestamp,validatePolicy,
  validateStatusSnapshot} from './core.mjs';
import {generateVaultKey,vaultPrivateKey} from './local-vault.mjs';

export const ORIGINAL_NETWORK_KEY_TRANSITION='IWXA_T4_ORIGINAL_NETWORK_KEY_TRANSITION/1';
export const ORIGINAL_NETWORK_KEY_MANAGE='t4.network.key.manage';
const claimFields=['schema','kind','transitionRef','authorityId','principalId','previousPolicyDigest',
  'registryWorkspaceId','registryObjectId','rootPolicyDigest','expectedStatusSequence','previousBindingDigest',
  'issuedAt','binding','keyRecord'];
const bindingFields=['bindingRef','subjectId','permissionRef','keyId','nodeRef','recipientNodeRef',
  'workspaceId','originalWriteOwnerRef','scopeRef','ownerEpoch','generation','keyUse'];
const stableFields=bindingFields.filter(k=>!['keyId','generation','bindingRef','permissionRef'].includes(k));
const same=(a,b)=>canonical(a)===canonical(b);
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const check=(v,c)=>insist(v,c);
function bindingSlot(b){return stableFields.map(k=>b[k]);}
function checkedClaims(input){
  const c=copy(input);fields(c,claimFields);
  check(c.schema===ORIGINAL_NETWORK_KEY_TRANSITION&&['ENROLL','ROTATE','REVOKE'].includes(c.kind),
    'NETWORK_KEY_TRANSITION_KIND_INVALID');
  for(const k of ['transitionRef','authorityId','principalId','registryWorkspaceId','registryObjectId'])identifier(c[k]);
  check(hex(c.rootPolicyDigest)&&hex(c.previousPolicyDigest)&&Number.isSafeInteger(c.expectedStatusSequence)&&c.expectedStatusSequence>=0&&
    c.expectedStatusSequence<Number.MAX_SAFE_INTEGER&&
    (c.kind==='ENROLL'?c.previousBindingDigest===null:hex(c.previousBindingDigest)),
    'NETWORK_KEY_PREDECESSOR_INVALID');
  timestamp(c.issuedAt);fields(c.binding,bindingFields);
  for(const k of bindingFields.filter(k=>!['ownerEpoch','generation'].includes(k)))identifier(c.binding[k]);
  check(['NETWORK_FRAME','NETWORK_AGREEMENT'].includes(c.binding.keyUse)&&c.binding.nodeRef!==c.binding.recipientNodeRef&&
    Number.isSafeInteger(c.binding.ownerEpoch)&&c.binding.ownerEpoch>=1&&
    Number.isSafeInteger(c.binding.generation)&&c.binding.generation>=1,
    'NETWORK_KEY_BINDING_INVALID');
  if(c.kind==='REVOKE')check(c.keyRecord===null,'NETWORK_KEY_REVOKE_CANNOT_ADD_KEY');
  else{
    fields(c.keyRecord,['subjectId','environment','publicKey','status','uses','notBefore','expiresAt']);
    const k=c.keyRecord;
    check(k.subjectId===c.binding.subjectId&&k.status==='ACTIVE'&&
      Array.isArray(k.uses)&&k.uses.length===1&&k.uses[0]===c.binding.keyUse&&
      ['TEST','PRODUCTION'].includes(k.environment)&&
      timestamp(k.notBefore)<=timestamp(c.issuedAt)&&timestamp(c.issuedAt)<timestamp(k.expiresAt)&&
      typeof k.publicKey==='string'&&createPublicKey(k.publicKey).asymmetricKeyType===(c.binding.keyUse==='NETWORK_AGREEMENT'?'x25519':'ed25519'),
      'NETWORK_KEY_RECORD_INVALID');
  }
  return c;
}
export function originalNetworkKeyPossessionBytes(claims){
  const c=checkedClaims(claims);
  check(c.kind!=='REVOKE'&&c.binding.keyUse==='NETWORK_FRAME','NETWORK_KEY_POSSESSION_NOT_APPLICABLE');
  return Buffer.from('IWXA-T4-NETWORK-KEY-POSSESSION-V1\0'+canonical(c));
}
// A fresh DH possession challenge is verified in the original trusted
// issuer process. Its ephemeral secret is never in the Registry or Vault.
// Cold replay authenticates the issuer's signed STATUS attesting the exact
// public witness. The in-memory evidence below is not a grant or a Store.
const agreementChallenges=new WeakMap();
const challengeSchema='IWXA_T4_NETWORK_AGREEMENT_CHALLENGE/1';
const b64=(value,length)=>{
  check(typeof value==='string'&&/^[A-Za-z0-9_-]+$/.test(value)&&value.length<=128,
    'NETWORK_AGREEMENT_ENCODING_INVALID');
  const bytes=Buffer.from(value,'base64url');
  check(bytes.length===length&&bytes.toString('base64url')===value,'NETWORK_AGREEMENT_ENCODING_INVALID');
  return bytes;
};
function checkedAgreementChallenge(input,claims){
  const c=copy(input);fields(c,['schema','claimsDigest','issuerEphemeralPublicKey','nonce']);
  check(c.schema===challengeSchema&&c.claimsDigest===digest(claims),'NETWORK_AGREEMENT_CHALLENGE_MISMATCH');
  b64(c.nonce,32);
  const der=b64(c.issuerEphemeralPublicKey,44),pub=createPublicKey({key:der,format:'der',type:'spki'});
  check(pub.asymmetricKeyType==='x25519'&&pub.export({type:'spki',format:'der'}).equals(der),
    'NETWORK_AGREEMENT_CHALLENGE_KEY_INVALID');
  return {challenge:c,publicKey:pub};
}
function agreementResponse(privateKey,publicKey,challenge){
  const shared=diffieHellman({privateKey,publicKey});
  try{
    check(shared.length===32&&shared.some(x=>x!==0),'NETWORK_AGREEMENT_SHARED_SECRET_INVALID');
    return createHmac('sha256',shared).update('IWXA-T4-NETWORK-AGREEMENT-POSSESSION-V1\0'+canonical(challenge)).digest();
  }finally{shared.fill(0);}
}
function agreementClaims(input){
  const c=checkedClaims(input);
  check(c.kind!=='REVOKE'&&c.binding.keyUse==='NETWORK_AGREEMENT','NETWORK_AGREEMENT_POSSESSION_NOT_APPLICABLE');
  return c;
}
export function createOriginalNetworkAgreementChallenge(input,{clock=Date.now}={}){
  const claims=agreementClaims(input),now=clock(),at=timestamp(claims.issuedAt);
  check(Number.isSafeInteger(now)&&at<=now&&now-at<60000,'NETWORK_AGREEMENT_CHALLENGE_EXPIRED');
  const {publicKey,privateKey}=generateKeyPairSync('x25519');
  const challenge=Object.freeze({schema:challengeSchema,claimsDigest:digest(claims),
    issuerEphemeralPublicKey:publicKey.export({type:'spki',format:'der'}).toString('base64url'),
    nonce:randomBytes(32).toString('base64url')});
  const expected=agreementResponse(privateKey,createPublicKey(claims.keyRecord.publicKey),challenge);
  let used=false;
  return Object.freeze({challenge,verifyResponse(response){
    check(!used,'NETWORK_AGREEMENT_CHALLENGE_ALREADY_USED');used=true;
    try{
      const observed=clock();
      check(Number.isSafeInteger(observed)&&observed>=now&&observed-at<60000,'NETWORK_AGREEMENT_CHALLENGE_EXPIRED');
      check(timingSafeEqual(expected,b64(response,32)),'NETWORK_AGREEMENT_POSSESSION_INVALID');
      const transition=validateOriginalNetworkKeyTransition({claims,possessionSignature:null,
        agreementPossession:{challenge,response}});
      const evidence=Object.freeze({transitionDigest:digest(transition)});
      agreementChallenges.set(evidence,{transitionDigest:digest(transition),verifiedAt:observed});
      return Object.freeze({transition,evidence});
    }finally{expected.fill(0);}
  }});
}
export function answerOriginalNetworkAgreementChallenge({claims:input,challenge,privateKey}={}){
  const claims=agreementClaims(input),parsed=checkedAgreementChallenge(challenge,claims);
  check(privateKey?.type==='private'&&privateKey.asymmetricKeyType==='x25519'&&
    createPublicKey(privateKey).export({type:'spki',format:'der'}).equals(
      createPublicKey(claims.keyRecord.publicKey).export({type:'spki',format:'der'})),
    'NETWORK_AGREEMENT_POSSESSION_KEY_MISMATCH');
  const response=agreementResponse(privateKey,parsed.publicKey,parsed.challenge);
  try{return response.toString('base64url');}finally{response.fill(0);}
}
export function isVerifiedOriginalNetworkAgreementPossession(evidence,transition,now){
  const record=agreementChallenges.get(evidence);
  return !!record&&record.transitionDigest===digest(transition)&&Number.isSafeInteger(now)&&
    now>=record.verifiedAt&&now-record.verifiedAt<60000;
}
export function validateOriginalNetworkKeyTransition(input){
  const t=copy(input);fields(t,['claims','possessionSignature','agreementPossession']);
  t.claims=checkedClaims(t.claims);
  if(t.claims.kind==='REVOKE')
    check(t.possessionSignature===null&&t.agreementPossession===null,'NETWORK_KEY_REVOKE_CANNOT_ADD_KEY');
  else if(t.claims.binding.keyUse==='NETWORK_AGREEMENT'){
    check(t.possessionSignature===null,'NETWORK_AGREEMENT_CANNOT_SIGN_ACCESS_OR_FRAME');
    fields(t.agreementPossession,['challenge','response']);
    checkedAgreementChallenge(t.agreementPossession.challenge,t.claims);
    b64(t.agreementPossession.response,32);
  }else{
    check(t.agreementPossession===null,'NETWORK_KEY_POSSESSION_INVALID');
    check(typeof t.possessionSignature==='string'&&/^[A-Za-z0-9_-]{86}$/.test(t.possessionSignature),
      'NETWORK_KEY_POSSESSION_INVALID');
    const raw=Buffer.from(t.possessionSignature,'base64url');
    check(raw.length===64&&raw.toString('base64url')===t.possessionSignature&&
      verify(null,originalNetworkKeyPossessionBytes(t.claims),createPublicKey(t.claims.keyRecord.publicKey),raw),
      'NETWORK_KEY_POSSESSION_INVALID');
  }
  return t;
}
export function originalNetworkKeyOperationDigest(transition){
  return digest(validateOriginalNetworkKeyTransition(transition));
}
export function originalNetworkKeyStatusId(transition){
  return 'status:network-key:'+originalNetworkKeyOperationDigest(transition);
}
// The original issuer's signed STATUS attests the exact transition and
// advances its EXISTING monotonic sequence. This is replayed from the
// original Kernel Event journal, never trusted from a writable key object.
export function deriveOriginalNetworkKeyTransition({transition,signedStatus,policy,bindings,priorFloors,registryIdentity}={}){
  const t=validateOriginalNetworkKeyTransition(transition),c=t.claims,b=c.binding;
  const authority=Object.hasOwn(policy.authorities,c.authorityId)?policy.authorities[c.authorityId]:null;
  check(authority&&authority.principalId===c.principalId&&authority.resources.includes(b.workspaceId)&&
    authority.actions.includes(ORIGINAL_NETWORK_KEY_MANAGE)&&
    authority.rightClasses.includes('ADMINISTRATION')&&
    policy.actionCatalog[ORIGINAL_NETWORK_KEY_MANAGE]==='ADMINISTRATION',
    'NETWORK_KEY_AUTHORITY_SCOPE_DENIED');
  check(registryIdentity&&c.registryWorkspaceId===registryIdentity.workspaceId&&
    c.registryObjectId===registryIdentity.objectId&&c.rootPolicyDigest===registryIdentity.rootPolicyDigest,
    'NETWORK_KEY_REGISTRY_SCOPE_MISMATCH');
  check(c.previousPolicyDigest===digest(policy)&&priorFloors?.[c.authorityId]===c.expectedStatusSequence,
    'NETWORK_KEY_POLICY_OR_SEQUENCE_STALE');
  const at=timestamp(c.issuedAt);
  const status=validateStatusSnapshot(c.authorityId,{policy,statuses:{[c.authorityId]:signedStatus},
    statusFloor:{[c.authorityId]:c.expectedStatusSequence+1}},at);
  check(status.id==='status:network-key:'+digest(t)&&status.sequence===c.expectedStatusSequence+1&&
    status.issuedAt===c.issuedAt&&authority.statusKeys.includes(signedStatus.keyId),
    'NETWORK_KEY_ISSUER_STATEMENT_INVALID');
  const previous=bindings.get(b.bindingRef);
  if(c.kind==='ENROLL'){
    check(!previous&&b.generation===1&&
      ![...bindings.values()].some(old=>old.active&&same(bindingSlot(old),bindingSlot(b))),
      'NETWORK_KEY_BINDING_ALREADY_EXISTS');
  }else{
    check(previous&&previous.active&&previous.authorityId===c.authorityId&&previous.principalId===c.principalId&&
      previous.generation+1===b.generation&&c.previousBindingDigest===digest(previous)&&
      stableFields.every(k=>previous[k]===b[k])&&previous.permissionRef===b.permissionRef&&
      Object.hasOwn(policy.keys,previous.keyId)&&policy.keys[previous.keyId].status==='ACTIVE'&&
      policy.keys[previous.keyId].uses.length===1&&policy.keys[previous.keyId].uses[0]===b.keyUse,
      'NETWORK_KEY_BINDING_PREDECESSOR_MISMATCH');
    check(c.kind==='ROTATE'?b.keyId!==previous.keyId:b.keyId===previous.keyId,
      'NETWORK_KEY_TRANSITION_KEY_MISMATCH');
  }
  const nextPolicy=copy(policy);
  if(previous)nextPolicy.keys[previous.keyId].status='REVOKED';
  if(c.kind!=='REVOKE'){
    check(!Object.hasOwn(nextPolicy.keys,b.keyId)&&c.keyRecord.environment===policy.environment&&
      timestamp(c.keyRecord.expiresAt)-at<=authority.maxTtlSeconds*1000,
      'NETWORK_KEY_ID_OR_LIFETIME_INVALID');
    nextPolicy.keys[b.keyId]=copy(c.keyRecord);
  }
  // Original policy validation also rejects the reuse of a PROOF, GRANT,
  // STATUS or retired network public key under another identifier.
  validatePolicy(nextPolicy);
  const nextBinding={...b,authorityId:c.authorityId,principalId:c.principalId,
    active:c.kind!=='REVOKE',transitionDigest:digest(t)};
  return {policy:nextPolicy,binding:nextBinding,transition:t};
}

// The existing device Vault holds the dedicated keys before enrollment and
// after restart. Only the issuer's original challenge may be answered.
// No network authorization follows from generating a local key.
export const ORIGINAL_NETWORK_DEVICE_KEY_PREFIX='key:t4-pilot:';
export function createOriginalNetworkDeviceKeyCustody({role,actorId,principalId,authorityId,workspaceId,
  permissionRef,rootPolicyDigest,requireCurrent,readVault,commitVault,clock=Date.now}={}){
  check(['SOURCE','RECIPIENT'].includes(role)&&hex(rootPolicyDigest)&&
    [requireCurrent,readVault,commitVault,clock].every(f=>typeof f==='function'),'NETWORK_DEVICE_CUSTODY_REQUIRED');
  [actorId,principalId,authorityId,workspaceId,permissionRef].forEach(identifier);
  const selected=(route,use)=>{
    const r=copy(route);fields(r,['sourceNodeRef','recipientNodeRef','originalWriteOwnerRef','scopeRef','ownerEpoch']);
    [r.sourceNodeRef,r.recipientNodeRef,r.originalWriteOwnerRef,r.scopeRef].forEach(identifier);
    check(r.sourceNodeRef!==r.recipientNodeRef&&Number.isSafeInteger(r.ownerEpoch)&&r.ownerEpoch>=1&&
      (use==='NETWORK_FRAME'||role==='RECIPIENT'&&use==='NETWORK_AGREEMENT'),'NETWORK_DEVICE_ROUTE_INVALID');
    const keyId=ORIGINAL_NETWORK_DEVICE_KEY_PREFIX+digest({role,actorId,principalId,authorityId,workspaceId,permissionRef,route:r,keyUse:use});
    return {r,keyId,algorithm:use==='NETWORK_FRAME'?'Ed25519':'X25519'};
  };
  const localKey=(vault,keyId,algorithm)=>{
    const k=vault?.keys?.[keyId];
    check(k?.subjectId===actorId&&k.algorithm===algorithm,'NETWORK_DEVICE_LOCAL_KEY_MISMATCH');
    return k;
  };
  function prepare({route,keyUse,confirmed=false}={}){
    requireCurrent();check(confirmed===true,'NETWORK_DEVICE_EXPLICIT_APPROVAL_REQUIRED');
    const {keyId,algorithm}=selected(route,keyUse),vault=readVault();
    if(!Object.hasOwn(vault.keys,keyId)){
      const next=copy(vault);
      generateVaultKey(next,{keyId,subjectId:actorId,algorithm,createdAt:new Date(clock()).toISOString()});
      requireCurrent();
      commitVault(next);
      // commitVault must perform original encrypted save and readback.
      const stored=localKey(readVault(),keyId,algorithm);
      check(stored.publicKeyPem===next.keys[keyId].publicKeyPem,'NETWORK_DEVICE_KEY_SAVE_UNCONFIRMED');
    }
    requireCurrent();
    const key=localKey(readVault(),keyId,algorithm);
    return Object.freeze({keyId,keyUse,publicKey:key.publicKeyPem,privateKeyRetained:true});
  }
  function answer({claims,agreementChallenge=null,confirmed=false}={}){
    requireCurrent();check(confirmed===true,'NETWORK_DEVICE_EXPLICIT_APPROVAL_REQUIRED');
    const c=checkedClaims(claims),b=c.binding,source=role==='SOURCE',route={
      sourceNodeRef:source?b.nodeRef:b.recipientNodeRef,recipientNodeRef:source?b.recipientNodeRef:b.nodeRef,
      originalWriteOwnerRef:b.originalWriteOwnerRef,scopeRef:b.scopeRef,ownerEpoch:b.ownerEpoch};
    const {keyId,algorithm}=selected(route,b.keyUse),now=clock();
    check(c.kind==='ENROLL'&&b.generation===1&&c.authorityId===authorityId&&c.principalId===principalId&&
      c.rootPolicyDigest===rootPolicyDigest&&b.subjectId===actorId&&b.workspaceId===workspaceId&&
      b.permissionRef===permissionRef&&b.keyId===keyId&&timestamp(c.issuedAt)<=now&&now-timestamp(c.issuedAt)<60000,
      'NETWORK_DEVICE_CHALLENGE_SCOPE_INVALID');
    const vault=readVault(),key=localKey(vault,keyId,algorithm);
    check(c.keyRecord.publicKey===key.publicKeyPem,'NETWORK_DEVICE_CHALLENGE_KEY_MISMATCH');
    requireCurrent();
    const privateKey=vaultPrivateKey(vault,keyId);
    const response=b.keyUse==='NETWORK_AGREEMENT'?
      {agreementResponse:answerOriginalNetworkAgreementChallenge({claims:c,challenge:agreementChallenge,privateKey})}:
      (check(agreementChallenge===null,'NETWORK_DEVICE_CHALLENGE_SCOPE_INVALID'),
       {possessionSignature:sign(null,originalNetworkKeyPossessionBytes(c),privateKey).toString('base64url')});
    requireCurrent();return Object.freeze({transitionRef:c.transitionRef,...response});
  }
  return Object.freeze({prepare,answer});
}
