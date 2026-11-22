import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {copy,digest,iso,keyObjectSigner} from '../src/t3/access/core.mjs';
import {CORPORATE_REQUEST_SCHEMA} from '../src/t3/access/corporate-product-license.mjs';
import {issueCorporateProductLicenseOnce,changeCorporateLicenseStatusOnce,
  inspectCorporateOriginalOwnerSignedReadback}
  from '../src/t3/access/corporate-product-issuance.mjs';

const T=Date.parse('2026-11-22T12:00:00.000Z');
const until=at=>iso(at+12*3600000);
const mustDeny=(f,code)=>assert.throws(f,e=>e?.code===code||e?.message===code,code);
function f(){
 const a=generateKeyPairSync('ed25519'),b=generateKeyPairSync('ed25519');
 const key=(pair,purpose)=>({status:'ACTIVE',environment:'PRODUCTION',
   uses:[purpose],notBefore:iso(T-86400000),expiresAt:iso(T+50*86400000),
   publicKey:pair.publicKey.export({type:'spki',format:'pem'})});
 const signer=keyObjectSigner('license:key',a.privateKey);
 const status=keyObjectSigner('status:key',b.privateKey);
 let signatures=0;
 const statusSigner={keyId:status.keyId,
   sign(bytes){signatures++;return status.sign(bytes);}};
 const state={revision:0,lastObservedAt:iso(T-86400000),
   trustOrigin:'HOST_PREINSTALLED_PUBLIC_POLICY',
   policy:{environment:'PRODUCTION',keys:{
     'license:key':key(a,'LICENSE'),'status:key':key(b,'LICENSE_STATUS')
   },authorities:{'issuer:iwxa':{
     issuerKeys:['license:key'],statusKeys:['status:key']
   }}},
   corporateLicenseIssuers:{'issuer:iwxa':{
     environment:'PRODUCTION',productId:'IWXA_ADMIN_CENTER',
     licenseKeyId:'license:key',statusKeyId:'status:key',
     featureIds:['PERSONAL_AGENT_CORPORATE'],
     maxAdminCenterSeats:10,maxEmployeeLimit:100,
     maxPersonalAgentSeats:30,maxTtlDays:30
   }}
 };
 const request={schema:CORPORATE_REQUEST_SCHEMA,
   kind:'CORPORATE_LICENSE_REQUEST',requestId:'request:factory',
   requestedAt:iso(T-2000),environment:'PRODUCTION',
   subject:{type:'ORGANIZATION',id:'org:factory'},
   product:{id:'IWXA_ADMIN_CENTER',version:'0.5.0'},
   tariff:{id:'TEAM',revision:1},
   featureIds:['PERSONAL_AGENT_CORPORATE'],
   limits:{adminCenterSeats:2,employeeLimit:10,personalAgentSeats:4,quotas:[]},
   termDays:20,status:'UNSIGNED_REQUEST'};
 const current={state:copy(state),writes:0};
 const persist=(next,guard)=>{
   assert.equal(guard.expectedStateRevision,current.state.revision);
   assert.equal(guard.expectedLedgerRevision,
     current.state.productLicenseIssueLedger?.revision??0);
   current.state=copy(next);current.writes++;
   return {durable:true,stateRevision:next.revision,
     ledgerRevision:next.productLicenseIssueLedger.revision};
 };
 const issue=()=>issueCorporateProductLicenseOnce({
   request,ownerState:copy(current.state),issuerAuthorityId:'issuer:iwxa',
   signer,licenseId:'license:factory:1',lineageId:'lineage:factory:1',
   persist,now:T});
 const change=(nextStatus,expectedSequence,at=T+3000,options={})=>
   changeCorporateLicenseStatusOnce({
     ownerState:copy(current.state),licenseId:'license:factory:1',
     nextStatus,expectedSequence,validUntil:until(at),
     statusSigner,persist,now:at,...options});
 const read=()=>inspectCorporateOriginalOwnerSignedReadback({
   ownerState:copy(current.state),licenseId:'license:factory:1'});
 return {current,persist,issue,change,read,signatureCount:()=>signatures};
}
test('corporate original issuer records license and STATUS in one existing owner snapshot',()=>{
 const x=f();x.issue();
 assert.equal(x.current.state.revision,1);
 assert.equal(x.current.state.productLicenseIssueLedger.revision,1);
 assert.equal(x.read().status,'NOT_ACTIVATED');
 assert.equal(x.read().sequence,0);
 assert.equal(x.read().recipientConfirmed,false);
 const first=x.change('ACTIVE',0);
 assert.equal(first.outcome,'CORPORATE_STATUS_RECORDED');
 assert.equal(x.signatureCount(),1);
 assert.equal(x.current.state.revision,2);
 assert.equal(x.current.state.productLicenseIssueLedger.revision,1);
 assert.equal(x.current.state.productLicenseStatusFloors['license:factory:1'].sequence,1);
 assert.equal(x.current.state.productLicenseStatusEnvelopes['license:factory:1'].payload.state,
   'ACTIVE');
 const rb=x.read();
 assert.equal(rb.status,'ACTIVE');assert.equal(rb.sequence,1);
 assert.equal(rb.statusFloorVerified,true);
 assert.equal(rb.statusSignatureVerifiedAtIssuance,true);
 assert.equal(rb.tariffId,'TEAM');assert.equal(rb.tariffRevision,1);
 assert.equal(rb.licenseEnvelopeSha256.length,64);
 assert.equal(rb.statusEnvelopeSha256.length,64);
 assert.equal(rb.activeSeats,0);
 assert.equal(rb.assignablePersonalAgentSeats,0);
 assert.equal(rb.productionActivation,false);
});
test('lost STATUS ACK uses original signed readback, never silently signs next sequence',()=>{
 const x=f();x.issue();
 let ackLost=false;
 const persistAndLose=(next,guard)=>{
   x.persist(next,guard);ackLost=true;throw Error('NATIVE_ACK_LOST');
 };
 assert.throws(()=>x.change('ACTIVE',0,T+3000,{persist:persistAndLose}),/NATIVE_ACK_LOST/);
 assert.equal(ackLost,true);assert.equal(x.current.writes,2);
 assert.equal(x.signatureCount(),1);
 assert.equal(x.read().status,'ACTIVE');
 assert.equal(x.read().sequence,1);
 mustDeny(()=>x.change('ACTIVE',0,T+6000),
   'CORP_ORIGINAL_STATUS_SEQUENCE_STALE');
 assert.equal(x.signatureCount(),1);
 assert.equal(x.current.writes,2);
});
test('corporate owner persists subsequent signed STATUS with monotone floor and terminal revoke',()=>{
 const x=f();x.issue();
 x.change('ACTIVE',0,T+3000);
 const second=x.change('SUSPENDED',1,T+6000);
 assert.equal(second.floor.sequence,2);
 const revoked=x.change('REVOKED',2,T+9000);
 assert.equal(revoked.floor.state,'REVOKED');
 assert.equal(revoked.floor.sequence,3);
 assert.equal(x.read().status,'REVOKED');
 mustDeny(()=>x.change('ACTIVE',3,T+12000),'CORP_ORIGINAL_TERMINAL_REVOKE');
 mustDeny(()=>x.change('REVOKED',2,T+12000),'CORP_ORIGINAL_STATUS_SEQUENCE_STALE');
 assert.equal(x.signatureCount(),3);assert.equal(x.current.writes,4);
});
test('source archive/status tampering after original signed commit cannot yield owner receipt',()=>{
 const x=f();x.issue();x.change('ACTIVE',0);
 const saved=copy(x.current.state);
 x.current.state.productLicenseIssueLedger.records['request:factory'].signedLicense
   .payload.limits.personalAgentSeats=11;
 mustDeny(()=>x.read(),'SIGNATURE_INVALID');
 x.current.state=saved;
 x.current.state.productLicenseStatusFloors['license:factory:1'].statusDigest='a'.repeat(64);
 mustDeny(()=>x.read(),'CORP_STATUS_EQUIVOCATION_DENIED');
});
test('status cannot claim success after original Store refuses CAS',()=>{
 const x=f();x.issue();
 mustDeny(()=>x.change('ACTIVE',0,T+3000,{
   persist:()=>({durable:false,stateRevision:2,ledgerRevision:1})
 }),'CORP_ORIGINAL_DURABLE_STATUS_RECEIPT_REQUIRED');
 assert.equal(x.current.writes,1);
 assert.equal(x.read().status,'NOT_ACTIVATED');
 mustDeny(()=>x.change('ACTIVE',0,T+3000,{
   statusSigner:{keyId:'license:key',sign:()=>Buffer.alloc(64)}
 }),'CORP_ORIGINAL_STATUS_SIGNER_REQUIRED');
});
