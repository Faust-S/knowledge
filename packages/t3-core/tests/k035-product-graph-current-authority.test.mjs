import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  K035ProductGraphError,
  buildK035Rc20ProductGraphSuccessor,
  productGraphComponentsBindingSha256,
} from '../../product/tools/k035-product-graph-successor.mjs';

const cli=fileURLToPath(new URL('../../product/tools/k035-product-graph-successor.mjs',import.meta.url));

const COMPONENTS=[
  {id:'commonModules',version:'0.4.1',sha256:'ac6c2121c1e527a9a38d2772006138de24befd7f0ad6b3b90f56e74d63c3d51c'},
  {id:'domainEngineering',version:'8.4.0',sha256:'a497a02b24ec2a8a7f1a2e812ab865f377631950bb1a958ac0757fb23d7e3e65'},
  {id:'domainKeys',version:'2.4.4',sha256:'1416c6570201e2dc24e059a0c22590dbaec6421681c54b1d1c87d8884f446fd6'},
  {id:'kernel',version:'0.3.4',sha256:'6b000cf2bbe33c46fab882706e73d1268a5ba9ac2cb0781e1a53553c61ea7c6b'},
  {id:'studio',version:'0.1.0-alpha.9.11.0',sha256:'e011544656fc918923882839be5dee9c83c405135aeb0a87722362fc413ba4d0'},
  {id:'workspace',version:'0.34.0-rc.19',sha256:'230f9099ce92edafe71e2b319837a3b72d851fa4fa2a3df4f47a2e68e942e44b'},
];

function predecessor(components=COMPONENTS){
  return {
    schema:'IWXA_T2_CURRENT_PREDECESSOR_PRODUCT_GRAPH_V1',
    status:'CURRENT_PREDECESSOR_AUTHORITY',
    historicalRecoveryRequired:false,
    components,
    componentsBindingSha256:productGraphComponentsBindingSha256(components),
  };
}

function qualification(kernelSha='3'.repeat(64)){
  const authoritySha='2'.repeat(64);
  return {
    repair:{
      sourceCandidate:{
        status:'MATERIALIZED_VERIFIED_REPRODUCIBLE_SOURCE_CANDIDATE',
        artifactClass:'CANONICAL_SOURCE_CANDIDATE_ARCHIVE',
        version:'0.3.5',
        reproducibilityCheckPassed:true,
        historicalRecoveryRequired:false,
        packagingAuthority:'CURRENT_PRODUCT_PACKAGING_PROFILE',
        packagingProfileAuthoritySha256:authoritySha,
        sha256:kernelSha,
      },
      sourcePackagingProfile:{
        status:'CURRENT_PRODUCT_PACKAGING_PROFILE',
        historicalRecoveryRequired:false,
        authority:'CURRENT_PRODUCT_PACKAGING_PROFILE',
        authoritySha256:authoritySha,
      },
    },
  };
}

function stable(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(stable).join(',')+']';const keys=Object.keys(value).sort();return '{'+keys.map((key)=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}'}
function workspaceRepair(candidateSha='5'.repeat(64)){
  const body={
    schema:'IWXA_T2_K035_RC20_WORKSPACE_PROVENANCE_REPAIR_RECEIPT_V1',
    status:'MATERIALIZED_VERIFIED_REPRODUCIBLE_WORKSPACE_CANDIDATE',
    workspaceVersion:'0.34.0-rc.20',
    sourceWorkspaceSha256:'bd10ac792096fa58e45d84b86138cad858e5548081be89bada3c1e9d81f85b6e',
    candidateWorkspaceSha256:candidateSha,
    reproducibilityCheckPassed:true,
    historicalRecoveryRequired:false,
    repairScope:'DOMAIN_KEYS_PROVENANCE_ONLY',
    provenance:{
      declaredBeforeSha256:'69baffe0f88aff15a16bcd2914c3dac9f21d42ad39737d5d95f7101f5eb6a515',
      declaredAfterSha256:'2bab48f601e137d8e6593f59c7b6e595dceb4c48e4e7740cab8037b19c5c31c1',
      actualSchemaSha256:'2bab48f601e137d8e6593f59c7b6e595dceb4c48e4e7740cab8037b19c5c31c1',
      schemaBytesChanged:false,
    },
    release_ready:false,
    productionDeploy:false,
    authorityEffect:'QUALIFICATION_INPUT_ONLY_NO_RELEASE_NO_DEPLOY_NO_PROJECT_PROCESS_WRITE_AUTHORITY',
    changedMembers:['IWXA_Universal_Workspace_0.34.0-rc.20/src/config/schemas/keys-2.0/provenance.json'],
    provenanceMember:'IWXA_Universal_Workspace_0.34.0-rc.20/src/config/schemas/keys-2.0/provenance.json',
    workspaceConfigSchemaMember:'IWXA_Universal_Workspace_0.34.0-rc.20/src/config/schemas/keys-2.0/workspace-config.schema.json',
    projectProcessWriteActivation:false,
  };
  return {...body,receiptSha256:createHash('sha256').update(stable(body)).digest('hex')};
}

test('current predecessor components retain exact Product Graph identity',()=>{
  assert.equal(productGraphComponentsBindingSha256(COMPONENTS),'98e9562c0b255274c467567b23f555bc703c4f25b99b4ae54f25ca654387f680');
});

test('successor builder requires current predecessor authority shape',()=>{
  assert.throws(
    ()=>buildK035Rc20ProductGraphSuccessor({predecessorGraph:{components:COMPONENTS},repairQualification:qualification(),workspaceRepairReceipt:workspaceRepair()}),
    (error)=>error instanceof K035ProductGraphError && error.code==='K035_CURRENT_PREDECESSOR_GRAPH_AUTHORITY_REQUIRED',
  );
});

test('successor builder rejects current predecessor component drift',()=>{
  const drifted=COMPONENTS.map((x)=>x.id==='kernel'?{...x,sha256:'f'.repeat(64)}:x);
  assert.throws(
    ()=>buildK035Rc20ProductGraphSuccessor({predecessorGraph:predecessor(drifted),repairQualification:qualification(),workspaceRepairReceipt:workspaceRepair()}),
    (error)=>error instanceof K035ProductGraphError && error.code==='K035_PREDECESSOR_GRAPH_SHA_MISMATCH',
  );
});

test('successor changes only kernel and workspace with current packaging authority',()=>{
  const kernelSha='4'.repeat(64);
  const workspaceSha='5'.repeat(64);
  const result=buildK035Rc20ProductGraphSuccessor({predecessorGraph:predecessor(),repairQualification:qualification(kernelSha),workspaceRepairReceipt:workspaceRepair(workspaceSha)});
  assert.equal(result.historicalRecoveryRequired,false);
  assert.equal(result.packageAuthority,'NOT_CLOSED');
  assert.equal(result.release_ready,false);
  assert.deepEqual(result.changedComponentIds,['kernel','workspace']);
  assert.equal(result.components.find((x)=>x.id==='kernel').sha256,kernelSha);
  assert.equal(result.components.find((x)=>x.id==='workspace').sha256,workspaceSha);
  assert.equal(result.workspaceSourceInputSha256,'bd10ac792096fa58e45d84b86138cad858e5548081be89bada3c1e9d81f85b6e');
  assert.equal(result.workspaceCandidateSha256,workspaceSha);
  assert.equal(result.workspaceProvenanceRepairReceiptSha256,workspaceRepair(workspaceSha).receiptSha256);
  assert.equal(result.currentSourcePackagingAuthoritySha256,'2'.repeat(64));
});

test('successor binds the exact Workspace provenance repair receipt',()=>{
  const receipt=workspaceRepair('6'.repeat(64));
  const result=buildK035Rc20ProductGraphSuccessor({
    predecessorGraph:predecessor(),
    repairQualification:qualification(),
    workspaceRepairReceipt:receipt,
  });
  assert.equal(result.workspaceProvenanceRepairReceiptSha256,receipt.receiptSha256);
});

test('successor CLI materializes output on Windows and POSIX path forms',()=>{
  const root=mkdtempSync(join(tmpdir(),'k035-product-graph-cli-'));
  const predecessorPath=join(root,'predecessor.json');
  const qualificationPath=join(root,'qualification.json');
  const outputPath=join(root,'successor.json');
  try{
    writeFileSync(predecessorPath,JSON.stringify(predecessor()),'utf8');
    writeFileSync(qualificationPath,JSON.stringify(qualification()),'utf8');
    const workspaceRepairPath=join(root,'workspace-repair.json');
    writeFileSync(workspaceRepairPath,JSON.stringify(workspaceRepair()),'utf8');
    const result=spawnSync(process.execPath,[cli,predecessorPath,qualificationPath,workspaceRepairPath,outputPath],{encoding:'utf8',shell:false});
    assert.equal(result.status,0,result.stderr||result.stdout);
    const successor=JSON.parse(readFileSync(outputPath,'utf8'));
    assert.equal(successor.status,'K035_RC20_SUCCESSOR_CANDIDATE_NOT_CURRENT');
    assert.equal(successor.release_ready,false);
  }finally{
    rmSync(root,{recursive:true,force:true});
  }
});

test('successor refuses missing current packaging authority',()=>{
  const q=qualification();
  delete q.repair.sourcePackagingProfile;
  assert.throws(
    ()=>buildK035Rc20ProductGraphSuccessor({predecessorGraph:predecessor(),repairQualification:q,workspaceRepairReceipt:workspaceRepair()}),
    (error)=>error instanceof K035ProductGraphError && error.code==='K035_CURRENT_SOURCE_PACKAGING_PROFILE_REQUIRED',
  );
});

test('successor refuses missing or invalid Workspace provenance repair receipt',()=>{
  assert.throws(
    ()=>buildK035Rc20ProductGraphSuccessor({predecessorGraph:predecessor(),repairQualification:qualification()}),
    (error)=>error instanceof K035ProductGraphError && error.code==='K035_WORKSPACE_PROVENANCE_REPAIR_REQUIRED',
  );
  const bad=workspaceRepair();bad.provenance.schemaBytesChanged=true;
  assert.throws(
    ()=>buildK035Rc20ProductGraphSuccessor({predecessorGraph:predecessor(),repairQualification:qualification(),workspaceRepairReceipt:bad}),
    (error)=>error instanceof K035ProductGraphError && error.code==='K035_WORKSPACE_PROVENANCE_REPAIR_REQUIRED',
  );
});


test('successor refuses forged Workspace provenance repair receipt self-hash',()=>{
  const bad=workspaceRepair();
  bad.receiptSha256='f'.repeat(64);
  assert.throws(
    ()=>buildK035Rc20ProductGraphSuccessor({predecessorGraph:predecessor(),repairQualification:qualification(),workspaceRepairReceipt:bad}),
    (error)=>error instanceof K035ProductGraphError && error.code==='K035_WORKSPACE_REPAIR_RECEIPT_SELF_HASH_INVALID',
  );
});
