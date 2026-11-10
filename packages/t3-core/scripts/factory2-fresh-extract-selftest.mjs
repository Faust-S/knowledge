#!/usr/bin/env node
import {existsSync,mkdtempSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {verifyFactory2Sha256Sums} from './factory2-staging-tree.mjs';
import {materializeFactory2K035Products} from './factory2-k035-source-materializer.mjs';
import {evaluateFactory2DomainRun,initFactory2DomainRun,submitFactory2DomainRun} from './factory2-domain-run-cli.mjs';

const readJson=(p)=>JSON.parse(readFileSync(resolve(p),'utf8'));
const sha256=(bytes)=>createHash('sha256').update(bytes).digest('hex');
function assertPayloadRoot(root,pathValue){
  const path=resolve(root,...String(pathValue).split('/'));
  if(!existsSync(path)) throw new Error(`FACTORY2_FRESH_EXTRACT_PAYLOAD_ROOT_MISSING:${pathValue}`);
  return path;
}
function verifySourceProductPayload(root,payloadEntry){
  if(payloadEntry?.mode!=='SOURCE_BYTES'||payloadEntry.payloadCompleteness!=='SEAL_ROOTS_EXACT') throw new Error(`FACTORY2_FRESH_EXTRACT_SOURCE_PAYLOAD_MODE_INVALID:${payloadEntry?.id}`);
  if(!Array.isArray(payloadEntry.payloadRoots)||payloadEntry.payloadRoots.length<1) throw new Error(`FACTORY2_FRESH_EXTRACT_SOURCE_PAYLOAD_ROOTS_INVALID:${payloadEntry?.id}`);
  for(const payloadRoot of payloadEntry.payloadRoots) assertPayloadRoot(root,payloadRoot);
  const sealPath=assertPayloadRoot(root,payloadEntry.sealFile);
  const seal=readJson(sealPath);
  if(seal.productId!==payloadEntry.id||seal.sealSha256!==payloadEntry.sealSha256||seal.fileCount!==payloadEntry.sealFileCount) throw new Error(`FACTORY2_FRESH_EXTRACT_SOURCE_SEAL_BINDING_INVALID:${payloadEntry.id}`);
  if(!Array.isArray(seal.files)||!Number.isInteger(seal.fileCount)||seal.fileCount<1||seal.files.length!==seal.fileCount) throw new Error(`FACTORY2_FRESH_EXTRACT_SOURCE_SEAL_FILE_COUNT_INVALID:${payloadEntry.id}`);
  for(const file of seal.files){
    const packaged=assertPayloadRoot(root,`t2/current/final-successor/canonical-source/${file.path}`);
    if(statSync(packaged).isFile()!==true||sha256(readFileSync(packaged))!==file.sha256) throw new Error(`FACTORY2_FRESH_EXTRACT_SOURCE_SEAL_FILE_MISMATCH:${payloadEntry.id}:${file.path}`);
  }
  return seal.fileCount;
}
const SYNTHETIC_OWNER_SOURCE_ZIP_BASE64='UEsDBBQAAAAAAAAAIQDqnHnKIAAAACAAAAARAAAAZG9tYWluLXNvdXJjZS50eHRmYWN0b3J5MiBzeW50aGV0aWMgb3duZXIgc291cmNlClBLAQIUAxQAAAAAAAAAIQDqnHnKIAAAACAAAAARAAAAAAAAAAAAAACAAQAAAABkb21haW4tc291cmNlLnR4dFBLBQYAAAAAAQABAD8AAABPAAAAAAA=';
export function verifyFactory2FreshExtract(rootValue){
  const root=resolve(rootValue);
  for(const path of ['SHA256SUMS','FACTORY2_DISTRIBUTION_MANIFEST.json','PRODUCTS/FACTORY2_SELF_CONTAINED_PAYLOAD_MANIFEST.json','START_HERE.md','t2/current/final-successor/canonical-source/package.json','t2/current/final-successor/product/T25_TO_T2_CAPABILITY_CLOSURE_MATRIX_2026-09-20.json'])
    if(!existsSync(resolve(root,path))) throw new Error(`FACTORY2_FRESH_EXTRACT_REQUIRED_PATH_MISSING:${path}`);
  const sums=verifyFactory2Sha256Sums(root,readFileSync(resolve(root,'SHA256SUMS'),'utf8'));
  const dist=readJson(resolve(root,'FACTORY2_DISTRIBUTION_MANIFEST.json'));
  if(dist.payloadMode!=='SELF_CONTAINED'||dist.repositoryCheckoutRequiredAfterExtraction!==false) throw new Error('FACTORY2_FRESH_EXTRACT_NOT_SELF_CONTAINED');
  const payload=readJson(resolve(root,'PRODUCTS/FACTORY2_SELF_CONTAINED_PAYLOAD_MANIFEST.json'));
  if(payload.status!=='SELF_CONTAINED_PAYLOAD_MATERIALIZED'||payload.products?.length!==6) throw new Error('FACTORY2_FRESH_EXTRACT_PRODUCT_PAYLOAD_INVALID');
  const byProduct=new Map(payload.products.map((entry)=>[entry.id,entry]));
  for(const id of ['common-modules','domain-keys','domain-studio','domain-engineering']) verifySourceProductPayload(root,byProduct.get(id));
  const kernelPayload=byProduct.get('domain-kernel'),workspacePayload=byProduct.get('universal-workspace');
  if(kernelPayload?.mode!=='EXACT_PRODUCT_ZIP'||!Array.isArray(kernelPayload.payloadRoots)||kernelPayload.payloadRoots.length!==1) throw new Error('FACTORY2_FRESH_EXTRACT_KERNEL_PAYLOAD_INVALID');
  if(workspacePayload?.mode!=='EXACT_BASE_PLUS_CURRENT_SUCCESSOR_SOURCE'||!Array.isArray(workspacePayload.payloadRoots)||workspacePayload.payloadRoots.length!==2) throw new Error('FACTORY2_FRESH_EXTRACT_WORKSPACE_PAYLOAD_INVALID');
  for(const payloadRoot of kernelPayload.payloadRoots) assertPayloadRoot(root,payloadRoot);
  for(const payloadRoot of workspacePayload.payloadRoots) assertPayloadRoot(root,payloadRoot);
  const matrix=readJson(resolve(root,'t2/current/final-successor/product/T25_TO_T2_CAPABILITY_CLOSURE_MATRIX_2026-09-20.json'));
  if(matrix.summary?.rowCount!==44||matrix.summary?.transferImplementationOpenCapabilities?.length!==0) throw new Error('FACTORY2_FRESH_EXTRACT_T25_COVERAGE_INVALID');
  const temp=mkdtempSync(join(tmpdir(),'factory2-fresh-'));
  try{
    const receipt=materializeFactory2K035Products({
      authorityPath:resolve(root,'t2/current/final-successor/canonical-source-inputs/k035-rc20/SOURCE_AUTHORITY.json'),
      repositoryRoot:root,outputRoot:resolve(temp,'products'),writeEnvelope:false
    });
    for(const key of ['kernel','workspace']){
      const packaged=readFileSync(resolve(root,'PRODUCTS',receipt.components[key].artifact));
      const rebuilt=readFileSync(resolve(temp,'products',receipt.components[key].artifact));
      if(Buffer.compare(packaged,rebuilt)!==0) throw new Error(`FACTORY2_FRESH_EXTRACT_${key.toUpperCase()}_BYTES_MISMATCH`);
    }
    const source=resolve(temp,'owner-domain-source.zip');
    writeFileSync(source,Buffer.from(SYNTHETIC_OWNER_SOURCE_ZIP_BASE64,'base64'));
    const runRoot=resolve(temp,'domain-run');
    const run=initFactory2DomainRun({sourceZip:source,domainId:'D03',out:runRoot,executionProfile:'ONE_DAY'});
    if(run.status!=='BOOTSTRAPPED'||run.sourceOrigin!=='OWNER_SUPPLIED_AT_TEST_TIME'||run.executionProfile!=='ONE_DAY'||run.sourceArchiveFormat!=='ZIP'||run.sourceArchiveEntryCount!==1) throw new Error('FACTORY2_FRESH_EXTRACT_DOMAIN_BOOTSTRAP_FAILED');
    const sourceSha=run.sourceSha256;
    const engineeringInput={
      sourceOrigin:'OWNER_SUPPLIED_AT_TEST_TIME',genericWriteAuthority:false,productionActivation:false,
      transformation:{
        intake:{domainId:'D03',productName:'Synthetic Fresh Extract Canary',currentSourceRef:'sha256:'+sourceSha,authorityStatus:'AUTHORITY_BOUND_PRODUCT_LOGIC',ownerRefs:['owner:synthetic-canary'],sourceTruthRefs:['source:synthetic-canary'],schemaRefs:['schema:synthetic-canary'],schemaMapStatus:'COMPLETE',ownerCommandMapStatus:'COMPLETE',processResultMapStatus:'COMPLETE',compatibilityMapStatus:'COMPLETE',rollbackPlanStatus:'COMPLETE',compatibilityConstraints:['fresh-extract-only']},
        schemaMap:{domainId:'D03',currentSourceSha256:sourceSha,targetSchemaIds:['neutral-object'],mappings:[{targetSchemaId:'neutral-object',status:'BOUND',ownerRef:'owner:synthetic-canary',sourceSchemaRefs:['schema:neutral-object'],migrationRefs:[],evidenceRefs:['evidence:neutral-schema']}],genericWriteAuthority:false},
        ownerCommandMap:{domainId:'D03',sourceSha256:sourceSha,entries:[{component:'neutral-owner',ownerRef:'owner:synthetic-canary',status:'BOUND',commandIds:['neutral.create'],evidenceRefs:['evidence:neutral-command']}],genericWriteAuthority:false,workspaceMayBecomeBusinessOwner:false},
        resultAcceptanceMap:{domainId:'D03',currentSourceSha256:sourceSha,persistentAuthorityStatus:'BOUND',entries:[{resultKind:'neutral-result',producerRef:'owner:synthetic-canary',status:'BOUND',acceptedResultRefs:['result:neutral'],inputAcceptanceEvidenceRefs:[],acceptanceCriteriaRefs:['criteria:neutral'],provenanceRefs:['provenance:neutral'],limitations:[],evidenceRefs:['evidence:neutral-result']}],genericWriteAuthority:false,commonProjectProcessResultWriterAllowed:false,commonAcceptanceWriterAllowed:false},
        compatibilityMap:{domainId:'D03',currentSourceSha256:sourceSha,entries:[{subject:'neutral-state',status:'BOUND',guarantees:['exact source identity preserved'],migrationRefs:[],limitations:[],evidenceRefs:['evidence:neutral-compatibility']}],destructiveMigrationAuthorized:false,productionActivation:false},
        rollbackPlan:{domainId:'D03',baselineSourceRef:'sha256:'+sourceSha,acceptedStateRef:'state:synthetic-canary',rollbackEvidenceRef:'evidence:neutral-rollback',limitations:[],verificationSteps:['verify exact source sha256'],executionAuthorized:false,destructiveCleanupAuthorized:false,productionActivation:false}
      },
      candidate:{domainId:'D03',evidenceRefs:['evidence:neutral-candidate'],rollbackRef:'evidence:neutral-rollback',compatibilityVerified:true,genericWriteAuthority:false,aiOutputSourceTruth:false,hiddenWritesAllowed:false,genericPutObjectAllowed:false,productionActivation:false}
    };
    writeFileSync(resolve(runRoot,'engineering-input.json'),JSON.stringify(engineeringInput,null,2)+'\n','utf8');
    const evaluated=evaluateFactory2DomainRun(runRoot);
    if(evaluated.status!=='READY_FOR_STUDIO_SUBMISSION') throw new Error('FACTORY2_FRESH_EXTRACT_ENGINEERING_FAILED');
    const submission=submitFactory2DomainRun(runRoot);
    if(submission.status!=='SUBMITTED_FOR_STUDIO_ACCEPTANCE'||submission.ownerApprovalGranted!==false||submission.productionActivation!==false) throw new Error('FACTORY2_FRESH_EXTRACT_STUDIO_SUBMISSION_FAILED');
    const engineeringSession=readJson(resolve(runRoot,'ENGINEERING_SESSION.json'));
    return Object.freeze({schema:'IWXA_T2_FACTORY2_FRESH_EXTRACT_SELFTEST_V1',status:'PASS',sha256sumsSha256:sums.sha256sumsSha256,fileCount:sums.fileCount,productCount:6,sourceProductSealPayloadsVerified:true,t25CapabilityCount:44,kernelSha256:receipt.components.kernel.sha256,workspaceBaseSha256:receipt.components.workspace.sha256,domainRunBootstrap:'PASS',ownerSourceZipValidation:'PASS',sourceArchiveFormat:run.sourceArchiveFormat,sourceArchiveEntryCount:run.sourceArchiveEntryCount,sourceSha256:run.sourceSha256,domainEngineering:'PASS',candidateValidationStatus:engineeringSession.candidateValidation?.status,studioSubmission:'PASS',studioSubmissionStatus:submission.status,oneDayProfile:'PASS',terminalApprovalSynthesized:false,ownerApprovalGranted:false,repositoryCheckoutRequired:false,productionActivation:false});
  }finally{rmSync(temp,{recursive:true,force:true});}
}
function main(){const root=process.argv[2]??resolve(process.cwd());try{console.log(JSON.stringify(verifyFactory2FreshExtract(root),null,2));}catch(e){console.error(e?.stack||String(e));process.exit(1);}}
if(process.argv[1]&&process.argv[1].endsWith('factory2-fresh-extract-selftest.mjs')) main();
