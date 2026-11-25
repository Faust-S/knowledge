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
import {materializeOriginalAgentT2Product} from '../scripts/build-original-agent-one-dist.mjs';
import {assembleSignedControlDist} from '../scripts/assemble-signed-control-dist.mjs';
import {assertQualifiedKernelArtifact} from '../src/factory2/products/domain-completion/independent-browser-witness.mjs';
import {companyExchangeServiceId} from '../src/t3/company-exchange-profile.mjs';
import {createSubjectKernelBinding} from '../src/t3/subject-access-binding.mjs';
import {createTrustedReconciliationKernelApply} from '../src/t3/reconciliation-kernel-apply.mjs';
import {companyWorkRecordKeyParts,companyWorkEventPayload,readOriginalCompanyWorkspace,
  validateCompanyMergeReceipt} from '../src/t3/company-workspace-readback.mjs';

const qualified=process.env.IWXA_COMPANY_TEST_QUALIFIED_T2;
const idbModule=process.env.IWXA_COMPANY_TEST_IDB_MODULE;
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

test('original qualified T2 cross-product complete archive and repeated same-Workspace merge',async()=>{
  assert.ok(qualified&&existsSync(join(qualified,'_iwxa/runtime/0.3.6/runtime.js')),
    'QUALIFIED_ORIGINAL_T2_REQUIRED');
  assert.ok(idbModule&&existsSync(idbModule),'TEST_INDEXEDDB_PLATFORM_REQUIRED');
  const idb=await import(pathToFileURL(resolve(idbModule)).href);
  for(const [name,value] of Object.entries(idb))if(name.startsWith('IDB')&&typeof value==='function')
    Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
  // Sequential source test: real runtime's lock callback is executed once
  // per request. No concurrency or native OS locking claim is made.
  Object.defineProperty(globalThis,'navigator',{value:{locks:{
    request:async(_name,options,callback)=>typeof options==='function'
      ?options({name:_name}):callback({name:_name})}},configurable:true});
  Object.defineProperty(globalThis,'window',{value:globalThis,configurable:true});
  const tmp=mkdtempSync(join(tmpdir(),'iwxa-company-runtime-'));
  let active=null;
  const originalFetch=globalThis.fetch;
  try{
    const verified=assertQualifiedKernelArtifact(qualified,{kernel:'0.3.6',contract:'1.3.0',artifactId});
    const compiled=join(tmp,'compiled');
    for(const file of ['signed-workspace.html','isolated-signed-workspace.html','trusted-kernel-realm.html'])
      put(compiled,file,'<base href="/workspace/"><script type="module" src="/workspace/assets/fixture.js"></script>');
    put(compiled,'assets/fixture.js','// test-only compiled UI placeholder: not executed');
    put(compiled,'favicon.ico','fixture');
    async function stage(which){
      const agent=which==='agent';
      const productId=agent?'iwxa.personal-agent':'iwxa.admin-center';
      const serviceId=productId+'.workspace',origin=agent?'http://127.0.0.1:18883':'http://127.0.0.1:18885';
      const profile={schema:agent?'IWXA_AGENT_ORIGINAL_T2_PRODUCT_PROFILE/1':'IWXA_ADMIN_ORIGINAL_T2_PRODUCT_PROFILE/1',
        productId,serviceId,origin,configVersion:agent?'0.6.0':'0.3.0-dev.1',workspaceProfile:'generic',
        localStoreName:'iwxa-local',kernelVersion:'0.3.6',runtimeContract:'1.3.0',
        qualifiedArtifactId:artifactId,authorizedNativeOwner:agent?'ORIGINAL_T3_SIGNED_EMPLOYEE':'ORIGINAL_T3_SIGNED_ADMIN',
        ...(agent?{authorizedResultRecipient:null,installedAgentT3Mode:'EXPLICIT_OPT_IN'}:{installedAdminT3Mode:'EXPLICIT_OPT_IN'})};
      const profilePath=put(tmp,which+'.json',profile),source=join(tmp,which+'-source'),dist=join(tmp,which+'-dist');
      if(agent)await materializeOriginalAgentT2Product({qualifiedKernelDist:qualified,agentProfile:profilePath,outputRoot:source});
      else await materializeOriginalAdminT2Product({qualifiedKernelDist:qualified,centerProfile:profilePath,outputRoot:source});
      const assembled=assembleSignedControlDist({t2Dist:source,t3Build:compiled,outputDir:dist,
        ...(agent?{installedOriginalAgentD6:true,desktopAgentControlOnly:true}:{installedOriginalAdminD3:true,desktopAdminControlOnly:true})});
      assert.equal(assembled.original_kernel,'0.3.6');
      assert.equal(assertQualifiedKernelArtifact(dist,{kernel:'0.3.6',contract:'1.3.0',artifactId}).artifactSha256,verified.artifactSha256);
      const runtime=await import(pathToFileURL(join(dist,'_iwxa/runtime/0.3.6/runtime.js')).href);
      return {runtime,serviceId,origin,dist,db:new idb.IDBFactory(),domain:json(dist,'_iwxa/domain.json'),current:json(dist,'_iwxa/current.json')};
    }
    const source=await stage('agent'),recipient=await stage('admin');
    globalThis.fetch=async(input)=>{
      assert.ok(active,'ORIGINAL_RUNTIME_TEST_ORIGIN_MISSING');
      const url=new URL(typeof input==='string'?input:input.url??String(input),active.origin);
      if(url.origin!==active.origin||!url.pathname.startsWith('/_iwxa/')||url.pathname.includes('..'))
        return new Response('',{status:403});
      const file=join(active.dist,...url.pathname.slice(1).split('/'));
      return existsSync(file)?new Response(readFileSync(file),{status:200,
        headers:{'Content-Type':url.pathname.endsWith('.json')?'application/json':'application/octet-stream'}}):new Response('',{status:404});
    };
    async function activate(s){
      active=s;
      Object.defineProperty(globalThis,'indexedDB',{value:s.db,writable:true,configurable:true});
      Object.defineProperty(globalThis,'location',{value:new URL(s.origin+'/workspace/'),configurable:true});
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
    for(const event of originalEvents)assert.deepEqual(readEvents.find(e=>e.event_id===event.event_id),event);
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
    const again=await cold.bound.importPreview(archive.bytes);
    const second=await cold.bound.importCommit({preview_token:again.preview_token,
      package_digest:again.package_digest,plan:merge});
    assert.equal(second.applied.objects_inserted,0);
    assert.equal(second.applied.objects_skipped,2);
    assert.deepEqual(validateCompanyMergeReceipt(again.preview,merge,second),[]);
    assert.deepEqual((await readOriginalCompanyWorkspace({kernel:cold.kernel,workspaceId:ws})).records,observed.records);
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
    await source.runtime.__resetKernelStoreForTests();
  }finally{
    globalThis.fetch=originalFetch;
    rmSync(tmp,{recursive:true,force:true});
  }
});
