import test from 'node:test';
import assert from 'node:assert/strict';
import {createT4NetworkConnectionProfile,openT4OperatorConnection}
  from '../src/network/operator-connection.mjs';
import {packageSha256} from '../src/network/webdav-package-transfer.mjs';
const policy={objectFamily:'owner-exported-package',workspaceId:'ws:company',authorityRoot:'original:company',
  writeOwnerRef:'original:exchange',primaryPlacement:'LOCAL_PRIMARY_HOSTED_REPLICA',
  allowedLocations:['my:server'],retentionClass:'original',recoveryClass:'owner',
  universalCloudMaster:false,subjectActionAuthority:false};
const profileData={profileRef:'t4:personal',mode:'SELF_HOSTED',operatorRef:'self:server',
  locationRef:'my:server',endpointUrl:'https://example.org/dav/'};
const agreement={
  schema:'IWXA_T4_CLOUD_PARTICIPATION_AGREEMENT_V1',
  originalOwnerRef:'org:company',authorityEvidenceRef:'t3:company:approved',
  termsDigest:'a'.repeat(64),permittedDataFamilies:['orders','activity'],
  permittedPurposes:['sectoral-anonymized-statistics'],
  operatorMayUseVerifiedAnonymizedDerivatives:true,rawSourceDataOwnershipTransferred:false,
  rawSourceDataMayBeRedistributed:false,reidentificationPermitted:false
};
const code=expected=>error=>{assert.equal(error.code,expected);return true;};
test('own server does not grant IWXA rights by default',()=>{
  const p=createT4NetworkConnectionProfile(profileData);
  assert.equal(p.cloudAgreement,null);
  assert.equal(p.iwxaDerivedDataRightByDefault,false);
  assert.equal(p.mode,'SELF_HOSTED');
});
test('independent operator is not silently enrolled in IWXA cloud',()=>{
  const p=createT4NetworkConnectionProfile({...profileData,mode:'THIRD_PARTY',operatorRef:'provider:external'});
  assert.equal(p.cloudAgreement,null);
  assert.equal(p.mode,'THIRD_PARTY');
});
test('IWXA cloud requires bounded owner agreement, not blanket transfer',()=>{
  assert.throws(()=>createT4NetworkConnectionProfile({...profileData,mode:'IWXA_CLOUD',operatorRef:'iwxa:operator'}),
    code('IWXA_CLOUD_AGREEMENT_REQUIRED'));
  const p=createT4NetworkConnectionProfile({...profileData,mode:'IWXA_CLOUD',operatorRef:'iwxa:operator',
    cloudAgreement:agreement});
  assert.equal(p.cloudAgreement.operatorMayUseVerifiedAnonymizedDerivatives,true);
  assert.equal(p.cloudAgreement.rawSourceDataOwnershipTransferred,false);
  assert.equal(p.cloudAgreement.rawSourceDataMayBeRedistributed,false);
  assert.equal(p.cloudAgreementVerified,false);
});
test('third party cannot borrow the IWXA data participation agreement',()=>{
  assert.throws(()=>createT4NetworkConnectionProfile({...profileData,cloudAgreement:agreement}),
    code('IWXA_CLOUD_AGREEMENT_NOT_APPLICABLE'));
});
test('malformed agreement and credentials in profile are denied',()=>{
  assert.throws(()=>createT4NetworkConnectionProfile({...profileData,password:'secret'}),
    code('CREDENTIAL_IN_PROFILE'));
  assert.throws(()=>createT4NetworkConnectionProfile({...profileData,mode:'IWXA_CLOUD',
    operatorRef:'iwxa:operator',cloudAgreement:{...agreement,rawSourceDataOwnershipTransferred:true}}),
    code('IWXA_CLOUD_AGREEMENT_REQUIRED'));
});
test('self hosted transfer works without any IWXA agreement verifier',async()=>{
  const p=createT4NetworkConnectionProfile(profileData),b=Buffer.from('opaque-self-hosted');
  let requests=0;
  const ctx=openT4OperatorConnection({profile:p,placementPolicy:policy,
    getMode:()=> 'T4_NETWORK',authorize:async()=>true,getAuthorizationHeader:async()=> 'Bearer example',
    fetchImpl:async()=>{requests++;return new Response(b,{status:200});}});
  const r=await ctx.transport.getSnapshot({key:packageSha256(b)+'.iwxa',expectedSha256:packageSha256(b)});
  assert.deepEqual(r.bytes,b);assert.equal(requests,1);
  assert.equal(ctx.operatorMayUseVerifiedAnonymizedDerivatives,false);
  ctx.close();
});
test('IWXA cloud checks live original-owner agreement on every transfer',async()=>{
  const p=createT4NetworkConnectionProfile({...profileData,mode:'IWXA_CLOUD',
    operatorRef:'iwxa:operator',cloudAgreement:agreement});
  let allowed=true,calls=0,network=0;
  const b=Buffer.from('opaque-cloud-only-with-current-agreement');
  const ctx=openT4OperatorConnection({profile:p,placementPolicy:policy,getMode:()=> 'T4_NETWORK',
    authorize:async()=>true,getAuthorizationHeader:async()=> 'Bearer example',
    verifyOperatorEndpoint:async e=>{assert.equal(e.operatorRef,'iwxa:operator');assert.equal(e.endpointUrl,profileData.endpointUrl);return true;},
    verifyOriginalOwnerAgreement:async e=>{calls++;assert.equal(e.originalOwnerRef,'org:company');return allowed;},
    fetchImpl:async()=>{network++;return new Response(b,{status:200});}});
  await ctx.transport.getSnapshot({key:packageSha256(b)+'.iwxa',expectedSha256:packageSha256(b)});
  allowed=false;
  await assert.rejects(ctx.transport.getSnapshot({key:packageSha256(b)+'.iwxa',expectedSha256:packageSha256(b)}),
    e=>e.code==='AUTHORIZATION_DENIED');
  assert.equal(network,1);assert.ok(calls>=2);
  assert.equal(ctx.operatorAgreementDeclared,true);
  assert.equal(ctx.operatorMayUseVerifiedAnonymizedDerivatives,false);
  assert.equal(ctx.automaticDataExtractionEnabled,false);
  ctx.close();
});
test('IWXA cloud refuses activation without original owner evidence port',()=>{
  const p=createT4NetworkConnectionProfile({...profileData,mode:'IWXA_CLOUD',
    operatorRef:'iwxa:operator',cloudAgreement:agreement});
  assert.throws(()=>openT4OperatorConnection({profile:p,placementPolicy:policy,
    getMode:()=> 'T4_NETWORK',authorize:async()=>true,getAuthorizationHeader:async()=> 'Bearer example'}),
    code('ORIGINAL_OWNER_AGREEMENT_PORT_REQUIRED'));
});

test('unverified IWXA operator endpoint is rejected before network access',async()=>{
  const p=createT4NetworkConnectionProfile({...profileData,mode:'IWXA_CLOUD',
    operatorRef:'iwxa:operator',cloudAgreement:agreement});
  let network=0;
  const b=Buffer.from('not-sent');
  const ctx=openT4OperatorConnection({profile:p,placementPolicy:policy,getMode:()=> 'T4_NETWORK',
    authorize:async()=>true,getAuthorizationHeader:async()=> 'Bearer example',
    verifyOperatorEndpoint:async()=>false,verifyOriginalOwnerAgreement:async()=>true,
    fetchImpl:async()=>{network++;return new Response(b,{status:200});}});
  await assert.rejects(ctx.transport.getSnapshot({key:packageSha256(b)+'.iwxa',
    expectedSha256:packageSha256(b)}),e=>e.code==='AUTHORIZATION_DENIED');
  assert.equal(network,0);
  ctx.close();
});
test('IWXA cloud requires an operator endpoint verifier, not just a claimed operator ID',()=>{
  const p=createT4NetworkConnectionProfile({...profileData,mode:'IWXA_CLOUD',
    operatorRef:'iwxa:operator',cloudAgreement:agreement});
  assert.throws(()=>openT4OperatorConnection({profile:p,placementPolicy:policy,
    getMode:()=> 'T4_NETWORK',authorize:async()=>true,
    getAuthorizationHeader:async()=> 'Bearer example',
    verifyOriginalOwnerAgreement:async()=>true}),
    code('IWXA_OPERATOR_ENDPOINT_VERIFIER_REQUIRED'));
});
