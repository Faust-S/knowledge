import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const repoRoot=resolve(here,'../../../../..');
const authorityPath=resolve(here,'../../canonical-source-inputs/k035-rc20/SOURCE_AUTHORITY.json');
const materializer=resolve(here,'../scripts/materialize-k035-rc20-source-input.py');
const repairWorkflow=join(repoRoot,'.github/workflows/IWXA_T2_WINDOWS_K035_DEPENDENCY_REPAIR_PROBE_20260917.yml');
const historicalWorkflow=join(repoRoot,'.github/workflows/IWXA_T2_WINDOWS_K035_RUNTIME_QUALIFICATION_20260917.yml');
const canonicalCoreWorkflow=join(repoRoot,'.github/workflows/IWXA_T2_CANONICAL_CORE_20260915.yml');
const workspaceCandidateTool=resolve(here,'../../product/tooling/prepare-workspace-source-candidate.py');
const workspaceRepairTool=resolve(here,'../../product/tools/k035-workspace-provenance-repair.py');
const r11PlatformTool=resolve(here,'../../product/tools/k035-r11-platform-certify.py');
const r11CompareTool=resolve(here,'../../product/tools/k035-r11-compare.py');
const r11ClosureTool=resolve(here,'../../product/tools/k035-r11-preacceptance-closure.mjs');
function stable(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(stable).join(',')+']';const keys=Object.keys(value).sort();return '{'+keys.map((key)=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}'}
test('current source authority binds exact K035/rc20 bytes',()=>{
  const a=JSON.parse(readFileSync(authorityPath,'utf8'));
  assert.equal(a.status,'CURRENT_CANONICAL_SOURCE_INPUT_AUTHORITY'); assert.equal(a.kernelTarget,'0.3.5'); assert.equal(a.workspaceTarget,'0.34.0-rc.20');
  assert.equal(a.envelope.sha256,'20383e0b243f6472f3d73765413dd98dd27754e14c541ea19cf2135b61e75250');
  assert.equal(a.components.kernel.sha256,'1c484218cfb86d776d57a3bd21f9b1ad606840e93711474a346dd1989352ce73');
  assert.equal(a.components.workspace.sha256,'bd10ac792096fa58e45d84b86138cad858e5548081be89bada3c1e9d81f85b6e');
  assert.equal(a.historicalRecoveryRequired,false); assert.equal(a.release_ready,false); assert.equal(a.productionDeploy,false); assert.equal(a.projectProcessWriteActivation,false);
  for(const row of a.envelope.chunks){assert.match(row.path,/^t2\/current\/final-successor\/canonical-source-inputs\/k035-rc20\/chunks\//); assert.match(row.gitBlobSha1,/^[0-9a-f]{40}$/);}
});
test('current source materializer verifies exact bytes and extracts Kernel plus Workspace',()=>{
  const root=mkdtempSync(join(tmpdir(),'k035-current-source-')), out=join(root,'out'), receipt=join(root,'receipt.json');
  try{
    const r=spawnSync(process.env.PYTHON||'python',[materializer,authorityPath,repoRoot,out,receipt],{encoding:'utf8',shell:false,maxBuffer:16*1024*1024});
    assert.equal(r.error,undefined); assert.equal(r.status,0,r.stderr||r.stdout);
    const x=JSON.parse(readFileSync(receipt,'utf8')); assert.equal(x.status,'CURRENT_SOURCE_INPUT_MATERIALIZED_VERIFIED'); assert.equal(x.historicalRecoveryRequired,false);
    assert.equal(x.envelope.sha256,'20383e0b243f6472f3d73765413dd98dd27754e14c541ea19cf2135b61e75250');
    assert.equal(x.components.kernel.sha256,'1c484218cfb86d776d57a3bd21f9b1ad606840e93711474a346dd1989352ce73'); assert.equal(x.components.workspace.sha256,'bd10ac792096fa58e45d84b86138cad858e5548081be89bada3c1e9d81f85b6e');
    assert.deepEqual(readdirSync(out).sort(),['IWXA_Domain_Kernel_0.3.5_RU_CANDIDATE.zip','IWXA_T2_K035_RC20_CURRENT_SOURCE_ENVELOPE.zip','IWXA_Universal_Workspace_0.34.0-rc.20_RU_CANDIDATE.zip'].sort());
  } finally {rmSync(root,{recursive:true,force:true});}
});
test('current rc20 Workspace provenance repair is deterministic and schema-byte preserving',()=>{
  const root=mkdtempSync(join(tmpdir(),'k035-current-workspace-repair-'));
  const sourceDir=join(root,'source');
  const receipt=join(root,'source-receipt.json');
  const candidateA=join(root,'workspace-a.zip');
  const candidateB=join(root,'workspace-b.zip');
  const repairA=join(root,'repair-a.json');
  const repairB=join(root,'repair-b.json');
  try{
    const materialized=spawnSync(process.env.PYTHON||'python',[materializer,authorityPath,repoRoot,sourceDir,receipt],{encoding:'utf8',shell:false,maxBuffer:16*1024*1024});
    assert.equal(materialized.error,undefined); assert.equal(materialized.status,0,materialized.stderr||materialized.stdout);
    const source=join(sourceDir,'IWXA_Universal_Workspace_0.34.0-rc.20_RU_CANDIDATE.zip');
    const first=spawnSync(process.env.PYTHON||'python',[workspaceRepairTool,source,candidateA,repairA],{encoding:'utf8',shell:false,maxBuffer:16*1024*1024});
    const second=spawnSync(process.env.PYTHON||'python',[workspaceRepairTool,source,candidateB,repairB],{encoding:'utf8',shell:false,maxBuffer:16*1024*1024});
    assert.equal(first.error,undefined); assert.equal(first.status,0,first.stderr||first.stdout);
    assert.equal(second.error,undefined); assert.equal(second.status,0,second.stderr||second.stdout);
    const a=JSON.parse(readFileSync(repairA,'utf8'));
    const b=JSON.parse(readFileSync(repairB,'utf8'));
    assert.equal(a.status,'MATERIALIZED_VERIFIED_REPRODUCIBLE_WORKSPACE_CANDIDATE');
    assert.equal(a.sourceWorkspaceSha256,'bd10ac792096fa58e45d84b86138cad858e5548081be89bada3c1e9d81f85b6e');
    assert.equal(a.candidateWorkspaceSha256,b.candidateWorkspaceSha256);
    assert.equal(a.receiptSha256,b.receiptSha256);
    const {receiptSha256,...receiptBody}=a;
    assert.equal(receiptSha256,createHash('sha256').update(stable(receiptBody)).digest('hex'));
    assert.notEqual(a.candidateWorkspaceSha256,a.sourceWorkspaceSha256);
    assert.equal(a.reproducibilityCheckPassed,true);
    assert.equal(a.historicalRecoveryRequired,false);
    assert.deepEqual(a.changedMembers,[a.provenanceMember]);
    assert.equal(a.provenance.declaredBeforeSha256,'69baffe0f88aff15a16bcd2914c3dac9f21d42ad39737d5d95f7101f5eb6a515');
    assert.equal(a.provenance.actualSchemaSha256,'2bab48f601e137d8e6593f59c7b6e595dceb4c48e4e7740cab8037b19c5c31c1');
    assert.equal(a.provenance.declaredAfterSha256,a.provenance.actualSchemaSha256);
    assert.equal(a.provenance.schemaBytesChanged,false);
    assert.equal(a.release_ready,false);
    assert.equal(a.productionDeploy,false);
    assert.equal(a.projectProcessWriteActivation,false);
  }finally{
    rmSync(root,{recursive:true,force:true});
  }
});

test('retired transport workflows stay absent; current verification uses local source commands',()=>{
  for(const path of [repairWorkflow,historicalWorkflow,canonicalCoreWorkflow]) assert.equal(existsSync(path),false);
  const workflow=readFileSync(join(repoRoot,'.github/workflows/T2_MANUAL_VERIFY.yml'),'utf8');
  assert.ok(workflow.includes('npm run test:all'));
  assert.equal(workflow.includes('t2/current/r11/transport'),false);
});
