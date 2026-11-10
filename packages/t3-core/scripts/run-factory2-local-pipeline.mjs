#!/usr/bin/env node
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,relative,resolve,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {CURRENT_EXECUTABLE_TOOLCHAIN} from './run-current-executable-verification.mjs';
import {assertCurrentLiveHead} from './current-live-head.mjs';
import {assembleFactory2Staging} from './assemble-factory2-staging.mjs';
import {extractFactory2ZipBytes,writeFactory2Zip} from './factory2-deterministic-zip.mjs';
import {makeFactory2ReleaseTechnicalReadiness} from './factory2-release-technical-readiness.mjs';
import {FACTORY2_ARTIFACT_NAME} from '../src/factory2/distribution/release-identity.mjs';

const scriptPath=fileURLToPath(import.meta.url);
const root=dirname(dirname(scriptPath));
const rel=(base,path)=>relative(base,path).split(sep).join('/');

function readJson(path){ return JSON.parse(readFileSync(path,'utf8')); }
function writeJson(path,value){ writeFileSync(path,JSON.stringify(value,null,2)+'\n','utf8'); }
function runNode(script,args,label){
  const result=spawnSync(process.execPath,[resolve(root,script),...args],{
    cwd:root,encoding:'utf8',shell:false,stdio:'pipe',maxBuffer:64*1024*1024,
  });
  if(result.error) throw new Error(`FACTORY2_LOCAL_PIPELINE_SPAWN_FAILED:${label}:${result.error.message}`);
  if(result.status!==0){
    throw new Error(`FACTORY2_LOCAL_PIPELINE_STEP_FAILED:${label}:${result.status}:${result.stderr||result.stdout}`);
  }
  return String(result.stdout??'').trim();
}
function assertSha40(value,label){
  if(typeof value!=='string'||!/^[0-9a-f]{40}$/.test(value)) throw new Error(`FACTORY2_LOCAL_PIPELINE_INVALID_${label}`);
}

export function makeFactory2LocalPipelineReceipt({expectedHead,verification,preseal,staging,zipReceipt,freshExtract,readiness,outputRoot}){
  assertSha40(expectedHead,'HEAD');
  if(verification?.status!=='PASS'||verification.sourceCommitSha!==expectedHead) throw new Error('FACTORY2_LOCAL_PIPELINE_VERIFICATION_INVALID');
  if(preseal?.status!=='PASS_PRESEAL_TECHNICAL_EVIDENCE'||preseal.sourceCommitSha!==expectedHead) throw new Error('FACTORY2_LOCAL_PIPELINE_PRESEAL_INVALID');
  if(staging?.status!=='PASS'||staging.sourceCommitSha!==expectedHead) throw new Error('FACTORY2_LOCAL_PIPELINE_STAGING_INVALID');
  if(zipReceipt?.status!=='PASS'||zipReceipt.artifactName!==FACTORY2_ARTIFACT_NAME||freshExtract?.status!=='PASS'||readiness?.status!=='TECHNICAL_SUBJECT_BOUND_OWNER_DECISIONS_PENDING') throw new Error('FACTORY2_LOCAL_PIPELINE_PACKAGE_INVALID');
  if(readiness.subject?.sourceCommitSha!==expectedHead||readiness.subject?.artifactSha256!==zipReceipt.sha256) throw new Error('FACTORY2_LOCAL_PIPELINE_SUBJECT_MISMATCH');
  return Object.freeze({
    schema:'IWXA_T2_FACTORY2_LOCAL_EXECUTION_PIPELINE_RECEIPT_V1',
    status:'PASS_TECHNICAL_PIPELINE_OWNER_DECISIONS_PENDING',
    factoryId:'IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2',
    generation:2,
    kernelTarget:'0.3.5',
    sourceCommitSha:expectedHead,
    sourceTreeSha:verification.sourceTreeSha,
    exactToolchain:Object.freeze({...CURRENT_EXECUTABLE_TOOLCHAIN}),
    outputRoot,
    artifact:Object.freeze({
      name:FACTORY2_ARTIFACT_NAME,
      sha256:zipReceipt.sha256,
      bytes:zipReceipt.bytes,
    }),
    releaseSubjectSha256:readiness.subjectSha256,
    receipts:Object.freeze({
      currentVerification:'current-executable-verification.json',
      presealQualification:'factory2-preseal-qualification.json',
      stagingAssembly:'factory2-staging-assembly.json',
      deterministicZip:'factory2-deterministic-zip.json',
      freshExtractSelftest:'factory2-fresh-extract-selftest.json',
      releaseTechnicalReadiness:'factory2-release-technical-readiness.json',
    }),
    commonReleaseLockIssued:false,
    commonFreezeIssued:false,
    p6Authorized:false,
    p7Authorized:false,
    factoryAcceptanceGranted:false,
    ownerApprovalGranted:false,
    productionActivation:false,
    realDomainRunAuthorized:false,
  });
}

function main(){
  const [outputRootArg,expectedHeadArg]=process.argv.slice(2);
  if(!outputRootArg||!expectedHeadArg){
    console.error('usage: node scripts/run-factory2-local-pipeline.mjs <new-output-root-outside-worktree> <expected-head-sha>');
    process.exit(2);
  }
  const expectedHead=String(expectedHeadArg).trim().toLowerCase();
  if(!/^[0-9a-f]{40}$/.test(expectedHead)){ console.error('FACTORY2_LOCAL_PIPELINE_EXPECTED_HEAD_INVALID'); process.exit(2); }
  if(process.version!==CURRENT_EXECUTABLE_TOOLCHAIN.nodeVersion){
    console.error(`FACTORY2_LOCAL_PIPELINE_NODE_VERSION_MISMATCH:${process.version}`); process.exit(2);
  }
  const outputRoot=resolve(outputRootArg);
  if(existsSync(outputRoot)){ console.error('FACTORY2_LOCAL_PIPELINE_OUTPUT_ROOT_EXISTS'); process.exit(2); }

  try{
    assertCurrentLiveHead({expectedHead});
    mkdirSync(outputRoot,{recursive:false});

    const verificationPath=resolve(outputRoot,'current-executable-verification.json');
    runNode('scripts/run-current-executable-verification.mjs',[verificationPath,expectedHead],'current-verification');
    const verification=readJson(verificationPath);

    const presealPath=resolve(outputRoot,'factory2-preseal-qualification.json');
    runNode('scripts/run-factory2-preseal-qualification.mjs',[verificationPath,presealPath,expectedHead],'factory2-preseal');
    const preseal=readJson(presealPath);

    const stagingRoot=resolve(outputRoot,'staging');
    const staging=assembleFactory2Staging({presealReceipt:preseal,outputRoot:stagingRoot});
    const stagingReceiptPath=resolve(outputRoot,'factory2-staging-assembly.json');
    writeJson(stagingReceiptPath,staging);

    const artifactPath=resolve(outputRoot,FACTORY2_ARTIFACT_NAME);
    const zipReceipt=writeFactory2Zip(stagingRoot,artifactPath);
    const zipReceiptPath=resolve(outputRoot,'factory2-deterministic-zip.json');
    writeJson(zipReceiptPath,zipReceipt);

    const freshRoot=resolve(outputRoot,'fresh-extract');
    extractFactory2ZipBytes(readFileSync(artifactPath),freshRoot);
    const packagedSelftest=resolve(freshRoot,'t2/current/final-successor/canonical-source/scripts/factory2-fresh-extract-selftest.mjs');
    const selftestText=runNode(packagedSelftest,[freshRoot],'factory2-fresh-extract-selftest');
    const freshExtract=JSON.parse(selftestText);
    const freshExtractPath=resolve(outputRoot,'factory2-fresh-extract-selftest.json');
    writeJson(freshExtractPath,freshExtract);

    const readiness=makeFactory2ReleaseTechnicalReadiness({preseal,staging,zipReceipt,freshExtract});
    const readinessPath=resolve(outputRoot,'factory2-release-technical-readiness.json');
    writeJson(readinessPath,readiness);

    const receipt=makeFactory2LocalPipelineReceipt({
      expectedHead,verification,preseal,staging,zipReceipt,freshExtract,readiness,
      outputRoot:rel(dirname(outputRoot),outputRoot)||'.',
    });
    writeJson(resolve(outputRoot,'FACTORY2_LOCAL_PIPELINE_RECEIPT.json'),receipt);
    console.log(JSON.stringify(receipt,null,2));
  }catch(error){
    console.error(error?.stack||String(error));
    process.exit(1);
  }
}
if(import.meta.url===pathToFileURL(resolve(process.argv[1]??'')).href) main();
