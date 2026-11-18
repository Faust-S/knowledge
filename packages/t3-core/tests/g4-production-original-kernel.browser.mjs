// Native Windows G4 witness: ORIGINAL private PRODUCTION DPAPI Admin issuer +
// independently proofed Agent employee + the SAME qualified original T2 0.3.6
// browser Kernel/Store. Not installed Tauri GUI, and Human decisions simulated.
// Only public test code is committed; original private sources are ephemeral.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {cpSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {materializeIntegrationHost,serveRealKernelHost}
  from '../scripts/real-kernel-e2e.mjs';
import {assertQualifiedKernelArtifact}
  from '../src/factory2/products/domain-completion/independent-browser-witness.mjs';
import {createSignedAccessHostPort}
  from '../src/t3/signed-access-host-port.mjs';
import {createTrustedReconciliationKernelApply}
  from '../src/t3/reconciliation-kernel-apply.mjs';
import {createOriginalKernelRegistryStatePort}
  from '../src/t3/access/original-kernel-registry-state.mjs';
import {createOriginalEmployeeEnrollmentOwner}
  from '../src/t3/access/original-employee-enrollment.mjs';

const SERVICE='iwxa.workspace.integration';
const REGISTRY='iwxa.t3.access.signed-registry';
const APPLIED='iwxa.admin.applied-results';
const ARTIFACT='iwxa-kernel-k036-same-store-history-20261019-qualified.1';
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const write=(base,path,content)=>{
  const full=join(base,...path.split('/'));
  mkdirSync(join(full,'..'),{recursive:true});
  writeFileSync(full,content);
  return full;
};
const no=code=>{throw Object.assign(Error(code),{code});};

export async function qualifyOriginalProductionEmployeeRealKernel({
  t3Root,prodRoot,workRoot,employeeCandidateRoot,employeeProcess,
  productionOrg,productionWs,candidate,onPhase=()=>{},
}={}){
  const qualified=process.env.G4_ORIGINAL_QUALIFIED_T2_DIST;
  if(process.platform!=='win32'||!qualified||
    !existsSync(join(qualified,'_iwxa/runtime/0.3.6/runtime.js')))
    no('G4_REAL_ORIGINAL_T2_QUALIFIED_DIST_REQUIRED');
  const prior=process.cwd();
  const project=join(prior,'packages','t3-core');
  process.chdir(project);
  const stage=join(workRoot,'actual-original-t2-host');
  const dist=join(stage,'dist'),profile=join(stage,'edge-profile');
  mkdirSync(dist,{recursive:true});
  let live=null,browser=null,owner=null;
  try{
    cpSync(join(qualified,'_iwxa'),join(dist,'_iwxa'),{recursive:true});
    assertQualifiedKernelArtifact(dist,{kernel:'0.3.6',
      contract:'1.3.0',artifactId:ARTIFACT});
    onPhase('ORIGINAL_PRODUCTION_KERNEL_REAL_HOST');
    live=await serveRealKernelHost(dist);
    const config=materializeIntegrationHost(dist,live.origin);
    config.domain.runtime.kernel_release='0.3.6';
    config.domain.runtime.runtime_version='0.3.6';
    config.workspaceConfig.host.required_runtime_version='0.3.6';
    config.workspaceConfig.host.required_contract_version='1.3.0';
    for(const schema of [REGISTRY,APPLIED]){
      config.domain.security.allowed_object_classes.push(schema);
      config.passport.input_object_types.push(schema);
      config.passport.output_object_types.push(schema);
      config.passport.permissions.objects.read.push(schema);
      config.passport.permissions.objects.write.push(schema);
      config.passport.schemas[schema]={
        schema_version:'1.0.0',preserve_unknown:true,
        json_schema:{type:'object'},embedded:{},
      };
    }
    config.passport.schemas[APPLIED].json_schema={
      type:'object',properties:{schema:{const:'IWXA_T3_ADMIN_APPLIED_RESULTS/1'}},
    };
    config.passport.permissions.operations=['t1.commitObjectGraph'];
    write(dist,'_iwxa/domain.json',JSON.stringify(config.domain));
    write(dist,'workspace/workspace.config.json',
      JSON.stringify(config.workspaceConfig));
    const filename='_iwxa/services/'+SERVICE+'.json';
    const passport=write(dist,filename,JSON.stringify(config.passport));
    write(dist,'_iwxa/service-catalog.json',JSON.stringify({
      count:1,entries:[{service_id:SERVICE,
        service_version:config.passport.service_version,
        base_path:config.passport.base_path,
        supported_levels:config.passport.supported_levels,
        file:filename,sha256:hash(passport)}],
    }));
    write(dist,'workspace/index.html',
      '<!doctype html><title>IWXA original T2 Kernel</title>'+
      '<script src="/_iwxa/loader.js"></script>');
    const launch=()=>chromium.launchPersistentContext(profile,{
      channel:'msedge',headless:true,ignoreHTTPSErrors:true,
    });
    browser=await launch();
    let page=await browser.newPage();
    await page.goto(live.origin+'/workspace/');
    await page.waitForFunction(()=>typeof window.IWXA?.connect==='function');
    const granted=await page.evaluate(async SERVICE=>{
      const s=await IWXA.connect({service_id:SERVICE});
      return {contract_version:s.contract_version,
        runtime_version:s.runtime_version,
        granted_operations:s.granted_operations};
    },SERVICE);
    assert.equal(granted.contract_version,'1.3.0');
    assert.equal(granted.runtime_version,'0.3.6');
    for(const id of ['t1.createWorkspace','t1.commitObjectGraph',
      't1.getWorkspace','t1.getObject','t1.listEventsSince'])
      assert.ok(granted.granted_operations.includes(id),
        'G4_REAL_T2_GRAPH_OPERATION_NOT_GRANTED');
    await page.evaluate(async({serviceId,workspaceId})=>{
      const s=await IWXA.connect({service_id:serviceId});
      await s.t1.createWorkspace({workspace_id:workspaceId,profile:'generic'});
    },{serviceId:SERVICE,workspaceId:productionWs});
    const facade={
      sessionInfo:{contract_version:'1.3.0',runtime_version:'0.3.6',
        service_id:SERVICE},
      hasOperation:id=>granted.granted_operations.includes(id),
      getWorkspace:workspaceId=>page.evaluate(async({serviceId,workspaceId})=>{
        const s=await IWXA.connect({service_id:serviceId});
        return s.t1.getWorkspace(workspaceId);
      },{serviceId:SERVICE,workspaceId}),
      getObject:(workspaceId,objectId)=>page.evaluate(
        async({serviceId,workspaceId,objectId})=>{
          const s=await IWXA.connect({service_id:serviceId});
          try{return await s.t1.getObject(workspaceId,objectId);}
          catch(e){
            if(e?.code==='OBJECT_NOT_FOUND')return null;
            throw e;
          }
        },{serviceId:SERVICE,workspaceId,objectId}),
      listEventsSince:(workspaceId,since)=>page.evaluate(
        async({serviceId,workspaceId,since})=>{
          const s=await IWXA.connect({service_id:serviceId});
          return s.t1.listEventsSince(workspaceId,since);
        },{serviceId:SERVICE,workspaceId,since}),
      commitObjectGraph:input=>page.evaluate(
        async({serviceId,input})=>{
          const s=await IWXA.connect({service_id:serviceId});
          return s.t1.commitObjectGraph(input);
        },{serviceId:SERVICE,input}),
    };
    const {openInstalledOriginalAdminD3HostPort}=await import(
      pathToFileURL(join(t3Root,'interop','native-admin-d3.mjs')).href);
    const args={
      root:prodRoot,organizationId:productionOrg,kernel:facade,
      createSignedAccessHostPort,createTrustedReconciliationKernelApply,
      createOriginalKernelRegistryStatePort,createOriginalEmployeeEnrollmentOwner,
      confirmHumanReview:async()=>false,confirmSeparateApply:async()=>false,
      isHostActive:()=>true,currentHostEpoch:()=>1,
    };
    owner=openInstalledOriginalAdminD3HostPort(args);
    const snap=owner.nativeState().view.snapshot;
    assert.equal(snap.d3EmployeeRegistryBootstrapAvailable,true);
    let binding={organizationId:productionOrg,workspaceId:productionWs,
      actorId:snap.actorId,contextId:snap.contextId,
      contextEpoch:snap.contextEpoch};
    const action=async(operation,input={},archivePath=null)=>{
      const request={organizationId:productionOrg,operation,input,binding,
        ...(archivePath?{archivePath}:{})};
      const output=await owner.nativeAction(request);
      return output.result;
    };
    onPhase('ORIGINAL_PRODUCTION_EMPLOYEE_KERNEL_BOOTSTRAP');
    const initial=await action('d3EmployeeRegistryReadback');
    assert.equal(initial.state,'ORIGINAL_KERNEL_REGISTRY_NOT_FOUND');
    const initialized=await action('d3EmployeeRegistryInitialize',
      {confirmed:true});
    assert.equal(initialized.state,'ORIGINAL_KERNEL_REGISTRY_CONFIRMED');
    assert.equal(initialized.originalKernel,true);
    const registered=await facade.getObject(productionWs,
      't3.access.signed-registry');
    assert.equal(registered.object.schema_id,REGISTRY);
    assert.equal(registered.object.revision,1);
    const originalEvents=await facade.listEventsSince(productionWs);
    assert.ok(originalEvents.some(e=>e.event_type===
      't3.access.signed_registry.persisted'));
    const registry=await action('d3EmployeeRegistryReadback');
    assert.equal(registry.originalReadback,true);
    onPhase('ORIGINAL_PRODUCTION_EMPLOYEE_KERNEL_CREDENTIAL');
    const begin=await action('d3EmployeeCredentialBegin',{
      employeePersonId:candidate.employeePersonId,
      credentialKeyId:candidate.credentialKeyId,
      keyRecord:candidate.employeeProofKeyRecord,
    });
    assert.equal(begin.state,'AWAITING_EMPLOYEE_CREDENTIAL_PROOF');
    const requestPath=write(workRoot,'original-kernel-credential-request.json',
      JSON.stringify(begin.employeeRequest));
    const first=employeeProcess('COLD_PROOF',{
      G4_EMPLOYEE_PUBLIC_REQUEST_PATH:requestPath,
      G4_EMPLOYEE_ORIGINAL_CHALLENGE:begin.employeeChallenge,
    });
    assert.equal(first.proof.keyId,candidate.credentialKeyId);
    const admitted=await action('d3EmployeeCredentialAdmit',{
      admissionId:begin.admissionId,
      employeePersonId:candidate.employeePersonId,
      credentialKeyId:candidate.credentialKeyId,
      employeeProof:first.proof,
    });
    assert.equal(admitted.state,'ORIGINAL_PROOF_CREDENTIAL_ADMITTED');
    assert.equal(admitted.exactReadback,true);
    onPhase('ORIGINAL_PRODUCTION_EMPLOYEE_KERNEL_ENROLLMENT');
    const started=await action('d3EmployeeBegin',{
      employeePersonId:candidate.employeePersonId,
      credentialKeyId:candidate.credentialKeyId,
    });
    assert.equal(started.state,'AWAITING_EMPLOYEE_PROOF');
    const memberRequest=write(workRoot,'original-kernel-membership-request.json',
      JSON.stringify(started.request));
    const second=employeeProcess('COLD_PROOF',{
      G4_EMPLOYEE_PUBLIC_REQUEST_PATH:memberRequest,
      G4_EMPLOYEE_ORIGINAL_CHALLENGE:started.challenge,
    });
    const signed=await action('d3EmployeeComplete',{
      enrollmentId:started.enrollmentId,
      employeePersonId:candidate.employeePersonId,
      credentialKeyId:candidate.credentialKeyId,
      employeeProof:second.proof,
    });
    assert.equal(signed.state,'SIGNED_EMPLOYEE_ENROLLED_NOT_DELIVERED');
    assert.equal(signed.originalSigned,true);
    const recovered=await action('d3EmployeeRead',{
      enrollmentId:started.enrollmentId,
      employeePersonId:candidate.employeePersonId,
    });
    assert.equal(recovered.originalReadback,true);
    assert.equal(recovered.state,'ORIGINAL_GRANTS_ACTIVE');
    const current=await facade.getObject(productionWs,
      't3.access.signed-registry');
    assert.equal(current.object.revision,3);
    const events=await facade.listEventsSince(productionWs);
    assert.equal(events.filter(e=>e.event_type===
      't3.access.signed_registry.persisted').length,3);
    console.log('G4_ORIGINAL_PRODUCTION_EMPLOYEE_REAL_T2_KERNEL_ENROLLED_PASS');
    onPhase('ORIGINAL_PRODUCTION_EMPLOYEE_KERNEL_TASK_DATA_GRANT');
    const taskGrant=await action('d3EmployeeTaskGrantIssue',{
      confirmed:true,employeePersonId:candidate.employeePersonId,
      enrollmentId:started.enrollmentId,
    });
    assert.equal(taskGrant.state,'ORIGINAL_MANAGER_TASK_DATA_ACTIVE');
    assert.equal(taskGrant.originalReadback,true);
    const invitePath=join(workRoot,'original-production-signed-invite.iwxa');
    onPhase('ORIGINAL_PRODUCTION_EMPLOYEE_KERNEL_INVITATION');
    const invitation=await action('d3EmployeeExportInvite',{
      employeePersonId:candidate.employeePersonId,
      enrollmentId:started.enrollmentId,
    },invitePath);
    assert.equal(invitation.originalSigned,true);
    assert.equal(invitation.invitationDelivered,false);
    assert.ok(existsSync(invitePath));
    const taskId='task:g4-'+randomUUID();
    onPhase('ORIGINAL_PRODUCTION_EMPLOYEE_KERNEL_SIGNED_TASK');
    const created=await action('d3EmployeeCreateTask',{
      confirmed:true,taskId,
      task:'Inspect equipment quotations, validate constraints and return accepted findings.',
      employeePersonId:candidate.employeePersonId,
      enrollmentId:started.enrollmentId,
    });
    onPhase('ORIGINAL_PRODUCTION_TASK_ISSUE_RETURNED');
    onPhase('ORIGINAL_PRODUCTION_TASK_RETURN_ASSERT');
    assert.equal(created.state,'SIGNED_TASK_CREATED_NOT_DELIVERED');
    assert.equal(created.recipientId,candidate.employeePersonId);
    onPhase('ORIGINAL_PRODUCTION_TASK_REATTACH');
    // Original signed Task increments the epoch and detaches the old Kernel.
    // Reattach the SAME qualified T2 facade with a fresh exact context,
    // without another signer, Store, or extra Kernel process.
    onPhase('ORIGINAL_PRODUCTION_TASK_REBIND');
    owner.attachOriginalKernel({
      kernel:facade,createSignedAccessHostPort,
      createTrustedReconciliationKernelApply,
      createOriginalKernelRegistryStatePort,
      createOriginalEmployeeEnrollmentOwner,
      confirmSeparateApply:async()=>false,
    });
    const fresh=owner.nativeState().view.snapshot;
    binding={organizationId:productionOrg,workspaceId:productionWs,
      actorId:fresh.actorId,contextId:fresh.contextId,
      contextEpoch:fresh.contextEpoch};
    // The original signed Task changed the Host epoch. Its Kernel binding
    // must first reconstruct signed employee rights READ-ONLY, not replay
    // registry initialization, a grant, or the Task's signature.
    onPhase('ORIGINAL_PRODUCTION_TASK_REBIND_READBACK');
    onPhase('ORIGINAL_PRODUCTION_TASK_REGISTRY_RECOVERY');
    const currentRegistry=await action('d3EmployeeRegistryReadback');
    onPhase('ORIGINAL_PRODUCTION_TASK_REGISTRY_ASSERT');
    assert.equal(currentRegistry.state,'ORIGINAL_KERNEL_REGISTRY_CONFIRMED');
    assert.equal(currentRegistry.originalReadback,true);
    onPhase('ORIGINAL_PRODUCTION_TASK_REBIND_STATUS_SEQUENCE');
    assert.equal(currentRegistry.statusSequence,4);
    const taskPath=join(workRoot,'original-production-signed-task.iwxa');
    onPhase('ORIGINAL_PRODUCTION_EMPLOYEE_KERNEL_TASK_EXPORT');
    const exported=await action('d3EmployeeExportTask',{
      taskId,employeePersonId:candidate.employeePersonId,
      enrollmentId:started.enrollmentId,
    },taskPath);
    assert.equal(exported.status,'EXPORTED_UNDELIVERED');
    assert.equal(exported.packageSha256,created.packageSha256);
    assert.ok(existsSync(taskPath));
    const latest=await facade.getObject(productionWs,
      't3.access.signed-registry');
    assert.equal(latest.object.revision,4);
    console.log('G4_ORIGINAL_PRODUCTION_EMPLOYEE_REAL_T2_TASK_ISSUED_PASS');

    // First source-only qualification ends at real Kernel grants; installed
    // native Human ACCEPT / separate Human APPLY is a distinct next gate.
    return {registryRevision:latest.object.revision,
      employeePersonId:candidate.employeePersonId,
      signedGrantIds:signed.grantIds,taskId,
      taskRevisionId:created.taskRevisionId,
      invitationPath:invitePath,taskPath};
  }finally{
    await owner?.close().catch(()=>{});
    await browser?.close().catch(()=>{});
    if(live?.server?.listening){
      live.server.closeAllConnections();
      await new Promise(resolve=>live.server.close(resolve));
    }
    process.chdir(prior);
  }
}
