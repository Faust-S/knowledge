import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {K035R11ClosureError,closeK035R11PreAcceptance} from '../../product/tools/k035-r11-preacceptance-closure.mjs';

const S='1'.repeat(64),G='2'.repeat(64),Q='3'.repeat(64),U='4'.repeat(64),W='5'.repeat(64),B='6'.repeat(64),R='7'.repeat(64),P='e'.repeat(64),X='c'.repeat(64);
const SOURCE_WORKSPACE='bd10ac792096fa58e45d84b86138cad858e5548081be89bada3c1e9d81f85b6e';
const CM='8'.repeat(64),CA='9'.repeat(64),RL='a'.repeat(64),RA='b'.repeat(64);
function stable(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(stable).join(',')+']';const ks=Object.keys(v).sort();return '{'+ks.map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}'}
function selfHash(body){return createHash('sha256').update(stable(body)).digest('hex')}
function workspaceRepair(){const body={schema:'IWXA_T2_K035_RC20_WORKSPACE_PROVENANCE_REPAIR_RECEIPT_V1',status:'MATERIALIZED_VERIFIED_REPRODUCIBLE_WORKSPACE_CANDIDATE',workspaceVersion:'0.34.0-rc.20',sourceWorkspaceSha256:SOURCE_WORKSPACE,candidateWorkspaceSha256:X,reproducibilityCheckPassed:true,historicalRecoveryRequired:false,repairScope:'DOMAIN_KEYS_PROVENANCE_ONLY',authorityEffect:'QUALIFICATION_INPUT_ONLY_NO_RELEASE_NO_DEPLOY_NO_PROJECT_PROCESS_WRITE_AUTHORITY',changedMembers:['x/src/config/schemas/keys-2.0/provenance.json'],provenanceMember:'x/src/config/schemas/keys-2.0/provenance.json',workspaceConfigSchemaMember:'x/src/config/schemas/keys-2.0/workspace-config.schema.json',provenance:{declaredBeforeSha256:'6'.repeat(64),declaredAfterSha256:'7'.repeat(64),actualSchemaSha256:'7'.repeat(64),schemaBytesChanged:false},release_ready:false,productionDeploy:false,projectProcessWriteActivation:false};return {...body,receiptSha256:selfHash(body)}}
function qualification(){const wr=workspaceRepair();return {status:'K035_RC20_C3_PREACCEPTANCE_QUALIFICATION_PASS_RUNTIME_ACCEPTANCE_PENDING',repair:{sourceCandidate:{status:'MATERIALIZED_VERIFIED_REPRODUCIBLE_SOURCE_CANDIDATE',sha256:S}},workspaceProvenanceRepair:wr,buildReproducibility:{schema:'IWXA_T2_CURRENT_BUILD_REPRODUCIBILITY_V1',status:'PASS',installAuthority:'NPM_CI_EXACT_PACKAGE_LOCK',packageLockSha256:P,buildTreeSha256:B,buildFileCount:12,buildCount:2,buildsByteEquivalent:true,historicalRecoveryRequired:false,release_ready:false,productionDeploy:false,projectProcessWriteActivation:false},successorProductGraph:{status:'K035_RC20_SUCCESSOR_CANDIDATE_NOT_CURRENT',componentsBindingSha256:G,workspaceSourceInputSha256:SOURCE_WORKSPACE,workspaceCandidateSha256:X,workspaceProvenanceRepairReceiptSha256:wr.receiptSha256,components:[{id:'kernel',version:'0.3.5',sha256:S},{id:'workspace',version:'0.34.0-rc.20',sha256:X}]}}}
function contract(){return {version:'1.2.0',byteSemanticEqualityToK034AcceptedReference:true,candidateManifestSha256:CM,candidateAggregateSha256:CA,referenceMachineLockSha256:RL,referenceAggregateSha256:RA,fileCount:25}}
function platforms(){const preview={status:'PASS',preReleasePassed:true,referenceOnlyContractLock:true,testOnly:true,stageDAuthorized:false,releaseZipSha256:R};return [{os:'ubuntu-24.04',status:'PASS',failureCount:0,productGraphSha256:G,kernelSourceSha256:S,workspaceSha256:X,productionAudit:{total:0,high:0,critical:0},runtimeContractVersion:'1.2.0',runtimeContractByteSemanticEquality:true,runtimeContract:contract(),nodeVersion:'24.18.1',npmVersion:'11.16.0',testOnlyReleaseDerivative:{...preview},evidenceSha256:U},{os:'windows-2025',status:'PASS',failureCount:0,productGraphSha256:G,kernelSourceSha256:S,workspaceSha256:X,productionAudit:{total:0,high:0,critical:0},runtimeContractVersion:'1.2.0',runtimeContractByteSemanticEquality:true,runtimeContract:contract(),nodeVersion:'24.18.1',npmVersion:'11.16.0',testOnlyReleaseDerivative:{...preview},evidenceSha256:W}]}
function verdict(){const body={schema:'IWXA_T2_K035_RC20_R11_CROSS_PLATFORM_VERDICT_V2',status:'PASS',issues:[],mismatches:[],productGraphSha256:G,kernelSourceSha256:S,workspaceSha256:X,runtimeContract:contract(),testOnlyReleaseZipSha256:R};return {...body,verdictSha256:selfHash(body)}}

test('closes exact two-platform current K035 R11 and preserves exact Runtime Contract identity',()=>{
  const r=closeK035R11PreAcceptance({qualification:qualification(),qualificationSha256:Q,platformEvidence:platforms(),crossPlatformVerdict:verdict()});
  assert.equal(r.status,'PASS');
  assert.equal(r.runtimeContract.candidateManifestSha256,CM);
  assert.equal(r.runtimeContract.candidateAggregateSha256,CA);
  assert.equal(r.runtimeContract.referenceMachineLockSha256,RL);
  assert.equal(r.runtimeContract.referenceAggregateSha256,RA);
  assert.equal(r.runtimeContract.fileCount,25);
  assert.equal(r.workspace.sha256,X);
  assert.equal(r.workspace.sourceInputSha256,SOURCE_WORKSPACE);
  assert.equal(r.workspace.provenanceRepairReceiptSha256,qualification().workspaceProvenanceRepair.receiptSha256);
  assert.equal(r.currentBuild.packageLockSha256,P);
  assert.equal(r.currentBuild.buildTreeSha256,B);
  assert.equal(r.currentBuild.buildFileCount,12);
    assert.equal(r.securityBoundary.productionAdvisories,'ZERO_REQUIRED');
  assert.equal(r.testOnlyReleasePreview.releaseZipSha256,R);
  assert.equal(r.testOnlyReleasePreview.stageDAuthorized,false);
  assert.equal(r.governance.runtimeAcceptanceIssued,false);
  assert.equal(r.governance.commonResultAcceptanceWrites,'FORBIDDEN');
  assert.match(r.receiptSha256,/^[0-9a-f]{64}$/);
});

test('refuses non-zero production audit',()=>{
  const p=platforms();p[0].productionAudit.total=1;
  assert.throws(()=>closeK035R11PreAcceptance({qualification:qualification(),qualificationSha256:Q,platformEvidence:p,crossPlatformVerdict:verdict()}),(e)=>e instanceof K035R11ClosureError&&e.code==='R11_PRODUCTION_AUDIT_NOT_ZERO');
});

test('refuses deterministic mismatch',()=>{
  const v=verdict();v.mismatches=[{path:'x'}];
  assert.throws(()=>closeK035R11PreAcceptance({qualification:qualification(),qualificationSha256:Q,platformEvidence:platforms(),crossPlatformVerdict:v}),(e)=>e instanceof K035R11ClosureError&&e.code==='R11_CROSS_PLATFORM_MISMATCHES_PRESENT');
});

test('refuses cross-platform test-only release derivative mismatch',()=>{
  const p=platforms();p[1].testOnlyReleaseDerivative.releaseZipSha256='c'.repeat(64);
  assert.throws(()=>closeK035R11PreAcceptance({qualification:qualification(),qualificationSha256:Q,platformEvidence:p,crossPlatformVerdict:verdict()}),(e)=>e instanceof K035R11ClosureError&&e.code==='R11_TEST_ONLY_RELEASE_DERIVATIVE_MISMATCH');
});

test('refuses cross-platform Runtime Contract identity drift',()=>{
  const p=platforms();p[1].runtimeContract={...p[1].runtimeContract,candidateManifestSha256:'c'.repeat(64)};
  assert.throws(()=>closeK035R11PreAcceptance({qualification:qualification(),qualificationSha256:Q,platformEvidence:p,crossPlatformVerdict:verdict()}),(e)=>e instanceof K035R11ClosureError&&e.code==='R11_RUNTIME_CONTRACT_CROSS_PLATFORM_MISMATCH');
});

test('refuses verdict Runtime Contract identity drift',()=>{
  const v=verdict();v.runtimeContract={...v.runtimeContract,candidateAggregateSha256:'c'.repeat(64)};v.verdictSha256=selfHash({...v,verdictSha256:undefined});
  const body={...v};delete body.verdictSha256;v.verdictSha256=selfHash(body);
  assert.throws(()=>closeK035R11PreAcceptance({qualification:qualification(),qualificationSha256:Q,platformEvidence:platforms(),crossPlatformVerdict:v}),(e)=>e instanceof K035R11ClosureError&&e.code==='R11_CROSS_PLATFORM_RUNTIME_CONTRACT_MISMATCH');
});

test('refuses forged verdict self-hash even when verdict fields otherwise PASS',()=>{
  const v=verdict();v.verdictSha256='d'.repeat(64);
  assert.throws(()=>closeK035R11PreAcceptance({qualification:qualification(),qualificationSha256:Q,platformEvidence:platforms(),crossPlatformVerdict:v}),(e)=>e instanceof K035R11ClosureError&&e.code==='R11_CROSS_PLATFORM_VERDICT_SHA256_MISMATCH');
});

test('refuses missing current reproducible build binding',()=>{
  const q=qualification();delete q.buildReproducibility;
  assert.throws(()=>closeK035R11PreAcceptance({qualification:q,qualificationSha256:Q,platformEvidence:platforms(),crossPlatformVerdict:verdict()}),(e)=>e instanceof K035R11ClosureError&&e.code==='K035_CURRENT_BUILD_REPRODUCIBILITY_REQUIRED');
});

test('refuses current build receipt with authority escalation',()=>{
  const q=qualification();q.buildReproducibility.productionDeploy=true;
  assert.throws(()=>closeK035R11PreAcceptance({qualification:q,qualificationSha256:Q,platformEvidence:platforms(),crossPlatformVerdict:verdict()}),(e)=>e instanceof K035R11ClosureError&&e.code==='K035_CURRENT_BUILD_AUTHORITY_INVALID');
});


test('refuses R11 evidence that falls back to immutable source Workspace identity',()=>{
  const p=platforms();p[0].workspaceSha256=SOURCE_WORKSPACE;
  assert.throws(()=>closeK035R11PreAcceptance({qualification:qualification(),qualificationSha256:Q,platformEvidence:p,crossPlatformVerdict:verdict()}),(e)=>e instanceof K035R11ClosureError&&e.code==='R11_PLATFORM_WORKSPACE_MISMATCH');
});

test('refuses Product Graph that reuses immutable source Workspace as repaired candidate',()=>{
  const q=qualification();
  q.successorProductGraph.workspaceCandidateSha256=SOURCE_WORKSPACE;
  q.successorProductGraph.components=q.successorProductGraph.components.map(x=>x.id==='workspace'?{...x,sha256:SOURCE_WORKSPACE}:x);
  assert.throws(()=>closeK035R11PreAcceptance({qualification:q,qualificationSha256:Q,platformEvidence:platforms(),crossPlatformVerdict:verdict()}),(e)=>e instanceof K035R11ClosureError&&e.code==='K035_GRAPH_WORKSPACE_REPAIR_IDENTITY_UNCHANGED');
});

test('refuses cross-platform verdict repaired Workspace drift',()=>{
  const v=verdict();v.workspaceSha256='d'.repeat(64);
  const body={...v};delete body.verdictSha256;v.verdictSha256=selfHash(body);
  assert.throws(()=>closeK035R11PreAcceptance({qualification:qualification(),qualificationSha256:Q,platformEvidence:platforms(),crossPlatformVerdict:v}),(e)=>e instanceof K035R11ClosureError&&e.code==='R11_CROSS_PLATFORM_WORKSPACE_MISMATCH');
});


test('refuses forged Workspace provenance repair receipt self-hash',()=>{
  const q=qualification();q.workspaceProvenanceRepair.receiptSha256='f'.repeat(64);q.successorProductGraph.workspaceProvenanceRepairReceiptSha256=q.workspaceProvenanceRepair.receiptSha256;
  assert.throws(()=>closeK035R11PreAcceptance({qualification:q,qualificationSha256:Q,platformEvidence:platforms(),crossPlatformVerdict:verdict()}),(e)=>e instanceof K035R11ClosureError&&e.code==='K035_WORKSPACE_REPAIR_RECEIPT_SELF_HASH_INVALID');
});

test('refuses Product Graph to Workspace repair receipt binding drift',()=>{
  const q=qualification();q.successorProductGraph.workspaceProvenanceRepairReceiptSha256='f'.repeat(64);
  assert.throws(()=>closeK035R11PreAcceptance({qualification:q,qualificationSha256:Q,platformEvidence:platforms(),crossPlatformVerdict:verdict()}),(e)=>e instanceof K035R11ClosureError&&e.code==='K035_GRAPH_WORKSPACE_REPAIR_RECEIPT_BINDING_MISMATCH');
});
