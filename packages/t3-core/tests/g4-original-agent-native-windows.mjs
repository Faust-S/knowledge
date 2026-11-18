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
  const code=/^[A-Z][A-Z0-9_]{2,119}$/.test(error?.message??'')?
    error.message:'UNCLASSIFIED';
  console.error('G4_NATIVE_FAILURE_PHASE',step);
  console.error('G4_NATIVE_FAILURE_CODE',code);
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
  };
  const python=process.env.PYTHON_COMMAND??'python';
  const subprocess=spawnSync(python,[pythonDriver],{
    cwd:workRoot,env,encoding:'utf8',timeout:150000,maxBuffer:512*1024});
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
  assert.ok(employeeOutput.includes('G4_ORIGINAL_NATIVE_EMPLOYEE_SIGNED_TASK_PASS'));
  assert.ok(employeeOutput.includes('G4_ORIGINAL_NATIVE_EMPLOYEE_SIGNED_RESULT_PASS'));
  assert.ok(employeeOutput.includes('G4_ORIGINAL_NATIVE_EMPLOYEE_COLD_NO_REEXPORT_PASS'));
  console.log('G4_ORIGINAL_NATIVE_EMPLOYEE_SIGNED_TASK_PASS');
  console.log('G4_ORIGINAL_NATIVE_EMPLOYEE_SIGNED_RESULT_PASS');
  console.log('G4_ORIGINAL_NATIVE_EMPLOYEE_COLD_NO_REEXPORT_PASS');

  phase='ORIGINAL_ADMIN_RESULT_RECEIVE_ACCEPT';
  const bytes=readFileSync(resultPath);
  assert.ok(bytes.length>64);
  const received=admin.receive(bytes);
  const digest=received.transportReceipt.packageSha256;
  assert.equal(digest,createHash('sha256').update(bytes).digest('hex'));
  const preview=admin.review(digest);
  assert.equal(preview.changes.length,1);
  assert.equal(preview.preview.classification,'NEW');
  assert.ok(!JSON.stringify(preview).includes('PRIVATE_PERSONAL'));
  const decision=admin.decide(digest,{decision:'ACCEPT',
    previewDigest:preview.preview.previewDigest});
  assert.ok(decision);
  assert.equal(admin.snapshot().receipts.length,1);
  admin.close();admin=null;
  phase='ORIGINAL_ADMIN_COLD_READBACK';
  const reopened=openInterop({root:adminRoot,product:'admin',passphrase:password});
  try{
    assert.equal(reopened.snapshot().receipts.length,1);
    const checked=reopened.review(digest);
    assert.ok(checked);
    console.log('G4_ORIGINAL_NATIVE_ADMIN_ACCEPTED_READBACK_PASS');
  }finally{reopened.close();}

  // The previous signed employee exchange used an explicit TEST issuer.
  // Qualify the separately existing ORIGINAL production Admin enrollment
  // under genuine Windows DPAPI CurrentUser, with a NEW cold Node process.
  // This does not create a new signer, Kernel, Store or employee credential.
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
  const candidate=enrollOriginalWindowsEmployeeCandidate(employeeCandidateRoot,{
    audience:originalIdentity.audience,authorityId:originalIdentity.authority,
    confirmedIssuerSha256:createHash('sha256').update(issuerPublicKey).digest('hex'),
    issuerKeyId:originalIdentity.issuer,issuerPublicKey,
    managerPersonId:originalIdentity.reviewer,
    organizationDataRootId:originalIdentity.organizationDataRootId,
    organizationId:originalIdentity.org,
    organizationName:originalIdentity.organizationName,
    realmId:originalIdentity.realm,reviewKeyId:originalIdentity.reviewKey,
    reviewPublicKey,workspaceId:originalIdentity.workspace,
  });
  assert.equal(candidate.state,'AWAITING_ORIGINAL_MANAGER_ENROLLMENT');
  assert.equal(candidate.originalKernelEnrollment,false);
  assert.notEqual(candidate.employeePersonId,originalIdentity.reviewer);
  assert.ok(!Object.hasOwn(originalState.policy.keys,candidate.credentialKeyId));
  assert.deepEqual(originalWindowsEmployeeCandidate(employeeCandidateRoot),candidate);
  assert.throws(()=>enrollOriginalWindowsEmployeeCandidate(employeeCandidateRoot,{}),
    {code:'T3_EMPLOYEE_WINDOWS_CANDIDATE_EXISTS_READBACK'});
  phase='ORIGINAL_PRODUCTION_EMPLOYEE_COLD_PROOF';
  const {randomUUID,verify,createPublicKey}=await import('node:crypto');
  const {canonical,digest}=await import(pathToFileURL(
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
  // Cold independent process receives no manager vault, password, issuer key,
  // PAT, or private source bytes, only exact staged owner module paths.
  const coldScript=[
    "import{pathToFileURL}from'node:url';",
    "const [modulePath,root,requestJson,challenge]=process.argv.slice(1);",
    "const {originalWindowsEmployeeCandidate,proveOriginalWindowsEmployeeChallenge}=",
    "await import(pathToFileURL(modulePath).href);",
    "const candidate=originalWindowsEmployeeCandidate(root);",
    "const answer=proveOriginalWindowsEmployeeChallenge(root,JSON.parse(requestJson),challenge);",
    "if(candidate.employeePersonId!==answer.employeePersonId||",
    "candidate.credentialKeyId!==answer.credentialKeyId||",
    "answer.originalKernelWriteAttempted!==false)throw Error('COLD_EMPLOYEE_SCOPE_FAILED');",
    "console.log(JSON.stringify(answer.proof));"
  ].join('');
  const coldEmployee=spawnSync(process.execPath,
    ['--input-type=module','-e',coldScript,
      join(t3Root,'interop','native-employee-d3.mjs'),
      employeeCandidateRoot,JSON.stringify(request),challenge],
    {cwd:workRoot,env:{
      PATH:process.env.PATH??'',SystemRoot:process.env.SystemRoot??'',
      WINDIR:process.env.WINDIR??'',USERPROFILE:process.env.USERPROFILE??'',
      APPDATA:process.env.APPDATA??'',LOCALAPPDATA:process.env.LOCALAPPDATA??'',
      HOMEDRIVE:process.env.HOMEDRIVE??'',HOMEPATH:process.env.HOMEPATH??'',
      PSModulePath:process.env.PSModulePath??'',
      TEMP:process.env.TEMP??'',TMP:process.env.TMP??'',
    },encoding:'utf8',windowsHide:true,timeout:65000,maxBuffer:128*1024});
  assert.equal(coldEmployee.status,0,'G4_EMPLOYEE_COLD_PROOF_PROCESS_FAILED');
  const proof=JSON.parse(coldEmployee.stdout.trim());
  const proofMessage=Buffer.from('IWXA-T3-ACCESS-SIGNED-V1\\0'+canonical({
    schema:proof.schema,keyId:proof.keyId,payload:proof.payload
  }));
  assert.equal(proof.keyId,candidate.credentialKeyId);
  assert.equal(proof.payload.environment,'PRODUCTION');
  assert.equal(proof.payload.kind,'PROOF');
  assert.equal(proof.payload.challenge,challenge);
  assert.equal(proof.payload.requestDigest,digest(request));
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
}catch(error){phaseFail(phase,error)}
finally{try{admin?.close()}catch{}}
