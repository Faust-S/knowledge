import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {keyObjectSigner,iso,digest,signRecord,makeProof,copy} from '../src/t3/access/core.mjs';
import {createOriginalEmployeeEnrollmentOwner} from '../src/t3/access/original-employee-enrollment.mjs';
import {createOriginalKernelRegistryStatePort} from '../src/t3/access/original-kernel-registry-state.mjs';
import {model,originalKernelFixture,NOW as MEMBER_NOW} from './support/t3-two-corp-original-authority.mjs';
import {CORPORATE_SEAT_ACTION,CORPORATE_SEAT_RESOURCE,CORPORATE_SEAT_PURPOSE,
 evaluateOriginalCorporateSeatUse} from '../src/t3/access/original-corporate-seat-owner.mjs';
import {
  CORPORATE_REQUEST_SCHEMA,CORPORATE_LICENSE_SCHEMA,CORPORATE_STATUS_SCHEMA,
  validateCorporateLicenseRequest,validateCorporateLicensePayload,
  createCorporateLicenseCandidate,signCorporateLicenseCandidate,
  inspectSignedCorporateLicense,signCorporateLicenseStatus,
  inspectSignedCorporateLicenseStatus,projectCorporateSeatLicense
} from '../src/t3/access/corporate-product-license.mjs';

const NOW=Date.parse('2026-11-22T12:00:00.000Z');
const future=iso(NOW+12*3600000);
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
   statusDigest:digest(st),state:'ACTIVE',issuedAt:iso(NOW)});
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
   limits:{...f.request.limits,personalAgentSeats:undefined}}),'PLAIN_DATA_REQUIRED');
 // Original signer has an independently configured ceiling even if the draft
 // requests more seats than the number of people in the organization.
 const request={...f.request,limits:{...f.request.limits,personalAgentSeats:26}};
 fail(()=>createCorporateLicenseCandidate({request,ownerState:f.ownerState,
   issuerAuthorityId:'publisher:iwxa',licenseId:'license:other',
   lineageId:'lineage:other',now:NOW}),
  'CORP_LICENSE_LIMIT_OUTSIDE_ISSUER_SCOPE');
});
test('original issuer refuses corporate Agent seats without explicit signed feature',()=>{
  const f=fixture();
  const modified={...f.request,featureIds:['CORPORATE_TASKS']};
  fail(()=>validateCorporateLicenseRequest(modified),'CORP_AGENT_FEATURE_REQUIRED');
  fail(()=>createCorporateLicenseCandidate({request:modified,ownerState:f.ownerState,
    issuerAuthorityId:'publisher:iwxa',licenseId:'license:no-agent-feature',
    lineageId:'lineage:no-agent-feature',now:NOW}),
    'CORP_AGENT_FEATURE_REQUIRED');
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
test('corporate STATUS uses original T3 offline TTL and five-field durable floor',()=>{
 const f=fixture(),l=f.license();
 fail(()=>f.status(l,'ACTIVE',1,iso(NOW+48*3600000)),
    'CORP_STATUS_OFFLINE_LIMIT_EXCEEDED');
 const st=f.status(l);
 const original=f.inspect(l,st);
 assert.deepEqual(Object.keys(original.floor).sort(),
   ['issuedAt','licenseId','sequence','state','statusDigest'].sort());
 const corrupt={...original.floor,issuedAt:iso(NOW+1000)};
 fail(()=>f.inspect(l,st,corrupt),'CORP_STATUS_TIME_ROLLBACK_DENIED');
 const legacy={...original.floor};
 delete legacy.issuedAt;
 fail(()=>f.inspect(l,st,legacy),'MISSING_FIELD');
});
test('expired STATUS or signing time does not become usable product entitlement',()=>{
 const f=fixture(),l=f.license(),st=f.status(l);
 fail(()=>inspectSignedCorporateLicenseStatus({
   license:l,statusEnvelope:st,installedTrust:f.ownerState,
   organizationId:'org:north',now:NOW+50*3600000}),
  'CORP_STATUS_NOT_CURRENT');
});


// Independent synthetic production-profile keys; no real customer credential.
// Real Ed25519 + original Kernel registry port over the existing deterministic
// Kernel fixture. Not a native installed Windows or commercial authority test.
async function seatFixture({seatLimit=1,employeeLimit=10,seatPolicy=true}={}){
 const f=fixture(),m=model(),org=m.all.north.descriptors.organizations[0];
 // Use the same deterministic clock for issuer, registry and employee proof.
 const time=MEMBER_NOW;
 const now=()=>time;
 for(const key of Object.values(f.ownerState.policy.keys)){
  key.notBefore=iso(time-86400000);key.expiresAt=iso(time+370*86400000);
 }
 const pairs=[],makeLicense=(id,limit,prior=null,state='ACTIVE',sequence=1)=>{
  const request={...f.request,requestId:'request:'+id,requestedAt:iso(time-1000),
    limits:{...f.request.limits,employeeLimit,personalAgentSeats:limit}};
  const p=createCorporateLicenseCandidate({request,ownerState:f.ownerState,
   issuerAuthorityId:'publisher:iwxa',licenseId:id,lineageId:'lineage:seats',
   renewalOf:prior,now:time});
  const license=signCorporateLicenseCandidate({payload:p,ownerState:f.ownerState,signer:f.signer,now:time});
  const statusEnvelope=signCorporateLicenseStatus({license,ownerState:f.ownerState,
    signer:f.statusSigner,sequence,state,validUntil:iso(time+3600000),now:time});
  const verified=inspectSignedCorporateLicenseStatus({license,statusEnvelope,
    installedTrust:f.ownerState,organizationId:org.organizationId,now:time});
  return {license,statusEnvelope,floor:verified.floor};
 };
 pairs.push(makeLicense('license:seat:one',seatLimit));
 let revision=1;
 const source={installedTrust:f.ownerState,read:()=>({revision,entries:copy(pairs)})};
 // Convert the EXISTING two-company fixture to PRODUCTION before signing.
 // No policy is edited after the trusted registry is initialized.
 m.policy.environment='PRODUCTION';
 for(const key of Object.values(m.policy.keys))key.environment='PRODUCTION';
 for(const [id,env] of Object.entries(m.state.grants))
  m.state.grants[id]=signRecord({...env.payload,environment:'PRODUCTION'},m.signers[env.keyId]);
 for(const [id,env] of Object.entries(m.state.statuses))
  m.state.statuses[id]=signRecord({...env.payload,environment:'PRODUCTION'},m.signers[env.keyId]);
 const auth=m.policy.authorities['issuer:north'];
 auth.roles.push('worker','role:manager','assigner');
 auth.rightClasses.push('ADMINISTRATION','DATA');
 auth.resources.push('authority:issuer:north','workspace:ws:north','subject:org:north',
   'recipient:org:north','field:result','field:task','operation:UPSERT');
 auth.actions.push('grant.issue','grant.revoke','work.prepare','package.export');
 auth.purposes.push('access-administration','work','handoff','assignment');
 Object.assign(m.policy.actionCatalog,{'grant.issue':'ADMINISTRATION','grant.revoke':'ADMINISTRATION',
   'work.prepare':'ACTION','package.export':'DATA'});
 if(seatPolicy){
   auth.rightClasses.push('ENTITLEMENT');auth.resources.push(CORPORATE_SEAT_RESOURCE);
   auth.actions.push(CORPORATE_SEAT_ACTION);auth.purposes.push(CORPORATE_SEAT_PURPOSE);
   m.policy.actionCatalog[CORPORATE_SEAT_ACTION]='ENTITLEMENT';
 }
 const admin={...m.state.grants['grant:north'].payload,id:'grant:seat:manager',
   lineageId:'grant:seat:manager',roleId:'role:manager',rightClass:'ADMINISTRATION',
   resources:['authority:issuer:north'],actions:['grant.issue','grant.revoke'],
   purposes:['access-administration']};
 const issuer=m.all.north.issuerSigner,manager=m.all.north.credentialSigner;
 m.state.grants[admin.id]=signRecord(admin,issuer);
 const old=m.state.statuses['issuer:north'].payload;
 m.state.statuses['issuer:north']=signRecord({...old,entries:[...old.entries,
  {grantId:admin.id,state:'ACTIVE',effectiveAt:old.issuedAt,evidenceRef:'evidence:manager'}]},issuer);
 const employees=['alice','bob','claire'].map(name=>{
  const kp=generateKeyPairSync('ed25519'),personId='person:seat:'+name,keyId='key:seat:'+name;
  m.policy.keys[keyId]={subjectId:personId,environment:'PRODUCTION',status:'ACTIVE',
    uses:['PROOF'],publicKey:kp.publicKey.export({type:'spki',format:'pem'}).toString(),
    notBefore:iso(time-1000),expiresAt:iso(time+3600000)};
  return {personId,signer:keyObjectSigner(keyId,kp.privateKey)};
 });
 const kernel=originalKernelFixture(),opts={kernel:kernel.api,workspaceId:'ws:host-registry',
   trustedPolicy:m.policy,clock:now};
 let registry=createOriginalKernelRegistryStatePort(opts);
 const open=(wrongProof=false)=>createOriginalEmployeeEnrollmentOwner({
  registry,issuerSigner:issuer,clock:now,trustedOrganization:org,trustedWorkspaceId:'ws:north',
  proveManager:async({request,challenge})=>makeProof(request,challenge,time,
    wrongProof?employees[0].signer:manager,'PRODUCTION'),corporateSeatSource:source
 });
 await registry.commitSignedState(m.state);
 let owner=open();
 for(const e of employees){
  const challenge=await owner.begin({organization:org,workspaceId:'ws:north',
    employeePersonId:e.personId,credentialKeyId:e.signer.keyId,
    managerPersonId:'person:operator',managerGrantId:admin.id,ttlSeconds:600});
  const enrolled=await owner.complete({enrollmentId:challenge.enrollmentId,
    employeeProof:makeProof(challenge.request,challenge.challenge,time,e.signer,'PRODUCTION')});
  e.enrollmentId=enrolled.enrollmentId;e.workGrantId=enrolled.grantIds.work;
 }
 const command=async(kind,id,target=null,from=null)=>{
  const v=await owner.viewCorporateSeats();
  return {kind,commandId:id,expectedRegistryDigest:v.registryDigest,
    expectedLicenseDigest:v.licenseEvidenceDigest,managerPersonId:'person:operator',
    managerGrantId:admin.id,employeePersonId:target?.personId??null,
    enrollmentId:target?.enrollmentId??null,fromGrantId:from};
 };
 const checkUse=async(e,grantId,at=time)=>{
  const state=await registry.readState(),grant=state.grants[grantId].payload;
  const request={id:'use:seat',actorId:e.personId,principalId:org.organizationId,
   roleId:grant.roleId,grantId,audience:grant.audience,resource:CORPORATE_SEAT_RESOURCE,
   action:CORPORATE_SEAT_ACTION,purpose:CORPORATE_SEAT_PURPOSE,
   realmId:org.realmId,operationDigest:'operation:agent'};
  const challenge='seat-use-independent-challenge';
  return evaluateOriginalCorporateSeatUse({state,organization:org,licenseState:source.read(),
    installedTrust:source.installedTrust,request,challenge,
    proof:makeProof(request,challenge,at,e.signer,'PRODUCTION'),now:at});
 };
 return {employees,kernel,command,source,checkUse,time,
  get owner(){return owner;},get registry(){return registry;},
  cold(){registry=createOriginalKernelRegistryStatePort(opts);owner=open();},
  wrongManager(){owner=open(true);},
  renew(limit){pairs.push(makeLicense('license:seat:revision:'+revision,limit,
    pairs.at(-1).license.payload.id));revision++;},
  revoke(){const pair=pairs.at(-1);
    pair.statusEnvelope=signCorporateLicenseStatus({license:pair.license,
      ownerState:f.ownerState,signer:f.statusSigner,sequence:pair.floor.sequence+1,state:'REVOKED',
      validUntil:iso(time+3600000),now:time});
    pair.floor=inspectSignedCorporateLicenseStatus({license:pair.license,
      statusEnvelope:pair.statusEnvelope,installedTrust:f.ownerState,
      organizationId:org.organizationId,now:time}).floor;revision++;}};
}
test('original corporate seat: assign, exact replay, capacity rejection, atomic transfer, cold release',async()=>{
 const s=await seatFixture(),[alice,bob]=s.employees;
 const initial=await s.owner.viewCorporateSeats();
 assert.equal(initial.independentlyEnrolledEmployees,3);
 assert.equal(initial.availableSeats,1);
 const assign=await s.command('ASSIGN','cmd:seat:alice',alice);
 const first=await s.owner.changeCorporateSeat(assign);
 assert.equal(first.outcome,'COMMITTED');
 assert.equal(first.view.reservedSeats,1);assert.equal(first.view.availableSeats,0);
 const before=s.kernel.calls.length;
 s.cold();
 assert.equal((await s.owner.changeCorporateSeat(assign)).outcome,'ALREADY_COMMITTED');
 assert.equal(s.kernel.calls.length,before);
 assert.equal((await s.checkUse(alice,first.grantId)).allowed,true);
 assert.equal((await s.checkUse(bob,first.grantId)).allowed,false);
 await assert.rejects(s.owner.changeCorporateSeat(await s.command('ASSIGN','cmd:seat:bob',bob)),
  /CORP_SEAT_CAPACITY_EXCEEDED/);
 await assert.rejects(s.owner.changeCorporateSeat({...assign,employeePersonId:bob.personId}),
  /CORP_SEAT_COMMAND_REUSE_CONFLICT/);
 const transfer=await s.command('TRANSFER','cmd:seat:transfer',bob,first.grantId);
 const moved=await s.owner.changeCorporateSeat(transfer);
 assert.equal(s.kernel.calls.length,before+1,'transfer is one original Kernel commit');
 assert.equal(moved.view.reservedSeats,1);
 assert.equal((await s.checkUse(alice,first.grantId)).allowed,false);
 assert.equal((await s.checkUse(bob,moved.grantId)).allowed,true);
 assert.equal((await s.registry.readState()).grants[alice.workGrantId].payload.rightClass,'ACTION');
 s.cold();
 assert.equal((await s.owner.changeCorporateSeat(transfer)).outcome,'ALREADY_COMMITTED');
 const release=await s.command('RELEASE','cmd:seat:release',null,moved.grantId);
 assert.equal((await s.owner.changeCorporateSeat(release)).view.reservedSeats,0);
 assert.equal((await s.checkUse(bob,moved.grantId)).allowed,false);
 s.cold();assert.equal((await s.owner.changeCorporateSeat(release)).outcome,'ALREADY_COMMITTED');
});
test('renewal shrinks signed capacity without silently deleting people; revoke disables feature only',async()=>{
 const s=await seatFixture({seatLimit:2}),[alice,bob]=s.employees;
 const a=await s.owner.changeCorporateSeat(await s.command('ASSIGN','cmd:renew:a',alice));
 const b=await s.owner.changeCorporateSeat(await s.command('ASSIGN','cmd:renew:b',bob));
 s.renew(1);
 let v=await s.owner.viewCorporateSeats();
 assert.equal(v.reservedSeats,2);assert.equal(v.overSeatLimit,1);
 assert.equal((await s.checkUse(alice,a.grantId)).allowed,false);
 assert.equal((await s.checkUse(bob,b.grantId)).allowed,false);
 await s.owner.changeCorporateSeat(await s.command('RELEASE','cmd:renew:release',null,b.grantId));
 assert.equal((await s.checkUse(alice,a.grantId)).allowed,true);
 s.revoke();assert.equal((await s.owner.viewCorporateSeats()).reservedSeats,1);
 assert.equal((await s.checkUse(alice,a.grantId)).allowed,false);
 const result=await s.owner.changeCorporateSeat(await s.command('RELEASE','cmd:revoke:release',null,a.grantId));
 assert.equal(result.view.reservedSeats,0);
 assert.equal(result.view.licenseState,'NO_CURRENT_LICENSE');
});
test('seat change requires exact current registry and original manager proof, no hidden grant writes',async()=>{
 const s=await seatFixture(),[alice,bob]=s.employees;
 const pending=await s.command('ASSIGN','cmd:stale:bob',bob);
 await s.owner.changeCorporateSeat(await s.command('ASSIGN','cmd:stale:alice',alice));
 const before=s.kernel.calls.length;
 await assert.rejects(s.owner.changeCorporateSeat(pending),/CORP_SEAT_REGISTRY_CHANGED/);
 const current=await s.owner.viewCorporateSeats(),occupied=current.assignments.find(x=>x.reserved);
 const release=await s.command('RELEASE','cmd:wrong:release',null,occupied.grantId);
 s.wrongManager();
 await assert.rejects(s.owner.changeCorporateSeat(release),/CORP_SEAT_MANAGER_PROOF_DENIED/);
 assert.equal(s.kernel.calls.length,before);
});

test('existing organization enables only the fixed original ENTITLEMENT ceiling without re-enrolling staff',async()=>{
 const s=await seatFixture({seatPolicy:false}),[alice]=s.employees;
 const before=await s.registry.readState(),v=await s.owner.viewCorporateSeats();
 assert.equal(v.seatPolicyReady,false);assert.equal(v.availableSeats,0);
 await assert.rejects(s.owner.changeCorporateSeat(await s.command('ASSIGN','cmd:legacy:seat',alice)),
  /CORP_SEAT_POLICY_ENABLE_REQUIRED/);
 const input={managerPersonId:'person:operator',managerGrantId:'grant:seat:manager',
   expectedRegistryDigest:v.registryDigest};
 const count=s.kernel.calls.length;
 const enabled=await s.owner.enableCorporateSeatPolicy(input);
 assert.equal(enabled.outcome,'ENABLED');assert.equal(enabled.view.availableSeats,1);
 assert.equal(s.kernel.calls.length,count+1);
 const after=await s.registry.readState();
 assert.deepEqual(after.grants,before.grants);
 assert.deepEqual(after.policy.keys,before.policy.keys);
 assert.deepEqual(after.policy.authorities['issuer:south'],before.policy.authorities['issuer:south']);
 assert.equal(after.policy.actionCatalog[CORPORATE_SEAT_ACTION],'ENTITLEMENT');
 s.cold();
 assert.equal((await s.owner.enableCorporateSeatPolicy(input)).outcome,'ALREADY_ENABLED');
 assert.equal(s.kernel.calls.length,count+1);
 const assigned=await s.owner.changeCorporateSeat(await s.command('ASSIGN','cmd:legacy:seat:enabled',alice));
 assert.equal(assigned.view.reservedSeats,1);
 assert.equal((await s.checkUse(alice,assigned.grantId)).allowed,true);
});

test('legacy policy admission rejects an outdated original registry digest without signing or committing',async()=>{
 const s=await seatFixture({seatPolicy:false});
 const before=s.kernel.calls.length;
 await assert.rejects(s.owner.enableCorporateSeatPolicy({managerPersonId:'person:operator',
  managerGrantId:'grant:seat:manager',expectedRegistryDigest:'0'.repeat(64)}),/CORP_SEAT_REGISTRY_CHANGED/);
 assert.equal(s.kernel.calls.length,before);
 assert.equal((await s.owner.viewCorporateSeats()).seatPolicyReady,false);
});
