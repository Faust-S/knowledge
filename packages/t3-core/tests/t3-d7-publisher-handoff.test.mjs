import test from "node:test";
import assert from "node:assert/strict";
import {createTrustedPublisherHandoff} from "../src/t3/publisher-license-handoff.mjs";

// Public adapter fixture, not a Publisher signature, status issuer, Windows
// credential, native user installation or production trust proof.
function fixture(){
  let permit=true,epoch=1,consent=true,loseAck=false,applies=0,active=true;
  const records=new Map();
  const ctx=()=>({kind:"PERSONAL",context_id:"local:me",actor_id:"person:owner",
    principal_id:"person:owner",role_id:"role:owner",grant_id:"grant:owner",
    realm_id:"realm:local",audience:"service:demo",resource:"ws:me",
    purpose:"read",workspace_id:"ws:me",organization_id:null,scope_revision:epoch});
  const access={currentContext:ctx,actionFor:()=>"workspace.read",
    operationDigest:()=>"a".repeat(64),
    authorize:()=>({schema:"IWXA_T3_AUTHORIZATION_DECISION/1",
      allowed:permit,outcome:permit?"PERMITTED":"DENIED",evidenceOnly:true,
      requestDigest:"b".repeat(64),policyDigest:"c".repeat(64),
      statusSequence:1,validUntil:new Date(Date.now()+60000).toISOString(),
      evaluatedAt:new Date().toISOString(),statusObservedAt:new Date().toISOString(),
      authorityPath:[{grantId:"grant:owner"}]}),
    verifyDecisionBinding:()=>true};
  const kernel={sessionInfo:{contract_version:"1.3.0"},
    hasOperation:x=>x==="t1.getWorkspace",
    async getWorkspace(id){return {workspace_id:id,deleted_at:null};}};
  const expectedId="a".repeat(64),previewDigest="b".repeat(64);
  const nativeHolder={
    async subjectForContext(context){
      assert.equal(context.workspace_id,"ws:me");
      return {holderId:"holder:os:me",recipientId:"recipient:me",
        subjectType:"PERSON"};
    },
    inspect:({kind,packageSha256})=>({
      kind,packageSha256,previewDigest,
      holderId:"holder:os:me",recipientId:"recipient:me",
      publisherId:"publisher:original",issuerAuthorityId:"issuer:original",
      operationId:kind==="LICENSE"?"operation:license":"operation:status",
      licenseId:"license:one",sequence:kind==="STATUS"?7:null,
      targetStatus:kind==="STATUS"?"REVOKED":null,
      publisherSignatureVerified:true,pinnedPublisherTrusted:true,
      stage:records.has(kind)?"RECOVER_ONLY":"READY",
    }),
    apply:async input=>{
      applies++;
      records.set(input.kind,{
        kind:input.kind,operationId:input.operationId,
        packageSha256:input.packageSha256,holderId:"holder:os:me",
        recipientId:"recipient:me",issuerAuthorityId:"issuer:original",
        state:"COMMITTED",licenseId:"license:one",
        sequence:input.kind==="STATUS"?7:null,
        targetStatus:input.kind==="STATUS"?"REVOKED":null,
      });
      if(loseAck)throw Error("ACK_LOST");
    },
    receipt:async q=>records.get(q.kind)??null,
    statusReadback:async q=>{
      const row=records.get(q.kind);return row?{...row,persisted:true}:null;
    },
  };
  const create=()=>createTrustedPublisherHandoff({
    kernel,accessForRead:async()=>access,nativeHolder,
    confirmHuman:async()=>consent,isHostActive:()=>active});
  return {create,nativeHolder,expectedId,previewDigest,applies:()=>applies,
    deny:()=>{permit=false;},switchContext:()=>{epoch++;},
    loseAck:()=>{loseAck=true;},cancel:()=>{consent=false;},
    dispose:()=>{active=false;}};
}
function file(){return Uint8Array.of(0x50,0x4b,3,4,1,2,3,4);}
test("D7 signed original Publisher LICENSE then terminal STATUS have independent durable readback",async()=>{
  const f=fixture(),port=f.create(),archiveBytes=file();
  const license=await port.preview({kind:"LICENSE",archiveBytes});
  assert.equal(license.status,"VERIFIED_PENDING_CONSENT");
  assert.equal(license.holderId,"holder:os:me");
  assert.equal(license.entitlementActivated,false);
  const got=await port.admit({kind:"LICENSE",archiveBytes,
    previewDigest:license.previewDigest});
  assert.equal(got.status,"ORIGINAL_HOLDER_READBACK_CONFIRMED");
  assert.equal(got.dataAccessAuthorized,false);
  const status=await port.preview({kind:"STATUS",archiveBytes});
  const revoked=await port.admit({kind:"STATUS",archiveBytes,
    previewDigest:status.previewDigest});
  assert.equal(revoked.status,"ORIGINAL_HOLDER_READBACK_CONFIRMED");
  assert.equal(revoked.targetStatus,"REVOKED");
  assert.equal(revoked.sequence,7);
  assert.equal(f.applies(),2);
  // Cold host reopen recovers old original owner receipts, without mutation.
  const cold=f.create();
  assert.equal((await cold.recover({kind:"STATUS",archiveBytes})).status,
    "ORIGINAL_HOLDER_READBACK_CONFIRMED");
  assert.equal(f.applies(),2);
});
test("D7 Publisher denial, changed scope and lost native ACK block automatic replay",async()=>{
  const f=fixture(),port=f.create(),archiveBytes=file();
  const prev=await port.preview({kind:"LICENSE",archiveBytes});
  await assert.rejects(port.admit({kind:"LICENSE",archiveBytes,
    previewDigest:"f".repeat(64)}),{code:"T3_D7_PUBLISHER_PREVIEW_CHANGED"});
  f.cancel();
  assert.equal((await port.admit({kind:"LICENSE",archiveBytes,
    previewDigest:prev.previewDigest})).status,"USER_CANCELLED");
  assert.equal(f.applies(),0);
  const z=fixture(),p=z.create(),p0=await p.preview({kind:"LICENSE",archiveBytes});
  z.nativeHolder.inspect=async input=>{
    z.switchContext();
    return {kind:"LICENSE",packageSha256:input.packageSha256,
      previewDigest:p0.previewDigest,holderId:"holder:os:me",
      recipientId:"recipient:me",publisherId:"publisher:original",
      issuerAuthorityId:"issuer:original",operationId:"operation:license",
      licenseId:"license:one",stage:"READY",
      publisherSignatureVerified:true,pinnedPublisherTrusted:true};
  };
  await assert.rejects(p.admit({kind:"LICENSE",archiveBytes,
    previewDigest:p0.previewDigest}),{code:"T3_D7_SIGNED_CONTEXT_CHANGED"});
  assert.equal(z.applies(),0);
  const l=fixture(),lp=l.create(),pro=await lp.preview({kind:"LICENSE",archiveBytes});
  l.loseAck();
  assert.equal((await lp.admit({kind:"LICENSE",archiveBytes,
    previewDigest:pro.previewDigest})).status,"OUTCOME_UNKNOWN");
  assert.equal(l.applies(),1);
  assert.equal((await lp.admit({kind:"LICENSE",archiveBytes,
    previewDigest:pro.previewDigest})).status,"OUTCOME_UNKNOWN");
  assert.equal(l.applies(),1);
  assert.equal((await l.create().recover({kind:"LICENSE",archiveBytes})).status,
    "ORIGINAL_HOLDER_READBACK_CONFIRMED");
  l.deny();
  await assert.rejects(lp.preview({kind:"STATUS",archiveBytes}),
    {code:"T3_ACCESS_NOT_PERMITTED"});
});
