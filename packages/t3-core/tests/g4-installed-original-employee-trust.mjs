// Produce ONLY PUBLIC trust for an installed second-SID employee from the
// actual original signed Admin owner. No synthetic issuer, bypass, or shared key.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,realpathSync,writeFileSync,rmSync} from 'node:fs';
import {basename,dirname,isAbsolute,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const fail=code=>{throw Error(code);};
const allowed=e=>typeof e?.message==='string'&&/^G4_[A-Z0-9_]{3,105}$/.test(e.message)
  ?e.message:'G4_INSTALLED_ORIGINAL_EMPLOYEE_TRUST_NOT_READY';
function scoped(root,destination,name){
  if(!isAbsolute(destination)||dirname(resolve(destination)).toLowerCase()!==root.toLowerCase()||
    basename(destination)!==name||existsSync(destination))
    fail('G4_INSTALLED_EMPLOYEE_TRUST_SCOPE_INVALID');
  return resolve(destination);
}
export async function prepareInstalledEmployeePublicTrust({
  sourceDir,privateRoot,publicFile,runnerTemp=process.env.RUNNER_TEMP,
}={}){
  if(process.platform!=='win32')fail('G4_INSTALLED_EMPLOYEE_TRUST_WINDOWS_REQUIRED');
  if(![sourceDir,privateRoot,publicFile,runnerTemp].every(x=>typeof x==='string'&&isAbsolute(x)))
    fail('G4_INSTALLED_EMPLOYEE_TRUST_PATHS_REQUIRED');
  const runner=realpathSync(runnerTemp);
  const original=realpathSync(sourceDir);
  if(basename(original)!=='g4-installed-original-employee-owner'||
     dirname(original).toLowerCase()!==runner.toLowerCase())
    fail('G4_INSTALLED_EMPLOYEE_TRUST_SOURCE_SCOPE_CHANGED');
  const manager=scoped(runner,privateRoot,'g4-installed-original-admin-private');
  const publicTrust=scoped(runner,publicFile,'g4-installed-original-employee-trust.json');
  mkdirSync(manager,{mode:0o700});
  try {
    // Current-user manager DPAPI and keys may only be readable by SYSTEM or
    // local Administrators, never a separately created ordinary employee SID.
    const icacls=join(process.env.SystemRoot??'','System32','icacls.exe');
    const protectedRoot=spawnSync(icacls,[manager,'/inheritance:r','/grant:r',
      '*S-1-5-18:(OI)(CI)F','*S-1-5-32-544:(OI)(CI)F'],{
      windowsHide:true,encoding:'utf8',timeout:20000,maxBuffer:32000
    });
    if(protectedRoot.status!==0||protectedRoot.error)
      fail('G4_INSTALLED_EMPLOYEE_MANAGER_PRIVATE_ACL_FAILED');
    const native=await import(pathToFileURL(join(original,'interop','native-admin-d3.mjs')).href);
    if(typeof native.runNativeAdminD3!=='function')
      fail('G4_INSTALLED_EMPLOYEE_ORIGINAL_MANAGER_NOT_AVAILABLE');
    const suffix=randomUUID().slice(0,12);
    const orgId='org:g4:installed-employee-'+suffix;
    const wsId='workspace:g4:installed-employee-'+suffix;
    const request=join(manager,'enroll-request.json');
    writeFileSync(request,JSON.stringify({
      organizationId:orgId,workspaceId:wsId,
      organizationName:'IWXA G4 Installed Employee Qualification',
    }),{flag:'wx',mode:0o600});
    const ownerRoot=join(manager,'original-admin');
    const enrolled=native.runNativeAdminD3(['d3-enroll',ownerRoot,orgId,request]);
    if(enrolled?.schema!=='IWXA_T3_ADMIN_D3_NATIVE/1'||
       enrolled.organizationId!==orgId||enrolled.operation!=='D3_ENROLLED'||
       enrolled.ownerMode!=='ORIGINAL_SIGNED_CORPORATE_D3'||
       enrolled.view?.status!=='D3_OWNER_READY'||
       enrolled.view?.snapshot?.workspaceId!==wsId)
      fail('G4_INSTALLED_EMPLOYEE_MANAGER_NATIVE_ENROLL_INVALID');
    const identity=JSON.parse(readFileSync(join(ownerRoot,'identity.json'),'utf8'));
    const state=JSON.parse(readFileSync(join(ownerRoot,'registry.json'),'utf8')).state;
    const issuer=state.policy.keys[identity.issuer].publicKey;
    const review=state.policy.keys[identity.reviewKey].publicKey;
    const digest=value=>createHash('sha256').update(value,'utf8').digest('hex');
    if(identity.org!==orgId||identity.workspace!==wsId||
       typeof issuer!=='string'||typeof review!=='string'||issuer===review)
      fail('G4_INSTALLED_EMPLOYEE_TRUST_ORIGINAL_STATE_CHANGED');
    const profile={
      audience:identity.audience,authorityId:identity.authority,
      confirmedIssuerSha256:digest(issuer),
      issuerKeyId:identity.issuer,issuerPublicKey:issuer,
      managerPersonId:identity.reviewer,
      organizationDataRootId:identity.organizationDataRootId,
      organizationId:identity.org,organizationName:identity.organizationName,
      realmId:identity.realm,reviewKeyId:identity.reviewKey,
      reviewPublicKey:review,workspaceId:identity.workspace,
    };
    if(Object.values(profile).some(x=>typeof x!=='string'||!x))
      fail('G4_INSTALLED_EMPLOYEE_PUBLIC_TRUST_INCOMPLETE');
    writeFileSync(publicTrust,JSON.stringify(profile),{flag:'wx',mode:0o600});
    console.log('G4_INSTALLED_ORIGINAL_ADMIN_NATIVE_TRUST_CREATED_PASS');
    console.log('G4_INSTALLED_ORIGINAL_ADMIN_PRIVATE_ROOT_ISOLATED_PASS');
    console.log('G4_INSTALLED_EMPLOYEE_PUBLIC_TRUST_ONLY_PASS');
    return {manager,publicTrust};
  }catch(e){
    // No leaked private enrolment if a proof cannot complete.
    rmSync(manager,{recursive:true,force:true,maxRetries:2});
    rmSync(publicTrust,{force:true});
    throw e;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  prepareInstalledEmployeePublicTrust({
    sourceDir:process.argv[2],privateRoot:process.argv[3],publicFile:process.argv[4],
  }).catch(e=>{console.error(allowed(e));process.exitCode=1;});
}