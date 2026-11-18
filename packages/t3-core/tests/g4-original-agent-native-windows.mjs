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
  const {windowsVaultSecret}=await import(pathToFileURL(
    join(t3Root,'access-control','windows-credential.mjs')).href);

  const adminRoot=join(workRoot,'admin');
  const employeeRoot=join(workRoot,'employee');
  const dir=join(workRoot,'transfer');
  mkdirSync(employeeRoot,{recursive:true});
  mkdirSync(dir,{recursive:true});
  phase='ORIGINAL_DPAPI_PROVISION';
  const password=windowsVaultSecret(employeeRoot,{create:true});
  // Original signed TEST ceremony. The credential is NEVER passed to Agent
  // or its Python process; only the original DPAPI owner can recover it.
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
    WINDIR:process.env.WINDIR??'',TEMP:process.env.TEMP??'',
    TMP:process.env.TMP??'',HOME:process.env.HOME??'',
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
  assert.equal(subprocess.status,0,
    'G4_NATIVE_EMPLOYEE_IPC_ORIGINAL_FAIL');
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
}catch(error){phaseFail(phase,error)}
finally{try{admin?.close()}catch{}}
