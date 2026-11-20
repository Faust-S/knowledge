// Genuine original T2 0.3.6 bytes in an existing IWXA integration Host.
// A qualified Kernel artifact is not by itself a complete domain One Dist.
// Reuse the established materializeIntegrationHost, not a second Kernel.
// No original private issuer or fake signed receipt is used in this test.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,extname,sep} from 'node:path';
import {prepareOriginalAgentAtlasGraph}
  from '../src/t3/native-agent-atlas-source-publisher.mjs';
import {assembleSignedControlDist} from '../scripts/assemble-signed-control-dist.mjs';
import {materializeIntegrationHost} from '../scripts/real-kernel-e2e.mjs';
import {assertQualifiedKernelArtifact}
  from '../src/factory2/products/domain-completion/independent-browser-witness.mjs';

const qualified=process.env.IWXA_T2_QUALIFIED_KERNEL_DIST;
assert.ok(typeof qualified==='string'&&qualified.length>0,
  'T3_D6_QUALIFIED_ORIGINAL_T2_REQUIRED');
const dir=mkdtempSync(join(tmpdir(),'iwxa-t3-agent-d6-original-'));
const source=join(dir,'qualified-integration-host'),output=join(dir,'agent-one-dist');
const base=resolve('.');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const artifactId='iwxa-kernel-k036-same-store-history-20261019-qualified.1';
let origin='',browser=null;
const server=createServer((req,res)=>{
  const send=(status,body,type='text/plain')=>{
    res.writeHead(status,{'content-type':type,'cache-control':'no-store',
      'x-content-type-options':'nosniff',
      'content-security-policy':"default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'self';"});
    res.end(body);
  };
  if(req.headers.host!==new URL(origin).host)
    return send(403,'ORIGINAL_HOST_DENIED');
  let url;
  try{url=new URL(req.url,origin);}catch{return send(404,'INVALID_URL');}
  if(url.pathname==='/__original_agent_d6_kernel_probe__')
    return send(200,'<!doctype html><title>Original T2 Agent D6</title>'+
      '<script src="/_iwxa/loader.js"></script>','text/html');
  if(!/^\/(?:_iwxa|workspace)\/[A-Za-z0-9_.\/-]+$/.test(url.pathname))
    return send(404,'ORIGINAL_ROUTE_REQUIRED');
  const file=resolve(output,'.'+url.pathname);
  if(!file.startsWith(resolve(output)+sep))
    return send(403,'ORIGINAL_PATH_DENIED');
  try{
    const mime={'.js':'text/javascript','.mjs':'text/javascript',
      '.json':'application/json','.html':'text/html','.wasm':'application/wasm',
      '.css':'text/css','.ico':'image/x-icon'};
    return send(200,readFileSync(file),
      mime[extname(file)]??'application/octet-stream');
  }catch{return send(404,'ORIGINAL_RESOURCE_MISSING');}
});
const launch=()=>chromium.launchPersistentContext(join(dir,'browser-profile'),{
  headless:true,serviceWorkers:'block',
});
try{
  await new Promise((ok,bad)=>{
    server.once('error',bad);
    server.listen(0,'127.0.0.1',ok);
  });
  origin='http://127.0.0.1:'+server.address().port;
  mkdirSync(join(source,'workspace/assets'),{recursive:true});
  cpSync(join(qualified,'_iwxa'),join(source,'_iwxa'),{recursive:true});
  assertQualifiedKernelArtifact(source,{
    kernel:'0.3.6',contract:'1.3.0',artifactId,
  });
  // The same original integration Host materializer is already exercised
  // by t3-d1-signed-control-one-dist.browser.mjs on the real T2 Kernel.
  const host=materializeIntegrationHost(source,origin);
  host.domain.runtime.kernel_release='0.3.6';
  host.domain.runtime.runtime_version='0.3.6';
  host.workspaceConfig.host.required_runtime_version='0.3.6';
  host.workspaceConfig.host.required_contract_version='1.3.0';
  writeFileSync(join(source,'_iwxa/domain.json'),JSON.stringify(host.domain));
  writeFileSync(join(source,'workspace/workspace.config.json'),
    JSON.stringify(host.workspaceConfig));
  const serviceId=host.workspaceConfig.workspace_service_id;
  const servicePath='_iwxa/services/'+serviceId+'.json';
  const originalPassport=Buffer.from(JSON.stringify(host.passport));
  writeFileSync(join(source,servicePath),originalPassport);
  writeFileSync(join(source,'_iwxa/service-catalog.json'),JSON.stringify({
    count:1,entries:[{
      service_id:serviceId,service_version:host.passport.service_version,
      base_path:host.passport.base_path,
      supported_levels:host.passport.supported_levels,
      file:servicePath,sha256:sha(originalPassport),
    }],
  }));
  writeFileSync(join(source,'workspace/index.html'),
    '<!doctype html><title>Original qualified T2 source</title>');
  cpSync(join(base,'public/favicon.ico'),join(source,'workspace/favicon.ico'));

  const originalRuntime=readFileSync(
    join(source,'_iwxa/runtime/0.3.6/runtime.js'));
  const originalLoader=readFileSync(join(source,'_iwxa/loader.js'));
  const assembled=assembleSignedControlDist({
    t2Dist:source,t3Build:join(base,'dist'),
    outputDir:output,installedOriginalAgentD6:true,
  });
  assert.equal(assembled.original_qualified_artifact,artifactId);
  assert.equal(assembled.original_kernel,'0.3.6');
  assert.equal(assembled.original_runtime_unchanged,true);
  assert.equal(assembled.original_agent_d6_schema_registered,true);
  assert.equal(assembled.original_admin_d3_schema_registered,false);
  assert.equal(sha(readFileSync(join(output,'_iwxa/runtime/0.3.6/runtime.js'))),
    sha(originalRuntime),'original T2 runtime changed');
  assert.equal(sha(readFileSync(join(output,'_iwxa/loader.js'))),
    sha(originalLoader),'original T2 loader changed');

  const catalog=JSON.parse(readFileSync(
    join(output,'_iwxa/service-catalog.json'),'utf8'));
  const entry=catalog.entries.find(x=>x.service_id===serviceId);
  assert.ok(entry&&entry.file===servicePath);
  const assembledPassport=readFileSync(join(output,servicePath));
  assert.equal(sha(assembledPassport),entry.sha256);
  assert.equal(sha(readFileSync(join(source,servicePath))),sha(originalPassport));
  const installed=JSON.parse(assembledPassport);
  assert.equal(installed.schemas['iwxa.agent.accepted-result']?.schema_version,'1.0.0');
  assert.equal(installed.schemas['iwxa.t3.company-work-record']?.schema_version,'1.0.0');
  assert.equal(installed.schemas['iwxa.t3.access.signed-registry']?.schema_version,'1.0.0');
  assert.deepEqual(installed.schemas['iwxa.t3.access.signed-registry'].json_schema,
    {type:'object'},'the original signed D1 policy is not reimplemented by Agent');
  assert.equal(installed.schemas['iwxa.admin.applied-results'],undefined);
  assert.deepEqual(installed.permissions.operations,['t1.commitObjectGraph']);
  assert.equal(installed.permissions.workspace.create,
    host.passport.permissions.workspace.create,
    'Agent D6 may not widen original Workspace creation rights');
  for(const row of [installed.permissions.objects.read,
    installed.permissions.objects.write,installed.input_object_types,
    installed.output_object_types]){
    for(const schema of ['iwxa.agent.accepted-result','iwxa.t3.company-work-record',
      'iwxa.t3.access.signed-registry'])
      assert.ok(row.includes(schema),'original D6 schema not authorized: '+schema);
  }
  assert.equal(sha(readFileSync(join(source,'_iwxa/runtime/0.3.6/runtime.js'))),
    sha(originalRuntime),'qualified original Kernel source mutated');
  // Actual original T2 Kernel 1.3.0 Object+Event, using the canonical
  // existing T3 D6 graph builder and installed Agent-only schema. This is
  // NOT an original private employee signer or Atlas recipient qualification.
  const workspace='agent-d6-original-'+randomUUID();
  const binding={
    schema:'IWXA_AGENT_T3_ORIGINAL_ATLAS_PUBLICATION/1',
    recipientId:'iwxa.atlas',
    signedTaskId:'task:public-graph-test',
    signedTaskRevisionId:'rev:1',
    signedTaskPackageSha256:'a'.repeat(64),
    taskId:'TASK-CHAT-'+'1'.repeat(24),
    resultId:'RES-public-accepted',
    acceptedDigest:'b'.repeat(64),
    workRef:{projectId:'project:public',workId:'work:source',revision:'3'},
    contextDigest:'c'.repeat(64),
  };
  const canonical=value=>Array.isArray(value)
    ?'['+value.map(canonical).join(',')+']'
    :value!==null&&typeof value==='object'
      ?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+
        canonical(value[k])).join(',')+'}'
      :JSON.stringify(value);
  const operationId='agent:t3:atlas:'+createHash('sha256')
    .update(canonical(binding)).digest('hex');
  const accepted={
    acceptanceKind:'HUMAN_ACCEPTED_DRAFT',readOnly:true,
    taskId:binding.taskId,resultId:binding.resultId,
    acceptedDigest:binding.acceptedDigest,
    signedTaskId:binding.signedTaskId,
    signedTaskRevisionId:binding.signedTaskRevisionId,
    signedTaskPackageSha256:binding.signedTaskPackageSha256,
    workRef:structuredClone(binding.workRef),
  };
  const graph=prepareOriginalAgentAtlasGraph({
    operationId,binding,accepted,workspace_id:workspace,
  });
  // Independently prove the unchanged ORIGINAL T2 Kernel accepts COMPLETE
  // corporate Result text through the newly registered Agent-only schema.
  // This public fixture does NOT claim a private Human ACCEPT/Task signature.
  const completeText='Принятое корпоративное исследование. '.repeat(44000);
  assert.ok(completeText.length>1200000&&completeText.length<=2000000);
  const data={
    schema:'IWXA_T3_ORIGINAL_COMPANY_WORK_RECORD/1',
    kind:'RESULT',artifactId:'RES-public-accepted',
    operationId:'accepted:RES-public-accepted',
    organizationId:'org:public-company',workspaceId:workspace,
    executorId:'person:public-worker',taskId:'task:public-graph-test',
    taskRevisionId:'a'.repeat(64),taskPackageSha256:'b'.repeat(64),
    mimeType:'application/json',text:completeText,
    sha256:sha(Buffer.from(completeText,'utf8')),
    sourceKind:'ORIGINAL_AGENT_HUMAN_ACCEPTED',
  };
  const companyKey=sha(Buffer.from(JSON.stringify([
    data.organizationId,data.workspaceId,data.taskId,
    data.taskRevisionId,data.kind,data.artifactId,
  ]),'utf8'));
  const companyGraph={
    workspace_id:workspace,idempotency_key:companyKey,
    object:{
      object_id:'company:work:'+companyKey,
      schema_id:'iwxa.t3.company-work-record',schema_version:'1.0.0',
      base_revision:0,data,
    },
    relation_puts:[],relation_deletes:[],
    event:{event_type:'iwxa.company.work-record.committed',
      payload:{
        schema:data.schema,kind:data.kind,artifactId:data.artifactId,
        operationId:data.operationId,organizationId:data.organizationId,
        workspaceId:data.workspaceId,executorId:data.executorId,
        taskId:data.taskId,taskRevisionId:data.taskRevisionId,
        taskPackageSha256:data.taskPackageSha256,
        artifactSha256:data.sha256,sourceKind:data.sourceKind,
        objectId:'company:work:'+companyKey,
      }},
  };
  const probe=origin+'/__original_agent_d6_kernel_probe__';
  const ready=async()=>{
    browser=await launch();
    const page=browser.pages()[0]||await browser.newPage();
    await page.goto(probe);
    await page.waitForFunction(()=>typeof window.IWXA?.connect==='function');
    return page;
  };
  const page=await ready();
  const written=await page.evaluate(async({serviceId,workspace,graph})=>{
    const kernel=await window.IWXA.connect({service_id:serviceId});
    if(kernel.contract_version!=='1.3.0'||
       !kernel.granted_operations.includes('t1.commitObjectGraph'))
      throw Error('T3_AGENT_D6_ORIGINAL_KERNEL_GRAPH_NOT_GRANTED');
    await kernel.t1.createWorkspace({
      workspace_id:workspace,profile:'generic',
    });
    const receipt=await kernel.t1.commitObjectGraph(graph);
    return {revision:receipt.object?.revision,
      eventId:receipt.event?.event_id,
      objectId:receipt.object?.object_id,
      idempotencyKey:receipt.event?.idempotency_key};
  },{serviceId,workspace,graph});
  assert.equal(written.revision,1);
  assert.equal(written.objectId,graph.object.object_id);
  assert.equal(written.idempotencyKey,graph.idempotency_key);
  assert.ok(written.eventId,
    'the real inherited Kernel must persist an original Event');
  const companyWritten=await page.evaluate(async({serviceId,companyGraph})=>{
    const kernel=await window.IWXA.connect({service_id:serviceId});
    const receipt=await kernel.t1.commitObjectGraph(companyGraph);
    return {revision:receipt.object?.revision,
      objectId:receipt.object?.object_id,
      eventId:receipt.event?.event_id,
      idempotencyKey:receipt.event?.idempotency_key};
  },{serviceId,companyGraph});
  assert.equal(companyWritten.revision,1);
  assert.equal(companyWritten.objectId,companyGraph.object.object_id);
  assert.equal(companyWritten.idempotencyKey,companyKey);

  // Completely close the browser process between independent Kernel reads.
  // Do not call commitObjectGraph again, and do not fake either receipt.
  for(let coldIndex=1;coldIndex<=2;coldIndex++){
    await browser.close();browser=null;
    const coldPage=await ready();
    const observed=await coldPage.evaluate(async({
      serviceId,graph,written,companyGraph,companyWritten
    })=>{
      const kernel=await window.IWXA.connect({service_id:serviceId});
      const raw=await kernel.t1.getObject(
        graph.workspace_id,graph.object.object_id);
      const company=await kernel.t1.getObject(
        companyGraph.workspace_id,companyGraph.object.object_id);
      const events=await kernel.t1.listEventsSince(graph.workspace_id);
      return {object:raw?.object??null,
        company:company?.object??null,
        matched:events.filter(e=>
          e.event_id===written.eventId&&
          e.event_type===graph.event.event_type&&
          e.idempotency_key===graph.idempotency_key),
        companyEvents:events.filter(e=>
          e.event_id===companyWritten.eventId&&
          e.event_type===companyGraph.event.event_type&&
          e.idempotency_key===companyGraph.idempotency_key)};
    },{serviceId,graph,written,companyGraph,companyWritten});
    assert.equal(observed.object?.revision,1);
    assert.deepEqual(observed.object.data,graph.object.data);
    assert.equal(observed.matched.length,1,
      'each cold original T2 read must see the same one Event');
    assert.equal(observed.company?.revision,1);
    assert.deepEqual(observed.company.data,companyGraph.object.data);
    assert.equal(observed.company.data.sha256,data.sha256);
    assert.equal(observed.companyEvents.length,1,
      'company Result must survive both original T2 cold Event reads');
  }
  console.log('AGENT_COMPANY_COMPLETE_TEXT_ORIGINAL_KERNEL_TWO_COLD_READS_PASS');
  console.log('AGENT_D6_ORIGINAL_KERNEL_OBJECT_EVENT_TWO_COLD_READS_PASS');
  console.log('AGENT_D6_ORIGINAL_QUALIFIED_ONE_DIST_PROFILE_PASS');
}finally{
  if(browser)await browser.close().catch(()=>{});
  server.closeAllConnections();
  if(server.listening)await new Promise(ok=>server.close(()=>ok()));
  rmSync(dir,{recursive:true,force:true});
}
