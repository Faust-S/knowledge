import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {copy,digest,iso,keyObjectSigner} from '../src/t3/access/core.mjs';
import {CORPORATE_REQUEST_SCHEMA,CORPORATE_LICENSE_SCHEMA,inspectCorporateLicenseLineages} from
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

test('corporate renewal binds the same signed organization, product and lineage, with exact retry',()=>{
 const f=fixture(),first=f.issue();
 const request={...f.request,requestId:'request:company:renewal',
  requestedAt:iso(NOW+1000),tariff:{id:'TEAM',revision:3},
  limits:{...f.request.limits,personalAgentSeats:2}};
 const options={licenseId:'license:company:two',
  lineageId:first.signedLicense.payload.lineageId,
  renewalOf:first.signedLicense.payload.id,now:NOW+2000};
 const renewal=f.issue(request,options);
 assert.equal(renewal.outcome,'ISSUED_NEW');
 assert.equal(renewal.signedLicense.payload.renewalOf,first.signedLicense.payload.id);
 assert.equal(renewal.signedLicense.payload.lineageId,first.signedLicense.payload.lineageId);
 assert.equal(renewal.signedLicense.payload.limits.personalAgentSeats,2);
 assert.equal(f.transactions(),2);
 const replay=f.issue(request,{...options,licenseId:'license:not-issued',now:NOW+3000});
 assert.deepEqual(replay.signedLicense,renewal.signedLicense);
 assert.equal(f.signatures(),2);
 mustDeny(()=>f.issue(request,{...options,renewalOf:null}),
   'CORP_ORIGINAL_ISSUE_RENEWAL_CONFLICT');
 mustDeny(()=>f.issue({...request,requestId:'request:fork'},
   {...options,licenseId:'license:fork',now:NOW+4000}),
   'CORP_ORIGINAL_RENEWAL_ALREADY_ISSUED');
 assert.equal(f.transactions(),2);
});
test('corporate renewal cannot attach a missing or foreign predecessor or reuse a root lineage',()=>{
 const f=fixture();f.issue();
 const r={...f.request,requestId:'request:company:two',requestedAt:iso(NOW)};
 const o={licenseId:'license:company:two',now:NOW+1000,
  lineageId:'lineage:company:one',renewalOf:'license:company:one'};
 mustDeny(()=>f.issue(r,{...o,renewalOf:'license:missing'}),
  'CORP_ORIGINAL_RENEWAL_PREDECESSOR_REQUIRED');
 mustDeny(()=>f.issue({...r,subject:{type:'ORGANIZATION',id:'org:other'}},o),
  'CORP_ORIGINAL_RENEWAL_SCOPE_MISMATCH');
 mustDeny(()=>f.issue(r,{...o,lineageId:'lineage:other'}),
  'CORP_ORIGINAL_RENEWAL_SCOPE_MISMATCH');
 mustDeny(()=>f.issue(r,{...o,renewalOf:null}),'CORP_LINEAGE_MULTIPLE_ROOTS');
 assert.equal(f.transactions(),1);assert.equal(f.signatures(),1);
});

test('recipient can observe a signed renewal before its predecessor without adding old limits',()=>{
 const f=fixture(),p=f.issue().signedLicense.payload;
 const r={...p,id:'license:renewed',requestId:'request:renewed',
  renewalOf:p.id,issuedAt:iso(NOW+1000),notBefore:iso(NOW+1000),
  expiresAt:iso(NOW+31*86400000)};
 const one=inspectCorporateLicenseLineages([r]);
 assert.deepEqual(one.heads,[r.id]);
 assert.deepEqual(one.superseded,[p.id]);
 assert.deepEqual(one.unresolvedHeads,[]);
 mustDeny(()=>inspectCorporateLicenseLineages([r],{requireComplete:true}),
  'CORP_LINEAGE_PREDECESSOR_REQUIRED');
 const both=inspectCorporateLicenseLineages([r,p],{requireComplete:true});
 assert.deepEqual(both,one);
 const late={...r,id:'license:late',requestId:'request:late',
  renewalOf:'license:middle',issuedAt:iso(NOW+3000),notBefore:iso(NOW+3000)};
 const incomplete=inspectCorporateLicenseLineages([late,p]);
 assert.deepEqual(incomplete.unresolvedHeads,[late.id,p.id].sort());
 const middle={...r,id:'license:middle',requestId:'request:middle'};
 const complete=inspectCorporateLicenseLineages([late,p,middle]);
 assert.deepEqual(complete.heads,[late.id]);
 assert.deepEqual(complete.unresolvedHeads,[]);
 assert.deepEqual(complete.superseded,[p.id,middle.id].sort());
});
test('recipient rejects signed lineage forks, wrong scopes and cycles before any Store mutation',()=>{
 const f=fixture(),p=f.issue().signedLicense.payload;
 const r={...p,id:'license:renewed',requestId:'request:renewed',
  renewalOf:p.id,issuedAt:iso(NOW+1000),notBefore:iso(NOW+1000)};
 const fork={...r,id:'license:fork',requestId:'request:fork'};
 mustDeny(()=>inspectCorporateLicenseLineages([p,r,fork]),'CORP_LINEAGE_FORK_DENIED');
 mustDeny(()=>inspectCorporateLicenseLineages([p,{...r,subject:{type:'ORGANIZATION',id:'org:foreign'}}]),
  'CORP_LINEAGE_SCOPE_MISMATCH');
 mustDeny(()=>inspectCorporateLicenseLineages([p,{...r,issuedAt:iso(NOW-1000),notBefore:iso(NOW-1000)}]),
  'CORP_LINEAGE_TIME_ROLLBACK');
 mustDeny(()=>inspectCorporateLicenseLineages([
  {...p,renewalOf:r.id}, {...r,issuedAt:p.issuedAt,notBefore:p.notBefore}
 ]),'CORP_LINEAGE_CYCLE_DENIED');
});
