// Candidate T4 extension of the ORIGINAL signed T3 Access registry.
// Pure verification and transition derivation only: no registry, key store,
// authority issuer, device scheduler or subject-write permission is created.
import {createPublicKey,verify} from 'node:crypto';
import {canonical,copy,digest,fields,identifier,insist,timestamp,validatePolicy,
  validateStatusSnapshot} from './core.mjs';

export const ORIGINAL_NETWORK_KEY_TRANSITION='IWXA_T4_ORIGINAL_NETWORK_KEY_TRANSITION/1';
export const ORIGINAL_NETWORK_KEY_MANAGE='t4.network.key.manage';
const claimFields=['schema','kind','transitionRef','authorityId','principalId','previousPolicyDigest',
  'registryWorkspaceId','registryObjectId','rootPolicyDigest','expectedStatusSequence','previousBindingDigest',
  'issuedAt','binding','keyRecord'];
const bindingFields=['bindingRef','subjectId','permissionRef','keyId','nodeRef','recipientNodeRef',
  'workspaceId','originalWriteOwnerRef','scopeRef','ownerEpoch','generation'];
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
  check(c.binding.nodeRef!==c.binding.recipientNodeRef&&
    Number.isSafeInteger(c.binding.ownerEpoch)&&c.binding.ownerEpoch>=1&&
    Number.isSafeInteger(c.binding.generation)&&c.binding.generation>=1,
    'NETWORK_KEY_BINDING_INVALID');
  if(c.kind==='REVOKE')check(c.keyRecord===null,'NETWORK_KEY_REVOKE_CANNOT_ADD_KEY');
  else{
    fields(c.keyRecord,['subjectId','environment','publicKey','status','uses','notBefore','expiresAt']);
    const k=c.keyRecord;
    check(k.subjectId===c.binding.subjectId&&k.status==='ACTIVE'&&
      Array.isArray(k.uses)&&k.uses.length===1&&k.uses[0]==='NETWORK_FRAME'&&
      ['TEST','PRODUCTION'].includes(k.environment)&&
      timestamp(k.notBefore)<=timestamp(c.issuedAt)&&timestamp(c.issuedAt)<timestamp(k.expiresAt)&&
      typeof k.publicKey==='string'&&createPublicKey(k.publicKey).asymmetricKeyType==='ed25519',
      'NETWORK_KEY_RECORD_INVALID');
  }
  return c;
}
export function originalNetworkKeyPossessionBytes(claims){
  const c=checkedClaims(claims);
  check(c.kind!=='REVOKE','NETWORK_KEY_POSSESSION_NOT_APPLICABLE');
  return Buffer.from('IWXA-T4-NETWORK-KEY-POSSESSION-V1\0'+canonical(c));
}
export function validateOriginalNetworkKeyTransition(input){
  const t=copy(input);fields(t,['claims','possessionSignature']);
  t.claims=checkedClaims(t.claims);
  if(t.claims.kind==='REVOKE')
    check(t.possessionSignature===null,'NETWORK_KEY_REVOKE_CANNOT_ADD_KEY');
  else{
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
      policy.keys[previous.keyId].uses.length===1&&policy.keys[previous.keyId].uses[0]==='NETWORK_FRAME',
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
