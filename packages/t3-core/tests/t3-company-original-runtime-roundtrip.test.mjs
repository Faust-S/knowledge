// Source qualification: execute the immutable qualified ORIGINAL T2 runtime.
// Only browser platform storage and Web Locks are provided by a Node test
// environment. No replacement Kernel, codec, browser automation, fake T2
// receipts or claim of installed Windows GUI/production Access acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {materializeOriginalAdminT2Product} from '../scripts/materialize-original-admin-t2-product.mjs';
import {materializeOriginalAgentT2Product,buildOriginalAgentOneDist,buildOriginalAgentOneDistFromQualifiedKernel} from '../scripts/build-original-agent-one-dist.mjs';
import {assembleSignedControlDist} from '../scripts/assemble-signed-control-dist.mjs';
import {assertQualifiedKernelArtifact} from '../src/factory2/products/domain-completion/independent-browser-witness.mjs';
import {CANDIDATE_KERNEL_ARTIFACT,selectQualificationKernelCandidate}
  from '../scripts/installed-kernel-candidate.mjs';
import {assertInstalledOriginalKernelArtifact} from '../scripts/installed-kernel-selection.mjs';
import {companyExchangeServiceId} from '../src/t3/company-exchange-profile.mjs';
import {assertT4OriginalInstalledProductPassport} from '../../t4-network/src/network/original-installed-product-passport.mjs';
import {createSubjectKernelBinding} from '../src/t3/subject-access-binding.mjs';
import {createTrustedReconciliationKernelApply} from '../src/t3/reconciliation-kernel-apply.mjs';
import {companyWorkRecordKeyParts,companyWorkEventPayload,readOriginalCompanyWorkspace,
  validateCompanyMergeReceipt} from '../src/t3/company-workspace-readback.mjs';

const qualified=process.env.IWXA_COMPANY_TEST_QUALIFIED_T2;
const idbModule=process.env.IWXA_COMPANY_TEST_IDB_MODULE;
const candidateDir=process.env.IWXA_COMPANY_TEST_CANDIDATE_T2;
const candidateReceipt=process.env.IWXA_COMPANY_TEST_CANDIDATE_RECEIPT;
const realCompiledUi=process.env.IWXA_COMPANY_TEST_COMPILED_T3;
const artifactId='iwxa-kernel-k036-same-store-history-20261019-qualified.1';
const ws='ws:corporate-roundtrip',org='org:corporate-roundtrip';
const sha=s=>createHash('sha256').update(s).digest('hex');
const put=(root,path,value)=>{
  const dest=join(root,path);mkdirSync(dirname(dest),{recursive:true});
  writeFileSync(dest,typeof value==='string'?value:JSON.stringify(value));return dest;
};
const json=(root,path)=>JSON.parse(readFileSync(join(root,path),'utf8'));
const full={workspaces:[ws],include_history:true,include_assets:true,include_relations:true,include_schemas:true};
const merge={mode:'merge',target_workspace:ws,conflict:'fail',include_workspaces:[ws],
  include_history:true,include_assets:true,include_relations:true};

// The original JS facade can materialize absent optional Event fields as
// undefined; the original JSON archive omits those keys. Compare the exact
// defined data, including all optional fields when present. Do not normalize
// timestamps, nulls, payloads, IDs, actor/service identity or revisions.
const optionalEventFields=['causation_id','correlation_id','idempotency_key','object_id','revision'];
function eventWire(event){
  assert.ok(event&&typeof event.event_id==='string','ORIGINAL_EVENT_MISSING');
  const copy={...event};
  for(const key of optionalEventFields)if(copy[key]===undefined)delete copy[key];
  return copy;
}
function assertHistoryContains(actual,expected){
  assert.equal(new Set(actual.map(e=>e.event_id)).size,actual.length,
    'ORIGINAL_EVENT_DUPLICATED');
  for(const event of expected)
    assert.deepEqual(eventWire(actual.find(e=>e.event_id===event.event_id)),eventWire(event));
}
test('event wire equality only ignores absent original optional fields',()=>{
  const event={event_id:'event:1',event_type:'workspace.created',workspace_id:ws,
    service_id:'iwxa.personal-agent.workspace',occurred_at:'2026-11-25T00:00:00.000Z',
    payload:{profile:'generic'},object_id:undefined};
  assertHistoryContains([JSON.parse(JSON.stringify(event))],[event]);
  for(const patch of [{object_id:null},{revision:1},{causation_id:'event:prior'},
    {occurred_at:'2026-11-25T00:00:01.000Z'},{payload:{profile:'other'}},
    {service_id:'iwxa.admin-center.workspace'}])
    assert.throws(()=>assertHistoryContains([{...event,...patch}],[event]),{code:'ERR_ASSERTION'});
  assert.throws(()=>assertHistoryContains([event,event],[event]),{code:'ERR_ASSERTION'});
  assert.throws(()=>assertHistoryContains([],[event]),{code:'ERR_ASSERTION'});
});

// The actual product recipes must admit the explicit original candidate.
// No post-assembly runtime replacement or self-declared build hashes.
function candidateSelection(verified){
  assert.equal(Boolean(candidateDir),Boolean(candidateReceipt),'CANDIDATE_INPUT_PAIR_REQUIRED');
  if(!candidateDir)return undefined;
  const pin=selectQualificationKernelCandidate(CANDIDATE_KERNEL_ARTIFACT);
  const receipt=JSON.parse(readFileSync(candidateReceipt,'utf8'));
  assert.equal(receipt.schema,'IWXA_T2_KERNEL_CANDIDATE_ARCHIVE/1');
  assert.equal(receipt.status,'SOURCE_AND_BUILD_PASS_CANDIDATE_UNACCEPTED');
  for(const key of ['artifactId','baseQualifiedArtifactId','sourceCommit','archiveSha256',
    'kernel','contract','releaseAccepted','productionActivation','files'])
    assert.deepEqual(receipt[key],pin[key],'CANDIDATE_ARCHIVE_IDENTITY_MISMATCH:'+key);
  for(const row of verified.files){
    const next=pin.files.find(f=>f.path===row.path);
    assert.ok(next);
    if(row.path==='_iwxa/runtime/0.3.6/runtime.js')assert.notEqual(row.sha256,next.sha256);
    else assert.equal(row.sha256,next.sha256);
  }
  assertInstalledOriginalKernelArtifact(candidateDir,CANDIDATE_KERNEL_ARTIFACT);
  assert.throws(()=>assertInstalledOriginalKernelArtifact(qualified,CANDIDATE_KERNEL_ARTIFACT),
    /FILE_DIGEST_MISMATCH/,'old accepted bytes cannot claim the candidate identity');
  assert.throws(()=>assertQualifiedKernelArtifact(candidateDir,{kernel:'0.3.6',contract:'1.3.0',artifactId}),
    /KERNEL_ARTIFACT_MISMATCH/,'candidate must not be admitted under the prior accepted ID');
  return CANDIDATE_KERNEL_ARTIFACT;
}
async function withOriginalRuntime(execute){
  assert.ok(qualified&&existsSync(join(qualified,'_iwxa/runtime/0.3.6/runtime.js')),
    'QUALIFIED_ORIGINAL_T2_REQUIRED');
  assert.ok(idbModule&&existsSync(idbModule),'TEST_INDEXEDDB_PLATFORM_REQUIRED');
  const idb=await import(pathToFileURL(resolve(idbModule)).href);
  // A Node BroadcastChannel owns a ref'ed MessagePort, unlike a browser
  // realm whose destruction automatically closes its channels. Model
  // that platform lifetime explicitly, not with --test-force-exit.
  const globals=new Map(),channels=new Set();
  const setGlobal=(name,value)=>{
    if(!globals.has(name))globals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));
    Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
  };
  const PlatformBroadcastChannel=globalThis.BroadcastChannel;
  if(typeof PlatformBroadcastChannel==='function'){
    setGlobal('BroadcastChannel',class extends PlatformBroadcastChannel{
      constructor(name){super(name);channels.add(this);}
      close(){try{super.close();}finally{channels.delete(this);}}
    });
  }
  for(const [name,value] of Object.entries(idb))if(name.startsWith('IDB')&&typeof value==='function')
    setGlobal(name,value);
  // Sequential source test: real runtime's lock callback is executed once
  // per request. No concurrency or native OS locking claim is made.
  setGlobal('navigator',{locks:{
    request:async(_name,options,callback)=>typeof options==='function'
      ?options({name:_name}):callback({name:_name})}});
  setGlobal('window',globalThis);
  const tmp=mkdtempSync(join(tmpdir(),'iwxa-company-runtime-'));
  let active=null;
  const staged=[];
  try{
    const verified=assertQualifiedKernelArtifact(qualified,{kernel:'0.3.6',contract:'1.3.0',artifactId});
    const qualificationKernelCandidate=candidateSelection(verified);
    const input=qualificationKernelCandidate?candidateDir:qualified;
    const selected=assertInstalledOriginalKernelArtifact(input,qualificationKernelCandidate);
    const compiled=realCompiledUi?resolve(realCompiledUi):join(tmp,'compiled');
    if(qualificationKernelCandidate)
      assert.ok(realCompiledUi,'CANDIDATE_REAL_COMPILED_T3_REQUIRED');
    if(!realCompiledUi){
      for(const file of ['signed-workspace.html','isolated-signed-workspace.html','trusted-kernel-realm.html'])
        put(compiled,file,'<base href="/workspace/"><script type="module" src="/workspace/assets/fixture.js"></script>');
      put(compiled,'assets/fixture.js','// test-only compiled UI placeholder: not executed');
      put(compiled,'favicon.ico','fixture');
    }
    // A genuine candidate is only usable in the two native corporate
    // profiles, not as a normal site, browser domain or test fixture.
    if(qualificationKernelCandidate){
      assert.throws(()=>assembleSignedControlDist({t2Dist:input,t3Build:compiled,
        outputDir:join(tmp,'forbidden-web-dist'),qualificationKernelCandidate}),
        /CANDIDATE_NATIVE_CORPORATE_QUALIFICATION_ONLY/);
      assert.throws(()=>assembleSignedControlDist({t2Dist:input,t3Build:compiled,
        outputDir:join(tmp,'forbidden-fixture-dist'),qualificationKernelCandidate,
        testOnlyUnqualifiedFixture:true}),/CANDIDATE_NATIVE_CORPORATE_QUALIFICATION_ONLY/);
      assert.equal(existsSync(join(tmp,'forbidden-web-dist')),false);
      assert.equal(existsSync(join(tmp,'forbidden-fixture-dist')),false);
    }
    async function stage(which,pilotRole=null){
      const agent=which==='agent';
      const productId=agent?'iwxa.personal-agent':'iwxa.admin-center';
      const serviceId=productId+'.workspace',origin=agent?'http://127.0.0.1:18883':'http://127.0.0.1:18885';
      const profile={schema:agent?'IWXA_AGENT_ORIGINAL_T2_PRODUCT_PROFILE/1':'IWXA_ADMIN_ORIGINAL_T2_PRODUCT_PROFILE/1',
        productId,serviceId,origin,configVersion:agent?'0.6.0':'0.3.0-dev.1',workspaceProfile:'generic',
        localStoreName:'iwxa-local',kernelVersion:'0.3.6',runtimeContract:'1.3.0',
        qualifiedArtifactId:artifactId,authorizedNativeOwner:agent?'ORIGINAL_T3_SIGNED_EMPLOYEE':'ORIGINAL_T3_SIGNED_ADMIN',
        ...(agent?{authorizedResultRecipient:null,installedAgentT3Mode:'EXPLICIT_OPT_IN'}:{installedAdminT3Mode:'EXPLICIT_OPT_IN'})};
      const name=which+(pilotRole?'-pilot':'');
      const profilePath=put(tmp,name+'.json',profile),source=join(tmp,name+'-source'),dist=join(tmp,name+'-dist');
      const product=agent
        ?await materializeOriginalAgentT2Product({qualifiedKernelDist:input,agentProfile:profilePath,outputRoot:source,qualificationKernelCandidate})
        :await materializeOriginalAdminT2Product({qualifiedKernelDist:input,centerProfile:profilePath,outputRoot:source,qualificationKernelCandidate});
      let assembled;
      if(agent){
        const receiptPath=join(tmp,name+'-assembled-receipt.json');
        const options={t3Build:compiled,outputDir:dist,receiptPath,desktopAgentControlOnly:true,
          qualificationKernelCandidate,installedNetworkPilotRole:pilotRole};
        // Exercise the actual convenience path used by installed SOURCE builds.
        // The independently materialized product still supplies the artifact witness.
        const built=pilotRole==='SOURCE'
          ?await buildOriginalAgentOneDistFromQualifiedKernel({...options,qualifiedKernelDist:input,agentProfile:profilePath})
          :buildOriginalAgentOneDist({...options,t2Dist:source});
        assembled=JSON.parse(readFileSync(receiptPath,'utf8'));
        assert.equal(built.productId,'iwxa.personal-agent');
        assert.equal(built.original_qualified_artifact,assembled.original_qualified_artifact);
      }else{
        assembled=assembleSignedControlDist({t2Dist:source,t3Build:compiled,outputDir:dist,
          qualificationKernelCandidate,installedOriginalAdminD3:true,desktopAdminControlOnly:true,installedNetworkPilotRole:pilotRole});
      }
      assert.equal(assembled.original_kernel,'0.3.6');
      assert.equal(assembled.original_t4_pilot_role,pilotRole);
      assert.equal(assembled.original_t4_technical_schema_registered,pilotRole!==null);
      assert.equal(assertInstalledOriginalKernelArtifact(dist,qualificationKernelCandidate).artifactSha256,selected.artifactSha256);
      if(qualificationKernelCandidate){
        assert.equal(product.originalQualifiedArtifactId,null);
        assert.equal(assembled.original_qualified_artifact,null);
        for(const receipt of [product,assembled]){
          assert.equal(receipt.original_kernel_candidate_artifact,selected.artifactId);
          assert.equal(receipt.original_kernel_candidate_archive_sha256,selected.archiveSha256);
          assert.equal(receipt.original_kernel_release_accepted,false);
        }
      }else assert.equal(assembled.original_qualified_artifact,artifactId);
      const runtimePath=join(dist,'_iwxa/runtime/0.3.6/runtime.js');
      const runtime=await import(pathToFileURL(runtimePath).href);
      const materialized={runtime,serviceId,origin,dist,db:new idb.IDBFactory(),domain:json(dist,'_iwxa/domain.json'),current:json(dist,'_iwxa/current.json')};
      staged.push(materialized);
      return materialized;
    }
    setGlobal('fetch',async(input)=>{
      assert.ok(active,'ORIGINAL_RUNTIME_TEST_ORIGIN_MISSING');
      const url=new URL(typeof input==='string'?input:input.url??String(input),active.origin);
      if(url.origin!==active.origin||!url.pathname.startsWith('/_iwxa/')||url.pathname.includes('..'))
        return new Response('',{status:403});
      const file=join(active.dist,...url.pathname.slice(1).split('/'));
      return existsSync(file)?new Response(readFileSync(file),{status:200,
        headers:{'Content-Type':url.pathname.endsWith('.json')?'application/json':'application/octet-stream'}}):new Response('',{status:404});
    });
    async function activate(s){
      active=s;
      setGlobal('indexedDB',s.db);
      setGlobal('location',new URL(s.origin+'/workspace/'));
      const ctx={domain:s.domain,current:s.current,origin:s.origin};
      const product=await s.runtime.connect({service_id:s.serviceId,required_levels:['T1','T2']},ctx);
      const exchange=await s.runtime.connect({service_id:companyExchangeServiceId(s.serviceId),required_levels:['T1','T2']},ctx);
      assert.equal(product.contract_version,'1.3.0');assert.equal(exchange.runtime_version,'0.3.6');
      assert.equal(product.mode,'full');assert.equal(exchange.mode,'full');
      assert.ok(!product.granted_operations.includes('t1.purgeCommit'));
      assert.ok(exchange.granted_operations.includes('t2.importCommit'));
      const kernel={sessionInfo:{contract_version:product.contract_version,service_id:s.serviceId},
        hasOperation:op=>product.granted_operations.includes(op)};
      for(const name of ['getWorkspace','getObject','listObjects','listEventsSince','commitObjectGraph'])
        kernel[name]=(...args)=>product.t1[name](...args);
      for(const name of ['exportPreview','exportPackage','confirmExport','importPreview','importCommit','importCancel'])
        kernel[name]=(...args)=>exchange.t2[name](...args);
      // This is a test signed-port fixture, not production signatures.
      // The real T2 dispatch, parser, transaction and receipt are unchanged.
      const context={kind:'CORP',context_id:'context:corp',actor_id:'person:employee',
        principal_id:org,role_id:'role:employee',grant_id:'grant:corp',realm_id:'realm:corp',
        audience:'host:t3',resource:ws,purpose:'purpose:work',workspace_id:ws,
        organization_id:org,scope_revision:1};
      const dg='a'.repeat(64),access={currentContext:()=>context,actionFor:()=> 'action:work',
        operationDigest:()=>dg,authorize:()=>({
          schema:'IWXA_T3_ORGANIZATION_OPERATION_DECISION/1',allowed:true,outcome:'PERMITTED',
          evidenceOnly:true,requestDigest:dg,policyDigest:dg,statusSequence:1,organizationId:org,
          workspaceId:ws,grantId:context.grant_id,operationDigest:dg,evidenceDigest:dg,
          productionActivation:false,doesNotTransferData:true,doesNotAcceptCorporateCopy:true,
          validUntil:new Date(Date.now()+60000).toISOString()}),verifyDecisionBinding:()=>true};
      const bound=createSubjectKernelBinding({kernel,access,previewSession:{},corporateBusinessExchange:true});
      return {product,exchange,kernel,bound,context,access};
    }
    await execute({stage,activate});
  }finally{
    try{
      for(const product of staged)await product.runtime.__resetKernelStoreForTests();
    }finally{
      // Close only channels constructed inside this test realm. Preserve
      // actual Runtime/Store resets and restore the original globals.
      for(const channel of [...channels])channel.close();
      for(const [name,descriptor] of [...globals].reverse()){
        if(descriptor)Object.defineProperty(globalThis,name,descriptor);
        else delete globalThis[name];
      }
      rmSync(tmp,{recursive:true,force:true});
    }
  }
}

test(candidateDir?'original K036 source-built UNACCEPTED candidate cross-product complete archive and repeated same-Workspace merge':
  'original qualified T2 cross-product complete archive and repeated same-Workspace merge',async()=>{
  await withOriginalRuntime(async({stage,activate})=>{
    const source=await stage('agent'),recipient=await stage('admin');
    const a=await activate(source);
    await a.product.t1.createWorkspace({workspace_id:ws,profile:'generic'});
    const rows=[];
    for(const [kind,artifactId,text] of [['TASK','task:roundtrip','Task text'],['RESULT','result:roundtrip','Result text']]){
      const data={schema:'IWXA_T3_ORIGINAL_COMPANY_WORK_RECORD/1',kind,artifactId,
        operationId:'operation:'+kind,organizationId:org,workspaceId:ws,executorId:'person:employee',
        taskId:'task:roundtrip',taskRevisionId:'b'.repeat(64),taskPackageSha256:'c'.repeat(64),
        mimeType:'text/plain',text,sha256:sha(text),
        sourceKind:kind==='TASK'?'ORIGINAL_SIGNED_TASK':'ORIGINAL_AGENT_HUMAN_ACCEPTED'};
      const token=sha(JSON.stringify(companyWorkRecordKeyParts(data))),objectId='company:work:'+token;
      const applied=await a.product.t1.commitObjectGraph({workspace_id:ws,idempotency_key:token,
        object:{object_id:objectId,schema_id:'iwxa.t3.company-work-record',schema_version:'1.0.0',data,base_revision:0},
        event:{event_type:'iwxa.company.work-record.committed',payload:companyWorkEventPayload(data,objectId)}});
      rows.push(applied.object);
    }
    await a.product.t1.putRelation({workspace_id:ws,relation_id:'relation:roundtrip',
      from_object_id:rows[0].object_id,to_object_id:rows[1].object_id,kind:'result-of',
      event:{event_type:'iwxa.company.test.relation'}});
    // The original package maps asset IDs to archive paths. Use a portable
    // filename-safe identifier, never a colon-delimited logical object ID.
    const attachment=Uint8Array.from([0,1,2,3,255]);
    await a.product.t1.putAsset({workspace_id:ws,asset_id:'asset-roundtrip',
      object_id:rows[1].object_id,mime:'application/octet-stream',bytes:attachment,base_revision:0,
      event:{event_type:'iwxa.company.test.asset'}});
    const preview=await a.bound.exportPreview(full);
    assert.equal(preview.summary.scope_mode,'workspace');
    assert.equal(preview.counts.objects,2);assert.equal(preview.counts.assets,1);
    const archive=await a.bound.exportPackage(full);
    await a.bound.confirmExport({package_digest:archive.package_digest,workspace_ids:[ws]});
    assert.equal(archive.manifest.counts.relations,1);
    const originalEvents=await a.product.t1.listEventsSince(ws);
    assert.ok(originalEvents.length>=2);
    await source.runtime.__resetKernelStoreForTests();
    const b=await activate(recipient);
    await b.product.t1.createWorkspace({workspace_id:ws,profile:'generic'});
    // The original restricted destination passport is a negative control.
    const narrow=await b.product.t2.importPreview(archive.bytes);
    assert.equal(narrow.preview.scope_mode,'writable_objects');
    assert.ok(narrow.preview.excluded_by_permission.events>0);
    assert.ok(narrow.preview.excluded_by_permission.assets>0);
    await b.product.t2.importCancel(narrow.preview_token);
    const incoming=await b.bound.importPreview(archive.bytes);
    assert.equal(incoming.preview.scope_mode,'workspace');
    assert.equal(incoming.preview.included.events,archive.manifest.counts.events);
    assert.equal(incoming.preview.included.assets,1);
    const receipt=await b.bound.importCommit({preview_token:incoming.preview_token,
      package_digest:incoming.package_digest,plan:merge});
    assert.deepEqual(validateCompanyMergeReceipt(incoming.preview,merge,receipt),[]);
    const observed=await readOriginalCompanyWorkspace({kernel:b.kernel,workspaceId:ws,
      expectedRows:incoming.preview.objects,organizationId:org});
    assert.equal(observed.records.length,2);
    assert.equal(observed.records.find(r=>r.kind==='RESULT').text,'Result text');
    assert.equal(observed.signedReceiptVerified,false);
    const readEvents=await b.product.t1.listEventsSince(ws);
    assertHistoryContains(readEvents,originalEvents);
    const asset=await b.exchange.t1.getAsset(ws,'asset-roundtrip');
    assert.deepEqual(asset.bytes,attachment);
    assert.equal(asset.asset.service_id,source.serviceId);
    const relation=await b.exchange.t1.getObject(ws,rows[0].object_id);
    assert.ok(relation.relations.outgoing.some(r=>r.relation_id==='relation:roundtrip'));
    // Apply the accepted administrative effect to the SAME original Admin
    // Kernel, but its already provisioned private administrative Workspace.
    // The access fixture is not a production signature; the persisted graph,
    // independent readback, physical archive and transactions are original T2.
    const adminStorage='workspace:registry:'+sha(org+'|'+ws);
    await b.product.t1.createWorkspace({workspace_id:adminStorage,profile:'generic'});
    const effect=sha('accepted administrative effect'),acceptanceId=sha('acceptance'),
      resultRevision=sha('accepted revision'),objId='result:applied:'+effect;
    const target={consumerId:'IWXA_ADMIN_CENTER',processId:'admin.applied-results',
      processVersion:'1',purpose:'application',subjectId:org,workspaceId:ws,dataRootId:'root:org'};
    const adminContext={...b.context,purpose:'application',role_id:'role:manager',
      actor_id:'person:manager',grant_id:b.context.grant_id};
    let approved=false;
    const command={workspace_id:ws,idempotency_key:effect,object:{
      object_id:objId,schema_id:'iwxa.admin.applied-results',schema_version:'1.0.0',
      base_revision:0,data:{schema:'IWXA_T3_ADMIN_APPLIED_RESULTS/1',records:[{
        taskId:'task:roundtrip',taskRevisionId:'b'.repeat(64),resultRevisionId:resultRevision,
        organizationId:org,workspaceId:ws,executorId:'person:employee',
        result:'Result text',acceptanceId}]}},
      event:{event_type:'iwxa.admin.result.applied',payload:{
        reconciliation_acceptance_id:acceptanceId,reconciliation_revision_ids:[resultRevision]}}};
    const makeApply=port=>createTrustedReconciliationKernelApply({
      kernel:port.kernel,access:{...port.access,currentContext:()=>adminContext},
      admission:{inspectAcceptedApplication:async()=>({})},isHostActive:()=>true,
      resolveReceiptWorkspace:async()=>adminStorage,
      stageFromOriginalOwner:()=>({command,binding:{
        schema:'IWXA_T3_APPLICATION_HOST_BINDING/1',effectKey:effect,
        operation:{operationId:'effect:'+effect,payloadDigest:sha('payload'),
          resource:ws,productId:'IWXA_ADMIN_CENTER',audience:adminContext.audience,
          purpose:'application',action:'application.apply'},expectedRevision:0,
        applicationAuthorized:false,writeAllowed:false,hostJitRequired:true,
        explicitHumanDecisionRequired:true,decisionCheckAtCommit:true,
        externalContextCoreApplied:false,commitPrecondition:()=>approved},
        authorizationContext:{operationId:'effect:'+effect,payloadDigest:sha('payload'),
          organizationId:org,workspaceId:ws,dataRootId:target.dataRootId,
          storageScopeDigest:sha('storage'),expectedRevision:0,actorId:adminContext.actor_id,
          principalId:org,roleId:adminContext.role_id,grantId:adminContext.grant_id,
          operationDigest:sha('operation')}}),
      confirmSeparateApply:async()=>{approved=true;return true;}});
    const selection={acceptanceId,revisionIds:[resultRevision],target};
    const applied=await makeApply(b).applyAccepted(selection);
    assert.equal(applied.originalKernelReceipt.workspace_id,adminStorage);
    assert.equal(applied.originalKernelReadback.object.data.records[0].workspaceId,ws);
    const returnArchive=await b.bound.exportPackage(full);
    await b.bound.confirmExport({package_digest:returnArchive.package_digest,workspace_ids:[ws]});
    assert.equal(returnArchive.manifest.counts.objects,2);
    assert.ok(!(await b.product.t1.listEventsSince(ws)).some(e=>e.event_type==='iwxa.admin.result.applied'));
    // Repeat on a new original Runtime connection, same recipient Store.
    await recipient.runtime.__resetKernelStoreForTests();
    const cold=await activate(recipient);
    const recovered=await makeApply(cold).recoverApplied(selection);
    assert.equal(recovered.status,'ORIGINAL_KERNEL_APPLY_READBACK_CONFIRMED');
    assert.equal(recovered.originalEventReadback.workspace_id,adminStorage);
    await assert.rejects(makeApply(cold).applyAccepted(selection),
      {code:'T3_D3_ORIGINAL_EFFECT_ALREADY_RECORDED_USE_RECOVERY'});
    const prior=await readOriginalCompanyWorkspace({kernel:cold.kernel,workspaceId:ws,organizationId:org});
    assert.deepEqual(prior.records,observed.records);
    assertHistoryContains(await cold.product.t1.listEventsSince(ws),readEvents);
    const again=await cold.bound.importPreview(archive.bytes);
    const second=await cold.bound.importCommit({preview_token:again.preview_token,
      package_digest:again.package_digest,plan:merge});
    assert.equal(second.applied.objects_inserted,0);
    assert.equal(second.applied.objects_skipped,2);
    assert.deepEqual(validateCompanyMergeReceipt(again.preview,merge,second),[]);
    assert.deepEqual((await readOriginalCompanyWorkspace({kernel:cold.kernel,workspaceId:ws})).records,observed.records);
    const mergedEvents=await cold.product.t1.listEventsSince(ws);
    assertHistoryContains(mergedEvents,readEvents);
    const coldAsset=await cold.exchange.t1.getAsset(ws,'asset-roundtrip');
    assert.deepEqual(coldAsset.bytes,attachment);
    assert.equal(coldAsset.asset.service_id,source.serviceId);
    await recipient.runtime.__resetKernelStoreForTests();
    // Admin -> employee return is a second physical archive import. Its
    // history/assets/relations are still the original business records.
    const employeeCold=await activate(source);
    const returned=await employeeCold.bound.importPreview(returnArchive.bytes);
    assert.ok(returned.preview.objects.every(o=>o.schema_id!=='iwxa.admin.applied-results'));
    const returnedReceipt=await employeeCold.bound.importCommit({preview_token:returned.preview_token,
      package_digest:returned.package_digest,plan:merge});
    assert.deepEqual(validateCompanyMergeReceipt(returned.preview,merge,returnedReceipt),[]);
    const employeeRows=await readOriginalCompanyWorkspace({kernel:employeeCold.kernel,workspaceId:ws});
    assert.deepEqual(employeeRows.records,observed.records);
    const employeeEvents=await employeeCold.product.t1.listEventsSince(ws);
    assertHistoryContains(employeeEvents,readEvents);
    assert.ok(!employeeEvents.some(e=>e.event_type==='iwxa.admin.result.applied'));
    const returnedAsset=await employeeCold.exchange.t1.getAsset(ws,'asset-roundtrip');
    assert.deepEqual(returnedAsset.bytes,attachment);
    assert.equal(returnedAsset.asset.service_id,source.serviceId);
    const returnedRelation=await employeeCold.exchange.t1.getObject(ws,rows[0].object_id);
    assert.ok(returnedRelation.relations.outgoing.some(r=>r.relation_id==='relation:roundtrip'));
    await source.runtime.__resetKernelStoreForTests();

  });
});

test('native pilot passports execute original Kernel permission ceiling and persist tombstones',async()=>{
  await withOriginalRuntime(async({stage,activate})=>{
    const text='Pilot business fixture';
    const data={schema:'IWXA_T3_ORIGINAL_COMPANY_WORK_RECORD/1',kind:'TASK',
      artifactId:'task:pilot',operationId:'operation:pilot',organizationId:org,workspaceId:ws,
      executorId:'person:employee',taskId:'task:pilot',taskRevisionId:'b'.repeat(64),
      taskPackageSha256:'c'.repeat(64),mimeType:'text/plain',text,sha256:sha(text),
      sourceKind:'ORIGINAL_SIGNED_TASK'};
    const businessId='company:work:'+sha(JSON.stringify(companyWorkRecordKeyParts(data)));
    const appliedData={schema:'IWXA_T3_ADMIN_APPLIED_RESULTS/1',records:[{
      taskId:data.taskId,taskRevisionId:data.taskRevisionId,resultRevisionId:'d'.repeat(64),
      organizationId:org,workspaceId:ws,executorId:data.executorId,result:text,
      acceptanceId:'e'.repeat(64)}]};
    // Assemble the explicit two native pilot variants, not a fixture passport
    // or a locally patched Runtime. Exercise the original permission ceiling
    // against real Object/Graph/Event operations in independent local Stores.
    // This is a service-passport qualification, NOT device enrollment,
    // signed network Access, DB9, or an installed two-node transport test.
    for(const [which,role] of [['agent','SOURCE'],['admin','RECIPIENT']]){
      const pilot=await stage(which,role);
      const catalog=json(pilot.dist,'_iwxa/service-catalog.json');
      const entry=catalog.entries.find(x=>x.service_id===pilot.serviceId);
      assert.ok(entry);
      const bytes=readFileSync(join(pilot.dist,entry.file));
      assert.equal(sha(bytes),entry.sha256);
      const passport=JSON.parse(bytes.toString('utf8'));
      assert.equal(assertT4OriginalInstalledProductPassport({domain:pilot.domain,passport,role}),role);
      const p=await activate(pilot),t1=p.product.t1;
      for(const name of ['getWorkspace','getObject','listObjects','listEventsSince','commitObjectGraph','putObject','deleteObject','getAsset','listAssets','putAsset','deleteAsset','putRelation','deleteRelation'])
        assert.ok(p.product.granted_operations.includes('t1.'+name),'PILOT_ORIGINAL_OPERATION_MISSING:'+role+':'+name);
      for(const name of ['softDeleteWorkspace','restoreWorkspace','purgeCommit'])
        assert.ok(!p.product.granted_operations.includes('t1.'+name),'PILOT_LIFECYCLE_PERMISSION_WIDENED');
      const tech='ws:pilot-technical',registry='ws:pilot-registry';
      for(const id of [ws,tech,registry])
        await t1.createWorkspace({workspace_id:id,profile:'generic'});
      const technicalData={schema:'IWXA_T4_ORIGINAL_NETWORK_REPLAY_CHECKPOINT_V1',
        title:'Pilot schema witness',witness:true};
      const write=async(workspace_id,object_id,schema_id,data)=>{
        const receipt=await t1.commitObjectGraph({workspace_id,idempotency_key:sha(role+'|'+workspace_id+'|'+object_id),
          object:{object_id,schema_id,schema_version:'1.0.0',data,base_revision:0,extensions:{}},
          event:{event_type:'iwxa.test.pilot.created',payload:{object_id}}});
        assert.equal(receipt.object.revision,1);
        assert.equal(receipt.object.schema_id,schema_id);
        const observed=await t1.getObject(workspace_id,object_id);
        assert.deepEqual(observed.object.data,data);
        return receipt.object;
      };
      const protectedRows=[
        await write(tech,'pilot:technical','iwxa.t4.network.record',technicalData),
        // Only serialization is under test here; never use this fixture as
        // an authenticated signed Registry or a real authority decision.
        await write(registry,'pilot:registry','iwxa.t3.access.signed-registry',{witness:true}),
      ];
      if(role==='RECIPIENT')protectedRows.push(await write(registry,'pilot:applied',
        'iwxa.admin.applied-results',appliedData));
      const business=await write(ws,businessId,'iwxa.t3.company-work-record',data);
      const remove=row=>t1.deleteObject({workspace_id:row.workspace_id,object_id:row.object_id,
        base_revision:row.revision,event:{event_type:'iwxa.test.pilot.deleted',payload:{object_id:row.object_id}}});
      for(const row of protectedRows){
        const history=await t1.listEventsSince(row.workspace_id);
        await assert.rejects(remove(row),{code:'PERMISSION_DENIED'});
        assert.deepEqual((await t1.getObject(row.workspace_id,row.object_id)).object,row);
        assert.deepEqual(await t1.listEventsSince(row.workspace_id),history);
      }
      const deleted=await remove(business);
      assert.equal(deleted.object.revision,business.revision+1);
      assert.ok((await t1.listEventsSince(ws)).some(e=>e.event_id===deleted.event.event_id));
      await pilot.runtime.__resetKernelStoreForTests();
      const coldPilot=await activate(pilot);
      for(const row of protectedRows)
        assert.deepEqual((await coldPilot.product.t1.getObject(row.workspace_id,row.object_id)).object,row);
      const tombstone=(await coldPilot.product.t1.listObjects({workspace_id:ws,include_deleted:true})).find(x=>x.object_id===business.object_id);
      assert.ok(tombstone&&tombstone.revision===business.revision+1&&tombstone.deleted===true,'PILOT_ORIGINAL_TOMBSTONE_MISSING');
      await pilot.runtime.__resetKernelStoreForTests();
    }
  });
});
