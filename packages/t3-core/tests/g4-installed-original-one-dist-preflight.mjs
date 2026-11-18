// Public-only original T2 + public One Core distribution probe.
// Does not load original private T3 or Center source. Probe the EXACT
// installed Admin D3 profile, not a test-only fake original Kernel.
import {existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {assembleSignedControlDist}
  from '../scripts/assemble-signed-control-dist.mjs';

const qualified=process.env.G4_INSTALLED_QUALIFIED_T2_DIST;
const compiled=join(process.cwd(),'packages','t3-core','dist');
const output=join(tmpdir(),'g4-installed-admin-dist-preflight-'+randomUUID());
try{
  if(!qualified||!existsSync(qualified)||!existsSync(compiled))
    throw Error('G4_INSTALLED_ONE_DIST_INPUT_NOT_PRESENT');
  const result=assembleSignedControlDist({
    t2Dist:qualified,t3Build:compiled,outputDir:output,
    installedOriginalAdminD3:true,
  });
  if(result.schema!=='iwxa.t3.signed-control-one-dist/1'||
      result.original_admin_d3_schema_registered!==true||
      result.original_runtime_unchanged!==true||
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
  if(mismatch)console.error('G4_INSTALLED_QUALIFIED_PUBLIC_RELATIVE_FILE',mismatch[1]);
  const kind=String(error?.code??'');
  if(/^(ENOENT|EACCES|ENOTDIR|EEXIST|EPERM)$/.test(kind))
    console.error('G4_INSTALLED_PUBLIC_ASSEMBLER_FS_CODE',kind);
  process.exitCode=1;
}finally{
  rmSync(output,{recursive:true,force:true,maxRetries:3});
}