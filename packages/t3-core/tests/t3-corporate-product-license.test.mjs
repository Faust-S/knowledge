import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {keyObjectSigner,iso,digest} from '../src/t3/access/core.mjs';
import {
  CORPORATE_REQUEST_SCHEMA,CORPORATE_LICENSE_SCHEMA,CORPORATE_STATUS_SCHEMA,
  validateCorporateLicenseRequest,validateCorporateLicensePayload,
  createCorporateLicenseCandidate,signCorporateLicenseCandidate,
  inspectSignedCorporateLicense,signCorporateLicenseStatus,
  inspectSignedCorporateLicenseStatus
} from '../src/t3/access/corporate-product-license.mjs';

const NOW=Date.parse('2026-11-22T12:00:00.000Z');
const future=iso(NOW+48*3600000);
const config=()=>({
  environment:'PRODUCTION',productId:'IWXA_ADMIN_CENTER',
  licenseKeyId:'key:corporate-license',statusKeyId:'key:corporate-status',
  featureIds:['CORPORATE_TASKS','PERSONAL_AGENT_CORPORATE'],
  maxAdminCenterSeats:5,maxEmployeeLimit:100,maxPersonalAgentSeats:25,
  maxTtlDays:365
});
function fixture(){
  const a=generateKeyPairSync('ed25519'),b=generateKeyPairSync('ed25519');
  const key=(pair,uses)=>({status:'ACTIVE',environment:'PRODUCTION',uses,
    notBefore:iso(NOW-86400000),expiresAt:iso(NOW+370*86400000),
    publicKey:pair.publicKey.export({format:'pem',type:'spki'})});
  const ownerState={trustOrigin:'HOST_PREINSTALLED_PUBLIC_POLICY',
    policy:{environment:'PRODUCTION',
      keys:{'key:corporate-license':key(a,['LICENSE']),
        'key:corporate-status':key(b,['LICENSE_STATUS'])},
      authorities:{'publisher:iwxa':{
        issuerKeys:['key:corporate-license'],statusKeys:['key:corporate-status']
      }}
    },corporateLicenseIssuers:{'publisher:iwxa':config()}
  };
  const signer=keyObjectSigner('key:corporate-license',a.privateKey);
  const statusSigner=keyObjectSigner('key:corporate-status',b.privateKey);
  const request={schema:CORPORATE_REQUEST_SCHEMA,
    kind:'CORPORATE_LICENSE_REQUEST',requestId:'request:company:1',
    requestedAt:iso(NOW-30000),environment:'PRODUCTION',
    subject:{type:'ORGANIZATION',id:'org:north'},
    product:{id:'IWXA_ADMIN_CENTER',version:'0.5.0'},
    tariff:{id:'TEAM',revision:3},featureIds:['CORPORATE_TASKS','PERSONAL_AGENT_CORPORATE'],
    limits:{adminCenterSeats:2,employeeLimit:40,personalAgentSeats:10,
      quotas:[{metric:'TASKS_PER_MONTH',service:'LOCAL',unit:'COUNT',
        period:'MONTH',max:1000}]},
    termDays:30,status:'UNSIGNED_REQUEST'};
  const candidate=()=>createCorporateLicenseCandidate({request,ownerState,
    issuerAuthorityId:'publisher:iwxa',licenseId:'license:company:1',
    lineageId:'lineage:company:1',now:NOW});
  const license=()=>signCorporateLicenseCandidate({payload:candidate(),ownerState,
    signer,now:NOW});
  const status=(l,s='ACTIVE',seq=1,validUntil=future)=>signCorporateLicenseStatus({
    license:l,ownerState,signer:statusSigner,sequence:seq,state:s,
    validUntil,now:NOW});
  const inspect=(l,st,priorFloor=null,organizationId='org:north')=>
    inspectSignedCorporateLicenseStatus({license:l,statusEnvelope:st,installedTrust:ownerState,
      organizationId,priorFloor,now:NOW});
  return {ownerState,signer,statusSigner,request,candidate,license,status,inspect};
}
const fail=(fn,code)=>assert.throws(fn,e=>e?.code===code||e?.message===code,
  'Expected '+code);

test('original T3 Ed25519 signs corporate license with actual tariff identity, limits and status',()=>{
 const f=fixture(),p=f.candidate();
 assert.equal(p.schema,CORPORATE_LICENSE_SCHEMA);
 assert.equal(p.subject.type,'ORGANIZATION');
 assert.equal(p.product.id,'IWXA_ADMIN_CENTER');
 assert.equal(p.tariff.id,'TEAM');
 assert.equal(p.tariff.revision,3);
 assert.equal(p.limits.personalAgentSeats,10);
 const signed=f.license(),st=f.status(signed);
 assert.equal(st.payload.schema,CORPORATE_STATUS_SCHEMA);
 const verified=f.inspect(signed,st);
 assert.equal(verified.signatureVerified,true);
 assert.equal(verified.statusSignatureVerified,true);
 assert.equal(verified.verifiedSignedActive,true);
 assert.equal(verified.status,'ACTIVE');
 assert.equal(verified.sequence,1);
 assert.equal(verified.personalAgentSeatCeiling,10);
 assert.equal(verified.employeeLimit,40);
 assert.equal(verified.adminCenterSeats,2);
 assert.equal(verified.tariffRevision,3);
 assert.equal(verified.assignablePersonalAgentSeats,0,
   'signature alone is not a durable holder/seat allocation');
 assert.equal(verified.productionActivation,false);
 assert.equal(verified.publisherCommercialIdentityConfirmed,false);
 assert.equal(verified.originalHolderReceiptRequired,true);
 assert.deepEqual(verified.floor,{licenseId:p.id,sequence:1,
   statusDigest:digest(st),state:'ACTIVE'});
});
test('real Ed25519 verification rejects edited price-independent tariff, agent ceiling and product',()=>{
 const f=fixture(),signed=f.license();
 const forgedTariff=structuredClone(signed);
 forgedTariff.payload.tariff.revision=4;
 fail(()=>inspectSignedCorporateLicense({envelope:forgedTariff,installedTrust:f.ownerState,
   organizationId:'org:north',now:NOW}),'SIGNATURE_INVALID');
 const forgedSeats=structuredClone(signed);
 forgedSeats.payload.limits.personalAgentSeats=24;
 fail(()=>inspectSignedCorporateLicense({envelope:forgedSeats,installedTrust:f.ownerState,
   organizationId:'org:north',now:NOW}),'SIGNATURE_INVALID');
 const badProduct=structuredClone(signed);
 badProduct.payload.product.id='IWXA_ATLAS';
 fail(()=>inspectSignedCorporateLicense({envelope:badProduct,installedTrust:f.ownerState,
   organizationId:'org:north',now:NOW}),'CORP_ADMIN_CENTER_REQUIRED');
});
test('organization is bound to verified holder and trust must be independently preinstalled',()=>{
 const f=fixture(),signed=f.license(),status=f.status(signed);
 fail(()=>f.inspect(signed,status,null,'org:south'),'CORP_WRONG_ORGANIZATION');
 fail(()=>inspectSignedCorporateLicense({envelope:signed,installedTrust:{
   ...f.ownerState,trustOrigin:'RECEIVED_PACKAGE'
 },organizationId:'org:north',now:NOW}),'CORP_PREINSTALLED_PRODUCTION_TRUST_REQUIRED');
 fail(()=>inspectSignedCorporateLicense({envelope:signed,installedTrust:{
   ...f.ownerState,corporateLicenseIssuers:{}
 },organizationId:'org:north',now:NOW}),'CORP_PUBLISHER_AUTHORITY_NOT_ENROLLED');
});
test('status keys must be separate; status bound to exact signed LICENSE and issuer',()=>{
 const f=fixture(),license=f.license(),signed=f.status(license);
 const swap=structuredClone(signed);
 swap.payload.licenseDigest='a'.repeat(64);
 fail(()=>f.inspect(license,swap),'SIGNATURE_INVALID');
 const badKey={...f.ownerState,corporateLicenseIssuers:{
   'publisher:iwxa':{...config(),statusKeyId:'key:corporate-license'}
 }};
 fail(()=>inspectSignedCorporateLicense({envelope:license,installedTrust:badKey,
   organizationId:'org:north',now:NOW}),'CORP_LICENSE_STATUS_KEY_REUSE_DENIED');
 fail(()=>signCorporateLicenseStatus({license,ownerState:f.ownerState,
   signer:f.signer,sequence:1,state:'ACTIVE',
   validUntil:future,now:NOW}),'CORP_ORIGINAL_STATUS_SIGNER_REQUIRED');
});
test('corporate status enforces monotone floor and terminal REVOKED without reviving',()=>{
 const f=fixture(),l=f.license(),active=f.status(l,'ACTIVE',1);
 const a=f.inspect(l,active);
 const repeated=f.inspect(l,active,a.floor);
 assert.equal(repeated.floor.sequence,1);
 const revoked=f.status(l,'REVOKED',2);
 const r=f.inspect(l,revoked,a.floor);
 assert.equal(r.verifiedSignedActive,false);
 assert.equal(r.floor.state,'REVOKED');
 fail(()=>f.inspect(l,active,r.floor),'CORP_STATUS_ROLLBACK_DENIED');
 const changed=f.status(l,'SUSPENDED',2);
 fail(()=>f.inspect(l,changed,r.floor),'CORP_STATUS_EQUIVOCATION_DENIED');
 const next=f.status(l,'ACTIVE',3);
 fail(()=>f.inspect(l,next,r.floor),'CORP_STATUS_REVOKE_RESURRECTION_DENIED');
});
test('candidate rejects inferred agent seats, missing tariff edition and over-ceiling',()=>{
 const f=fixture();
 fail(()=>validateCorporateLicenseRequest({...f.request,
   limits:{...f.request.limits,personalAgentSeats:41}}),
   'CORP_AGENT_SEATS_EXCEED_EMPLOYEES');
 fail(()=>validateCorporateLicenseRequest({...f.request,
   tariff:{id:'TEAM'}}),'MISSING_FIELD');
 fail(()=>validateCorporateLicenseRequest({...f.request,
   limits:{...f.request.limits,personalAgentSeats:undefined}}),'INVALID_UNDEFINED');
 // Original signer has an independently configured ceiling even if the draft
 // requests more seats than the number of people in the organization.
 const request={...f.request,limits:{...f.request.limits,personalAgentSeats:26}};
 fail(()=>createCorporateLicenseCandidate({request,ownerState:f.ownerState,
   issuerAuthorityId:'publisher:iwxa',licenseId:'license:other',
   lineageId:'lineage:other',now:NOW}),
  'CORP_LICENSE_LIMIT_OUTSIDE_ISSUER_SCOPE');
});
test('commercial profile cannot be produced by TEST publisher or alternative product',()=>{
 const f=fixture(),req={...f.request};
 fail(()=>validateCorporateLicenseRequest({...req,environment:'TEST'}),
   'CORP_REQUEST_PROFILE_INVALID');
 fail(()=>validateCorporateLicenseRequest({...req,
   product:{id:'IWXA_PERSONAL_AGENT',version:'0.6.0'}}),
   'CORP_ADMIN_CENTER_REQUIRED');
 const signed=f.license();
 fail(()=>validateCorporateLicensePayload({...signed.payload,environment:'TEST'}),
   'CORP_LICENSE_PROFILE_INVALID');
 fail(()=>createCorporateLicenseCandidate({request:req,
   ownerState:{...f.ownerState,policy:{...f.ownerState.policy,environment:'TEST'}},
   issuerAuthorityId:'publisher:iwxa',licenseId:'license:other',
   lineageId:'lineage:other',now:NOW}),
  'CORP_PREINSTALLED_PRODUCTION_TRUST_REQUIRED');
});
test('expired STATUS or signing time does not become usable product entitlement',()=>{
 const f=fixture(),l=f.license(),st=f.status(l);
 fail(()=>inspectSignedCorporateLicenseStatus({
   license:l,statusEnvelope:st,installedTrust:f.ownerState,
   organizationId:'org:north',now:NOW+50*3600000}),
  'CORP_STATUS_NOT_CURRENT');
});
