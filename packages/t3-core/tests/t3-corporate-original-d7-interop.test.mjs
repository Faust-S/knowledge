// A SOURCE-LEVEL interop witness: signed Ed25519 LICENSE/STATUS are genuine,
// while the carrier and receipt below are deliberately synthetic. This is
// NOT a native installed Admin Center proof or an original Store acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {digest,iso,keyObjectSigner} from '../src/t3/access/core.mjs';
import {createTrustedPublisherHandoff}
  from '../src/t3/publisher-license-handoff.mjs';
import {CORPORATE_REQUEST_SCHEMA,
  createCorporateLicenseCandidate,signCorporateLicenseCandidate,
  inspectSignedCorporateLicense,signCorporateLicenseStatus,
  inspectSignedCorporateLicenseStatus}
  from '../src/t3/access/corporate-product-license.mjs';
const NOW=Date.parse('2026-11-22T12:00:00.000Z');
const ORG='org:factory';
const archive=()=>Uint8Array.of(0x50,0x4b,3,4,1,2,3,4);
function signed(){
  const a=generateKeyPairSync('ed25519'),b=generateKeyPairSync('ed25519');
  const key=(pair,use)=>({status:'ACTIVE',environment:'PRODUCTION',uses:[use],
    notBefore:iso(NOW-86400000),expiresAt:iso(NOW+365*86400000),
    publicKey:pair.publicKey.export({type:'spki',format:'pem'})});
  const state={trustOrigin:'HOST_PREINSTALLED_PUBLIC_POLICY',
    policy:{environment:'PRODUCTION',keys:{
      'key:license':key(a,'LICENSE'),'key:status':key(b,'LICENSE_STATUS')
    },authorities:{'publisher:iwxa':{
      issuerKeys:['key:license'],statusKeys:['key:status']
    }}},corporateLicenseIssuers:{'publisher:iwxa':{
      environment:'PRODUCTION',productId:'IWXA_ADMIN_CENTER',
      licenseKeyId:'key:license',statusKeyId:'key:status',
      featureIds:['PERSONAL_AGENT_CORPORATE'],
      maxAdminCenterSeats:3,maxEmployeeLimit:10,maxPersonalAgentSeats:5,
      maxTtlDays:365
    }}
  };
  const request={schema:CORPORATE_REQUEST_SCHEMA,
    kind:'CORPORATE_LICENSE_REQUEST',requestId:'proposal:factory:1',
    requestedAt:iso(NOW-1000),environment:'PRODUCTION',
    subject:{type:'ORGANIZATION',id:ORG},
    product:{id:'IWXA_ADMIN_CENTER',version:'0.5.0'},
    tariff:{id:'TEAM',revision:1},
    featureIds:['PERSONAL_AGENT_CORPORATE'],
    limits:{adminCenterSeats:2,employeeLimit:10,personalAgentSeats:3,quotas:[]},
    termDays:30,status:'UNSIGNED_REQUEST'};
  const license=signCorporateLicenseCandidate({payload:createCorporateLicenseCandidate({
    request,ownerState:state,issuerAuthorityId:'publisher:iwxa',
    licenseId:'license:factory:1',lineageId:'lineage:factory:1',now:NOW
  }),ownerState:state,signer:keyObjectSigner('key:license',a.privateKey),now:NOW});
  const status=signCorporateLicenseStatus({license,ownerState:state,
    signer:keyObjectSigner('key:status',b.privateKey),
    sequence:1,state:'ACTIVE',validUntil:iso(NOW+12*3600000),now:NOW});
  return {state,license,status};
}
test('original signed corporate T3 LICENSE/STATUS flows into existing D7 Human review without activating employee seats',async()=>{
  const source=signed(),records=new Map(),calls=[],holder={
    holderId:'holder:windows:factory',recipientId:ORG,subjectType:'ORGANIZATION',
    bindingEpoch:'epoch:1'
  };
  const nativeHolder={
    currentSubject:async()=>({...holder}),
    inspect:async({kind,packageSha256})=>{
      const verified=kind==='LICENSE'
        ?inspectSignedCorporateLicense({envelope:source.license,
          installedTrust:source.state,organizationId:ORG,now:NOW})
        :inspectSignedCorporateLicenseStatus({license:source.license,
          statusEnvelope:source.status,installedTrust:source.state,
          organizationId:ORG,now:NOW});
      assert.equal(verified.signatureVerified,true);
      const operationId=kind==='LICENSE'?'operation:license':'operation:status';
      return {kind,packageSha256,holderId:holder.holderId,recipientId:ORG,
        publisherId:'publisher:iwxa',issuerAuthorityId:'publisher:iwxa',
        operationId,previewDigest:digest({kind,operationId}),
        licenseId:source.license.payload.id,
        ...(kind==='STATUS'?{
          statusSchema:source.status.payload.schema,
          organizationId:ORG,productId:'IWXA_ADMIN_CENTER',
          statusState:verified.status,sequence:verified.sequence,
          statusPayloadDigest:digest(source.status.payload),
          statusValidUntil:verified.statusValidUntil
        }:{}),
        publisherSignatureVerified:true,pinnedPublisherTrusted:true,
        stage:records.has(kind)?'RECOVER_ONLY':'READY'};
    },
    apply:async row=>{
      calls.push(row.kind);
      const v={kind:row.kind,operationId:row.operationId,
        packageSha256:row.packageSha256,holderId:holder.holderId,
        recipientId:ORG,issuerAuthorityId:'publisher:iwxa',
        licenseId:source.license.payload.id,state:'COMMITTED',
        ...(row.kind==='STATUS'?{sequence:1,
          statusPayloadDigest:digest(source.status.payload)}:{})};
      records.set(row.kind,v);
    },
    receipt:async q=>records.get(q.kind)??null,
    statusReadback:async q=>{
      const v=records.get(q.kind);
      return v?{...v,persisted:true,statusSequenceFloor:1}:null;
    }
  };
  const create=()=>createTrustedPublisherHandoff({
    nativeHolder,confirmHuman:async()=>true,isHostActive:()=>true
  });
  const port=create(),bytes=archive();
  const preview=await port.preview({kind:'LICENSE',archiveBytes:bytes});
  assert.equal(preview.entitlementActivated,false);
  const receipt=await port.admit({kind:'LICENSE',archiveBytes:bytes,
    previewDigest:preview.previewDigest});
  assert.equal(receipt.status,'ORIGINAL_HOLDER_READBACK_CONFIRMED');
  const statusPreview=await port.preview({kind:'STATUS',archiveBytes:bytes});
  assert.equal(statusPreview.statusFamily,'CORPORATE_PRODUCT_STATUS/3');
  const statusReceipt=await port.admit({kind:'STATUS',archiveBytes:bytes,
    previewDigest:statusPreview.previewDigest});
  assert.equal(statusReceipt.status,'ORIGINAL_HOLDER_READBACK_CONFIRMED');
  assert.equal(statusReceipt.entitlementActivated,false);
  assert.equal(statusReceipt.dataAccessAuthorized,false);
  assert.deepEqual(calls,['LICENSE','STATUS']);
  const cold=await create().recover({kind:'STATUS',archiveBytes:bytes});
  assert.equal(cold.status,'ORIGINAL_HOLDER_READBACK_CONFIRMED');
  assert.deepEqual(calls,['LICENSE','STATUS']);
});
