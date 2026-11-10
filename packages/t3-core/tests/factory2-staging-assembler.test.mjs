import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {assembleFactory2Staging} from '../scripts/assemble-factory2-staging.mjs';
import {verifyFactory2Sha256Sums} from '../scripts/factory2-staging-tree.mjs';
import {buildFactory2ProductSeal} from '../scripts/factory2-product-seal.mjs';

const productIds=['common-modules','domain-engineering','domain-keys','domain-studio'];

function preseal(){
  return {
    schema:'IWXA_T2_FACTORY2_PRESEAL_QUALIFICATION_V1',
    status:'PASS_PRESEAL_TECHNICAL_EVIDENCE',
    factoryId:'IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2',
    generation:2,
    kernelTarget:'0.3.5',
    sourceCommitSha:'a'.repeat(40),
    qualificationSubjectSha256:'b'.repeat(64),
    runtimeContractSnapshot:{version:'1.2.0',status:'PASS'},
    productSeals:productIds.map((productId)=>{
      const seal=buildFactory2ProductSeal(productId);
      return {productId,predecessor:seal.predecessor,fileCount:seal.fileCount,sealSha256:seal.sealSha256};
    }),
    neutralAcceptance:{
      schema:'IWXA_T2_FACTORY2_NEUTRAL_ACCEPTANCE_EXECUTION_RESULT_V1',
      status:'READY_FOR_HUMAN_REVIEW',
      deterministicOutputSha256:'d'.repeat(64),
      factoryAcceptanceGranted:false,ownerApprovalGranted:false,productionActivation:false,
    },
    factoryAcceptanceGranted:false,ownerApprovalGranted:false,productionActivation:false,
  };
}
test('Factory 2 staging assembler materializes canonical package roots and verified SHA256SUMS',()=>{
  const out=join(mkdtempSync(join(tmpdir(),'factory2-assemble-')),'stage');
  const r=assembleFactory2Staging({presealReceipt:preseal(),outputRoot:out});
  assert.equal(r.status,'PASS');
  assert.equal(r.stagedProductSealCount,4);
  assert.equal(r.factoryAcceptanceGranted,false);
  assert.equal(r.repositoryCheckoutRequiredAfterExtraction,false);
  assert.ok(r.selfContainedSourceFileCount>500);
  assert.ok(r.selfContainedSourceBytes>1_000_000);
  assert.equal(r.exactKernelSha256,'1c484218cfb86d776d57a3bd21f9b1ad606840e93711474a346dd1989352ce73');
  assert.equal(r.exactWorkspaceBaseSha256,'bd10ac792096fa58e45d84b86138cad858e5548081be89bada3c1e9d81f85b6e');
  const sums=readFileSync(join(out,'SHA256SUMS'),'utf8');
  const check=verifyFactory2Sha256Sums(out,sums);
  assert.equal(check.status,'PASS');
  const dist=JSON.parse(readFileSync(join(out,'FACTORY2_DISTRIBUTION_MANIFEST.json'),'utf8'));
  assert.equal(dist.status,'STAGING_MATERIALIZED_FROM_PASS_PRESEAL');
  assert.equal(dist.payloadMode,'SELF_CONTAINED');
  assert.equal(dist.repositoryCheckoutRequiredAfterExtraction,false);
  assert.ok(readFileSync(join(out,'PRODUCTS','IWXA_Domain_Kernel_0.3.5_RU_CANDIDATE.zip')).length>0);
  assert.ok(readFileSync(join(out,'PRODUCTS','IWXA_Universal_Workspace_0.34.0-rc.20_RU_CANDIDATE.zip')).length>0);
  assert.ok(readFileSync(join(out,'t2','current','final-successor','canonical-source','package.json')).length>0);
  assert.equal(dist.products.find(p=>p.id==='common-modules').qualifiedSealSha256,buildFactory2ProductSeal('common-modules').sealSha256);
  const expectedCounts={'common-modules':33,'domain-engineering':18,'domain-keys':9,'domain-studio':7};
  for(const [productId,fileCount] of Object.entries(expectedCounts)){
    const stagedSeal=JSON.parse(readFileSync(join(out,'PRODUCTS',`${productId}.seal.json`),'utf8'));
    const sourceSeal=buildFactory2ProductSeal(productId);
    assert.equal(stagedSeal.files.length,fileCount,`${productId} seal rows are complete`);
    assert.equal(stagedSeal.fileCount,fileCount,`${productId} seal fileCount is complete`);
    assert.equal(stagedSeal.sealSha256,sourceSeal.sealSha256,`${productId} seal matches current source`);
    assert.deepEqual(stagedSeal.files,sourceSeal.files,`${productId} full seal rows are staged`);
  }
  const payload=JSON.parse(readFileSync(join(out,'PRODUCTS','FACTORY2_SELF_CONTAINED_PAYLOAD_MANIFEST.json'),'utf8'));
  const common=payload.products.find(p=>p.id==='common-modules');
  const keys=payload.products.find(p=>p.id==='domain-keys');
  const studio=payload.products.find(p=>p.id==='domain-studio');
  const engineering=payload.products.find(p=>p.id==='domain-engineering');
  assert.equal(common.payloadCompleteness,'SEAL_ROOTS_EXACT');
  assert.ok(common.payloadRoots.some(p=>p.endsWith('/src/factory2/products/common-modules/common-modules.mjs')));
  assert.ok(keys.payloadRoots.some(p=>p.endsWith('/src/factory2/products/domain-keys/domain-keys.mjs')));
  assert.ok(keys.payloadRoots.some(p=>p.endsWith('/scripts/verify-domain-keys-snapshot.mjs')));
  assert.ok(studio.payloadRoots.some(p=>p.endsWith('/studio.html')));
  assert.ok(engineering.payloadRoots.some(p=>p.endsWith('/scripts/factory2-domain-run-cli.mjs')));
});
test('Factory 2 staging assembler rejects non-PASS preseal evidence',()=>{
  const x=preseal(); x.status='PENDING';
  assert.throws(()=>assembleFactory2Staging({presealReceipt:x,outputRoot:join(tmpdir(),'never-factory2-stage')}),/PRESEAL_RECEIPT_INVALID/);
});
