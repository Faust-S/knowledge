#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {buildFactory2ProductSeal} from './factory2-product-seal.mjs';
import {runFactory2NeutralAcceptanceCase} from '../src/factory2/acceptance/neutral-factory-acceptance.mjs';
import {CURRENT_EXECUTABLE_TOOLCHAIN} from './run-current-executable-verification.mjs';
import {assertCurrentLiveHead} from './current-live-head.mjs';

const scriptPath=fileURLToPath(import.meta.url);
const root=dirname(dirname(scriptPath));
const productRoot=resolve(root,'../product');
const sha256=(bytes)=>createHash('sha256').update(bytes).digest('hex');

function readJson(path){
  return JSON.parse(readFileSync(path,'utf8'));
}
function runNodeScript(path,label){
  const result=spawnSync(process.execPath,[path],{cwd:root,encoding:'utf8',shell:false,stdio:'pipe',maxBuffer:16*1024*1024});
  if(result.error) throw new Error(`FACTORY2_PRESEAL_SPAWN_FAILED:${label}:${result.error.message}`);
  if(result.status!==0) throw new Error(`FACTORY2_PRESEAL_STEP_FAILED:${label}:${result.status}:${result.stderr||result.stdout}`);
  return String(result.stdout??'').trim();
}
export function validateCurrentVerificationForFactory2(receipt,{expectedHead}){
  if(!receipt||receipt.schema!=='IWXA_T2_CURRENT_EXECUTABLE_VERIFICATION_V1'||receipt.status!=='PASS'){
    throw new Error('FACTORY2_PRESEAL_CURRENT_VERIFICATION_REQUIRED');
  }
  if(receipt.sourceCommitSha!==expectedHead) throw new Error('FACTORY2_PRESEAL_CURRENT_VERIFICATION_HEAD_MISMATCH');
  if(receipt.nodeVersion!==CURRENT_EXECUTABLE_TOOLCHAIN.nodeVersion||receipt.npmVersion!==CURRENT_EXECUTABLE_TOOLCHAIN.npmVersion){
    throw new Error('FACTORY2_PRESEAL_CURRENT_VERIFICATION_TOOLCHAIN_MISMATCH');
  }
  if(receipt.worktreeCleanBefore!==true||receipt.worktreeCleanAfter!==true||receipt.buildsByteEquivalent!==true){
    throw new Error('FACTORY2_PRESEAL_CURRENT_VERIFICATION_INCOMPLETE');
  }
  return receipt;
}
export function makeFactory2PresealReceipt({
  expectedHead,
  currentVerification,
  productSeals,
  runtimeSnapshotVerified,
  neutralAcceptance,
}){
  validateCurrentVerificationForFactory2(currentVerification,{expectedHead});
  const ids=['common-modules','domain-engineering','domain-keys','domain-studio'];
  if(!Array.isArray(productSeals)||productSeals.length!==ids.length){
    throw new Error('FACTORY2_PRESEAL_PRODUCT_SEALS_INCOMPLETE');
  }
  const byId=new Map(productSeals.map((x)=>[x.productId,x]));
  for(const id of ids){
    const seal=byId.get(id);
    if(!seal||seal.generation!==2||typeof seal.sealSha256!=='string'||!/^[0-9a-f]{64}$/.test(seal.sealSha256)||!Number.isInteger(seal.fileCount)||seal.fileCount<1){
      throw new Error(`FACTORY2_PRESEAL_PRODUCT_SEAL_INVALID:${id}`);
    }
  }
  if(runtimeSnapshotVerified!==true) throw new Error('FACTORY2_PRESEAL_RUNTIME_SNAPSHOT_REQUIRED');
  if(!neutralAcceptance||neutralAcceptance.schema!=='IWXA_T2_FACTORY2_NEUTRAL_ACCEPTANCE_EXECUTION_RESULT_V1'||
     neutralAcceptance.status!=='READY_FOR_HUMAN_REVIEW'||neutralAcceptance.factoryAcceptanceGranted!==false||
     neutralAcceptance.ownerApprovalGranted!==false||neutralAcceptance.productionActivation!==false){
    throw new Error('FACTORY2_PRESEAL_NEUTRAL_ACCEPTANCE_INVALID');
  }
  const subject={
    expectedHead,
    sourceTreeSha:currentVerification.sourceTreeSha,
    packageLockSha256:currentVerification.packageLockSha256,
    buildTreeSha256:currentVerification.buildTreeSha256,
    productSeals:Object.fromEntries(ids.map((id)=>[id,byId.get(id).sealSha256])),
    neutralAcceptanceSha256:neutralAcceptance.deterministicOutputSha256,
  };
  return Object.freeze({
    schema:'IWXA_T2_FACTORY2_PRESEAL_QUALIFICATION_V1',
    status:'PASS_PRESEAL_TECHNICAL_EVIDENCE',
    factoryId:'IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2',
    generation:2,
    kernelTarget:'0.3.5',
    sourceCommitSha:expectedHead,
    sourceTreeSha:currentVerification.sourceTreeSha,
    exactToolchain:Object.freeze({...CURRENT_EXECUTABLE_TOOLCHAIN}),
    currentVerification:Object.freeze({
      status:'PASS',
      receiptSha256:sha256(Buffer.from(JSON.stringify(currentVerification))),
      packageLockSha256:currentVerification.packageLockSha256,
      buildTreeSha256:currentVerification.buildTreeSha256,
      buildFileCount:currentVerification.buildFileCount,
    }),
    runtimeContractSnapshot:Object.freeze({version:'1.2.0',status:'PASS'}),
    productSeals:Object.freeze(productSeals.map((x)=>Object.freeze({
      productId:x.productId,
      predecessor:x.predecessor,
      fileCount:x.fileCount,
      sealSha256:x.sealSha256,
    }))),
    neutralAcceptance,
    qualificationSubjectSha256:sha256(Buffer.from(JSON.stringify(subject))),
    commonReleaseLockIssued:false,
    commonFreezeIssued:false,
    p6Authorized:false,
    p7Authorized:false,
    factoryAcceptanceGranted:false,
    ownerApprovalGranted:false,
    productionActivation:false,
  });
}
function main(){
  const [verificationPath,outputPath,expectedHeadArg]=process.argv.slice(2);
  if(!verificationPath||!outputPath||!expectedHeadArg){
    console.error('usage: node scripts/run-factory2-preseal-qualification.mjs <current-verification-json> <output-json> <expected-head-sha>');
    process.exit(2);
  }
  const expectedHead=String(expectedHeadArg).trim().toLowerCase();
  if(!/^[0-9a-f]{40}$/.test(expectedHead)){
    console.error('FACTORY2_PRESEAL_EXPECTED_HEAD_INVALID'); process.exit(2);
  }
  if(process.version!==CURRENT_EXECUTABLE_TOOLCHAIN.nodeVersion){
    console.error(`FACTORY2_PRESEAL_NODE_VERSION_MISMATCH:${process.version}`); process.exit(2);
  }
  try{
    assertCurrentLiveHead({expectedHead});
    const verification=readJson(resolve(verificationPath));
    validateCurrentVerificationForFactory2(verification,{expectedHead});
    runNodeScript(resolve(root,'scripts/verify-runtime-contract-snapshot.mjs'),'runtime-contract-snapshot');
    const productSeals=['common-modules','domain-engineering','domain-keys','domain-studio']
      .map((id)=>buildFactory2ProductSeal(id,{cwd:root}));
    const neutralCase=readJson(resolve(productRoot,'FACTORY2_NEUTRAL_ACCEPTANCE_CASE_2026-09-24.json'));
    const neutralAcceptance=runFactory2NeutralAcceptanceCase(neutralCase);
    const receipt=makeFactory2PresealReceipt({
      expectedHead,
      currentVerification:verification,
      productSeals,
      runtimeSnapshotVerified:true,
      neutralAcceptance,
    });
    const output=resolve(outputPath);
    if(existsSync(output)) throw new Error('FACTORY2_PRESEAL_OUTPUT_ALREADY_EXISTS');
    mkdirSync(dirname(output),{recursive:true});
    writeFileSync(output,JSON.stringify(receipt,null,2)+'\n','utf8');
    console.log(JSON.stringify(receipt,null,2));
  }catch(error){
    console.error(error?.stack||String(error)); process.exit(1);
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===pathToFileURL(scriptPath).href) main();
