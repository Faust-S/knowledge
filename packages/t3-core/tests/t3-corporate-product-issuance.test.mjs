import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {copy,digest,iso,keyObjectSigner} from '../src/t3/access/core.mjs';
import {CORPORATE_REQUEST_SCHEMA,CORPORATE_LICENSE_SCHEMA} from
  '../src/t3/access/corporate-product-license.mjs';
import {ORIGINAL_PRODUCT_ISSUE_LEDGER_SCHEMA,issueCorporateProductLicenseOnce}
  from '../src/t3/access/corporate-product-issuance.mjs';

const NOW=Date.parse('2026-11-22T12:00:00.000Z');
const mustDeny=(fn,code)=>assert.throws(fn,e=>e?.code===code||e?.message===code,
  'Expected denial '+code);
function fixture(){
  const pair=generateKeyPairSync('ed25519'),
    other=generateKeyPairSync('ed25519');
  const meta=(pair,uses)=>({
    environment:'PRODUCTION',status:'ACTIVE',uses,
    notBefore:iso(NOW-86400000),expiresAt:iso(NOW+366*86400000),
    publicKey:pair.publicKey.export({type:'spki',format:'pem'})
  });
  let signatureCount=0;
  const signer=keyObjectSigner('key:license',pair.privateKey);
  const tracked={keyId:signer.keyId,sign(data){signatureCount++;return signer.sign(data);}};
  const state={
    trustOrigin:'HOST_PREINSTALLED_PUBLIC_POLICY',
    policy:{environment:'PRODUCTION',keys:{
      'key:license':meta(pair,['LICENSE']),
      'key:status':meta(other,['LICENSE_STATUS'])
    },authorities:{'publisher:iwxa':{
      issuerKeys:['key:license'],statusKeys:['key:status']
    }}},
    corporateLicenseIssuers:{'publisher:iwxa':{
      environment:'PRODUCTION',productId:'IWXA_ADMIN_CENTER',
      licenseKeyId:'key:license',statusKeyId:'key:status',
      featureIds:['PERSONAL_AGENT_CORPORATE'],
      maxAdminCenterSeats:5,maxEmployeeLimit:50,
      maxPersonalAgentSeats:20,maxTtlDays:365
    }},
    revision:0,lastObservedAt:iso(NOW-86400000)
  };
  const request={
    schema:CORPORATE_REQUEST_SCHEMA,kind:'CORPORATE_LICENSE_REQUEST',
    requestId:'request:company:one',requestedAt:iso(NOW-1000),
    environment:'PRODUCTION',status:'UNSIGNED_REQUEST',
    subject:{type:'ORGANIZATION',id:'org:company'},
    product:{id:'IWXA_ADMIN_CENTER',version:'0.5.0'},
    tariff:{id:'TEAM',revision:2},
    featureIds:['PERSONAL_AGENT_CORPORATE'],
    limits:{adminCenterSeats:1,employeeLimit:10,personalAgentSeats:3,
      quotas:[]},termDays:30
  };
  const current={value:copy(state)};
  let transactions=0;
  const persist=(next,guard)=>{
    assert.equal(guard.expectedStateRevision,current.value.revision);
    assert.equal(guard.expectedLedgerRevision,
      current.value.productLicenseIssueLedger?.revision??0);
    current.value=copy(next);transactions++;
    return {durable:true,stateRevision:next.revision,
      ledgerRevision:next.productLicenseIssueLedger.revision};
  };
  const issue=(r=request,options={})=>issueCorporateProductLicenseOnce({
    request:r,ownerState:copy(current.value),
    issuerAuthorityId:'publisher:iwxa',signer:tracked,
    licenseId:'license:company:one',
    lineageId:'lineage:company:one',now:NOW,
    persist,...options
  });
  return {state,current,request,issue,persist,signatures:()=>signatureCount,
    transactions:()=>transactions};
}
test('corporate issuer signs and persists exact offer in ORIGINAL shared issuer ledger with native CAS',()=>{
 const f=fixture(),first=f.issue();
 assert.equal(first.outcome,'ISSUED_NEW');
 assert.equal(first.signedLicense.payload.schema,CORPORATE_LICENSE_SCHEMA);
 assert.equal(first.signedLicense.payload.tariff.revision,2);
 assert.equal(first.signedLicense.payload.limits.personalAgentSeats,3);
 assert.equal(first.recipientConfirmed,false);
 assert.equal(first.activeSeats,0);
 assert.equal(first.assignablePersonalAgentSeats,0);
 assert.equal(f.current.value.revision,1);
 assert.equal(f.current.value.productLicenseIssueLedger.schema,
   ORIGINAL_PRODUCT_ISSUE_LEDGER_SCHEMA);
 assert.equal(f.current.value.productLicenseIssueLedger.revision,1);
 assert.equal(f.current.value.productLicenseIssueLedger.records[f.request.requestId].requestDigest,
   digest(f.request));
 assert.equal(f.signatures(),1);assert.equal(f.transactions(),1);
 const original=JSON.stringify(f.current.value);
 const replay=f.issue(f.request,{licenseId:'license:should-not-exist'});
 assert.equal(replay.outcome,'ALREADY_ISSUED');
 assert.deepEqual(replay.signedLicense,first.signedLicense);
 assert.equal(f.signatures(),1);
 assert.equal(f.transactions(),1);
 assert.equal(JSON.stringify(f.current.value),original);
});
test('lost native ISSUE ACK recovers old original issuer record; never signs another license',()=>{
 const f=fixture();
 let acknowledged=false;
 const commitButLoseAck=(next,guard)=>{
   const stored=f.persist(next,guard);
   assert.equal(stored.durable,true);
   acknowledged=true;
   throw Error('NATIVE_ACK_LOST_AFTER_ORIGINAL_STORE_COMMIT');
 };
 assert.throws(()=>f.issue(f.request,{persist:commitButLoseAck}),
   /NATIVE_ACK_LOST_AFTER_ORIGINAL_STORE_COMMIT/);
 assert.equal(acknowledged,true);
 assert.equal(f.signatures(),1);
 assert.equal(f.transactions(),1);
 const recovery=f.issue(f.request,{licenseId:'license:second-attempt'});
 assert.equal(recovery.outcome,'ALREADY_ISSUED');
 assert.equal(recovery.signedLicense.payload.id,'license:company:one');
 assert.equal(f.signatures(),1);
 assert.equal(f.transactions(),1);
});
test('wrong digest or changed corporate tariffs do not rewrite a signed original ledger entry',()=>{
 const f=fixture();
 f.issue();
 const forged={...f.request,limits:{...f.request.limits,personalAgentSeats:4}};
 mustDeny(()=>f.issue(forged),'CORP_ORIGINAL_ISSUE_REQUEST_CONFLICT');
 const wrongOrg={...f.request,subject:{type:'ORGANIZATION',id:'org:other'}};
 mustDeny(()=>f.issue(wrongOrg),'CORP_ORIGINAL_ISSUE_REQUEST_CONFLICT');
 assert.equal(f.signatures(),1);assert.equal(f.transactions(),1);
});
test('owner cannot claim durability if original CAS rejected transaction',()=>{
 const f=fixture();
 mustDeny(()=>f.issue(f.request,{persist:()=>({
   durable:false,stateRevision:1,ledgerRevision:1
 })}),'CORP_ORIGINAL_DURABLE_ISSUE_RECEIPT_REQUIRED');
 assert.equal(f.transactions(),0);
 assert.equal(f.current.value.productLicenseIssueLedger,undefined);
 mustDeny(()=>f.issue(f.request,{persist:()=>{throw Error('ORIGINAL_STORE_STALE_REVISION')}}),
   'ORIGINAL_STORE_STALE_REVISION');
});
test('existing TEST/PERSON entries remain byte-identical; original legacy inspector is mandatory',()=>{
 const f=fixture();
 const legacy={requestDigest:'a'.repeat(64),issuerAuthorityId:'issuer:legacy',
   signedLicense:{payload:{schema:'IWXA_T3_PRODUCT_LICENSE/2'}}};
 f.current.value.productLicenseIssueLedger={
   schema:ORIGINAL_PRODUCT_ISSUE_LEDGER_SCHEMA,revision:7,
   records:{'request:person:old':legacy}
 };
 mustDeny(()=>f.issue(),'CORP_ORIGINAL_LEGACY_LEDGER_INSPECTOR_REQUIRED');
 const reviewed=[];
 const originalLegacy=digest(legacy);
 const inspector=x=>{
   assert.equal(x.schema,ORIGINAL_PRODUCT_ISSUE_LEDGER_SCHEMA);
   assert.equal(x.revision,7);
   reviewed.push(x);
   return copy(x);
 };
 const issued=f.issue(f.request,{inspectLegacyLedger:inspector});
 assert.equal(issued.outcome,'ISSUED_NEW');
 assert.equal(f.current.value.productLicenseIssueLedger.revision,8);
 assert.equal(digest(f.current.value.productLicenseIssueLedger.records['request:person:old']),
   originalLegacy);
 assert.equal(reviewed.length,1);
});
test('original issuer refuses changed signing key, duplicate immutable license ID and TEST authority',()=>{
 const f=fixture();
 mustDeny(()=>f.issue(f.request,{signer:{keyId:'key:status',sign:()=>Buffer.alloc(64)}}),
   'CORP_ORIGINAL_LICENSE_SIGNER_REQUIRED');
 const state=f.current.value;
 state.productLicenseIssueLedger={
   schema:ORIGINAL_PRODUCT_ISSUE_LEDGER_SCHEMA,revision:1,records:{
     'request:legacy:1':{issuerAuthorityId:'issuer:legacy',requestDigest:'b'.repeat(64),
       signedLicense:{payload:{id:'license:company:one',schema:'IWXA_T3_PRODUCT_LICENSE/2'}}}
   }
 };
 const inspector=x=>copy(x);
 mustDeny(()=>f.issue(f.request,{inspectLegacyLedger:inspector}),
   'CORP_ORIGINAL_LICENSE_ID_CONFLICT');
 state.policy.environment='TEST';
 mustDeny(()=>f.issue(f.request,{inspectLegacyLedger:inspector}),
   'CORP_ORIGINAL_ISSUE_STATE_OR_TIME_INVALID');
});
