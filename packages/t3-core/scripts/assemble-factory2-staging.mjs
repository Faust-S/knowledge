#!/usr/bin/env node
import {cpSync,existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {basename,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {buildFactory2Sha256Sums,verifyFactory2Sha256Sums} from './factory2-staging-tree.mjs';
import {validateFactory2DistributionCandidate} from '../src/factory2/distribution/distribution-control.mjs';
import {materializeFactory2K035Products} from './factory2-k035-source-materializer.mjs';
import {buildFactory2ProductSeal,FACTORY2_PRODUCT_SEAL_SPECS} from './factory2-product-seal.mjs';

const scriptPath=fileURLToPath(import.meta.url);
const root=dirname(dirname(scriptPath));
const productRoot=resolve(root,'../product');
const repositoryRoot=resolve(root,'../../../..');
const stagedCanonicalSourcePrefix='t2/current/final-successor/canonical-source';

function stagedSealRoots(productId){
  const spec=FACTORY2_PRODUCT_SEAL_SPECS[productId];
  if(!spec) throw new Error(`FACTORY2_STAGING_PRODUCT_SEAL_SPEC_MISSING:${productId}`);
  return spec.roots.map((entry)=>`${stagedCanonicalSourcePrefix}/${entry.replaceAll('\\','/')}`);
}

function readJson(path){ return JSON.parse(readFileSync(path,'utf8')); }
function writeJson(path,value){
  mkdirSync(dirname(path),{recursive:true});
  writeFileSync(path,JSON.stringify(value,null,2)+'\n','utf8');
}
function requirePreseal(receipt){
  if(!receipt||receipt.schema!=='IWXA_T2_FACTORY2_PRESEAL_QUALIFICATION_V1'||receipt.status!=='PASS_PRESEAL_TECHNICAL_EVIDENCE'||
     receipt.factoryId!=='IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2'||receipt.generation!==2||receipt.kernelTarget!=='0.3.5'||
     receipt.factoryAcceptanceGranted!==false||receipt.ownerApprovalGranted!==false||receipt.productionActivation!==false){
    throw new Error('FACTORY2_STAGING_PRESEAL_RECEIPT_INVALID');
  }
  const ids=['common-modules','domain-engineering','domain-keys','domain-studio'];
  const byId=new Map((receipt.productSeals??[]).map((x)=>[x.productId,x]));
  for(const id of ids){
    const seal=byId.get(id);
    if(!seal||typeof seal.sealSha256!=='string'||!/^[0-9a-f]{64}$/.test(seal.sealSha256)) throw new Error(`FACTORY2_STAGING_PRODUCT_SEAL_MISSING:${id}`);
  }
  if(receipt.runtimeContractSnapshot?.status!=='PASS'||receipt.neutralAcceptance?.status!=='READY_FOR_HUMAN_REVIEW'){
    throw new Error('FACTORY2_STAGING_PRESEAL_EVIDENCE_INCOMPLETE');
  }
  return receipt;
}

function trackedFinalSuccessorFiles(){
  const result=spawnSync('git',['ls-files','-z','--','t2/current/final-successor'],{cwd:repositoryRoot,encoding:'buffer',shell:false,maxBuffer:32*1024*1024});
  if(result.error||result.status!==0) throw new Error('FACTORY2_STAGING_TRACKED_SOURCE_LIST_FAILED');
  return result.stdout.toString('utf8').split('\0').filter(Boolean).sort();
}
function copyTrackedFinalSuccessor(out){
  let count=0,totalBytes=0;
  for(const rel of trackedFinalSuccessorFiles()){
    const source=resolve(repositoryRoot,...rel.split('/'));
    if(!existsSync(source)) throw new Error(`FACTORY2_STAGING_TRACKED_SOURCE_MISSING:${rel}`);
    const target=resolve(out,...rel.split('/'));
    mkdirSync(dirname(target),{recursive:true});
    cpSync(source,target);
    count+=1; totalBytes+=readFileSync(source).length;
  }
  return Object.freeze({path:'t2/current/final-successor',fileCount:count,totalBytes});
}

function copyProductFile(rel,targetDir,targetName=basename(rel)){
  cpSync(resolve(productRoot,rel),resolve(targetDir,targetName));
}
export function assembleFactory2Staging({presealReceipt,outputRoot,overwrite=false}){
  const preseal=requirePreseal(presealReceipt);
  const out=resolve(outputRoot);
  if(existsSync(out)){
    if(!overwrite) throw new Error('FACTORY2_STAGING_OUTPUT_EXISTS');
    rmSync(out,{recursive:true,force:true});
  }
  for(const dir of ['PRODUCTS','CONTROL','ACCEPTANCE','BOOTSTRAP','COMPATIBILITY','TOOLCHAIN']) mkdirSync(resolve(out,dir),{recursive:true});

  const dist=validateFactory2DistributionCandidate(readJson(resolve(productRoot,'FACTORY2_DISTRIBUTION_MANIFEST_CANDIDATE_2026-09-24.json')));
  const seals=Object.fromEntries(preseal.productSeals.map((x)=>[x.productId,x]));
  const completeSeals=Object.fromEntries(preseal.productSeals.map((summary)=>{
    const seal=buildFactory2ProductSeal(summary.productId,{cwd:root});
    if(seal.sealSha256!==summary.sealSha256||seal.fileCount!==summary.fileCount){
      throw new Error(`FACTORY2_STAGING_PRODUCT_SEAL_SUBJECT_MISMATCH:${summary.productId}`);
    }
    return [summary.productId,seal];
  }));
  const finalDist=JSON.parse(JSON.stringify(dist));
  finalDist.status='STAGING_MATERIALIZED_FROM_PASS_PRESEAL';
  finalDist.presealQualificationSha256=preseal.qualificationSubjectSha256;
  finalDist.products=finalDist.products.map((p)=>({
    ...p,
    qualifiedSealSha256:seals[p.id]?.sealSha256??p.qualifiedSealSha256,
  }));
  finalDist.sha256sums='SHA256SUMS';
  finalDist.deterministicRebuildReceipt='ACCEPTANCE/PRESEAL_QUALIFICATION.json';
  writeJson(resolve(out,'FACTORY2_DISTRIBUTION_MANIFEST.json'),finalDist);

  for(const seal of Object.values(completeSeals)){
    writeJson(resolve(out,'PRODUCTS',`${seal.productId}.seal.json`),seal);
  }
  copyProductFile('FACTORY2_DOMAIN_ENGINEERING_PRODUCT_2026-09-24.json',resolve(out,'PRODUCTS'));
  copyProductFile('FACTORY2_DOMAIN_STUDIO_PRODUCT_2026-09-24.json',resolve(out,'PRODUCTS'));
  copyProductFile('FACTORY2_COMMON_MODULES_PRODUCT_2026-09-24.json',resolve(out,'PRODUCTS'));
  copyProductFile('FACTORY2_DOMAIN_KEYS_PRODUCT_2026-09-24.json',resolve(out,'PRODUCTS'));

  for(const file of [
    'FACTORY2_CONTROL_PLANE_SUCCESSOR_MAP_2026-09-24.json',
    'FACTORY2_PRODUCT_LOGIC_SUCCESSOR_2026-09-24.json',
    'FACTORY2_CAPABILITY_SECURITY_ARCHITECTURE_2026-09-24.json',
    'FACTORY2_ARCHITECTURE_CHECKPOINT_2026-09-24.json',
    'FACTORY2_PRIVATE_STANDARD_SUCCESSOR_2026-09-24.json',
    'FACTORY2_RUNTIME_CONTRACT_SUCCESSOR_2026-09-24.json',
    'FACTORY2_COMMON_RELEASE_LOCK_CANDIDATE_2026-09-24.json',
    'FACTORY2_COMMON_FREEZE_CANDIDATE_2026-09-24.json',
    'FACTORY2_P6_SUCCESSOR_2026-09-24.json',
    'FACTORY2_P7_SUCCESSOR_2026-09-24.json',
  ]) copyProductFile(file,resolve(out,'CONTROL'));

  writeJson(resolve(out,'ACCEPTANCE','PRESEAL_QUALIFICATION.json'),preseal);
  writeJson(resolve(out,'ACCEPTANCE','NEUTRAL_ACCEPTANCE_EXECUTION.json'),preseal.neutralAcceptance);
  copyProductFile('FACTORY2_NEUTRAL_ACCEPTANCE_CASE_2026-09-24.json',resolve(out,'ACCEPTANCE'));
  copyProductFile('FACTORY2_ACCEPTANCE_RESULT_2026-09-24.json',resolve(out,'ACCEPTANCE'));
  copyProductFile('FACTORY2_DOMAIN_RUN_BOOTSTRAP_2026-09-24.json',resolve(out,'BOOTSTRAP'));
  copyProductFile('FACTORY2_CONTRACT_VERSION_COMPATIBILITY_MANIFEST_2026-09-24.json',resolve(out,'COMPATIBILITY'));
  copyProductFile('FACTORY2_ENVIRONMENT_TOOLCHAIN_MANIFEST_2026-09-24.json',resolve(out,'TOOLCHAIN'));
  copyProductFile('FACTORY2_START_HERE_2026-09-24.md',out,'START_HERE.md');

  const sourcePayload=copyTrackedFinalSuccessor(out);
  const k035=materializeFactory2K035Products({
    authorityPath:resolve(repositoryRoot,'t2/current/final-successor/canonical-source-inputs/k035-rc20/SOURCE_AUTHORITY.json'),
    repositoryRoot,
    outputRoot:resolve(out,'PRODUCTS'),
    writeEnvelope:false,
  });
  const payloadManifest={
    schema:'IWXA_T2_FACTORY2_SELF_CONTAINED_PAYLOAD_MANIFEST_V1',
    factoryId:'IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2',
    generation:2,
    status:'SELF_CONTAINED_PAYLOAD_MATERIALIZED',
    sourceTree:sourcePayload,
    products:[
      {id:'common-modules',payloadRoots:stagedSealRoots('common-modules'),sealFile:'PRODUCTS/common-modules.seal.json',sealSha256:seals['common-modules'].sealSha256,sealFileCount:seals['common-modules'].fileCount,mode:'SOURCE_BYTES',payloadCompleteness:'SEAL_ROOTS_EXACT'},
      {id:'domain-kernel',payloadRoots:['PRODUCTS/'+k035.components.kernel.artifact],sha256:k035.components.kernel.sha256,mode:'EXACT_PRODUCT_ZIP'},
      {id:'universal-workspace',payloadRoots:['PRODUCTS/'+k035.components.workspace.artifact,stagedCanonicalSourcePrefix+'/src/workspace-host'],sha256:k035.components.workspace.sha256,currentSuccessorSource:stagedCanonicalSourcePrefix+'/src/workspace-host',mode:'EXACT_BASE_PLUS_CURRENT_SUCCESSOR_SOURCE'},
      {id:'domain-keys',payloadRoots:stagedSealRoots('domain-keys'),sealFile:'PRODUCTS/domain-keys.seal.json',sealSha256:seals['domain-keys'].sealSha256,sealFileCount:seals['domain-keys'].fileCount,mode:'SOURCE_BYTES',payloadCompleteness:'SEAL_ROOTS_EXACT'},
      {id:'domain-studio',payloadRoots:stagedSealRoots('domain-studio'),sealFile:'PRODUCTS/domain-studio.seal.json',sealSha256:seals['domain-studio'].sealSha256,sealFileCount:seals['domain-studio'].fileCount,mode:'SOURCE_BYTES',payloadCompleteness:'SEAL_ROOTS_EXACT'},
      {id:'domain-engineering',payloadRoots:stagedSealRoots('domain-engineering'),sealFile:'PRODUCTS/domain-engineering.seal.json',sealSha256:seals['domain-engineering'].sealSha256,sealFileCount:seals['domain-engineering'].fileCount,mode:'SOURCE_BYTES',payloadCompleteness:'SEAL_ROOTS_EXACT'}
    ],
    operationalProfiles:'t2/current/final-successor/product/FACTORY2_OPERATIONAL_PROFILES_2026-09-24.json',
    operatorGuide:'t2/current/final-successor/product/FACTORY2_OPERATOR_GUIDE_RU.md',
    repositoryCheckoutRequiredAfterExtraction:false,
    productionActivation:false
  };
  writeJson(resolve(out,'PRODUCTS','FACTORY2_SELF_CONTAINED_PAYLOAD_MANIFEST.json'),payloadManifest);
  finalDist.payloadMode='SELF_CONTAINED';
  finalDist.repositoryCheckoutRequiredAfterExtraction=false;
  finalDist.selfContainedPayloadManifest='PRODUCTS/FACTORY2_SELF_CONTAINED_PAYLOAD_MANIFEST.json';
  finalDist.products=finalDist.products.map((p)=>{
    const payloadEntry=payloadManifest.products.find((x)=>x.id===p.id);
    const payloadPaths=payloadEntry?.payloadRoots??[];
    return {
      ...p,
      payloadPaths,
      payloadPath:payloadPaths.length===1?payloadPaths[0]:null,
    };
  });
  writeJson(resolve(out,'FACTORY2_DISTRIBUTION_MANIFEST.json'),finalDist);

  const sums=buildFactory2Sha256Sums(out);
  writeFileSync(resolve(out,'SHA256SUMS'),sums,'utf8');
  const verification=verifyFactory2Sha256Sums(out,sums);
  return Object.freeze({
    schema:'IWXA_T2_FACTORY2_STAGING_ASSEMBLY_RECEIPT_V1',
    status:'PASS',
    factoryId:'IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2',
    sourceCommitSha:preseal.sourceCommitSha,
    presealQualificationSha256:preseal.qualificationSubjectSha256,
    stagedProductSealCount:preseal.productSeals.length,
    selfContainedSourceFileCount:sourcePayload.fileCount,
    selfContainedSourceBytes:sourcePayload.totalBytes,
    selfContainedPayloadMaterialized:true,
    exactKernelSha256:k035.components.kernel.sha256,
    exactWorkspaceBaseSha256:k035.components.workspace.sha256,
    repositoryCheckoutRequiredAfterExtraction:false,
    sha256sumsSha256:verification.sha256sumsSha256,
    stagedFileCount:verification.fileCount+1,
    factoryAcceptanceGranted:false,
    ownerApprovalGranted:false,
    productionActivation:false,
  });
}
function main(){
  const [presealPath,out]=process.argv.slice(2);
  if(!presealPath||!out){
    console.error('usage: node scripts/assemble-factory2-staging.mjs <preseal-receipt-json> <staging-root>');
    process.exit(2);
  }
  try{
    const receipt=assembleFactory2Staging({presealReceipt:readJson(resolve(presealPath)),outputRoot:out});
    console.log(JSON.stringify(receipt,null,2));
  }catch(error){ console.error(error?.stack||String(error)); process.exit(1); }
}
if(import.meta.url===pathToFileURL(resolve(process.argv[1]??'')).href) main();
