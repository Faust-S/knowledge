// Qualify the narrow ERP-link passport on the ACTUAL inherited T2 0.3.6
// Kernel and IndexedDB Store. This is a disposable public test Host, not a
// production Agent/ERPNext, real external process, new Store or D1 issuer.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync}
  from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {planOriginalT2ExternalProcessRegistration}
  from '../src/t3/external-process-passport-registration.node.mjs';
import {
  EXTERNAL_PROCESS_LINK_SCHEMA,EXTERNAL_PROCESS_LINK_EVENT,
  createTrustedExternalProcessLink,
} from '../src/t3/external-process-link.mjs';
import {createTemporaryOriginalPersonalAuthority}
  from './support/t3-original-personal-authority.mjs';
import {createSubjectKernelBinding}
  from '../src/t3/subject-access-binding.mjs';
import {readActivityFromT2Host}
  from '../src/t3/activity/kernel-reader.mjs';
import {createTrustedNativeContinuation}
  from '../src/t3/native-result-continuation.mjs';
import {normalizeErpNextSalesOrderRead}
  from '../src/t3/external-erpnext-source.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const ARTIFACT='iwxa-kernel-k036-same-store-history-20261019-qualified.1';
const DIGEST='7075b8b9590ef1283e34ecb3c21dd9d1b7342697287e1aa150cd4f4a60860b68';
const ORIGINAL='iwxa.workspace.integration';
const EXTERNAL='iwxa.agent06.external-process';
const sha=x=>createHash('sha256').update(x).digest('hex');

/** Test-only RPC to the ACTUAL browser T2 Kernel. Ed25519 D1 signing and
 * source admission run in the Node Host; storage is only the original
 * browser's single real IndexedDB Kernel/Store, never a mock or second Store.
 * No credentials or owner state are passed to the renderer. */
async function browserOriginalKernel(page){
  const session=await page.evaluate(async serviceId=>{
    globalThis.__t3ExternalKernel=await globalThis.IWXA.connect({service_id:serviceId});
    return {contract_version:globalThis.__t3ExternalKernel.contract_version,
      runtime_version:globalThis.__t3ExternalKernel.runtime_version,
      granted_operations:globalThis.__t3ExternalKernel.granted_operations};
  },EXTERNAL);
  assert.equal(session.contract_version,'1.3.0');
  assert.equal(session.runtime_version,'0.3.6');
  const methods=['getWorkspace','getObject','putObject','listObjects','listEventsSince'];
  const facade={
    sessionInfo:Object.freeze({contract_version:session.contract_version,
      runtime_version:session.runtime_version,service_id:EXTERNAL}),
    hasOperation:operation=>session.granted_operations.includes(operation),
  };
  for(const method of methods){
    facade[method]=(...args)=>page.evaluate(async({method,args})=>
      globalThis.__t3ExternalKernel.t1[method](...args),{method,args});
  }
  return Object.freeze(facade);
}

test('original T2 service enforces narrow ERP-link schema, revision CAS and cold readback',async()=>{
  const qualified=process.env.IWXA_T2_QUALIFIED_KERNEL_DIST;
  assert.ok(qualified,'T3_EXT_ORIGINAL_T2_QUALIFIED_DIST_REQUIRED');
  const {assertQualifiedKernelArtifact}=await import(
    '../src/factory2/products/domain-completion/independent-browser-witness.mjs');
  const {materializeIntegrationHost,serveRealKernelHost}=await import(
    '../scripts/real-kernel-e2e.mjs');
  const {chromium}=await import('playwright');
  const tmp=mkdtempSync(join(tmpdir(),'iwxa-external-link-original-t2-'));
  const oldCwd=process.cwd();
  let serving=null,browser=null;
  try{
    const dist=join(tmp,'dist');
    mkdirSync(dist);
    cpSync(join(realpathSync(resolve(qualified)),'_iwxa'),join(dist,'_iwxa'),
      {recursive:true});
    const verified=assertQualifiedKernelArtifact(dist,{
      kernel:'0.3.6',contract:'1.3.0',artifactId:ARTIFACT});
    assert.equal(verified.archiveSha256,DIGEST);
    process.chdir(ROOT); // Existing Host fixture's public/favicon.ico
    const host=materializeIntegrationHost(dist,'https://127.0.0.1');
    host.domain.runtime.kernel_release='0.3.6';
    host.domain.runtime.runtime_version='0.3.6';
    host.workspaceConfig.host.required_runtime_version='0.3.6';
    host.workspaceConfig.host.required_contract_version='1.3.0';
    const writerFile='_iwxa/services/'+ORIGINAL+'.json';
    const writerBytes=readFileSync(join(dist,writerFile));
    const catalog={contract_version:'1.3.0',count:1,entries:[{
      service_id:ORIGINAL,
      service_version:host.passport.service_version,
      base_path:host.passport.base_path,
      supported_levels:host.passport.supported_levels,
      file:writerFile,sha256:sha(writerBytes),
    }]};
    const plan=planOriginalT2ExternalProcessRegistration({
      domain:host.domain,catalog,controlPlane:host.controlPlane});
    assert.equal(plan.catalog.count,2);
    writeFileSync(join(dist,'_iwxa/domain.json'),JSON.stringify(plan.domain));
    writeFileSync(join(dist,'workspace/workspace.config.json'),
      JSON.stringify(host.workspaceConfig));
    writeFileSync(join(dist,'_iwxa/security/capability-control-plane.json'),
      JSON.stringify(plan.controlPlane));
    writeFileSync(join(dist,'_iwxa/service-catalog.json'),
      JSON.stringify(plan.catalog));
    writeFileSync(join(dist,plan.passport_file),plan.passport_bytes);
    assert.equal(sha(readFileSync(join(dist,plan.passport_file))),
      plan.passport_sha256);
    serving=await serveRealKernelHost(dist,{
      independentWitness:true,previewOrigin:true});
    const profile=join(tmp,'browser-profile');
    const open=async()=>{
      browser=await chromium.launchPersistentContext(profile,{
        headless:true,ignoreHTTPSErrors:true,serviceWorkers:'block'});
      const page=browser.pages()[0]??await browser.newPage();
      await page.goto(serving.origin+'/__t2_independent_readback__',
        {waitUntil:'load'});
      await page.waitForFunction(()=>typeof globalThis.IWXA?.connect==='function');
      return page;
    };
    const ws='t3-ext-real-'+randomUUID();
    const obj='external-link:original-kernel-real-test';
    let page=await open();
    const written=await page.evaluate(async({ws,obj,ORIGINAL,EXTERNAL,SCHEMA,EVENT})=>{
      const writer=await globalThis.IWXA.connect({service_id:ORIGINAL});
      const link=await globalThis.IWXA.connect({service_id:EXTERNAL});
      const grants=link.granted_operations;
      if(link.contract_version!=='1.3.0'||link.runtime_version!=='0.3.6')
        throw Error('T3_EXT_ORIGINAL_T2_VERSION_MISMATCH');
      if(!['t1.getWorkspace','t1.getObject','t1.putObject'].every(x=>grants.includes(x)))
        throw Error('T3_EXT_NARROW_LINK_METHOD_MISSING');
      if(['t1.createWorkspace','t1.deleteObject','t2.exportPackage','t2.importCommit']
        .some(x=>grants.includes(x)))
        throw Error('T3_EXT_PASSPORT_WRITABLE_SCOPE_TOO_BROAD');
      await writer.t1.createWorkspace({workspace_id:ws,profile:'generic'});
      const data={source_owner:'erpnext:shop1',record_kind:'Sales Order',
        record_id:'SO-0042',source_revision:'2026-11-15 13:00:00.1000',
        source_digest:'a'.repeat(64),source_receipt:null,
        source_state:'Submitted',epistemic_status:'reported',
        record_authority:'EXTERNAL_OWNER'};
      const put=async(base_revision,source_revision)=>{
        const snapshot={...data,source_revision};
        return link.t1.putObject({workspace_id:ws,object_id:obj,
          schema_id:SCHEMA,schema_version:'1.0.0',
          base_revision,data:snapshot,extensions:{},
          event:{event_type:EVENT,payload:{
            source_owner:data.source_owner,record_kind:data.record_kind,
            record_id:data.record_id,source_revision,
            epistemic_status:'reported',
          }}});
      };
      const first=await put(0,data.source_revision);
      const second=await put(1,'2026-11-15 13:01:00.2000');
      let staleDenied=false;
      try{await put(1,'2026-11-15 13:02:00.3000')}
      catch{staleDenied=true}
      let foreignDenied=false;
      try{await link.t1.putObject({workspace_id:ws,object_id:'foreign-test',
        schema_id:'iwxa.demo.note',schema_version:'1.0.0',base_revision:0,
        data:{title:'must not save'},extensions:{},
        event:{event_type:'test.unapproved',payload:{}}})}
      catch{foreignDenied=true}
      const read=await link.t1.getObject(ws,obj);
      return {first:first?.object?.revision,second:second?.object?.revision,
        latest:read?.object?.revision,snapshot:read?.object?.data,
        events:[first?.event?.event_id,second?.event?.event_id],
        staleDenied,foreignDenied,canExport:grants.includes('t2.exportPackage')};
    },{ws,obj,ORIGINAL,EXTERNAL,SCHEMA:EXTERNAL_PROCESS_LINK_SCHEMA,
      EVENT:EXTERNAL_PROCESS_LINK_EVENT});
    assert.equal(written.first,1);
    assert.equal(written.second,2);
    assert.equal(written.latest,2);
    assert.equal(written.snapshot.epistemic_status,'reported');
    assert.equal(written.snapshot.source_revision,'2026-11-15 13:01:00.2000');
    assert.deepEqual(written.events.every(x=>typeof x==='string'),true);
    assert.equal(written.staleDenied,true);
    assert.equal(written.foreignDenied,true);
    assert.equal(written.canExport,false);

    // Prove that the new external-process-link itself (not a manually
    // assembled putObject) passes through the ORIGINAL signed D1 binding,
    // original T2 Kernel/Store and the narrowly registered service passport.
    const externalRef={expected_workspace_id:ws,record_kind:'Sales Order',
      record_id:'SO-0042'};
    const selected=Object.freeze({workspace_id:ws,deleted_at:null});
    let selection=selected,humanApproval=false,humanCount=0;
    const listeners=new Set();
    const currentWorkspace={
      get:()=>selection,
      subscribe:fn=>{listeners.add(fn);return ()=>listeners.delete(fn);},
    };
    const liveKernel=await browserOriginalKernel(page);
    const ops=['t1.getWorkspace','t1.getObject','t1.listObjects',
      't1.listEventsSince','t1.putObject'];
    for(const op of ops)assert.equal(liveKernel.hasOperation(op),true);
    const signed=createTemporaryOriginalPersonalAuthority({
      workspaceId:ws,now:Date.now(),clock:Date.now,operations:ops,
    });
    let sourceRevision='2026-11-15 13:03:00.1000',sourceDigest='a'.repeat(64);
    const externalOwner={
      ownerId:'erpnext:shop1',
      readExact:async()=>({
        source_owner:'erpnext:shop1',record_kind:'Sales Order',
        record_id:'SO-0042',source_revision:sourceRevision,
        source_digest:sourceDigest,source_receipt:null,
        source_state:'Submitted',
        private_customer:'never persist this ERP customer field',
      }),
    };
    const makePort=(kernel=liveKernel,access=signed.access)=>
      createTrustedExternalProcessLink({
        kernel,accessForWrite:async()=>access,currentWorkspace,externalOwner,
        confirmHuman:async()=>{humanCount++;return humanApproval;},
        isHostActive:()=>true,
      });
    const port=makePort();
    assert.equal((await port.link(externalRef)).status,'USER_CANCELLED');
    humanApproval=true;
    const originalSigned=await port.link(externalRef);
    assert.equal(originalSigned.status,'LINK_PERSISTED');
    assert.equal(originalSigned.revision,1);
    assert.equal((await port.link(externalRef)).status,'ALREADY_LINKED');
    assert.equal((await port.recover(externalRef)).status,'LINK_PERSISTED');
    const firstD6Ref=await port.prepareContinuation(externalRef);
    assert.deepEqual(firstD6Ref,{
      workspace_id:ws,object_id:originalSigned.object_id,
      schema_id:EXTERNAL_PROCESS_LINK_SCHEMA,revision:1,
    });
    const saved=await liveKernel.getObject(ws,originalSigned.object_id);
    assert.equal(saved.object.data.source_receipt,null);
    assert.equal(saved.object.data.private_customer,undefined);
    assert.equal(saved.object.data.epistemic_status,'reported');
    assert.ok(signed.proofCount>=3,'ACTUAL_SIGNED_ED25519_PROOFS_REQUIRED');

    sourceRevision='2026-11-15 13:04:00.2000';
    sourceDigest='b'.repeat(64);
    await assert.rejects(port.link(externalRef),
      {code:'T3_EXT_REVISION_OR_SOURCE_CONFLICT'});
    const refreshed=await port.refresh(externalRef);
    assert.equal(refreshed.status,'LINK_PERSISTED');
    assert.equal(refreshed.revision,2);
    assert.equal((await port.refresh(externalRef)).status,'ALREADY_LINKED');
    await assert.rejects(
      createTrustedNativeContinuation({
        kernel:liveKernel,accessForRead:async()=>signed.access,
        currentWorkspace,nativeOwner:{
          recipientId:'agent:n8n',
          inspect:()=>({status:'READY',operationId:'n8n:old',
            recipientId:'agent:n8n',reference:firstD6Ref}),
          receive:async()=>{},receipt:async()=>null,readback:async()=>null,
        },confirmHuman:async()=>true,isHostActive:()=>true,
      }).preview(firstD6Ref),
      {code:'T3_D6_STALE_OR_MISSING_REFERENCE'});

    // A reply can vanish AFTER the ORIGINAL T2 Kernel has committed.
    // Recovery must use signed readback, not a second putObject.
    sourceRevision='2026-11-15 13:05:00.3000';
    sourceDigest='c'.repeat(64);
    let realWritesWithLostAck=0;
    const lossyKernel={...liveKernel,async putObject(command){
      realWritesWithLostAck++;
      await liveKernel.putObject(command);
      throw Object.assign(new Error('SIMULATED_ACK_LOST_AFTER_ORIGINAL_COMMIT'),
        {code:'T3_EXT_TEST_ACK_LOST'});
    }};
    const uncertain=await makePort(lossyKernel).refresh(externalRef);
    assert.equal(uncertain.status,'OUTCOME_UNKNOWN');
    assert.equal(realWritesWithLostAck,1);
    assert.equal((await port.recover(externalRef)).status,'LINK_PERSISTED');
    assert.equal((await port.refresh(externalRef)).status,'ALREADY_LINKED');
    const currentD6Ref=await port.prepareContinuation(externalRef);
    assert.equal(currentD6Ref.revision,3);
    const rejected=createTemporaryOriginalPersonalAuthority({
      workspaceId:ws,now:Date.now(),clock:Date.now,operations:ops});
    rejected.revoke();
    await assert.rejects(makePort(liveKernel,rejected.access).refresh(externalRef),
      {code:'T3_ACCESS_NOT_PERMITTED'});
    assert.equal((await port.recover(externalRef)).revision,3);

    // New independent ORIGINAL Ed25519 read-only grant, never a write
    // capability. Recovery and D6 source preparation must remain available
    // even after the unrelated writing grant has been revoked.
    const reader=createTemporaryOriginalPersonalAuthority({
      workspaceId:ws,now:Date.now(),clock:Date.now,
      operations:['t1.getWorkspace','t1.getObject']});
    let wronglyUsedWriteOwner=0;
    const readonlyPort=createTrustedExternalProcessLink({
      kernel:liveKernel,currentWorkspace,externalOwner,
      accessForRead:async operation=>{
        assert.equal(operation,'t1.getObject');return reader.access;},
      isHostActive:()=>true,
    });
    assert.equal((await readonlyPort.recover(externalRef)).status,'LINK_PERSISTED');
    assert.equal((await readonlyPort.prepareContinuation(externalRef)).revision,3);
    assert.ok(reader.proofCount>=4);
    await assert.rejects(readonlyPort.link(externalRef),
      {code:'T3_EXT_WRITE_NOT_GRANTED'});
    await assert.rejects(readonlyPort.refresh(externalRef),
      {code:'T3_EXT_WRITE_NOT_GRANTED'});
    assert.equal(wronglyUsedWriteOwner,0);

    // Original D2 must label the registered external events as *reported*.
    // It must never copy original ERP identity or customer payload into view.
    const activitySigned=createSubjectKernelBinding({
      kernel:liveKernel,access:signed.access});
    const activity=await readActivityFromT2Host({
      kernel:liveKernel,authorizedRead:activitySigned,workspace_id:ws,
      bindings:{
        objects:[{schema_id:EXTERNAL_PROCESS_LINK_SCHEMA,
          schema_version:'1.0.0',semantic_kind:'Evidence'}],
        events:[{event_type:EXTERNAL_PROCESS_LINK_EVENT,
          semantic_kind:'Event',epistemic_status:'reported'}],
      },
    });
    assert.equal(activity.nodes.some(x=>x.object_id===currentD6Ref.object_id),true);
    assert.equal(activity.events.filter(x=>x.epistemic_status==='reported').length,5);
    assert.equal(activity.events.some(x=>x.epistemic_status==='observed'),false);
    assert.equal(JSON.stringify(activity).includes('SO-0042'),false);
    assert.equal(JSON.stringify(activity).includes('private_customer'),false);
    assert.ok(humanCount>=3);

    // An installed Host with an unconnected ERP account cannot offer
    // execution of the locally saved external-process-link. Its original
    // signed Kernel read remains available, but no Human Review/dispatch.
    let missingAccountSends=0,missingAccountApprovals=0;
    const offlineRecipient={recipientId:'agent:missing-erp',
      inspect:({reference,recipientId})=>({
        status:'READY',operationId:'erpnext:account-not-connected',
        recipientId,reference}),
      receive:async()=>{missingAccountSends++;},
      receipt:async()=>null,readback:async()=>null,
    };
    const offlineContinuation=createTrustedNativeContinuation({
      kernel:liveKernel,accessForRead:async()=>signed.access,
      currentWorkspace,nativeOwner:offlineRecipient,
      confirmHuman:async()=>{missingAccountApprovals++;return true;},
      isHostActive:()=>true,
    });
    assert.equal((await offlineContinuation.preview(currentD6Ref)).status,
      'SOURCE_ACCOUNT_REQUIRED');
    assert.equal((await offlineContinuation.continueSelected(currentD6Ref)).status,
      'SOURCE_ACCOUNT_REQUIRED');
    assert.equal(missingAccountSends,0);
    assert.equal(missingAccountApprovals,0);
    console.log('T3_AGENT06_EXTERNAL_SOURCE_ACCOUNT_REQUIRED_PASS',
      JSON.stringify({originalKernel:true,accountConnected:false,
        sends:missingAccountSends,humanApprovals:missingAccountApprovals}));
    // A live ERP revision can change during Human Review even while the
    // signed original T2 Object stays at the same revision. Refuse BEFORE
    // native dispatch, using the existing external-process-link currentness.
    let staleDispatches=0;
    const staleOwner={recipientId:'agent:stale-preflight',
      inspect:({reference,recipientId})=>({
        status:'READY',operationId:'erpnext:stale-preflight',
        recipientId,reference}),
      receive:async()=>{staleDispatches++;},
      receipt:async()=>null,readback:async()=>null,
    };
    const staleD6=createTrustedNativeContinuation({
      kernel:liveKernel,accessForRead:async()=>signed.access,
      currentWorkspace,nativeOwner:staleOwner,
      sourceCurrent:()=>port.prepareContinuation(externalRef),
      confirmHuman:async()=>{
        sourceRevision='2026-11-15 13:06:00.4000';
        return true;
      },isHostActive:()=>true,
    });
    await assert.rejects(staleD6.continueSelected(currentD6Ref),
      {code:'T3_D6_EXTERNAL_SOURCE_NOT_CURRENT'});
    assert.equal(staleDispatches,0);
    sourceRevision='2026-11-15 13:05:00.3000';
    // Existing D6, no workflow engine: HTTP ACK cannot become a native
    // durable result; a new Host can only recover via the native owner.
    let sends=0,nativeReceipt=null,canonicalResultAvailable=false;
    let canonicalReads=0,resultKernel=liveKernel,resultAccess=signed.access;
    const nativeOwner={
      recipientId:'agent:n8n',
      inspect:({reference,recipientId})=>({
        status:sends>0?'RECOVER_ONLY':'READY',
        operationId:'n8n:SO-0042',recipientId,reference}),
      receive:async()=>{sends++;return {
        external_effect_state:'ACKNOWLEDGED',request_id:'transport:ack-only'};},
      receipt:async()=>nativeReceipt,
      readback:async()=>nativeReceipt?{...nativeReceipt,state:'PERSISTED'}:null,
    };
    // Synthetic CehoVod recipient boundary used ONLY to qualify D6 with
    // the ACTUAL original T2 signed source. No real CehoVod Result is issued.
    const resultOwner={
      ownerId:'cehovod:shop1',resultType:'plan-fact-analysis',
      orderRef:'po:fixture-42',executionRef:'pex:fixture-42',
      async verifySaved({resultRef,operationId,recipientId,sourceReference,
        orderRef,executionRef}){
        assert.equal(orderRef,'po:fixture-42');
        assert.equal(executionRef,'pex:fixture-42');
        canonicalReads++;
        const verifiedRead=createSubjectKernelBinding({
          kernel:resultKernel,access:resultAccess});
        const saved=await verifiedRead.getObject(ws,sourceReference.object_id);
        assert.equal(saved.object.revision,sourceReference.revision);
        if(!canonicalResultAvailable)return null;
        return {status:'ORIGINAL_DOMAIN_RESULT_VERIFIED',
          ownerId:'cehovod:shop1',resultType:'plan-fact-analysis',
          orderRef:'po:fixture-42',executionRef:'pex:fixture-42',
          resultRef,operationId,recipientId,
          workspaceId:ws,sourceReference,stage:'final',
          canonicalVerified:true,resultRevision:1};
      },
    };
    const d6=()=>createTrustedNativeContinuation({
      kernel:liveKernel,accessForRead:async()=>signed.access,
      currentWorkspace,nativeOwner,resultOwner,
      sourceCurrent:()=>port.prepareContinuation(externalRef),
      confirmHuman:async()=>true,isHostActive:()=>true,
    });
    assert.equal((await d6().continueSelected(currentD6Ref)).status,'OUTCOME_UNKNOWN');
    assert.equal((await d6().continueSelected(currentD6Ref)).status,'OUTCOME_UNKNOWN');
    assert.equal(sends,1);
    assert.equal(canonicalReads,0);
    nativeReceipt={operationId:'n8n:SO-0042',recipientId:'agent:n8n',
      reference:currentD6Ref,state:'COMMITTED',resultRef:'cehovod:pf:fixture-42'};
    const pendingDomain=await d6().recover(currentD6Ref);
    assert.equal(pendingDomain.status,'DOMAIN_RESULT_UNVERIFIED');
    assert.equal(pendingDomain.owner_action_confirmed,true);
    assert.equal(pendingDomain.domain_result_confirmed,false);
    assert.equal(pendingDomain.can_retry,false);
    canonicalResultAvailable=true;
    const domainProof=await d6().recover(currentD6Ref);
    assert.equal(domainProof.status,'DOMAIN_RESULT_READBACK_CONFIRMED');
    assert.equal(domainProof.resultRef,'cehovod:pf:fixture-42');
    assert.equal(domainProof.orderRef,'po:fixture-42');
    assert.equal(domainProof.executionRef,'pex:fixture-42');
    assert.equal(domainProof.resultRevision,1);
    assert.equal(sends,1);
    console.log('T3_AGENT06_D6_TWO_OWNER_CONTRACT_PASS',
      JSON.stringify({originalKernel:true,signedD1:true,
        syntheticDomainOwner:true,externalDispatches:sends,
        domainProofs:canonicalReads,domainResultInCehoVod:false}));
    console.log('T3_AGENT06_SIGNED_D1_REAL_KERNEL_PROCESS_PASS',
      JSON.stringify({contract:'1.3.0',kernel:'0.3.6',
        signedProofs:signed.proofCount,
        sourceRevision,revision:currentD6Ref.revision,
        originalActivityEvents:activity.events.length,
        signedReadback:true,lostAckNoReplay:realWritesWithLostAck===1,
        d6HttpAckRemainsUnknown:true}));

    await browser.close();browser=null;
    page=await open();
    const reopened=await page.evaluate(async({ws,obj,EXTERNAL})=>{
      const link=await globalThis.IWXA.connect({service_id:EXTERNAL});
      const x=await link.t1.getObject(ws,obj);
      const history=await link.t1.listEventsSince(ws);
      return {revision:x?.object?.revision,
        source_revision:x?.object?.data?.source_revision,
        eventTypes:history.map(e=>e.event_type)};
    },{ws,obj,EXTERNAL});
    assert.equal(reopened.revision,2);
    assert.equal(reopened.source_revision,written.snapshot.source_revision);
    assert.equal(reopened.eventTypes.filter(e=>e===EXTERNAL_PROCESS_LINK_EVENT).length,5);

    const coldKernel=await browserOriginalKernel(page);
    const coldSigned=createTemporaryOriginalPersonalAuthority({
      workspaceId:ws,now:Date.now(),clock:Date.now,operations:ops});
    resultKernel=coldKernel;resultAccess=coldSigned.access;
    const afterCold=createTrustedNativeContinuation({
      kernel:coldKernel,accessForRead:async()=>coldSigned.access,
      currentWorkspace,nativeOwner,resultOwner,confirmHuman:async()=>true,
      isHostActive:()=>true,
    });
    const coldDomainProof=await afterCold.recover(currentD6Ref);
    assert.equal(coldDomainProof.status,'DOMAIN_RESULT_READBACK_CONFIRMED');
    assert.equal(coldDomainProof.resultRef,'cehovod:pf:fixture-42');
    assert.equal(sends,1);
    const coldPort=makePort(coldKernel,coldSigned.access);
    const coldRecovered=await coldPort.recover(externalRef);
    assert.equal(coldRecovered.status,'LINK_PERSISTED');
    assert.equal(coldRecovered.revision,3);
    assert.equal((await coldPort.prepareContinuation(externalRef)).revision,3);
    // A cold original Host must show last saved ERP link even without any
    // external account/network. Do NOT label it current or allow dispatch.
    const offlineKernel={...coldKernel,
      hasOperation:op=>op!=='t1.putObject'&&coldKernel.hasOperation(op),
      putObject:()=>{throw Error('OFFLINE_READ_NEVER_WRITES');},
    };
    const savedOnly=createTrustedExternalProcessLink({
      kernel:offlineKernel,currentWorkspace,
      externalOwner:{ownerId:'erpnext:shop1'},
      accessForRead:async operation=>{
        assert.equal(operation,'t1.getObject');return coldSigned.access;},
      isHostActive:()=>true,
    });
    const cached=await savedOnly.readSaved(externalRef);
    assert.equal(cached.status,'SAVED_UNVERIFIED');
    assert.equal(cached.revision,3);
    assert.equal(cached.source_revision,sourceRevision);
    assert.equal(cached.epistemic_status,'reported');
    assert.equal(cached.owner_current,false);
    assert.equal(cached.can_execute,false);
    await assert.rejects(savedOnly.prepareContinuation(externalRef),
      {code:'T3_EXT_OWNER_ONLINE_REQUIRED'});
    await assert.rejects(savedOnly.refresh(externalRef),
      {code:'T3_EXT_WRITE_NOT_GRANTED'});
    console.log('T3_AGENT06_ORIGINAL_T2_OFFLINE_ERP_SNAPSHOT_PASS',
      JSON.stringify({revision:cached.revision,readOnly:true,
        ownerCurrent:false,canExecute:false}));
    assert.equal((await coldPort.link(externalRef)).status,'ALREADY_LINKED');
    assert.ok(coldSigned.proofCount>0);
    console.log('T3_AGENT06_SIGNED_D1_COLD_RECOVERY_PASS',
      JSON.stringify({revision:coldRecovered.revision,
        signedProofs:coldSigned.proofCount,
        sourceOwner:'erpnext:shop1',executedExternalERP:false}));
    // Exercise the REAL source normalizer against the ORIGINAL signed T2
    // Kernel. The HTTP response is a controlled Frappe-shaped fixture:
    // this is contract qualification, NOT a live ERPNext account operation.
    const erpResponse={data:{
      doctype:'Sales Order',name:'SO-0043',
      modified:'2026-11-15 13:20:00.1000',
      status:'To Deliver and Bill',docstatus:1,
      customer:'Confidential ERPNext customer',
      items:[{item_code:'SKU-001',qty:2,rate:1200}],
    }};
    const erpRef={expected_workspace_id:ws,record_kind:'Sales Order',
      record_id:'SO-0043'};
    const erpOwner={
      ownerId:'erpnext:shop1',
      readExact:async({record_kind,record_id})=>{
        assert.equal(record_kind,'Sales Order');
        return normalizeErpNextSalesOrderRead({
          ownerId:'erpnext:shop1',expectedRecordId:record_id,
          response:erpResponse,
        });
      },
    };
    const erpPort=createTrustedExternalProcessLink({
      kernel:coldKernel,currentWorkspace,externalOwner:erpOwner,
      accessForWrite:async()=>coldSigned.access,
      accessForRead:async()=>coldSigned.access,
      confirmHuman:async()=>true,isHostActive:()=>true,
    });
    const erpLinked=await erpPort.link(erpRef);
    assert.equal(erpLinked.status,'LINK_PERSISTED');
    assert.equal(erpLinked.revision,1);
    const storedErp=await coldKernel.getObject(ws,erpLinked.object_id);
    assert.equal(storedErp.object.data.record_id,'SO-0043');
    assert.equal(storedErp.object.data.source_receipt,null);
    assert.equal(storedErp.object.data.epistemic_status,'reported');
    assert.equal(JSON.stringify(storedErp.object).includes(
      'Confidential ERPNext customer'),false);
    assert.equal(JSON.stringify(storedErp.object).includes('SKU-001'),false);
    const digestBefore=storedErp.object.data.source_digest;
    // Same Frappe modified, but changed item: do not allow unstable source.
    erpResponse.data.items[0].qty=3;
    await assert.rejects(erpPort.refresh(erpRef),
      {code:'T3_EXT_SOURCE_REVISION_NOT_STABLE'});
    // Original owner now provides a newer exact revision. User consent and
    // ORIGINAL Kernel CAS keep the linked source conservative.
    erpResponse.data.modified='2026-11-15 13:21:00.2000';
    const erpUpdated=await erpPort.refresh(erpRef);
    assert.equal(erpUpdated.status,'LINK_PERSISTED');
    assert.equal(erpUpdated.revision,2);
    const finalErp=await coldKernel.getObject(ws,erpLinked.object_id);
    assert.notEqual(finalErp.object.data.source_digest,digestBefore);
    assert.equal(finalErp.object.data.source_revision,
      '2026-11-15 13:21:00.2000');
    assert.equal((await erpPort.prepareContinuation(erpRef)).revision,2);
    console.log('T3_AGENT06_ERPNext_REST_ORIGINAL_KERNEL_PASS',
      JSON.stringify({kernel:'0.3.6',signedD1:true,
        sourceOwner:'erpnext:shop1',revision:2,
        customerPersisted:false,liveErpNext:false}));
    console.log('T3_AGENT06_ORIGINAL_T2_ERP_LINK_PASSPORT_COLD_PASS',
      JSON.stringify({kernel:'0.3.6',contract:'1.3.0',
        revision:reopened.revision,originalEventCount:5,
        staleDenied:written.staleDenied,foreignDenied:written.foreignDenied}));
  }finally{
    if(browser)await browser.close().catch(()=>{});
    if(serving){
      serving.server.closeAllConnections();
      await new Promise(done=>serving.server.close(()=>done()));
    }
    process.chdir(oldCwd);
    rmSync(tmp,{recursive:true,force:true});
  }
});
