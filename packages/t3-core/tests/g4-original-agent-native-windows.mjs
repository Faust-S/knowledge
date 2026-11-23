// Genuine ORIGINAL private T3 signed Admin + independent Agent Node Worker
// with a real Python IPC port. This is Windows NATIVE-PROCESS qualification;
// it is not an installed Setup Core / Tauri GUI acceptance.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const [t3Root,agentRoot,workRoot,pythonDriver]=process.argv.slice(2);
const phaseFail=(step,error)=>{
  // System errors have safe fixed Node codes; do not emit descriptions.
  const safe=value=>typeof value==='string'&&
    /^[A-Z][A-Z0-9_]{2,119}$/.test(value)?value:null;
  const code=safe(error?.code)??safe(error?.message)??'UNCLASSIFIED';
  console.error('G4_NATIVE_FAILURE_PHASE',step);
  console.error('G4_NATIVE_FAILURE_CODE',code);
  // Only a bounded exception TYPE is public. The private T3 stack, source,
  // signed payload, paths and key material never leave the Windows runner.
  const classes=['AssertionError','TypeError','ReferenceError','RangeError',
    'SyntaxError','Error','AggregateError'];
  console.error('G4_NATIVE_FAILURE_CLASS',
    classes.includes(error?.name)?error.name:'UNCLASSIFIED');
  process.exitCode=1;
};
let admin;
let phase='INIT';
try{
  assert.equal(process.platform,'win32');
  for(const dir of [t3Root,agentRoot,workRoot,pythonDriver])
    assert.equal(typeof dir,'string');
  mkdirSync(workRoot,{recursive:true});
  const {provision,I}=await import(pathToFileURL(
    join(t3Root,'interop','provision.mjs')).href);
  const {openInterop}=await import(pathToFileURL(
    join(t3Root,'interop','runtime.mjs')).href);
  const {windowsIdentity,dpapiProtect,dpapiUnprotect,windowsVaultSecret}=
    await import(pathToFileURL(
      join(t3Root,'access-control','windows-credential.mjs')).href);

  const adminRoot=join(workRoot,'admin');
  const employeeRoot=join(workRoot,'employee');
  const dir=join(workRoot,'transfer');
  mkdirSync(employeeRoot,{recursive:true});
  mkdirSync(dir,{recursive:true});
  phase='ORIGINAL_WINDOWS_IDENTITY';
  // Identity discovery is a read-only operation. CI Windows PowerShell
  // startup can fail transiently; never retry any signed or stored write.
  let identity;
  for(let attempt=1;attempt<=3;attempt++){
    try{identity=windowsIdentity();break;}
    catch(error){
      if(error?.message!=='WINDOWS_PROVIDER_FAILED'||attempt===3)
        throw error;
      console.log('G4_NATIVE_IDENTITY_READ_RETRY',attempt);
      await new Promise(resolve=>setTimeout(resolve,400*attempt));
    }
  }
  assert.ok(identity.sid&&identity.deviceId);
  phase='ORIGINAL_WINDOWS_DPAPI_PROTECT';
  const diagnostic=Buffer.from('g4-private-provider-warmup');
  const entropy=Buffer.from('iwxa-g4-native-source-fixture');
  const cipher=dpapiProtect(diagnostic,entropy);
  assert.ok(cipher.length>0);
  phase='ORIGINAL_WINDOWS_DPAPI_UNPROTECT';
  assert.deepEqual(dpapiUnprotect(cipher,entropy),diagnostic);
  phase='ORIGINAL_WINDOWS_MASTER_SECRET';
  const password=windowsVaultSecret(employeeRoot,{create:true});
  // Original signed TEST ceremony. The credential is NEVER passed to Agent
  // or its Python process; only the original DPAPI owner can recover it.
  phase='ORIGINAL_SIGNED_FIXTURE_PROVISION';
  provision({adminRoot,controlRoot:employeeRoot,passphrase:password,
    identity:I,now:Date.now(),environment:'TEST'});
  admin=openInterop({root:adminRoot,product:'admin',passphrase:password});
  phase='ORIGINAL_SIGNED_TASK_ISSUE';
  const invitation=admin.invite();
  const taskBytes=admin.createTask('Inspect two equipment quotations and return only accepted summary.');
  const invitePath=join(dir,'invitation.iwxa'),taskPath=join(dir,'task.iwxa');
  const resultPath=join(dir,'employee-result.iwxa');
  writeFileSync(invitePath,invitation,{flag:'wx'});
  writeFileSync(taskPath,taskBytes,{flag:'wx'});

  phase='AGENT_INDEPENDENT_PYTHON_NODE_IPC';
  const env={
    PATH:process.env.PATH??'',SystemRoot:process.env.SystemRoot??'',
    WINDIR:process.env.WINDIR??'',USERPROFILE:process.env.USERPROFILE??'',
    APPDATA:process.env.APPDATA??'',LOCALAPPDATA:process.env.LOCALAPPDATA??'',
    HOMEDRIVE:process.env.HOMEDRIVE??'',HOMEPATH:process.env.HOMEPATH??'',
    PSModulePath:process.env.PSModulePath??'',ComSpec:process.env.ComSpec??'',
    ProgramData:process.env.ProgramData??'',PATHEXT:process.env.PATHEXT??'',
    TEMP:process.env.TEMP??'',TMP:process.env.TMP??'',
    HOME:process.env.HOME??'',
    PYTHONPATH:agentRoot,
    PYTHONDONTWRITEBYTECODE:'1',PYTHONNOUSERSITE:'1',
    IWXA_T3_ORIGINAL_OWNER_DIR:t3Root,
    G4_CONTROL_ROOT:employeeRoot,
    G4_INVITE_PATH:invitePath,G4_TASK_PATH:taskPath,
    G4_RESULT_PATH:resultPath,
    G4_AGENT_CORE_ROOT:join(workRoot,'ephemeral-agent-core'),
    G4_SOURCE_EXPECT_NO_KERNEL:'1',
    G4_AGENT_OLLAMA_BASE_URL:process.env.G4_AGENT_OLLAMA_BASE_URL??'',
    G4_AGENT_OLLAMA_MODEL:process.env.G4_AGENT_OLLAMA_MODEL??'',
    OLLAMA_HOST:process.env.OLLAMA_HOST??'',
    OLLAMA_MODELS:process.env.OLLAMA_MODELS??'',
  };
  const python=process.env.PYTHON_COMMAND??'python';
  const subprocess=spawnSync(python,[pythonDriver],{
    cwd:workRoot,env,encoding:'utf8',timeout:420000,maxBuffer:512*1024});
  const employeeOutput=(subprocess.stdout??'')+'\n'+(subprocess.stderr??'');
  if(subprocess.status!==0){
    // Only the existing, declassified phase and machine code may appear
    // outside the original private Agent employee process.
    const step=employeeOutput.match(/G4_NATIVE_FAILURE_PHASE\s+([A-Z_]{3,80})/);
    const code=employeeOutput.match(/G4_NATIVE_FAILURE_CODE\s+([A-Z0-9_]{3,120})/);
    console.log('G4_NATIVE_EMPLOYEE_FAILURE_PHASE',
      step?.[1]??'UNCLASSIFIED');
    console.log('G4_NATIVE_EMPLOYEE_FAILURE_CODE',
      code?.[1]??'UNCLASSIFIED');
    const cls=employeeOutput.match(/G4_NATIVE_FAILURE_CLASS\s+(KeyError|TypeError|ValueError|AssertionError|CorporateT3Error|OSError|TimeoutError|AttributeError|RuntimeError|IndexError)/);
    console.log('G4_NATIVE_EMPLOYEE_FAILURE_CLASS',
      cls?.[1]??'UNCLASSIFIED');
    throw Error('G4_NATIVE_EMPLOYEE_IPC_ORIGINAL_FAIL');
  }
  // This TEST invitation intentionally has no original T2 Kernel and
  // cannot count as successful Agent execution in released 0.6.2. A real
  // signed original corporate Task/Result follows below against PRODUCTION
  // and must prove the original T2 attachment independently.
  assert.ok(employeeOutput.includes(
    'G4_AGENT_ORIGINAL_KERNEL_MISSING_REFUSAL_PASS'),
    'G4_SOURCE_MISSING_T2_HOST_MUST_NOT_ACCEPT_TASK');
  console.log('G4_AGENT_ORIGINAL_KERNEL_MISSING_REFUSAL_PASS');
  admin.close();admin=null;

  // The real original production owner and One Core continue below. This
  // negative source preflight does not establish signed Task/Result success.
  phase='ORIGINAL_PRODUCTION_OWNER_ENROLL';
  const {runNativeAdminD3}=await import(pathToFileURL(
    join(t3Root,'interop','native-admin-d3.mjs')).href);
  const prodRoot=join(workRoot,'production-owner');
  const productionOrg='org:g4:original-windows-probe';
  const productionWs='workspace:g4:original-windows-probe';
  const requestPath=join(dir,'production-owner-command.json');
  writeFileSync(requestPath,JSON.stringify({
    organizationId:productionOrg,
    workspaceId:productionWs,
    organizationName:'IWXA G4 Native Owner Qualification',
  }),{flag:'wx'});
  const enrolled=runNativeAdminD3([
    'd3-enroll',prodRoot,productionOrg,requestPath,
  ]);
  assert.equal(enrolled?.schema,'IWXA_T3_ADMIN_D3_NATIVE/1');
  assert.equal(enrolled.organizationId,productionOrg);
  assert.equal(enrolled.operation,'D3_ENROLLED');
  assert.equal(enrolled.ownerMode,'ORIGINAL_SIGNED_CORPORATE_D3');
  assert.equal(enrolled.view?.status,'D3_OWNER_READY');
  // Production owner is not the whole T3 G4 product; it deliberately reports
  // productionActivation=false and T3_READY=false in public native status.
  assert.equal(enrolled.productionActivation,false);
  assert.equal(enrolled.T3_READY,false);
  phase='ORIGINAL_PRODUCTION_OWNER_COLD_READBACK';
  const originalModule=join(t3Root,'interop','native-admin-d3.mjs');
  const source=[
    "import{pathToFileURL}from'node:url';",
    "const [modulePath,root,organization,workspace]=process.argv.slice(1);",
    "const {runNativeAdminD3}=await import(pathToFileURL(modulePath).href);",
    "const state=runNativeAdminD3(['d3-state',root,organization]);",
    "if(state?.schema!=='IWXA_T3_ADMIN_D3_NATIVE/1'||",
    "state.ownerMode!=='ORIGINAL_SIGNED_CORPORATE_D3'||",
    "state.organizationId!==organization||",
    "state.view?.status!=='D3_OWNER_READY'||",
    "state.view?.snapshot?.workspaceId!==workspace||",
    "state.view?.snapshot?.d3RecipientAvailable!==true||",
    "state.productionActivation!==false||state.T3_READY!==false)",
    "throw Error('G4_ORIGINAL_PRODUCTION_OWNER_COLD_READBACK_FAILED');",
    "console.log('G4_ORIGINAL_PRODUCTION_OWNER_COLD_READBACK_PASS');",
  ].join('');
  const coldProd=spawnSync(process.execPath,
    ['--input-type=module','-e',source,originalModule,prodRoot,
      productionOrg,productionWs],
    {cwd:workRoot,env:{
      PATH:process.env.PATH??'',SystemRoot:process.env.SystemRoot??'',
      WINDIR:process.env.WINDIR??'',USERPROFILE:process.env.USERPROFILE??'',
      APPDATA:process.env.APPDATA??'',LOCALAPPDATA:process.env.LOCALAPPDATA??'',
      HOMEDRIVE:process.env.HOMEDRIVE??'',HOMEPATH:process.env.HOMEPATH??'',
      PSModulePath:process.env.PSModulePath??'',
      TEMP:process.env.TEMP??'',TMP:process.env.TMP??'',
    },encoding:'utf8',windowsHide:true,timeout:45000,maxBuffer:128*1024});
  assert.equal(coldProd.status,0,
    'G4_ORIGINAL_PRODUCTION_OWNER_COLD_READBACK_FAILED');
  assert.ok((coldProd.stdout??'').includes(
    'G4_ORIGINAL_PRODUCTION_OWNER_COLD_READBACK_PASS'));
  console.log('G4_ORIGINAL_PRODUCTION_OWNER_COLD_READBACK_PASS');

  // Independently created Windows employee key and cold DPAPI proof. This
  // candidate is NOT signed membership or installed Admin/Agent G4 acceptance.
  phase='ORIGINAL_PRODUCTION_EMPLOYEE_FIRST_USE';
  const {enrollOriginalWindowsEmployeeCandidate,
    originalWindowsEmployeeCandidate,
    proveOriginalWindowsEmployeeChallenge}=await import(pathToFileURL(
      join(t3Root,'interop','native-employee-d3.mjs')).href);
  const originalIdentity=JSON.parse(readFileSync(join(prodRoot,'identity.json'),'utf8'));
  const originalState=JSON.parse(readFileSync(join(prodRoot,'registry.json'),'utf8')).state;
  const issuerPublicKey=originalState.policy.keys[originalIdentity.issuer].publicKey;
  const reviewPublicKey=originalState.policy.keys[originalIdentity.reviewKey].publicKey;
  const employeeCandidateRoot=join(workRoot,'independent-windows-employee');
  const profile={
    audience:originalIdentity.audience,authorityId:originalIdentity.authority,
    confirmedIssuerSha256:createHash('sha256').update(issuerPublicKey).digest('hex'),
    issuerKeyId:originalIdentity.issuer,issuerPublicKey,
    managerPersonId:originalIdentity.reviewer,
    organizationDataRootId:originalIdentity.organizationDataRootId,
    organizationId:originalIdentity.org,
    organizationName:originalIdentity.organizationName,
    realmId:originalIdentity.realm,reviewKeyId:originalIdentity.reviewKey,
    reviewPublicKey,workspaceId:originalIdentity.workspace,
  };
  const profilePath=join(dir,'production-employee-public-profile.json');
  writeFileSync(profilePath,JSON.stringify(profile),{flag:'wx'});
  const firstUseDriver=join(process.cwd(),'packages','t3-core','tests',
    'g4-original-employee-bootstrap-driver.py');
  // Real second Windows logon SID: the existing Agent Python/Node bridge
  // creates and cold-opens an ORIGINAL T3 employee DPAPI candidate using
  // only public manager trust. No manager private key crosses user profiles.
  // This qualifies source custody, not installed GUI or ACCEPT/APPLY.
  phase='ORIGINAL_PRODUCTION_SECOND_WINDOWS_SID_AGENT_DPAPI';
  const twoSidDriver=join(process.cwd(),'packages','t3-core','tests',
    'g4-original-agent-second-windows-sid.ps1');
  const twoSid=spawnSync('powershell.exe',[
    '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
    '-File',twoSidDriver,'-T3Root',t3Root,
    '-AgentRoot',agentRoot,'-PythonDriver',firstUseDriver,
    '-PublicProfilePath',profilePath,
  ],{cwd:workRoot,env:{
    PATH:process.env.PATH??'',SystemRoot:process.env.SystemRoot??'',
    WINDIR:process.env.WINDIR??'',
    ProgramData:process.env.ProgramData??'',
    USERPROFILE:process.env.USERPROFILE??'',
    APPDATA:process.env.APPDATA??'',
    LOCALAPPDATA:process.env.LOCALAPPDATA??'',
    HOMEDRIVE:process.env.HOMEDRIVE??'',
    HOMEPATH:process.env.HOMEPATH??'',
    TEMP:process.env.TEMP??'',TMP:process.env.TMP??'',
    COMPUTERNAME:process.env.COMPUTERNAME??'',
    PSModulePath:process.env.PSModulePath??'',
    ComSpec:process.env.ComSpec??'',
    G4_ORIGINAL_PYTHON_COMMAND:process.env.G4_ORIGINAL_PYTHON_COMMAND??'',
    G4_ORIGINAL_NODE_COMMAND:process.env.G4_ORIGINAL_NODE_COMMAND??'',
  },encoding:'utf8',windowsHide:true,timeout:260000,maxBuffer:128*1024});
  const twoSidOutput=(twoSid.stdout??'')+'\n'+(twoSid.stderr??'');
  if(twoSid.status!==0){
    const failPhase=twoSidOutput.match(
      /G4_ORIGINAL_AGENT_TWO_SID_FAILURE_PHASE\s+([A-Z0-9_]{3,119})/);
    const failCode=twoSidOutput.match(
      /G4_ORIGINAL_AGENT_TWO_SID_FAILURE_CODE\s+([A-Z0-9_]{3,119})/);
    console.log('G4_ORIGINAL_AGENT_TWO_SID_FAILURE_PHASE',
      failPhase?.[1]??'UNCLASSIFIED');
    console.log('G4_ORIGINAL_AGENT_TWO_SID_FAILURE_CODE',
      failCode?.[1]??'UNCLASSIFIED');
    const nativeAcl=twoSidOutput.match(
      /G4_ORIGINAL_EMPLOYEE_SHARED_ROOT_(GRANT|ISOLATE)_EXIT\s+([0-9]{1,5})/);
    if(nativeAcl)console.log('G4_ORIGINAL_AGENT_TWO_SID_ACL_STATUS',
      nativeAcl[1]+'_'+nativeAcl[2]);
    throw Error('G4_ORIGINAL_AGENT_SECOND_SID_DPAPI_SOURCE_NOT_ACCEPTED');
  }
  for(const marker of [
    'G4_ORIGINAL_AGENT_SECOND_SID_NATIVE_FIRST_USE_PASS',
    'G4_ORIGINAL_AGENT_SECOND_SID_NATIVE_DPAPI_COLD_PASS',
    'G4_ORIGINAL_AGENT_SECOND_SID_NATIVE_SIGNED_PROOF_PASS',
    'G4_ORIGINAL_AGENT_SECOND_SID_CRYPTO_PROOF_VERIFIED_PASS',
  ]){
    assert.ok(twoSidOutput.includes(marker),
      'G4_ORIGINAL_AGENT_SECOND_SID_SOURCE_MARKER_MISSING');
    console.log(marker);
  }
  const firstUseEnv={
    PATH:process.env.PATH??'',SystemRoot:process.env.SystemRoot??'',
    WINDIR:process.env.WINDIR??'',USERPROFILE:process.env.USERPROFILE??'',
    APPDATA:process.env.APPDATA??'',LOCALAPPDATA:process.env.LOCALAPPDATA??'',
    HOMEDRIVE:process.env.HOMEDRIVE??'',HOMEPATH:process.env.HOMEPATH??'',
    PSModulePath:process.env.PSModulePath??'',
    TEMP:process.env.TEMP??'',TMP:process.env.TMP??'',
    PYTHONPATH:agentRoot,PYTHONDONTWRITEBYTECODE:'1',
    PYTHONNOUSERSITE:'1',IWXA_T3_ORIGINAL_OWNER_DIR:t3Root,
    G4_EMPLOYEE_BOOTSTRAP_ROOT:employeeCandidateRoot,
    G4_EMPLOYEE_PUBLIC_PROFILE_PATH:profilePath,
  };
  const employeeProcess=(mode,extra={},expectedFailure=null)=>{
    const result=spawnSync(python,[firstUseDriver],{
      cwd:workRoot,env:{...firstUseEnv,...extra,
        G4_EMPLOYEE_BOOTSTRAP_MODE:mode},
      encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:128*1024
    });
    if(expectedFailure!==null){
      const code=(result.stdout??'').match(
        /G4_EMPLOYEE_BOOTSTRAP_FAILURE_CODE\s+([A-Z0-9_]{3,119})/);
      assert.notEqual(result.status,0,
        'G4_EMPLOYEE_FIRST_USE_REPLAY_UNEXPECTEDLY_ACCEPTED');
      assert.equal(code?.[1],expectedFailure,
        'G4_EMPLOYEE_FIRST_USE_REPLAY_DENIAL_REASON_CHANGED');
      return null;
    }
    if(result.status!==0){
      const message=(result.stdout??'').match(
        /G4_EMPLOYEE_BOOTSTRAP_FAILURE_CODE\s+([A-Z0-9_]{3,119})/);
      console.log('G4_AGENT_FIRST_USE_FAILURE_CODE',
        message?.[1]??'UNCLASSIFIED');
      throw Error('G4_AGENT_FIRST_USE_NATIVE_PROCESS_FAILED');
    }
    return JSON.parse(result.stdout.trim());
  };
  const candidate=employeeProcess('CREATE').candidate;
  assert.equal(candidate.state,'AWAITING_ORIGINAL_MANAGER_ENROLLMENT');
  assert.equal(candidate.originalKernelEnrollment,false);
  assert.notEqual(candidate.employeePersonId,originalIdentity.reviewer);
  assert.ok(!Object.hasOwn(originalState.policy.keys,candidate.credentialKeyId));
  assert.deepEqual(originalWindowsEmployeeCandidate(employeeCandidateRoot),candidate);
  assert.throws(()=>enrollOriginalWindowsEmployeeCandidate(employeeCandidateRoot,{}),
    {code:'T3_EMPLOYEE_WINDOWS_CANDIDATE_EXISTS_READBACK'});
  // The Agent IPC must likewise deny a SECOND first-use without minting keys.
  // A failed consequential native write stays unknown inside this process;
  // the next operation is an independent cold, read-only original opening.
  phase='ORIGINAL_PRODUCTION_EMPLOYEE_AGENT_NO_REPLAY';
  employeeProcess('CREATE',{},'T3_EMPLOYEE_WINDOWS_CANDIDATE_EXISTS_READBACK');
  console.log('G4_ORIGINAL_PRODUCTION_AGENT_FIRST_USE_NO_REPLAY_PASS');
  phase='ORIGINAL_PRODUCTION_EMPLOYEE_COLD_PROOF';
  const {randomUUID,verify,createPublicKey}=await import('node:crypto');
  const {canonical,digest:originalDigest}=await import(pathToFileURL(
    join(t3Root,'access-control','core.mjs')).href);
  const challenge=randomBytes(32).toString('hex');
  const request={
    id:'proof-key:employee:'+randomUUID(),
    actorId:candidate.employeePersonId,principalId:productionOrg,
    roleId:'worker',grantId:'proof-key:prospective',
    audience:'t3.employee.enrollment',resource:productionWs,
    action:'work.prepare',purpose:'work',realmId:originalIdentity.realm,
    operationDigest:createHash('sha256').update('g4-original-employee-first-use')
      .digest('hex'),
  };
  // A separate cold Agent Python process opens ORIGINAL T3 DPAPI custody.
  // It receives only public challenge data and never an issuer private key.
  const challengePath=join(dir,'production-employee-public-request.json');
  writeFileSync(challengePath,JSON.stringify(request),{flag:'wx'});
  phase='ORIGINAL_PRODUCTION_EMPLOYEE_AGENT_COLD_IPC_PROOF';
  const coldEmployee=employeeProcess('COLD_PROOF',{
    G4_EMPLOYEE_PUBLIC_REQUEST_PATH:challengePath,
    G4_EMPLOYEE_ORIGINAL_CHALLENGE:challenge,
  });
  assert.deepEqual(coldEmployee.candidate,candidate);
  const proof=coldEmployee.proof;
  const proofMessage=Buffer.from('IWXA-T3-ACCESS-SIGNED-V1\0'+canonical({
    schema:proof.schema,keyId:proof.keyId,payload:proof.payload
  }));
  assert.equal(proof.keyId,candidate.credentialKeyId);
  assert.equal(proof.payload.environment,'PRODUCTION');
  assert.equal(proof.payload.kind,'PROOF');
  assert.equal(proof.payload.challenge,challenge);
  assert.equal(proof.payload.requestDigest,originalDigest(request));
  assert.ok(verify(null,proofMessage,
    createPublicKey(candidate.employeeProofKeyRecord.publicKey),
    Buffer.from(proof.signature,'base64url')));
  assert.throws(()=>proveOriginalWindowsEmployeeChallenge(
    employeeCandidateRoot,{...request,principalId:'org:foreign'},challenge),
    {code:'T3_EMPLOYEE_ORIGINAL_CHALLENGE_SCOPE_CHANGED'});
  assert.throws(()=>proveOriginalWindowsEmployeeChallenge(
    employeeCandidateRoot,{...request,actorId:originalIdentity.reviewer},challenge),
    {code:'T3_EMPLOYEE_ORIGINAL_CHALLENGE_SCOPE_CHANGED'});
  console.log('G4_ORIGINAL_PRODUCTION_INDEPENDENT_EMPLOYEE_CREDENTIAL_COLD_PASS');
  console.log('G4_ORIGINAL_PRODUCTION_INDEPENDENT_AGENT_IPC_FIRST_USE_PASS');
  // Original manager D3 issues a second, distinct employee membership
  // challenge AFTER the Kernel credential admission. Confirm the employee's
  // same original DPAPI key can sign precisely this alternate request shape.
  // This checks the signature only, NOT a Kernel membership grant.
  phase='ORIGINAL_PRODUCTION_EMPLOYEE_MEMBER_PROOF';
  const enrollmentId=randomUUID();
  const membershipRequest={
    ...request,id:'employee-proof:'+enrollmentId,
    grantId:'enrollment:'+enrollmentId,
    operationDigest:createHash('sha256').update(
      'g4-original-employee-membership-intent').digest('hex'),
  };
  const membershipChallenge=randomUUID()+randomUUID();
  const membershipRequestPath=join(dir,
    'production-employee-public-membership-request.json');
  writeFileSync(membershipRequestPath,JSON.stringify(membershipRequest),
    {flag:'wx'});
  const secondEmployee=employeeProcess('COLD_PROOF',{
    G4_EMPLOYEE_PUBLIC_REQUEST_PATH:membershipRequestPath,
    G4_EMPLOYEE_ORIGINAL_CHALLENGE:membershipChallenge,
  });
  assert.deepEqual(secondEmployee.candidate,candidate);
  const membershipProof=secondEmployee.proof;
  assert.equal(membershipProof.keyId,candidate.credentialKeyId);
  assert.equal(membershipProof.payload.kind,'PROOF');
  assert.equal(membershipProof.payload.environment,'PRODUCTION');
  assert.equal(membershipProof.payload.challenge,membershipChallenge);
  assert.equal(membershipProof.payload.requestDigest,originalDigest(
    membershipRequest));
  const memberBytes=Buffer.from('IWXA-T3-ACCESS-SIGNED-V1\0'+canonical({
    schema:membershipProof.schema,keyId:membershipProof.keyId,
    payload:membershipProof.payload,
  }));
  assert.ok(verify(null,memberBytes,
    createPublicKey(candidate.employeeProofKeyRecord.publicKey),
    Buffer.from(membershipProof.signature,'base64url')));
  assert.throws(()=>proveOriginalWindowsEmployeeChallenge(
    employeeCandidateRoot,
    {...membershipRequest,grantId:'proof-key:prospective'},
    membershipChallenge),
    {code:'T3_EMPLOYEE_ORIGINAL_CHALLENGE_SCOPE_CHANGED'});
  console.log('G4_ORIGINAL_PRODUCTION_AGENT_MEMBERSHIP_CHALLENGE_PASS');
  phase='ORIGINAL_PRODUCTION_REAL_T2_EMPLOYEE_KERNEL';
  const {qualifyOriginalProductionEmployeeRealKernel}=await import(
    pathToFileURL(join(process.cwd(),'packages','t3-core','tests',
      'g4-production-original-kernel.browser.mjs')).href);
  const kernelEvidence=await qualifyOriginalProductionEmployeeRealKernel({
    t3Root,prodRoot,workRoot,employeeCandidateRoot,employeeProcess,
    agentRoot,pythonDriver,productionOrg,productionWs,candidate,
    onPhase:next=>{phase=next;},
  });
  assert.equal(kernelEvidence.registryRevision,4);
  assert.ok(kernelEvidence.signedGrantIds.work&&
    kernelEvidence.signedGrantIds.export);
  // The exact signed invitation and Task were imported once by the existing
  // original Agent IPC; cold-read them using a NEW independent Agent process.
  phase='ORIGINAL_PRODUCTION_EMPLOYEE_AGENT_IMPORT_TASK';
  const expectedOriginalTask={
    organizationId:productionOrg,workspaceId:productionWs,
    executorId:candidate.employeePersonId,taskId:kernelEvidence.taskId,
    taskRevisionId:kernelEvidence.taskRevisionId,
    packageSha256:createHash('sha256').update(
      readFileSync(kernelEvidence.taskPath)).digest('hex'),
  };
  const expectedPath=join(dir,'production-employee-original-task-binding.json');
  writeFileSync(expectedPath,JSON.stringify(expectedOriginalTask),{flag:'wx'});
  const employeeTaskDriver=join(process.cwd(),'packages','t3-core','tests',
    'g4-original-employee-real-task-driver.py');
  const deliver=mode=>{
    const result=spawnSync(python,[employeeTaskDriver],{
      cwd:workRoot,encoding:'utf8',windowsHide:true,
      timeout:120000,maxBuffer:128*1024,
      env:{...firstUseEnv,G4_AGENT_EMPLOYEE_TASK_MODE:mode,
        G4_AGENT_EMPLOYEE_EXPECTED_FILE:expectedPath,
        G4_AGENT_ORIGINAL_INVITATION_PATH:kernelEvidence.invitationPath,
        G4_AGENT_ORIGINAL_TASK_PATH:kernelEvidence.taskPath},
    });
    if(result.status!==0){
      const safe=(result.stdout??'').match(
        /G4_AGENT_EMPLOYEE_TASK_FAILURE_CODE\s+([A-Z0-9_]{3,119})/);
      console.log('G4_ORIGINAL_AGENT_DELIVERY_FAILURE_CODE',
        safe?.[1]??'UNCLASSIFIED');
      throw Error('G4_ORIGINAL_AGENT_DELIVERY_PROCESS_FAILED');
    }
    const receipt=JSON.parse(result.stdout.trim());
    assert.equal(receipt.verified,true);
    assert.equal(receipt.mode,mode);
  };
  // The original manager->employee Agent IPC has ALREADY imported the
  // invitation and exact Task and produced its signed Result in the
  // production Kernel helper. Re-importing here would replay a durable
  // membership write. This extra process is READ-ONLY cold verification.
  console.log('G4_ORIGINAL_PRODUCTION_EMPLOYEE_AGENT_SIGNED_TASK_RECEIVE_PASS');
  phase='ORIGINAL_PRODUCTION_EMPLOYEE_AGENT_TASK_COLD';
  deliver('COLD_READBACK');
  console.log('G4_ORIGINAL_PRODUCTION_EMPLOYEE_AGENT_TASK_COLD_READBACK_PASS');


}catch(error){phaseFail(phase,error)}
finally{try{admin?.close()}catch{}}
