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
  let confirmGate=null,enterConfirm=null,confirmCount=0;
  let scope=fullScope(),entries=fullEntries(),payloadDigest="c".repeat(64);
  let floor=7,inspectAlwaysReady=false;
  let receiptHook=null,readbackHook=null;
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
      stage:records.has(kind)&&!inspectAlwaysReady?"RECOVER_ONLY":"READY",
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
    receipt:async q=>{
      if(receiptHook!==null)await receiptHook();
      return records.get(q.kind)??null;
    },
    statusReadback:async q=>{
      if(readbackHook!==null)await readbackHook();
      const row=records.get(q.kind);
      return row?{...row,persisted:true,statusSequenceFloor:floor}:null;
    },
  };
  const create=()=>createTrustedPublisherHandoff({
    kernel,accessForRead:async()=>access,nativeHolder,
    confirmHuman:async()=>{confirmCount++;enterConfirm?.();if(confirmGate)await confirmGate;return consent;},
    isHostActive:()=>active});
  return {create,nativeHolder,applies:()=>applies,confirmations:()=>confirmCount,previewDigest,
    deny:()=>{permit=false;},switchContext:()=>{epoch++;},
    loseAck:()=>{loseAck=true;},cancel:()=>{consent=false;},
    dispose:()=>{active=false;},
    useStatus:(nextScope,nextEntries,nextDigest="d".repeat(64))=>{
      scope=nextScope;entries=nextEntries;payloadDigest=nextDigest;
    },
    useFloor:n=>{floor=n;},
    setInspectAlwaysReady:()=>{inspectAlwaysReady=true;},
    onReceipt:fn=>{receiptHook=fn;},
    onReadback:fn=>{readbackHook=fn;},
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
test("D7 cold restart checks original receipt before applying an already committed licence",async()=>{
  const f=fixture(),archiveBytes=file();
  f.loseAck();
  const first=f.create();
  const preview=await first.preview({kind:"LICENSE",archiveBytes});
  assert.equal((await first.admit({kind:"LICENSE",archiveBytes,
    previewDigest:preview.previewDigest})).status,"OUTCOME_UNKNOWN");
  assert.equal(f.applies(),1);
  const approvedCount=f.confirmations();
  f.setInspectAlwaysReady();
  const second=f.create(),fresh=await second.preview({kind:"LICENSE",archiveBytes});
  assert.equal(fresh.status,"RECOVER_ONLY");
  assert.equal((await second.admit({kind:"LICENSE",archiveBytes,
    previewDigest:fresh.previewDigest})).status,"ORIGINAL_HOLDER_READBACK_CONFIRMED");
  const third=f.create();
  assert.equal((await third.admit({kind:"LICENSE",archiveBytes,
    previewDigest:fresh.previewDigest})).status,"ORIGINAL_HOLDER_READBACK_CONFIRMED");
  assert.equal(f.applies(),1);
  assert.equal(f.confirmations(),approvedCount);
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
  l.setInspectAlwaysReady();
  assert.equal((await lp.preview({kind:"LICENSE",archiveBytes})).status,
    "RECOVER_ONLY");
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
  assert.equal((await port.preview({kind:"STATUS",archiveBytes})).status,
    "OPERATION_IN_PROGRESS");
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

test("D7 Publisher refuses signed context changes, not native recovery uncertainty",async()=>{
  const archiveBytes=file();
  // Change in the signed D1 context during the first original receipt probe.
  const pre=fixture(),port=pre.create();
  const preview=await port.preview({kind:"LICENSE",archiveBytes});
  pre.onReceipt(()=>pre.switchContext());
  await assert.rejects(port.admit({kind:"LICENSE",archiveBytes,
    previewDigest:preview.previewDigest}),{code:"T3_D7_SIGNED_CONTEXT_CHANGED"});
  assert.equal(pre.applies(),0);

  // The second probe runs AFTER explicit Human consent and fresh inspection.
  const post=fixture(),other=post.create();
  const next=await other.preview({kind:"LICENSE",archiveBytes});
  let probes=0;
  post.onReceipt(()=>{if(++probes===2)post.switchContext();});
  await assert.rejects(other.admit({kind:"LICENSE",archiveBytes,
    previewDigest:next.previewDigest}),{code:"T3_D7_SIGNED_CONTEXT_CHANGED"});
  assert.equal(post.applies(),0);

  // Installed holder already committed; cold read-only recovery must not
  // swallow a signed context change, even if native receipt becomes unavailable.
  const cold=fixture(),owner=cold.create();
  const p=await owner.preview({kind:"LICENSE",archiveBytes});
  assert.equal((await owner.admit({kind:"LICENSE",archiveBytes,
    previewDigest:p.previewDigest})).status,"ORIGINAL_HOLDER_READBACK_CONFIRMED");
  cold.onReceipt(()=>{cold.switchContext();throw Error("NATIVE_RECEIPT_OFFLINE");});
  await assert.rejects(cold.create().recover({kind:"LICENSE",archiveBytes}),
    {code:"T3_D7_SIGNED_CONTEXT_CHANGED"});
  assert.equal(cold.applies(),1);

  // With original access unchanged, an offline native readback is UNKNOWN;
  // it never sends another LICENSE/STATUS mutation.
  const unavailable=fixture(),first=unavailable.create();
  const one=await first.preview({kind:"LICENSE",archiveBytes});
  assert.equal((await first.admit({kind:"LICENSE",archiveBytes,
    previewDigest:one.previewDigest})).status,"ORIGINAL_HOLDER_READBACK_CONFIRMED");
  unavailable.onReadback(()=>{throw Error("NATIVE_STATUS_READBACK_OFFLINE");});
  assert.equal((await unavailable.create().recover({kind:"LICENSE",archiveBytes})).status,
    "OUTCOME_UNKNOWN");
  assert.equal(unavailable.applies(),1);
});

test("D7 signed denial AFTER original holder APPLY is not unknown",async()=>{
  const f=fixture(),archiveBytes=file(),port=f.create();
  const preview=await port.preview({kind:"LICENSE",archiveBytes});
  const original=f.nativeHolder.statusReadback;
  f.nativeHolder.statusReadback=async query=>{
    const saved=await original(query);
    f.switchContext();
    return saved;
  };
  await assert.rejects(port.admit({kind:"LICENSE",archiveBytes,
    previewDigest:preview.previewDigest}),
    {code:"T3_D7_SIGNED_CONTEXT_CHANGED"});
  assert.equal(f.applies(),1);
  f.nativeHolder.statusReadback=original;
  // Cold recovery reads the already-persisted LICENSE; it does not Apply.
  assert.equal((await f.create().recover({kind:"LICENSE",archiveBytes})).status,
    "ORIGINAL_HOLDER_READBACK_CONFIRMED");
  assert.equal(f.applies(),1);
});

test("D7 original native issuer refusal stays DENIED, not lost-readback UNKNOWN",async()=>{
  const archiveBytes=file();
  const revoked=fixture(),port=revoked.create();
  const preview=await port.preview({kind:"LICENSE",archiveBytes});
  revoked.onReceipt(()=>{
    throw Object.assign(Error("native issuer refused read"),{
      code:"PERMISSION_DENIED",outcome:"DENIED",
    });
  });
  await assert.rejects(port.admit({kind:"LICENSE",archiveBytes,
    previewDigest:preview.previewDigest}),{
      code:"PERMISSION_DENIED",outcome:"DENIED",
  });
  assert.equal(revoked.applies(),0);
  assert.equal(revoked.confirmations(),0);

  const status=fixture(),owner=status.create();
  const planned=await owner.preview({kind:"STATUS",archiveBytes});
  const saved=await owner.admit({kind:"STATUS",archiveBytes,
    previewDigest:planned.previewDigest});
  assert.equal(saved.status,"ORIGINAL_HOLDER_READBACK_CONFIRMED");
  status.onReadback(()=>{
    throw Object.assign(Error("original signed status rollback"),{
      code:"PERSON_STATUS_ROLLBACK_DENIED",
    });
  });
  await assert.rejects(status.create().recover({kind:"STATUS",archiveBytes}),{
    code:"PERSON_STATUS_ROLLBACK_DENIED",
  });
  assert.equal(status.applies(),1);
});

test("D7 keeps PERSON product STATUS/2 separate from scoped status and persists original native receipt",async()=>{
  const f=fixture(),original=f.nativeHolder.inspect;
  f.nativeHolder.inspect=params=>{
    const raw=original(params);
    if(params.kind!=="STATUS")return raw;
    const {scope,entries,...verified}=raw;
    return {...verified,statusSchema:"IWXA_T3_PRODUCT_LICENSE_STATUS/2",
      personId:"holder:os:me",productId:"IWXA_ATLAS",
      statusState:"REVOKED",
      statusValidUntil:"2026-11-18T00:00:00.000Z"};
  };
  const port=f.create(),archiveBytes=file();
  const preview=await port.preview({kind:"STATUS",archiveBytes});
  assert.equal(preview.statusFamily,"PERSON_PRODUCT_STATUS/2");
  assert.equal(preview.productId,"IWXA_ATLAS");
  assert.equal(preview.statusState,"REVOKED");
  assert.equal(preview.statusScope,null);
  assert.equal(preview.statusEntries,null);
  assert.equal(preview.dataAccessAuthorized,false);
  const saved=await port.admit({kind:"STATUS",archiveBytes,
    previewDigest:preview.previewDigest});
  assert.equal(saved.status,"ORIGINAL_HOLDER_READBACK_CONFIRMED");
  assert.equal(saved.statusFamily,"PERSON_PRODUCT_STATUS/2");
  assert.equal(saved.sequence,7);
  assert.equal(saved.entitlementActivated,false);
  assert.equal((await f.create().recover({kind:"STATUS",archiveBytes})).status,
    "ORIGINAL_HOLDER_READBACK_CONFIRMED");
  assert.equal(f.applies(),1);
});
test("D7 signed PERSON STATUS refuses alien holder, product, invented scope and unsigned state",async()=>{
  for(const change of [
    {personId:"person:alien"},{productId:"IWXA_ADMIN_CENTER"},
    {statusState:"SUPERSEDED"},{statusPayloadDigest:"wrong"},
    {scope:fullScope()}
  ]){
    const f=fixture(),original=f.nativeHolder.inspect;
    f.nativeHolder.inspect=params=>{
      const raw=original(params);
      if(params.kind!=="STATUS")return raw;
      const {scope,entries,...verified}=raw;
      return {...verified,statusSchema:"IWXA_T3_PRODUCT_LICENSE_STATUS/2",
        personId:"holder:os:me",productId:"IWXA_ATLAS",
        statusState:"ACTIVE",
        statusValidUntil:"2026-11-18T00:00:00.000Z",
        ...change};
    };
    await assert.rejects(f.create().preview({kind:"STATUS",archiveBytes:file()}),
      {code:"T3_D7_PERSON_ORIGINAL_SIGNED_STATUS_REQUIRED"});
    assert.equal(f.applies(),0);
  }
});

test("D7 accepts original corporate STATUS/3 only for the independently installed organization holder",async()=>{
  const f=fixture();
  f.nativeHolder.currentSubject=async()=>({
    holderId:"holder:windows:factory",recipientId:"org:factory",
    subjectType:"ORGANIZATION",bindingEpoch:"epoch:1"
  });
  const existing=f.nativeHolder.inspect;
  f.nativeHolder.inspect=async input=>({
    ...(await existing(input)),
    holderId:"holder:windows:factory",recipientId:"org:factory",
    ...(input.kind==="STATUS"?{
      statusSchema:"IWXA_T3_PRODUCT_LICENSE_STATUS/3",
      statusPayloadDigest:"d".repeat(64),
      organizationId:"org:factory",productId:"IWXA_ADMIN_CENTER",
      statusState:"ACTIVE",sequence:7,
      statusValidUntil:"2026-12-01T00:00:00.000Z",
      scope:undefined,entries:undefined,
    }:{})
  });
  const preview=await f.create().preview({kind:"STATUS",archiveBytes:file()});
  assert.equal(preview.statusFamily,"CORPORATE_PRODUCT_STATUS/3");
  assert.equal(preview.productId,"IWXA_ADMIN_CENTER");
  assert.equal(preview.statusState,"ACTIVE");
  assert.equal(preview.entitlementActivated,false);
  assert.equal(preview.dataAccessAuthorized,false);
  // A changed organization cannot repurpose the same signed corporate status.
  const first=f.nativeHolder.inspect;
  f.nativeHolder.inspect=async input=>({
    ...(await first(input)),organizationId:"org:other"
  });
  await assert.rejects(f.create().preview({kind:"STATUS",archiveBytes:file()}),{
    code:"T3_D7_CORPORATE_ORIGINAL_SIGNED_STATUS_REQUIRED"
  });
});
test("D7 corporate STATUS/3 never accepts PERSON holder or TEST/1 status as production",async()=>{
 const f=fixture();
 f.nativeHolder.currentSubject=async()=>({
   holderId:"holder:os:me",recipientId:"org:factory",
   subjectType:"PERSON",bindingEpoch:"epoch:1"
 });
 const original=f.nativeHolder.inspect;
 f.nativeHolder.inspect=async input=>({
   ...(await original(input)),recipientId:"org:factory",
   organizationId:"org:factory",
   statusSchema:"IWXA_T3_PRODUCT_LICENSE_STATUS/3",
   productId:"IWXA_ADMIN_CENTER",statusState:"ACTIVE",sequence:7,
   statusValidUntil:"2026-12-01T00:00:00.000Z",
   scope:undefined,entries:undefined
 });
 await assert.rejects(f.create().preview({kind:"STATUS",archiveBytes:file()}),{
   code:"T3_D7_CORPORATE_ORIGINAL_SIGNED_STATUS_REQUIRED"
 });
 f.nativeHolder.currentSubject=async()=>({
   holderId:"holder:windows:factory",recipientId:"org:factory",
   subjectType:"ORGANIZATION",bindingEpoch:"epoch:1"
 });
 f.nativeHolder.inspect=async input=>({
   ...(await original(input)),holderId:"holder:windows:factory",
   recipientId:"org:factory",organizationId:"org:factory",
   statusSchema:"IWXA_T3_PRODUCT_LICENSE_STATUS/1",
   productId:"IWXA_ADMIN_CENTER",statusState:"ACTIVE",sequence:7,
   statusValidUntil:"2026-12-01T00:00:00.000Z",
   scope:undefined,entries:undefined
 });
 await assert.rejects(f.create().preview({kind:"STATUS",archiveBytes:file()}),{
   code:"T3_D7_PUBLISHER_SIGNED_STATUS_REQUIRED"
 });
});
