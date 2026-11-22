// Corporate Publisher product profile on the ORIGINAL T3 Access signer.
// Reuse core.signRecord/verifyRecord, issuer-authority policy and host-provided
// public trust. No second issuer, Store, seat ledger, credential or .iwxa parser.
// A signed contract is NOT a durable issuance or an employee authorization.
import {copy,digest,fields,identifier,insist,iso,signRecord,
  timestamp,verifyRecord} from './core.mjs';

export const CORPORATE_REQUEST_SCHEMA='IWXA_T3_CORPORATE_LICENSE_REQUEST/1';
export const CORPORATE_LICENSE_SCHEMA='IWXA_T3_PRODUCT_LICENSE/3';
export const CORPORATE_STATUS_SCHEMA='IWXA_T3_PRODUCT_LICENSE_STATUS/3';
const PRODUCT='IWXA_ADMIN_CENTER',DAY=86400000;
const STATES=new Set(['ACTIVE','SUSPENDED','REVOKED']);
const MAX_QUOTAS=32;
const SEMVER=/^\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]{0,63})?$/;

const exact=(o,ks,code)=>{
  insist(o&&typeof o==='object'&&!Array.isArray(o)&&
    (Object.getPrototypeOf(o)===Object.prototype||
      Object.getPrototypeOf(o)===null),code);
  fields(o,ks);
  insist(Object.keys(o).length===ks.length,code);
};
const positive=(n,min,max,code)=>insist(Number.isSafeInteger(n)&&
  n>=min&&n<=max,code);
const uniqueIds=(a,max,code)=>{
  insist(Array.isArray(a)&&a.length<=max&&new Set(a).size===a.length,code);
  a.forEach(identifier);
};
function validateQuotas(quotas){
  insist(Array.isArray(quotas)&&quotas.length<=MAX_QUOTAS,
    'CORP_QUOTAS_INVALID');
  const keys=new Set();
  for(const q of quotas){
    exact(q,['metric','service','unit','period','max'],'CORP_QUOTA_SHAPE_INVALID');
    identifier(q.metric);
    insist(['LOCAL','CLOUD'].includes(q.service)&&
      ['COUNT','TOKENS','MINUTES','GIB','CREDITS'].includes(q.unit)&&
      ['TOTAL','DAY','MONTH'].includes(q.period),'CORP_QUOTA_KIND_INVALID');
    positive(q.max,1,1_000_000_000,'CORP_QUOTA_MAX_INVALID');
    const key=[q.service,q.metric,q.period].join(':');
    insist(!keys.has(key),'CORP_QUOTA_DUPLICATE');keys.add(key);
  }
}
function terms(x){
  exact(x,['id','revision'],'CORP_TARIFF_SHAPE_INVALID');
  identifier(x.id);
  positive(x.revision,1,1000,'CORP_TARIFF_REVISION_INVALID');
}
function limits(x){
  exact(x,['adminCenterSeats','employeeLimit','personalAgentSeats','quotas'],
    'CORP_LIMITS_SHAPE_INVALID');
  positive(x.adminCenterSeats,1,10000,'CORP_ADMIN_SEATS_INVALID');
  positive(x.employeeLimit,1,100000,'CORP_EMPLOYEE_LIMIT_INVALID');
  positive(x.personalAgentSeats,0,100000,'CORP_AGENT_SEATS_INVALID');
  insist(x.personalAgentSeats<=x.employeeLimit,
    'CORP_AGENT_SEATS_EXCEED_EMPLOYEES');
  validateQuotas(x.quotas);
}
function identity(x){
  exact(x,['type','id'],'CORP_SUBJECT_SHAPE_INVALID');
  insist(x.type==='ORGANIZATION','CORP_ORGANIZATION_REQUIRED');
  identifier(x.id);
  insist(!x.id.startsWith('holder:'),'CORP_PLACEHOLDER_SUBJECT');
}
function product(x){
  exact(x,['id','version'],'CORP_PRODUCT_SHAPE_INVALID');
  insist(x.id===PRODUCT&&typeof x.version==='string'&&SEMVER.test(x.version),
    'CORP_ADMIN_CENTER_REQUIRED');
}
function common(x){
  identity(x.subject);product(x.product);terms(x.tariff);
  uniqueIds(x.featureIds,30,'CORP_FEATURE_IDS_INVALID');
  limits(x.limits);
  insist(x.limits.personalAgentSeats===0||
    x.featureIds.includes('PERSONAL_AGENT_CORPORATE'),
    'CORP_AGENT_FEATURE_REQUIRED');
}
export function validateCorporateLicenseRequest(input){
  const r=copy(input);
  exact(r,['schema','kind','requestId','requestedAt','environment',
    'subject','product','tariff','featureIds','limits','termDays','status'],
    'CORP_REQUEST_SHAPE_INVALID');
  insist(r.schema===CORPORATE_REQUEST_SCHEMA&&
    r.kind==='CORPORATE_LICENSE_REQUEST'&&
    r.environment==='PRODUCTION'&&r.status==='UNSIGNED_REQUEST',
    'CORP_REQUEST_PROFILE_INVALID');
  identifier(r.requestId);timestamp(r.requestedAt);
  positive(r.termDays,1,3650,'CORP_TERM_DAYS_INVALID');
  common(r);return r;
}
export function validateCorporateLicensePayload(input){
  const p=copy(input);
  exact(p,['schema','kind','id','requestId','issuerAuthorityId','environment',
    'subject','product','tariff','featureIds','limits','issuedAt','notBefore',
    'expiresAt','lineageId','renewalOf'],'CORP_LICENSE_SHAPE_INVALID');
  insist(p.kind==='LICENSE'&&p.schema===CORPORATE_LICENSE_SCHEMA&&
    p.environment==='PRODUCTION','CORP_LICENSE_PROFILE_INVALID');
  for(const name of ['id','requestId','issuerAuthorityId','lineageId'])
    identifier(p[name]);
  if(p.renewalOf!==null){identifier(p.renewalOf);
    insist(p.renewalOf!==p.id,'CORP_RENEWAL_SELF_INVALID');}
  const issue=timestamp(p.issuedAt),start=timestamp(p.notBefore),
    end=timestamp(p.expiresAt);
  insist(issue<=start&&start<end,'CORP_LICENSE_INTERVAL_INVALID');
  common(p);return p;
}
// The original native Host provides these pre-enrolled authorities/keys.
// A received .iwxa must NEVER be used to add a publisher or trust root.
function issuerConfig(trust,authorityId){
  identifier(authorityId);
  const policy=trust?.policy;
  insist(policy?.environment==='PRODUCTION'&&
    trust?.trustOrigin==='HOST_PREINSTALLED_PUBLIC_POLICY',
    'CORP_PREINSTALLED_PRODUCTION_TRUST_REQUIRED');
  const a=policy.authorities?.[authorityId];
  const cfg=trust.corporateLicenseIssuers?.[authorityId];
  insist(a&&cfg,'CORP_PUBLISHER_AUTHORITY_NOT_ENROLLED');
  exact(cfg,['environment','productId','licenseKeyId','statusKeyId',
    'featureIds','maxAdminCenterSeats','maxEmployeeLimit',
    'maxPersonalAgentSeats','maxTtlDays'],'CORP_ISSUER_CONFIG_INVALID');
  insist(cfg.environment==='PRODUCTION'&&cfg.productId===PRODUCT,
    'CORP_ISSUER_PRODUCT_DENIED');
  identifier(cfg.licenseKeyId);identifier(cfg.statusKeyId);
  insist(cfg.licenseKeyId!==cfg.statusKeyId,
    'CORP_LICENSE_STATUS_KEY_REUSE_DENIED');
  uniqueIds(cfg.featureIds,128,'CORP_ISSUER_FEATURES_INVALID');
  positive(cfg.maxAdminCenterSeats,1,10000,'CORP_ISSUER_ADMIN_SEATS_INVALID');
  positive(cfg.maxEmployeeLimit,1,100000,'CORP_ISSUER_EMPLOYEES_INVALID');
  positive(cfg.maxPersonalAgentSeats,0,100000,'CORP_ISSUER_AGENT_SEATS_INVALID');
  positive(cfg.maxTtlDays,1,3650,'CORP_ISSUER_TTL_INVALID');
  insist(a.issuerKeys?.includes(cfg.licenseKeyId)&&
    a.statusKeys?.includes(cfg.statusKeyId),
    'CORP_ISSUER_SIGNER_OUTSIDE_AUTHORITY');
  const lk=policy.keys?.[cfg.licenseKeyId],sk=policy.keys?.[cfg.statusKeyId];
  insist(lk?.status==='ACTIVE'&&sk?.status==='ACTIVE'&&
    lk.environment==='PRODUCTION'&&sk.environment==='PRODUCTION'&&
    lk.uses?.includes('LICENSE')&&sk.uses?.includes('LICENSE_STATUS'),
    'CORP_ISSUER_SIGNING_KEYS_UNAVAILABLE');
  return cfg;
}
function checkLimits(p,cfg){
  insist(p.featureIds.every(id=>cfg.featureIds.includes(id)),
    'CORP_FEATURE_NOT_IN_PUBLISHER_SCOPE');
  insist(p.limits.adminCenterSeats<=cfg.maxAdminCenterSeats&&
    p.limits.employeeLimit<=cfg.maxEmployeeLimit&&
    p.limits.personalAgentSeats<=cfg.maxPersonalAgentSeats,
    'CORP_LICENSE_LIMIT_OUTSIDE_ISSUER_SCOPE');
  insist(timestamp(p.expiresAt)-timestamp(p.notBefore)<=cfg.maxTtlDays*DAY,
    'CORP_LICENSE_TTL_OUTSIDE_ISSUER_SCOPE');
}
export function createCorporateLicenseCandidate({request,ownerState,
  issuerAuthorityId,licenseId,lineageId,renewalOf=null,now=Date.now()}={}){
  const r=validateCorporateLicenseRequest(request);
  const cfg=issuerConfig(ownerState,issuerAuthorityId);
  identifier(licenseId);identifier(lineageId);
  insist(Number.isSafeInteger(now)&&now>=timestamp(r.requestedAt),
    'CORP_REQUEST_FROM_FUTURE');
  const p=validateCorporateLicensePayload({
    schema:CORPORATE_LICENSE_SCHEMA,kind:'LICENSE',
    id:licenseId,requestId:r.requestId,issuerAuthorityId,
    environment:'PRODUCTION',subject:r.subject,product:r.product,
    tariff:r.tariff,featureIds:r.featureIds,limits:r.limits,
    issuedAt:iso(now),notBefore:iso(now),expiresAt:iso(now+r.termDays*DAY),
    lineageId,renewalOf
  });
  checkLimits(p,cfg);return p;
}
export function signCorporateLicenseCandidate({payload,ownerState,signer,now=Date.now()}={}){
  const p=validateCorporateLicensePayload(payload);
  const cfg=issuerConfig(ownerState,p.issuerAuthorityId);
  checkLimits(p,cfg);
  insist(signer?.keyId===cfg.licenseKeyId&&typeof signer.sign==='function',
    'CORP_ORIGINAL_LICENSE_SIGNER_REQUIRED');
  const envelope=signRecord(p,signer);
  inspectSignedCorporateLicense({envelope,installedTrust:ownerState,
    organizationId:p.subject.id,now});
  // Signed bytes still must be committed to the ORIGINAL issuer journal.
  return envelope;
}
export function inspectSignedCorporateLicense({envelope,installedTrust,
  organizationId,now=Date.now()}={}){
  const p=validateCorporateLicensePayload(envelope?.payload);
  const cfg=issuerConfig(installedTrust,p.issuerAuthorityId);
  insist(envelope.keyId===cfg.licenseKeyId,
    'CORP_LICENSE_SIGNING_KEY_OUTSIDE_SCOPE');
  checkLimits(p,cfg);
  verifyRecord(envelope,installedTrust.policy,now,'LICENSE');
  identifier(organizationId);
  insist(p.subject.id===organizationId,
    'CORP_WRONG_ORGANIZATION');
  insist(timestamp(p.notBefore)<=now&&now<timestamp(p.expiresAt),
    'CORP_LICENSE_NOT_CURRENT');
  return Object.freeze({signatureVerified:true,licenseId:p.id,
    organizationId,issuerAuthorityId:p.issuerAuthorityId,
    productId:PRODUCT,tariffId:p.tariff.id,tariffRevision:p.tariff.revision,
    featureIds:Object.freeze([...p.featureIds]),
    adminCenterSeats:p.limits.adminCenterSeats,
    employeeLimit:p.limits.employeeLimit,
    personalAgentSeatCeiling:p.limits.personalAgentSeats,
    expiresAt:p.expiresAt,
    // No durable holder, recipient receipt or employee seat assignment here.
    activeSeats:0,assignablePersonalAgentSeats:0,
    productionActivation:false,
    publisherCommercialIdentityConfirmed:false});
}
export function validateCorporateStatusPayload(input){
  const p=copy(input);
  exact(p,['schema','kind','environment','issuerAuthorityId','licenseId',
    'organizationId','productId','licenseDigest','sequence','state',
    'effectiveAt','issuedAt','validUntil'],'CORP_STATUS_SHAPE_INVALID');
  insist(p.schema===CORPORATE_STATUS_SCHEMA&&p.kind==='LICENSE_STATUS'&&
    p.environment==='PRODUCTION'&&p.productId===PRODUCT,
    'CORP_STATUS_PROFILE_INVALID');
  for(const field of ['issuerAuthorityId','licenseId','organizationId'])
    identifier(p[field]);
  insist(typeof p.licenseDigest==='string'&&/^[a-f0-9]{64}$/.test(p.licenseDigest),
    'CORP_STATUS_LICENSE_DIGEST_INVALID');
  positive(p.sequence,1,2147483647,'CORP_STATUS_SEQUENCE_INVALID');
  insist(STATES.has(p.state),'CORP_STATUS_STATE_INVALID');
  const start=timestamp(p.effectiveAt),signed=timestamp(p.issuedAt),
    expiry=timestamp(p.validUntil);
  insist(start<=signed&&signed<expiry,'CORP_STATUS_INTERVAL_INVALID');
  return p;
}
export function signCorporateLicenseStatus({license,ownerState,signer,
  sequence,state,validUntil,now=Date.now()}={}){
  const p=license?.payload;
  inspectSignedCorporateLicense({envelope:license,installedTrust:ownerState,
    organizationId:p?.subject?.id,now});
  const cfg=issuerConfig(ownerState,p.issuerAuthorityId);
  insist(signer?.keyId===cfg.statusKeyId&&typeof signer.sign==='function',
    'CORP_ORIGINAL_STATUS_SIGNER_REQUIRED');
  const limit=ownerState.policy.offlineMaxAgeSeconds??86400;
  positive(limit,1,31536000,'CORP_STATUS_OFFLINE_LIMIT_INVALID');
  const payload=validateCorporateStatusPayload({
    schema:CORPORATE_STATUS_SCHEMA,kind:'LICENSE_STATUS',environment:'PRODUCTION',
    issuerAuthorityId:p.issuerAuthorityId,licenseId:p.id,
    organizationId:p.subject.id,productId:PRODUCT,
    licenseDigest:digest(license),sequence,state,
    effectiveAt:iso(now),issuedAt:iso(now),validUntil
  });
  insist(timestamp(payload.validUntil)<=timestamp(p.expiresAt),
    'CORP_STATUS_AFTER_LICENSE_EXPIRY');
  insist(timestamp(payload.validUntil)-timestamp(payload.issuedAt)<=limit*1000,
    'CORP_STATUS_OFFLINE_LIMIT_EXCEEDED');
  const envelope=signRecord(payload,signer);
  inspectSignedCorporateLicenseStatus({license,statusEnvelope:envelope,
    installedTrust:ownerState,organizationId:p.subject.id,now});
  return envelope;
}
export function inspectSignedCorporateLicenseStatus({license,statusEnvelope,
  installedTrust,organizationId,priorFloor=null,now=Date.now()}={}){
  const inspected=inspectSignedCorporateLicense({envelope:license,
    installedTrust,organizationId,now});
  const l=license.payload,p=validateCorporateStatusPayload(statusEnvelope?.payload);
  const cfg=issuerConfig(installedTrust,l.issuerAuthorityId);
  insist(statusEnvelope.keyId===cfg.statusKeyId&&
    statusEnvelope.keyId!==license.keyId,'CORP_STATUS_WRONG_SIGNER');
  verifyRecord(statusEnvelope,installedTrust.policy,now,'LICENSE_STATUS');
  insist(p.issuerAuthorityId===l.issuerAuthorityId&&
    p.licenseId===l.id&&p.organizationId===l.subject.id&&
    p.productId===l.product.id&&p.licenseDigest===digest(license),
    'CORP_STATUS_LICENSE_BINDING_INVALID');
  insist(timestamp(p.effectiveAt)<=now&&
    timestamp(p.issuedAt)<=now&&now<timestamp(p.validUntil)&&
    timestamp(p.validUntil)<=timestamp(l.expiresAt),
    'CORP_STATUS_NOT_CURRENT');
  const limit=installedTrust.policy.offlineMaxAgeSeconds??86400;
  positive(limit,1,31536000,'CORP_STATUS_OFFLINE_LIMIT_INVALID');
  insist(timestamp(p.validUntil)-timestamp(p.issuedAt)<=limit*1000,
    'CORP_STATUS_OFFLINE_LIMIT_EXCEEDED');
  const statusDigest=digest(statusEnvelope);
  if(priorFloor!==null){
    exact(priorFloor,['licenseId','sequence','statusDigest','state','issuedAt'],
      'CORP_STATUS_FLOOR_INVALID');
    insist(priorFloor.licenseId===l.id&&
      Number.isSafeInteger(priorFloor.sequence)&&priorFloor.sequence>=1&&
      typeof priorFloor.statusDigest==='string'&&
      /^[a-f0-9]{64}$/.test(priorFloor.statusDigest)&&STATES.has(priorFloor.state),
      'CORP_STATUS_FLOOR_INVALID');
    const observedAt=timestamp(priorFloor.issuedAt);
    insist(timestamp(p.issuedAt)>=observedAt,
      'CORP_STATUS_TIME_ROLLBACK_DENIED');
    insist(p.sequence>=priorFloor.sequence,'CORP_STATUS_ROLLBACK_DENIED');
    insist(p.sequence!==priorFloor.sequence||
      priorFloor.statusDigest===statusDigest,
      'CORP_STATUS_EQUIVOCATION_DENIED');
    insist(priorFloor.state!=='REVOKED'||p.state==='REVOKED',
      'CORP_STATUS_REVOKE_RESURRECTION_DENIED');
  }
  const floor=Object.freeze({licenseId:l.id,sequence:p.sequence,
    statusDigest,state:p.state,issuedAt:p.issuedAt});
  return Object.freeze({...inspected,statusSignatureVerified:true,
    status:p.state,sequence:p.sequence,statusValidUntil:p.validUntil,
    floor,verifiedSignedActive:p.state==='ACTIVE',
    // No effective employee grants/assignments until original Host admission.
    assignablePersonalAgentSeats:0,productionActivation:false,
    originalHolderReceiptRequired:true});
}
