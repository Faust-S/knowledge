import test from "node:test";
import assert from "node:assert/strict";
import {createTrustedPublisherHandoff} from "../src/t3/publisher-license-handoff.mjs";

// Adapter-only fixture: no production Publisher signatures, OS keys or
// installed recipient. The REAL /2 status schema is multi-entry/scoped.
const at="2026-11-14T12:00:00.000Z";
const statusEntry=(name,state)=>({
  licenseId:"license:"+name,lineageId:"lineage:one",state,
  effectiveAt:at,evidenceRef:"evidence:"+name,
});
const fullEntries=()=>[statusEntry("a","REVOKED"),statusEntry("b","SUSPENDED")];
const fullScope=()=>({mode:"FULL_HOLDER_SNAPSHOT",lineageId:null,licenseIds:[]});
const file=()=>Uint8Array.of(0x50,0x4b,3,4,1,2,3,4);
function fixture(){
  let permit=true,epoch=1,consent=true,loseAck=false,applies=0,active=true;
  let confirmGate=null,enterConfirm=null;
  let scope=fullScope(),entries=fullEntries(),payloadDigest="c".repeat(64);
  let floor=7;
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
  const previewDigest="b".repeat(64);
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
      ...(kind==="STATUS"?{
        statusSchema:"IWXA_T3_LICENSE_STATUS/2",
        statusPayloadDigest:payloadDigest,
        scope:structuredClone(scope),entries:structuredClone(entries),
      }:{}),
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
        statusPayloadDigest:input.kind==="STATUS"?payloadDigest:null,
      });
      if(loseAck)throw Error("ACK_LOST");
    },
    receipt:async q=>records.get(q.kind)??null,
    statusReadback:async q=>{
      const row=records.get(q.kind);
      return row?{...row,persisted:true,statusSequenceFloor:floor}:null;
    },
  };
  const create=()=>createTrustedPublisherHandoff({
    kernel,accessForRead:async()=>access,nativeHolder,
    confirmHuman:async()=>{enterConfirm?.();if(confirmGate)await confirmGate;return consent;},
    isHostActive:()=>active});
  return {create,nativeHolder,applies:()=>applies,previewDigest,
    deny:()=>{permit=false;},switchContext:()=>{epoch++;},
    loseAck:()=>{loseAck=true;},cancel:()=>{consent=false;},
    dispose:()=>{active=false;},
    useStatus:(nextScope,nextEntries,nextDigest="d".repeat(64))=>{
      scope=nextScope;entries=nextEntries;payloadDigest=nextDigest;
    },
    useFloor:n=>{floor=n;},
    pauseConsent:()=>{
      let release,entered;
      const started=new Promise(resolve=>{entered=resolve;});
      confirmGate=new Promise(resolve=>{release=resolve;});
      enterConfirm=entered;
      return {started,release};
    },
  };
}
test("D7 original LICENSE then multi-entry holder STATUS persist with exact readback and cold recovery",async()=>{
  const f=fixture(),port=f.create(),archiveBytes=file();
  const license=await port.preview({kind:"LICENSE",archiveBytes});
  assert.equal(license.status,"VERIFIED_PENDING_CONSENT");
  assert.equal(license.entitlementActivated,false);
  const got=await port.admit({kind:"LICENSE",archiveBytes,
    previewDigest:license.previewDigest});
  assert.equal(got.status,"ORIGINAL_HOLDER_READBACK_CONFIRMED");
  assert.equal(got.dataAccessAuthorized,false);
  const status=await port.preview({kind:"STATUS",archiveBytes});
  assert.equal(status.statusScope.mode,"FULL_HOLDER_SNAPSHOT");
  assert.deepEqual(status.statusEntries.map(x=>x.state),["REVOKED","SUSPENDED"]);
  assert.equal(status.statusPayloadDigest,"c".repeat(64));
  const delivered=await port.admit({kind:"STATUS",archiveBytes,
    previewDigest:status.previewDigest});
  assert.equal(delivered.status,"ORIGINAL_HOLDER_READBACK_CONFIRMED");
  assert.equal(delivered.sequence,7);
  assert.equal(delivered.statusEntries.length,2);
  assert.equal(f.applies(),2);
  assert.equal((await f.create().recover({kind:"STATUS",archiveBytes})).status,
    "ORIGINAL_HOLDER_READBACK_CONFIRMED");
  assert.equal(f.applies(),2);
});
test("D7 scoped selective, tombstone and empty FULL status are not reduced to single license",async()=>{
  for(const [scope,entries] of [
    [fullScope(),[]],
    [{mode:"SELECTIVE_DELTA",lineageId:null,
      licenseIds:["license:a","license:b"]},fullEntries()],
    [{mode:"TOMBSTONE_EVENT",lineageId:"lineage:one",licenseIds:[]},
      [statusEntry("a","REVOKED"),statusEntry("b","SUPERSEDED")]],
  ]){
    const f=fixture(),port=f.create(),archiveBytes=file();
    f.useStatus(scope,entries);
    const preview=await port.preview({kind:"STATUS",archiveBytes});
    assert.equal(preview.statusScope.mode,scope.mode);
    assert.equal(preview.statusEntries.length,entries.length);
    const receipt=await port.admit({kind:"STATUS",archiveBytes,
      previewDigest:preview.previewDigest});
    assert.equal(receipt.status,"ORIGINAL_HOLDER_READBACK_CONFIRMED");
    assert.equal(receipt.statusEntries.length,entries.length);
    assert.equal(f.applies(),1);
  }
  const bad=fixture();
  bad.useStatus({mode:"TOMBSTONE_EVENT",lineageId:"lineage:one",
    licenseIds:[]},[statusEntry("a","ACTIVE")]);
  await assert.rejects(bad.create().preview({kind:"STATUS",archiveBytes:file()}),
    {code:"T3_D7_PUBLISHER_STATUS_ENTRY_INVALID"});
});
test("D7 signed status readback must match ORIGINAL payload digest and local sequence floor",async()=>{
  const f=fixture(),port=f.create(),archiveBytes=file();
  const preview=await port.preview({kind:"STATUS",archiveBytes});
  f.useFloor(6);
  assert.equal((await port.admit({kind:"STATUS",archiveBytes,
    previewDigest:preview.previewDigest})).status,"OUTCOME_UNKNOWN");
  assert.equal(f.applies(),1);
  f.useFloor(7);
  assert.equal((await port.recover({kind:"STATUS",archiveBytes})).status,
    "ORIGINAL_HOLDER_READBACK_CONFIRMED");
});
test("D7 Publisher denial, changed context and lost ACK block automatic replay",async()=>{
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
test("D7 concurrent apply calls for the same receipt cannot dispatch twice",async()=>{
  const f=fixture(),port=f.create(),archiveBytes=file();
  const preview=await port.preview({kind:"STATUS",archiveBytes});
  const gate=f.pauseConsent();
  const first=port.admit({kind:"STATUS",archiveBytes,
    previewDigest:preview.previewDigest});
  await gate.started;
  const second=await port.admit({kind:"STATUS",archiveBytes,
    previewDigest:preview.previewDigest});
  assert.equal(second.status,"OPERATION_IN_PROGRESS");
  assert.equal(f.applies(),0);
  gate.release();
  assert.equal((await first).status,"ORIGINAL_HOLDER_READBACK_CONFIRMED");
  assert.equal(f.applies(),1);
});

test("D7 native Publisher licence works before a Workspace or signed D1 data grant exists",async()=>{
  const f=fixture(),archiveBytes=file();
  let nativeEpoch="native:epoch:1";
  // A real compiled product supplies this method from the original
  // installed holder (not from the UI or the downloaded .iwxa package).
  f.nativeHolder.subjectForContext=undefined;
  f.nativeHolder.currentSubject=async()=>({
    holderId:"holder:os:me",recipientId:"recipient:me",
    subjectType:"PERSON",bindingEpoch:nativeEpoch,
  });
  // Deliberately omit BOTH the Kernel and signed D1 Access. This is the
  // first-install route, not an alternative right to workspace data.
  const create=()=>createTrustedPublisherHandoff({
    nativeHolder:f.nativeHolder,
    confirmHuman:async()=>true,isHostActive:()=>true,
  });
  const port=create();
  const licence=await port.preview({kind:"LICENSE",archiveBytes});
  assert.equal(licence.status,"VERIFIED_PENDING_CONSENT");
  assert.equal(licence.dataAccessAuthorized,false);
  assert.equal(licence.holderId,"holder:os:me");
  const applied=await port.admit({kind:"LICENSE",archiveBytes,
    previewDigest:licence.previewDigest});
  assert.equal(applied.status,"ORIGINAL_HOLDER_READBACK_CONFIRMED");
  assert.equal(applied.entitlementActivated,false);
  assert.equal(f.applies(),1);
  // A second cold-opened Host recovers the SAME original native receipt.
  assert.equal((await create().recover({kind:"LICENSE",archiveBytes})).status,
    "ORIGINAL_HOLDER_READBACK_CONFIRMED");
  assert.equal(f.applies(),1);
  nativeEpoch="native:epoch:2";
  const next=await create().preview({kind:"STATUS",archiveBytes});
  assert.equal(next.status,"VERIFIED_PENDING_CONSENT");
});

test("D7 native Publisher refuses changed OS holder during human decision",async()=>{
  const f=fixture(),archiveBytes=file();
  let nativeEpoch="native:epoch:1";
  f.nativeHolder.subjectForContext=undefined;
  f.nativeHolder.currentSubject=async()=>({
    holderId:"holder:os:me",recipientId:"recipient:me",
    subjectType:"ORGANIZATION",bindingEpoch:nativeEpoch,
  });
  const port=createTrustedPublisherHandoff({
    nativeHolder:f.nativeHolder,isHostActive:()=>true,
    confirmHuman:async()=>{nativeEpoch="native:epoch:2";return true;},
  });
  const inspected=await port.preview({kind:"STATUS",archiveBytes});
  await assert.rejects(port.admit({kind:"STATUS",archiveBytes,
    previewDigest:inspected.previewDigest}),
    {code:"T3_D7_ORIGINAL_NATIVE_HOLDER_CHANGED"});
  assert.equal(f.applies(),0);
  f.nativeHolder.currentSubject=async()=>({
    holderId:"holder:os:me",recipientId:"recipient:me",
    subjectType:"ORGANIZATION",bindingEpoch:"",
  });
  await assert.rejects(port.preview({kind:"LICENSE",archiveBytes}),
    {code:"T3_D7_ORIGINAL_NATIVE_HOLDER_UNBOUND"});
});
