import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createWebDavPackageTransport, packageSha256 } from '../../src/network/webdav-package-transfer.mjs';
import {createT4OriginalExchangeHandoff} from '../../src/network/original-exchange-handoff.mjs';
const baseUrl=process.env.T4_TEST_URL,auth=process.env.T4_TEST_AUTH;
const policy={objectFamily:'owner-exported-package',workspaceId:'test-person-a',authorityRoot:'original-owner-a',writeOwnerRef:'original-exchange-a',primaryPlacement:'LOCAL_PRIMARY_HOSTED_REPLICA',allowedLocations:['test-webdav'],retentionClass:'test',recoveryClass:'test',universalCloudMaster:false,subjectActionAuthority:false};
let serial=0;
// Opaque transport fixtures, not original signed .iwxa archives.
const bytes=(label='sample')=>Buffer.from(`opaque-owner-fixture:${process.pid}:${++serial}:${label}\n`);
const cfg=(delta={})=>({baseUrl,locationRef:'test-webdav',placementPolicy:policy,getMode:()=> 'T4_NETWORK',authorize:async()=>true,getAuthorizationHeader:async()=>auth,...delta});
const sample=(b,extra={})=>({key:`${packageSha256(b)}.iwxa`,bytes:b,expectedSha256:packageSha256(b),createOnly:true,...extra});
const ec=(code)=>(e)=>{assert.equal(e.code,code);return true;};
if(!baseUrl||!auth) throw Error('Use scripts/qualify_webdav.py');
test('real Apache HTTPS PUT and verified GET',async()=>{const t=createWebDavPackageTransport(cfg()),b=bytes();const r=await t.putSnapshot(sample(b));assert.equal(r.state,'PUBLISHED_AND_READ_BACK');assert.equal(r.workspaceApplied,false);assert.deepEqual((await t.getSnapshot({key:r.key,expectedSha256:r.sha256})).bytes,b);t.close();});
test('existing snapshot is verified without overwrite',async()=>{const t=createWebDavPackageTransport(cfg()),b=bytes();await t.putSnapshot(sample(b));assert.equal((await t.putSnapshot(sample(b))).state,'ALREADY_PRESENT_VERIFIED');t.close();});
test('two revisions retain independent snapshots',async()=>{const t=createWebDavPackageTransport(cfg()),a=bytes('v1'),b=bytes('v2');const ra=await t.putSnapshot(sample(a)),rb=await t.putSnapshot(sample(b));assert.notEqual(ra.key,rb.key);assert.deepEqual((await t.getSnapshot({key:ra.key,expectedSha256:ra.sha256})).bytes,a);t.close();});
test('concurrent equal-content uploads preserve bytes',async()=>{const a=createWebDavPackageTransport(cfg()),b=createWebDavPackageTransport(cfg()),data=bytes('concurrent');const rs=await Promise.all([a.putSnapshot(sample(data)),b.putSnapshot(sample(data))]);assert.equal(rs[0].sha256,rs[1].sha256);assert.deepEqual((await b.getSnapshot({key:rs[0].key,expectedSha256:rs[0].sha256})).bytes,data);a.close();b.close();});
test('different content cannot reuse immutable key',async()=>{const t=createWebDavPackageTransport(cfg()),a=bytes(),b=bytes();await assert.rejects(t.putSnapshot(sample(b,{key:sample(a).key})),ec('DIGEST_KEY_REQUIRED'));t.close();});
test('mutable overwrite is not implemented',async()=>{const t=createWebDavPackageTransport(cfg());await assert.rejects(t.putSnapshot(sample(bytes(),{createOnly:false,expectedETag:'"x"'})),ec('IMMUTABLE_WRITE_REQUIRED'));t.close();});
test('LOCAL_ONLY makes zero requests',async()=>{let n=0;const t=createWebDavPackageTransport(cfg({getMode:()=> 'LOCAL_ONLY',fetchImpl:()=>{n++;}}));await assert.rejects(t.putSnapshot(sample(bytes())),ec('NETWORK_NOT_PERMITTED'));assert.equal(n,0);t.close();});
test('mode rechecked after asynchronous credentials',async()=>{let mode='T4_NETWORK',n=0;const t=createWebDavPackageTransport(cfg({getMode:()=>mode,getAuthorizationHeader:async()=>{mode='LOCAL_ONLY';return auth;},fetchImpl:()=>{n++;}}));await assert.rejects(t.putSnapshot(sample(bytes())),ec('NETWORK_NOT_PERMITTED'));assert.equal(n,0);t.close();});
test('authorization denial makes zero requests',async()=>{let n=0;const t=createWebDavPackageTransport(cfg({authorize:async()=>false,fetchImpl:()=>{n++;}}));await assert.rejects(t.putSnapshot(sample(bytes())),ec('AUTHORIZATION_DENIED'));assert.equal(n,0);t.close();});
test('LOCAL_ONLY placement cannot be upgraded',async()=>{const t=createWebDavPackageTransport(cfg({placementPolicy:{...policy,primaryPlacement:'LOCAL_ONLY'}}));await assert.rejects(t.putSnapshot(sample(bytes())),ec('NETWORK_NOT_PERMITTED'));t.close();});
test('real Apache denies invalid credentials',async()=>{const t=createWebDavPackageTransport(cfg({getAuthorizationHeader:()=> 'Basic eDpiYWQ='}));await assert.rejects(t.putSnapshot(sample(bytes())),ec('REMOTE_AUTHORIZATION_DENIED'));t.close();});
test('real Apache separates two authenticated users',async()=>{const t=createWebDavPackageTransport(cfg({getAuthorizationHeader:()=>process.env.T4_TEST_OTHER_AUTH}));await assert.rejects(t.putSnapshot(sample(bytes())),ec('REMOTE_AUTHORIZATION_DENIED'));t.close();});
test('traversal and encoded bypass rejected',async()=>{const t=createWebDavPackageTransport(cfg());for(const key of ['../a.iwxa','%2e%2e/a.iwxa','/a.iwxa','https://bad/a.iwxa','a\\b.iwxa','a//b.iwxa'])await assert.rejects(t.getSnapshot({key,expectedSha256:'0'.repeat(64)}),ec('INVALID_PACKAGE_KEY'));t.close();});
test('trusted digest is mandatory',async()=>{const t=createWebDavPackageTransport(cfg());await assert.rejects(t.getSnapshot({key:'x.iwxa'}),ec('EXPECTED_DIGEST_REQUIRED'));await assert.rejects(t.putSnapshot(sample(bytes(),{expectedSha256:'0'.repeat(64)})),ec('DIGEST_MISMATCH'));t.close();});
test('download detects substitution',async()=>{const t=createWebDavPackageTransport(cfg()),b=bytes();const r=await t.putSnapshot(sample(b));await assert.rejects(t.getSnapshot({key:r.key,expectedSha256:'0'.repeat(64)}),ec('DIGEST_MISMATCH'));t.close();});
test('weak ETag is metadata, not strong validator',async()=>{const b=bytes(),t=createWebDavPackageTransport(cfg({fetchImpl:async()=>new Response(b,{headers:{ETag:'W/"weak"'}})}));const r=await t.getSnapshot({key:sample(b).key,expectedSha256:packageSha256(b)});assert.equal(r.receipt.etag,'W/"weak"');await assert.rejects(t.getSnapshot({key:sample(b).key,expectedSha256:packageSha256(b),expectedETag:r.receipt.etag}),ec('STRONG_ETAG_REQUIRED'));t.close();});
test('upload and download size bounded',async()=>{const a=createWebDavPackageTransport(cfg()),data=bytes();const r=await a.putSnapshot(sample(data));const t=createWebDavPackageTransport(cfg({maxBytes:4}));await assert.rejects(t.putSnapshot(sample(data)),ec('PACKAGE_TOO_LARGE'));await assert.rejects(t.getSnapshot({key:r.key,expectedSha256:r.sha256}),ec('PACKAGE_TOO_LARGE'));a.close();t.close();});
test('unannounced oversized stream rejected',async()=>{const b=bytes(),t=createWebDavPackageTransport(cfg({maxBytes:4,fetchImpl:async()=>new Response(b)}));await assert.rejects(t.getSnapshot({key:sample(b).key,expectedSha256:packageSha256(b)}),ec('PACKAGE_TOO_LARGE'));t.close();});
test('lost ACK recovery is read-only',async()=>{let puts=0;const t=createWebDavPackageTransport(cfg({fetchImpl:async(...args)=>{const r=await fetch(...args);if(args[1].method==='PUT'){puts++;await r.arrayBuffer();throw Error('injected-lost-ack');}return r;}}));const s=sample(bytes());await assert.rejects(t.putSnapshot(s),ec('OUTCOME_UNKNOWN'));const r=await t.inspectOutcome(s);assert.equal(r.state,'EXPECTED_BYTES_PRESENT');assert.equal(r.historicalWriteProven,false);assert.equal(puts,1);t.close();});
test('redirect cannot forward credentials',async()=>{let n=0;const t=createWebDavPackageTransport(cfg({fetchImpl:async(u,o)=>{n++;assert.equal(o.redirect,'manual');return new Response(null,{status:307,headers:{Location:'https://unrelated.invalid/'}});}}));await assert.rejects(t.getSnapshot({key:'x.iwxa',expectedSha256:'0'.repeat(64)}),ec('REDIRECT_REFUSED'));assert.equal(n,1);t.close();});
test('TLS location and URL credential boundaries',()=>{assert.throws(()=>createWebDavPackageTransport(cfg({baseUrl:'http://example.org/'})),ec('TLS_REQUIRED'));assert.throws(()=>createWebDavPackageTransport(cfg({baseUrl:'https://user:pass@example.org/'})),ec('INVALID_ENDPOINT'));assert.throws(()=>createWebDavPackageTransport(cfg({locationRef:'foreign'})),ec('LOCATION_NOT_PERMITTED'));});
test('closed transport cannot reconnect',async()=>{const t=createWebDavPackageTransport(cfg());t.close();await assert.rejects(t.putSnapshot(sample(bytes())),ec('TRANSPORT_CLOSED'));});
test('bytes snapshotted before async authorization',async()=>{const b=bytes(),original=Buffer.from(b);let n=0;const t=createWebDavPackageTransport(cfg({authorize:async()=>{if(++n===1)b.fill(0);return true;}}));const r=await t.putSnapshot(sample(b));assert.equal(r.sha256,packageSha256(original));t.close();});
test('5xx write is unknown without retry',async()=>{let n=0;const t=createWebDavPackageTransport(cfg({fetchImpl:async()=>{n++;return new Response(null,{status:500});}}));await assert.rejects(t.putSnapshot(sample(bytes())),ec('OUTCOME_UNKNOWN'));assert.equal(n,1);t.close();});
test('readback, not PUT ETag, verifies upload',async()=>{const b=bytes();let n=0;const t=createWebDavPackageTransport(cfg({fetchImpl:async(u,o)=>{n++;return o.method==='PUT'?new Response(null,{status:201}):new Response(b);}}));const r=await t.putSnapshot(sample(b));assert.equal(r.state,'PUBLISHED_AND_READ_BACK');assert.equal(r.etag,null);assert.equal(n,2);t.close();});
test('checkpoint for cold-server fresh-process read',async()=>{const t=createWebDavPackageTransport(cfg()),b=bytes('cold');const r=await t.putSnapshot(sample(b));writeFileSync(process.env.T4_TEST_CHECKPOINT,JSON.stringify({key:r.key,sha256:r.sha256,text:b.toString('base64')}));t.close();});

test('real HTTPS roundtrip joins confirmed original Exchange-shaped artifact to original preview port', async()=>{
  const t=createWebDavPackageTransport(cfg());
  const data=bytes('confirmed-original-shape');
  const workspace={workspace_id:'test-person-a'};
  const packageDigest='original-digest-fixture';
  const semanticDigest='original-semantic-fixture';
  const state={
    status:'confirmed',ackSensitive:true,fileSavedConfirmed:true,
    packageSnapshot:{workspaces:['test-person-a']},
    artifact:{
      filename:'original.iwxa',bytes:data,size:data.byteLength,package_digest:packageDigest,
      semantic_digest:semanticDigest,
      manifest:{format:'iwxa.package',format_version:'1.1',encryption:'none',
        package_digest:packageDigest,semantic_digest:semanticDigest,workspaces:['test-person-a']},
      validation:{format:'iwxa.package.validation',ok:true}
    },
    receipt:{package_digest:packageDigest,workspace_ids:['test-person-a'],
      confirmed_at:'2026-11-21T00:00:00Z',confirmations:1}
  };
  let previews=0,commits=0;
  const kernel={
    hasOperation:op=>['t2.exportPackage','t2.confirmExport','t2.importPreview','t2.importCancel'].includes(op),
    importPreview:async content=>{
      previews++;
      assert.deepEqual(Buffer.from(content),data);
      return {preview_token:'original-kernel-preview-token'};
    },
    importCommit:async()=>{commits++;throw Error('T4_must_not_auto_commit');}
  };
  const handoff=createT4OriginalExchangeHandoff({
    transport:t,originalKernel:kernel,workspaceId:'test-person-a',
    readOriginalExportState:()=>state,
    currentWorkspace:{get:()=>workspace,subscribe:()=>()=>{}}
  });
  try{
    const published=await handoff.publishConfirmedExport();
    assert.equal(published.originalPackageDigest,packageDigest);
    assert.equal(published.transportReceipt.state,'PUBLISHED_AND_READ_BACK');
    const prepared=await handoff.previewRemoteImport({
      key:published.sha256+'.iwxa',expectedSha256:published.sha256
    });
    assert.equal(prepared.originalPreview.preview_token,'original-kernel-preview-token');
    assert.equal(prepared.originalImportCommitted,false);
    assert.equal(previews,1);
    assert.equal(commits,0);
  }finally{t.close();}
});
