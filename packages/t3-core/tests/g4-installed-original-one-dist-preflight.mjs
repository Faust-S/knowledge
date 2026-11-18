// Public-only original T2 + public One Core distribution probe.
// Does not load original private T3 or Center source. Probe the EXACT
// installed Admin D3 profile, not a test-only fake original Kernel.
import {existsSync,rmSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {assembleSignedControlDist}
  from '../scripts/assemble-signed-control-dist.mjs';
import {materializeOriginalAdminT2Product}
  from '../scripts/materialize-original-admin-t2-product.mjs';

const qualified=process.env.G4_INSTALLED_QUALIFIED_T2_DIST;
const compiled=join(process.cwd(),'packages','t3-core','dist');
const testDir=mkdtempSync(join(tmpdir(),'g4-installed-admin-dist-preflight-'));
const output=join(testDir,'one-dist');
try{
  if(!qualified||!existsSync(qualified)||!existsSync(compiled))
    throw Error('G4_INSTALLED_ONE_DIST_INPUT_NOT_PRESENT');
  // A public-only preflight cannot inspect the PRIVATE Center product
  // profile; this deliberately test-only mirror exercises original
  // qualified-byte staging. The installed private builder must separately
  // verify its actual Center-owned profile before any native build.
  const profilePath=join(testDir,'public-profile-fixture.json');
  writeFileSync(profilePath,JSON.stringify({
    schema:'IWXA_ADMIN_ORIGINAL_T2_PRODUCT_PROFILE/1',
    productId:'iwxa.admin-center',serviceId:'iwxa.admin-center.workspace',
    configVersion:'0.3.0-dev.1',origin:'http://127.0.0.1:38471',
    workspaceProfile:'generic',localStoreName:'iwxa-local',
    kernelVersion:'0.3.6',runtimeContract:'1.3.0',
    qualifiedArtifactId:
      'iwxa-kernel-k036-same-store-history-20261019-qualified.1',
    authorizedNativeOwner:'ORIGINAL_T3_SIGNED_ADMIN',
    installedAdminT3Mode:'EXPLICIT_OPT_IN',
  }),{flag:'wx'});
  const source=join(testDir,'original-admin-t2');
  const stage=await materializeOriginalAdminT2Product({
    qualifiedKernelDist:qualified,centerProfile:profilePath,outputRoot:source,
  });
  if(stage.originalKernelBytesUnchanged!==true||
     stage.serviceId!=='iwxa.admin-center.workspace')
    throw Error('G4_INSTALLED_PUBLIC_PRODUCT_STAGE_NOT_VERIFIED');
  console.log('G4_INSTALLED_PUBLIC_ADMIN_PRODUCT_T2_STAGE_PASS_TEST_PROFILE_ONLY');
  const result=assembleSignedControlDist({
    t2Dist:source,t3Build:compiled,outputDir:output,
    installedOriginalAdminD3:true,desktopAdminControlOnly:true,
  });
  if(result.schema!=='iwxa.t3.signed-control-one-dist/1'||
      result.original_admin_d3_schema_registered!==true||
      result.original_runtime_unchanged!==true||
      result.local_inference_registered!==false||
      result.original_kernel!=='0.3.6')
    throw Error('G4_INSTALLED_ONE_DIST_RESULT_INCOMPLETE');
  console.log('G4_INSTALLED_ORIGINAL_ONE_DIST_PUBLIC_PREFLIGHT_PASS');
}catch(error){
  const value=String(error?.message??error?.code??'');
  // The inherited qualified T2 witness reports an exact missing/altered
  // PUBLIC artifact path after a colon. Never print raw exception messages
  // or absolute paths; show a constrained relative public path only.
  const mismatch=value.match(
    /^FACTORY2_WITNESS_KERNEL_ARTIFACT_MISMATCH:([A-Za-z0-9_.\\/-]{1,150})$/);
  const code=mismatch
    ?'FACTORY2_WITNESS_KERNEL_ARTIFACT_MISMATCH'
    :/^(?:T3_D1_DIST|G4_INSTALLED|FACTORY2_WITNESS|T2)_[A-Z0-9_./-]{4,150}$/.test(value)
      ?value:'G4_INSTALLED_ONE_DIST_UNCLASSIFIED';
  console.error('G4_INSTALLED_PUBLIC_ASSEMBLER_FAILURE_CODE',code);
  // This preflight job checks out PUBLIC knowledge only, with NO private
  // T3/Center sources or secrets. Its local assembler error is safe to
  // diagnose directly, unlike the later private Bun/Rust build.
  console.error('G4_INSTALLED_PUBLIC_ASSEMBLER_ERROR',value.slice(0,500));
  if(mismatch)console.error('G4_INSTALLED_QUALIFIED_PUBLIC_RELATIVE_FILE',mismatch[1]);
  const kind=String(error?.code??'');
  if(/^(ENOENT|EACCES|ENOTDIR|EEXIST|EPERM)$/.test(kind))
    console.error('G4_INSTALLED_PUBLIC_ASSEMBLER_FS_CODE',kind);
  process.exitCode=1;
}finally{
  rmSync(testDir,{recursive:true,force:true,maxRetries:3});
}