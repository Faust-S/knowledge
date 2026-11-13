// Canonical T3 Access evaluator adopted from the original IWXA T3 research
// profile, retained byte-for-byte below this header. The ONE executable copy
// now lives in knowledge. This is NOT the T2 Kernel, Store, package format,
// a second IAM, or an independent issuer. No private keys are checked in.
// Host-provided signed grant/status/proof state remains authoritative.
import { createHash, createPublicKey, sign, verify } from 'node:crypto';

// This is a versioned T3 reference profile, not the T2 CapabilityGrant format.
export const PROFILE = 'IWXA_T3_ACCESS/1';
export const ENVELOPE = 'IWXA_T3_ACCESS_SIGNED/1';
export const RIGHT_CLASSES = ['ENTITLEMENT', 'DATA', 'ACTION', 'ACCEPTANCE', 'ADMINISTRATION'];
export const OUTCOMES = ['PERMITTED', 'PERMITTED_WITH_CONDITIONS', 'REQUIRES_PROOF', 'REQUIRES_CONFIRMATION', 'REQUIRES_FRESH_STATUS', 'DENIED', 'UNRESOLVED', 'STALE_REVALIDATION_REQUIRED'];
export class AccessError extends Error {
  constructor(code, outcome = 'DENIED') { super(code); this.name = 'AccessError'; this.code = code; this.outcome = outcome; }
}
export function insist(ok, code, outcome) { if (!ok) throw new AccessError(code, outcome); }
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
export function snapshot(value, depth = 0) {
  insist(depth <= 24, 'INPUT_TOO_DEEP');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') { insist(value.length <= 16384 && value.isWellFormed(), 'INVALID_STRING'); return value; }
  if (typeof value === 'number') { insist(Number.isSafeInteger(value) && !Object.is(value, -0), 'INVALID_NUMBER'); return value; }
  if (Array.isArray(value)) { insist(value.length <= 4096, 'ARRAY_TOO_LARGE'); const out=[]; for(let i=0;i<value.length;i++){ const d=Object.getOwnPropertyDescriptor(value,String(i)); insist(d && own(d,'value'),'SPARSE_OR_ACCESSOR_ARRAY'); out.push(snapshot(d.value,depth+1)); } return out; }
  insist(value && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null), 'PLAIN_DATA_REQUIRED');
  const entries = Object.entries(Object.getOwnPropertyDescriptors(value));
  insist(entries.length <= 4096, 'OBJECT_TOO_LARGE');
  const out = Object.create(null);
  for (const [k, d] of entries) {
    insist(!['__proto__', 'constructor', 'prototype'].includes(k) && own(d, 'value') && d.enumerable, 'UNSAFE_PROPERTY');
    out[k] = snapshot(d.value, depth + 1);
  }
  return out;
}
export function canonical(value) {
  const v = snapshot(value);
  const emit = x => x === null || typeof x !== 'object' ? JSON.stringify(x) : Array.isArray(x) ? '[' + x.map(emit).join(',') + ']' : '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + emit(x[k])).join(',') + '}';
  return emit(v);
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export const copy = value => JSON.parse(canonical(value));
// A recorded negative fact must block access even if its value is malformed or falsy.
// The optional index is preserved for legacy callers; a PRESENT invalid index fails closed.
export function hasRecordedTombstone(state, grantId) {
  const index=state?.tombstones;
  insist(index===undefined || (index!==null && typeof index==='object' && !Array.isArray(index)), 'INVALID_TOMBSTONE_INDEX');
  return index!==undefined && Object.hasOwn(index, grantId);
}
export function fields(value, required, optional = []) {
  insist(value && typeof value === 'object' && !Array.isArray(value), 'OBJECT_REQUIRED');
  insist(required.every(k => own(value, k)), 'MISSING_FIELD');
  insist(Object.keys(value).every(k => [...required, ...optional].includes(k)), 'UNKNOWN_FIELD');
}
export function identifier(v) { insist(typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(v), 'INVALID_IDENTIFIER'); return v; }
export function timestamp(v) {
  insist(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v), 'INVALID_TIME');
  const n = Date.parse(v); insist(Number.isFinite(n) && new Date(n).toISOString() === v, 'INVALID_TIME'); return n;
}
const strings = xs => { insist(Array.isArray(xs) && xs.length > 0 && xs.length <= 128 && new Set(xs).size === xs.length, 'INVALID_SET'); xs.forEach(identifier); };
const subset = (xs, ys) => xs.every(x => ys.includes(x));
export const iso = n => new Date(n).toISOString();
export const GRANT_FIELDS = ['kind', 'id', 'lineageId', 'renewalOf', 'parentGrantId', 'authorityId', 'principalId', 'holderId', 'roleId', 'rightClass', 'realmId', 'environment', 'audience', 'resources', 'actions', 'purposes', 'issuedAt', 'notBefore', 'expiresAt', 'remainingDepth', 'membershipEpoch', 'policyId', 'policyVersion', 'evidenceRefs'];
export function validateGrant(p) {
  fields(p, GRANT_FIELDS); insist(p.kind === 'GRANT', 'WRONG_RECORD_KIND');
  for (const k of ['id','lineageId','authorityId','principalId','holderId','roleId','realmId','audience','policyId','policyVersion']) identifier(p[k]);
  for (const k of ['renewalOf','parentGrantId']) if (p[k] !== null) identifier(p[k]);
  insist(p.renewalOf !== p.id && p.parentGrantId !== p.id && !(p.renewalOf && p.parentGrantId), 'INVALID_LINEAGE');
  insist(RIGHT_CLASSES.includes(p.rightClass), 'INVALID_RIGHT_CLASS');
  insist(['TEST','PRODUCTION'].includes(p.environment), 'INVALID_ENVIRONMENT');
  for (const k of ['resources','actions','purposes','evidenceRefs']) strings(p[k]);
  const i = timestamp(p.issuedAt), b = timestamp(p.notBefore), e = timestamp(p.expiresAt);
  insist(i <= b && b < e, 'INVALID_INTERVAL');
  insist(Number.isSafeInteger(p.remainingDepth) && p.remainingDepth >= 0 && p.remainingDepth <= 8, 'INVALID_DELEGATION_DEPTH');
  insist(Number.isSafeInteger(p.membershipEpoch) && p.membershipEpoch >= 0, 'INVALID_EPOCH');
  return p;
}
function message(envelope) {
  return Buffer.from('IWXA-T3-ACCESS-SIGNED-V1\0' + canonical({schema: envelope.schema, keyId: envelope.keyId, payload: envelope.payload}));
}
// A signer is supplied by a trusted host. No key material enters a grant or decision.
export function signRecord(payload, provider) {
  const envelope = {schema: ENVELOPE, keyId: identifier(provider.keyId), payload: copy(payload)};
  envelope.signature = Buffer.from(provider.sign(message(envelope))).toString('base64url');
  return envelope;
}
export function keyObjectSigner(keyId, privateKey) {
  insist(privateKey?.type === 'private' && privateKey.asymmetricKeyType === 'ed25519', 'ED25519_PRIVATE_KEY_REQUIRED');
  return Object.freeze({keyId: identifier(keyId), sign: data => sign(null, data, privateKey)});
}
export function verifyRecord(envelope, policy, now, expectedKind) {
  fields(envelope, ['schema','keyId','payload','signature']);
  insist(envelope.schema === ENVELOPE, 'UNSUPPORTED_ENVELOPE');
  identifier(envelope.keyId);
  const key = policy.keys[envelope.keyId];
  insist(key, 'UNKNOWN_KEY', 'UNRESOLVED');
  insist(key.status === 'ACTIVE', 'KEY_NOT_ACTIVE');
  insist(key.environment === policy.environment && envelope.payload.environment === policy.environment, 'ENVIRONMENT_MISMATCH');
  insist(key.uses.includes(expectedKind) && envelope.payload.kind === expectedKind, 'KEY_USAGE_DENIED');
  insist(timestamp(key.notBefore) <= now && now < timestamp(key.expiresAt), 'KEY_OUTSIDE_VALIDITY');
  insist(typeof envelope.signature === 'string' && /^[A-Za-z0-9_-]{86}$/.test(envelope.signature), 'INVALID_SIGNATURE_ENCODING');
  const bytes = Buffer.from(envelope.signature, 'base64url');
  insist(bytes.toString('base64url') === envelope.signature, 'INVALID_SIGNATURE_ENCODING');
  const publicKey = createPublicKey(key.publicKey);
  insist(publicKey.asymmetricKeyType === 'ed25519', 'ED25519_PUBLIC_KEY_REQUIRED');
  insist(verify(null, message(envelope), publicKey, bytes), 'SIGNATURE_INVALID');
  return key;
}
export function validatePolicy(p) {
  fields(p, ['schema','id','version','realmId','environment','statusMode','timeAssurance','proofMaxAgeSeconds','snapshotMaxAgeSeconds','offlineMaxAgeSeconds','keys','authorities','actionCatalog','prohibitions','confirmations']);
  insist(p.schema === PROFILE && ['TEST','PRODUCTION'].includes(p.environment), 'UNSUPPORTED_POLICY');
  identifier(p.id); identifier(p.version); identifier(p.realmId);
  insist(['OFFLINE_BOUNDED','STATUS_SNAPSHOT'].includes(p.statusMode), 'UNSUPPORTED_STATUS_MODE');
  insist(['LOCAL_BEST_EFFORT','TRUSTED'].includes(p.timeAssurance), 'UNSUPPORTED_TIME_ASSURANCE');
  for (const k of ['proofMaxAgeSeconds','snapshotMaxAgeSeconds','offlineMaxAgeSeconds']) insist(Number.isSafeInteger(p[k]) && p[k] > 0 && p[k] <= 315360000, 'INVALID_ASSURANCE_LIMIT');
  for (const [id,k] of Object.entries(p.keys)) {
    identifier(id); fields(k, ['subjectId','environment','publicKey','status','uses','notBefore','expiresAt']); identifier(k.subjectId);
    insist(['TEST','PRODUCTION'].includes(k.environment) && ['ACTIVE','SUSPENDED','REVOKED'].includes(k.status), 'INVALID_KEY_METADATA');
    strings(k.uses); insist(subset(k.uses,['GRANT','STATUS','PROOF','CONFIRMATION','LIVE_STATUS','LICENSE','LICENSE_STATUS']), 'INVALID_KEY_USAGE');
    insist(timestamp(k.notBefore) < timestamp(k.expiresAt), 'INVALID_KEY_INTERVAL');
    insist(typeof k.publicKey === 'string' && createPublicKey(k.publicKey).asymmetricKeyType === 'ed25519', 'INVALID_PUBLIC_KEY');
  }
  for (const [id,a] of Object.entries(p.authorities)) {
    identifier(id); fields(a,['principalId','issuerKeys','statusKeys','audiences','resources','actions','purposes','roles','rightClasses','membershipEpoch','maxTtlSeconds','maxDelegationDepth']);
    identifier(a.principalId);
    for (const k of ['issuerKeys','statusKeys','audiences','resources','actions','purposes','roles','rightClasses']) strings(a[k]);
    insist(subset(a.rightClasses,RIGHT_CLASSES), 'INVALID_AUTHORITY_RIGHT_CLASS');
    insist([...a.issuerKeys,...a.statusKeys].every(k => own(p.keys,k)), 'AUTHORITY_KEY_MISSING');
    insist(Number.isSafeInteger(a.membershipEpoch) && a.membershipEpoch >= 0, 'INVALID_EPOCH');
    insist(Number.isSafeInteger(a.maxTtlSeconds) && a.maxTtlSeconds > 0 && a.maxTtlSeconds <= 315360000, 'INVALID_TTL');
    insist(Number.isSafeInteger(a.maxDelegationDepth) && a.maxDelegationDepth >= 0 && a.maxDelegationDepth <= 8, 'INVALID_DELEGATION_DEPTH');
  }
  for (const [action,cls] of Object.entries(p.actionCatalog)) { identifier(action); insist(RIGHT_CLASSES.includes(cls),'INVALID_ACTION_CLASS'); }
  insist(Array.isArray(p.prohibitions) && Array.isArray(p.confirmations),'INVALID_POLICY_RULES');
  for (const r of p.prohibitions) { fields(r,['authorityId','action','resource','purpose','reason']); Object.values(r).forEach(identifier); }
  for (const r of p.confirmations) {
    fields(r,['authorityId','action','resource','principals','minimum']);
    identifier(r.authorityId); identifier(r.action); identifier(r.resource); strings(r.principals);
    insist(Number.isSafeInteger(r.minimum) && r.minimum > 0 && r.minimum <= r.principals.length,'INVALID_QUORUM');
  }
  return p;
}
export function checkCeiling(g,a,policy) {
  insist(g.realmId === policy.realmId && g.environment === policy.environment, 'REALM_OR_ENVIRONMENT_MISMATCH');
  insist(g.policyId === policy.id && g.policyVersion === policy.version, 'POLICY_REVALIDATION_REQUIRED', 'STALE_REVALIDATION_REQUIRED');
  insist(g.principalId === a.principalId && a.roles.includes(g.roleId) && a.rightClasses.includes(g.rightClass), 'AUTHORITY_SCOPE_DENIED');
  insist(a.audiences.includes(g.audience) && subset(g.resources,a.resources) && subset(g.actions,a.actions) && subset(g.purposes,a.purposes), 'AUTHORITY_CEILING_EXCEEDED');
  insist(g.actions.every(x => policy.actionCatalog[x] === g.rightClass), 'RIGHT_CLASS_MISMATCH');
  insist(timestamp(g.expiresAt)-timestamp(g.notBefore) <= a.maxTtlSeconds*1000 && g.remainingDepth <= a.maxDelegationDepth, 'GRANT_LIMIT_EXCEEDED');
  insist(g.membershipEpoch === a.membershipEpoch,'MEMBERSHIP_REVALIDATION_REQUIRED','STALE_REVALIDATION_REQUIRED');
}
export function assertAttenuation(child,parent) {
  for (const k of ['authorityId','principalId','roleId','rightClass','realmId','environment','audience','membershipEpoch','policyId','policyVersion']) insist(child[k] === parent[k], 'DELEGATION_BINDING_CHANGED');
  for (const k of ['resources','actions','purposes']) insist(subset(child[k],parent[k]),'DELEGATION_EXPANDS_RIGHTS');
  insist(child.remainingDepth < parent.remainingDepth, 'DELEGATION_DEPTH_EXCEEDED');
  insist(timestamp(child.notBefore) >= timestamp(parent.notBefore) && timestamp(child.expiresAt) <= timestamp(parent.expiresAt) && timestamp(child.issuedAt) >= timestamp(parent.issuedAt), 'DELEGATION_EXPANDS_TIME');
}
export function assertRenewal(next,old) {
  for (const k of ['lineageId','authorityId','principalId','holderId','roleId','rightClass','realmId','environment','audience','membershipEpoch','policyId','policyVersion']) insist(next[k] === old[k], 'RENEWAL_BINDING_CHANGED');
  for (const k of ['resources','actions','purposes']) insist(subset(next[k],old[k]), 'RENEWAL_EXPANDS_RIGHTS');
  insist(next.remainingDepth <= old.remainingDepth && next.renewalOf === old.id && next.parentGrantId === null && old.parentGrantId === null, 'RENEWAL_LINEAGE_INVALID');
  insist(timestamp(next.issuedAt) >= timestamp(old.issuedAt), 'RENEWAL_TIME_INVALID');
}
export function verifiedChain(grantId, state, now, options = {}) {
  const {policy,grants} = state; const visited = new Set(); const path = [];
  function walk(id) {
    insist(!visited.has(id) && visited.size < 16,'DELEGATION_CYCLE_OR_LIMIT'); visited.add(id);
    const env = grants[id]; insist(env,'GRANT_NOT_FOUND','UNRESOLVED');
    const g = validateGrant(env.payload); insist(g.id === id,'GRANT_ID_MISMATCH');
    const key = verifyRecord(env,policy,now,'GRANT');
    const a = policy.authorities[g.authorityId]; insist(a,'AUTHORITY_NOT_BOUND','UNRESOLVED'); checkCeiling(g,a,policy);
    insist(timestamp(g.issuedAt) <= now && timestamp(g.notBefore) <= now,'GRANT_NOT_YET_VALID');
    if (!options.allowExpired) insist(now < timestamp(g.expiresAt),'GRANT_EXPIRED');
    if (g.parentGrantId) {
      const parent = walk(g.parentGrantId);
      insist(key.subjectId === parent.holderId,'DELEGATOR_NOT_HOLDER'); assertAttenuation(g,parent);
    } else insist(a.issuerKeys.includes(env.keyId),'ISSUER_NOT_AUTHORIZED');
    // A renewal is a signed ancestry, not just its immediate predecessor.
    // Other T3 consumers also use verifiedChain(), without evaluate() JIT.
    let newer=g, predecessor=g.renewalOf;
    const renewalSeen=new Set([g.id]);
    while(predecessor){
      insist(!renewalSeen.has(predecessor) && renewalSeen.size<128,
        'RENEWAL_CYCLE_OR_LIMIT');renewalSeen.add(predecessor);
      const oldEnv=grants[predecessor];
      insist(oldEnv,'RENEWAL_PREDECESSOR_MISSING','UNRESOLVED');
      const old=validateGrant(oldEnv.payload);
      insist(old.id===predecessor && old.authorityId===g.authorityId,
        'RENEWAL_HISTORY_MISMATCH');
      verifyRecord(oldEnv,policy,now,'GRANT');
      insist(a.issuerKeys.includes(oldEnv.keyId),'PREDECESSOR_ISSUER_DENIED');
      assertRenewal(newer,old);
      insist(!hasRecordedTombstone(state,old.id),'REVOKED_PREDECESSOR');
      newer=old;predecessor=old.renewalOf;
    }
    path.push(g); return g;
  }
  walk(grantId); return path;
}
// Call only after verifiedChain() and validateStatusSnapshot(). The latter
// authenticates this status; this assertion adds the signed renewal ancestors,
// including explicit REVOKED, missing, or otherwise unreliable entries.
// A source adapter must NOT infer ACTIVE from the terminal grant alone.
export function requireKnownRenewalPredecessors(grant,state,verifiedStatus) {
  insist(verifiedStatus && Array.isArray(verifiedStatus.entries),
    'RENEWAL_SIGNED_STATUS_REQUIRED','REQUIRES_FRESH_STATUS');
  const seen=new Set([grant.id]);let predecessor=grant.renewalOf;
  while(predecessor){
    insist(!seen.has(predecessor) && seen.size<128,'RENEWAL_CYCLE_OR_LIMIT');
    seen.add(predecessor);
    const envelope=state.grants?.[predecessor];
    insist(envelope,'RENEWAL_PREDECESSOR_MISSING','UNRESOLVED');
    const old=validateGrant(envelope.payload);
    insist(old.id===predecessor && old.authorityId===grant.authorityId,
      'RENEWAL_HISTORY_MISMATCH');
    insist(!hasRecordedTombstone(state,old.id),'REVOKED_PREDECESSOR');
    const current=verifiedStatus.entries.find(x=>x.grantId===predecessor);
    insist(current,'RENEWAL_PREDECESSOR_STATUS_UNKNOWN','REQUIRES_FRESH_STATUS');
    insist(current.state!=='REVOKED','REVOKED_PREDECESSOR');
    insist(['ACTIVE','SUPERSEDED'].includes(current.state),
      'RENEWAL_PREDECESSOR_NOT_RELIABLE');
    predecessor=old.renewalOf;
  }
}
export function validateStatusSnapshot(authorityId,state,now) {
  const {policy} = state; const a = policy.authorities[authorityId];
  const env = state.statuses[authorityId]; insist(env,'STATUS_UNAVAILABLE','REQUIRES_FRESH_STATUS');
  verifyRecord(env,policy,now,'STATUS'); insist(a.statusKeys.includes(env.keyId),'STATUS_AUTHORITY_DENIED');
  const s = env.payload;
  fields(s,['kind','id','environment','realmId','authorityId','sequence','membershipEpoch','issuedAt','validUntil','entries']);
  insist(s.authorityId === authorityId && s.realmId === policy.realmId,'STATUS_SCOPE_MISMATCH');
  insist(Number.isSafeInteger(s.sequence) && s.sequence >= 0 && s.sequence >= (state.statusFloor[authorityId] ?? 0),'STATUS_ROLLBACK','STALE_REVALIDATION_REQUIRED');
  insist(s.membershipEpoch === a.membershipEpoch,'STATUS_EPOCH_MISMATCH','STALE_REVALIDATION_REQUIRED');
  insist(timestamp(s.issuedAt) <= now && now < timestamp(s.validUntil),'STATUS_STALE','REQUIRES_FRESH_STATUS');
  const maxAge = policy.statusMode === 'OFFLINE_BOUNDED' ? policy.offlineMaxAgeSeconds : policy.snapshotMaxAgeSeconds;
  insist(now-timestamp(s.issuedAt) < maxAge*1000,'STATUS_STALE','REQUIRES_FRESH_STATUS');
  insist(Array.isArray(s.entries) && new Set(s.entries.map(e => e.grantId)).size === s.entries.length,'STATUS_DUPLICATE');
  for (const e of s.entries) {
    fields(e,['grantId','state','effectiveAt','evidenceRef']); identifier(e.grantId); identifier(e.evidenceRef);
    insist(['ACTIVE','SUSPENDED','REVOKED','SUPERSEDED'].includes(e.state),'INVALID_STATUS');
    insist(timestamp(e.effectiveAt) <= timestamp(s.issuedAt),'FUTURE_STATUS_ENTRY');
  }
  return {...s, effectiveUntil:Math.min(timestamp(s.validUntil),timestamp(s.issuedAt)+maxAge*1000)};
}
// Shared issuer chronology for signed status delivery and full-registry
// persistence. A higher sequence cannot reopen terminal statements.
export function assertStatusTransitionHistory(previous,next,prefix='STATUS_DELIVERY'){
  if(!previous)return;
  insist(Array.isArray(previous.entries)&&Array.isArray(next?.entries),
    prefix+'_ENTRIES_INVALID');
  insist(timestamp(next.issuedAt)>=timestamp(previous.issuedAt),
    prefix+'_ISSUANCE_ROLLBACK');
  const later=new Map(next.entries.map(entry=>[entry.grantId,entry]));
  for(const old of previous.entries){
    const updated=later.get(old.grantId);
    if(old.state==='REVOKED')
      insist(updated&&updated.state==='REVOKED',prefix+'_TERMINAL_ROLLBACK');
    else if(old.state==='SUPERSEDED')
      insist(updated&&['SUPERSEDED','REVOKED'].includes(updated.state),
        prefix+'_TERMINAL_ROLLBACK');
    if(updated)
      insist(timestamp(updated.effectiveAt)>=timestamp(old.effectiveAt),
        prefix+'_EVENT_ROLLBACK');
  }
}
const statusFor=validateStatusSnapshot;
const REQUEST_FIELDS = ['id','actorId','principalId','roleId','grantId','audience','resource','action','purpose','realmId','operationDigest'];
export function validateRequest(r) { fields(r,REQUEST_FIELDS); for (const k of REQUEST_FIELDS) identifier(r[k]); return r; }
export function makeProof(request,challenge,now,provider,environment='TEST',kind='PROOF') {
  return signRecord({kind,environment,requestDigest:digest(request),challenge,issuedAt:iso(now),expiresAt:iso(now+60000)},provider);
}
function proofSubject(proof,policy,now,kind,hash,challenge) {
  insist(proof,'IDENTITY_PROOF_REQUIRED','REQUIRES_PROOF');
  const key = verifyRecord(proof,policy,now,kind); const p = proof.payload;
  fields(p,['kind','environment','requestDigest','challenge','issuedAt','expiresAt']);
  insist(p.requestDigest === hash && p.challenge === challenge,'PROOF_BINDING_MISMATCH');
  insist(timestamp(p.issuedAt) <= now && now < timestamp(p.expiresAt) && now-timestamp(p.issuedAt) < policy.proofMaxAgeSeconds*1000 && timestamp(p.expiresAt)-timestamp(p.issuedAt) <= policy.proofMaxAgeSeconds*1000,'PROOF_EXPIRED','REQUIRES_PROOF');
  return key.subjectId;
}
export function evaluate(requestInput,stateInput,context) {
  let requestHash=null,policyHash=null; const trace=[]; let now=null;
  try {
    const request=validateRequest(snapshot(requestInput)); const state=snapshot(stateInput); const policy=validatePolicy(state.policy);
    now=timestamp(context.now); requestHash=digest(request); policyHash=digest(policy);
    insist(typeof context.challenge==='string' && context.challenge.length>=16,'BROKER_CHALLENGE_REQUIRED','REQUIRES_PROOF');
    insist(!state.lastObservedAt || now >= timestamp(state.lastObservedAt),'CLOCK_ROLLBACK','REQUIRES_PROOF');
    insist(policy.timeAssurance!=='TRUSTED' || context.timeAssurance==='TRUSTED','TRUSTED_TIME_REQUIRED','REQUIRES_PROOF');
    const actor=proofSubject(context.proof,policy,now,'PROOF',requestHash,context.challenge);
    insist(actor===request.actorId,'ACTOR_PROOF_MISMATCH');
    const chain=verifiedChain(request.grantId,state,now); const grant=chain.at(-1);
    insist(request.realmId===policy.realmId && grant.holderId===actor && grant.principalId===request.principalId && grant.roleId===request.roleId,'SUBJECT_OR_ROLE_MISMATCH');
    insist(grant.audience===request.audience && grant.resources.includes(request.resource) && grant.actions.includes(request.action) && grant.purposes.includes(request.purpose),'REQUEST_OUTSIDE_GRANT');
    insist(policy.actionCatalog[request.action]===grant.rightClass,'RIGHT_CLASS_MISMATCH');
    const status=statusFor(grant.authorityId,state,now,requestHash,context.challenge);
    for (const g of chain) {
      insist(!hasRecordedTombstone(state,g.id),'GRANT_REVOKED');
      const entry=status.entries.find(e=>e.grantId===g.id);
      insist(entry,'GRANT_STATUS_UNKNOWN','REQUIRES_FRESH_STATUS');
      insist(entry.state==='ACTIVE','GRANT_'+entry.state);
      requireKnownRenewalPredecessors(g,state,status);
      trace.push({grantId:g.id,authorityId:g.authorityId,holderId:g.holderId,evidenceRefs:g.evidenceRefs});
    }
    for (const rule of policy.prohibitions) if (rule.authorityId===grant.authorityId && rule.action===request.action && rule.resource===request.resource && rule.purpose===request.purpose) throw new AccessError('POLICY_PROHIBITION:'+rule.reason);
    const confirmations=policy.confirmations.filter(r=>r.authorityId===grant.authorityId && r.action===request.action && r.resource===request.resource);
    for (const rule of confirmations) {
      const voters=new Set();
      for (const proof of context.confirmations??[]) voters.add(proofSubject(proof,policy,now,'CONFIRMATION',requestHash,context.challenge));
      insist(rule.principals.filter(p=>voters.has(p)).length>=rule.minimum,'DISTINCT_PRINCIPAL_CONFIRMATION_REQUIRED','REQUIRES_CONFIRMATION');
    }
    const usedKeys=new Set([...chain.map(g=>state.grants[g.id].keyId),context.proof.keyId,state.statuses[grant.authorityId].keyId,...(context.confirmations??[]).map(e=>e.keyId)]);
    const until=Math.min(...chain.map(g=>timestamp(g.expiresAt)),status.effectiveUntil,timestamp(context.proof.payload.expiresAt),...(context.confirmations??[]).map(e=>timestamp(e.payload.expiresAt)),...[...usedKeys].map(k=>timestamp(policy.keys[k].expiresAt)));
    return {schema:'IWXA_T3_AUTHORIZATION_DECISION/1',outcome:'PERMITTED',allowed:true,requestDigest:requestHash,policyDigest:policyHash,evaluatedAt:iso(now),validUntil:iso(until),authorityPath:trace,reasons:[],statusSequence:status.sequence,statusObservedAt:status.issuedAt,assurance:{status:policy.statusMode,time:policy.timeAssurance},evidenceOnly:true};
  } catch(error) {
    const known=error instanceof AccessError;
    return {schema:'IWXA_T3_AUTHORIZATION_DECISION/1',outcome:known?error.outcome:'DENIED',allowed:false,requestDigest:requestHash,policyDigest:policyHash,evaluatedAt:now===null?null:iso(now),validUntil:null,authorityPath:trace,reasons:[known?error.code:'MALFORMED_INPUT'],evidenceOnly:true};
  }
}
export function affectedGrants(grants,rootId) {
  const seen=new Set([rootId]); let changed=true;
  while(changed) { changed=false; for(const e of Object.values(grants)) if(!seen.has(e.payload.id) && (seen.has(e.payload.parentGrantId)||seen.has(e.payload.renewalOf))) { seen.add(e.payload.id); changed=true; } }
  return [...seen].sort();
}
