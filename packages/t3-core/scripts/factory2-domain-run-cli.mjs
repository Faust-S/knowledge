#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,mkdirSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {dirname,resolve,relative,isAbsolute,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildFactory2EngineeringBootstrap} from '../src/factory2/products/domain-engineering/engineering-bootstrap.mjs';
import {evaluateFactory2DomainEngineering} from '../src/factory2/products/domain-engineering/domain-engineering.mjs';
import {domainResultAuthorityReadiness} from '../src/modules/base/features/project-process/domain-result-authority-registry.mjs';
import {buildFactory2StudioModel} from '../src/factory2/products/domain-studio/domain-studio.mjs';
import {qualifyFactory2DomainProduct,verifyFactory2DomainProduct} from '../src/factory2/products/domain-completion/product-completion.mjs';
import {initAcceptedProductRun} from '../src/factory2/products/domain-completion/accepted-product-run.mjs';
import {inspectCanonicalGitSource,verifyCanonicalGitDescendant} from './factory2-canonical-git-source.mjs';

const sha256=(b)=>createHash('sha256').update(b).digest('hex');
const readJson=(p)=>JSON.parse(readFileSync(resolve(p),'utf8'));
const writeJson=(p,v)=>{mkdirSync(dirname(p),{recursive:true});writeFileSync(p,JSON.stringify(v,null,2)+'\n','utf8');};
const DOMAIN=/^D(?:0[1-9]|[1-9][0-9]+)$/;
const PRE_SUBMISSION_STATES=new Set(['BOOTSTRAPPED','ENGINEERING_BLOCKED','CANDIDATE_ENGINEERING_READY','READY_FOR_STUDIO_SUBMISSION','GIT_ENGINEERING_READY']);
function requiredToken(value,code){if(typeof value!=='string'||!value.trim()) throw new Error(code);return value.trim();}
function assertSha256(value,code){if(typeof value!=='string'||!/^[0-9a-f]{64}$/.test(value)) throw new Error(code);return value;}
function assertRunArtifactBytes(root,pathValue,expectedSha,label){
  assertSha256(expectedSha,`FACTORY2_DOMAIN_RUN_ARTIFACT_DIGEST_MISSING:${label}`);
  if(sha256(readFileSync(resolve(root,pathValue)))!==expectedSha) throw new Error(`FACTORY2_DOMAIN_RUN_ARTIFACT_BYTES_CHANGED:${label}`);
}
function assertRunState(state){
  if(!state||state.schema!=='IWXA_T2_FACTORY2_DOMAIN_RUN_STATE_V1'||!DOMAIN.test(String(state.domainId||''))||
     typeof state.sourceSha256!=='string'||!/^[0-9a-f]{64}$/.test(state.sourceSha256)||
     !['OWNER_SUPPLIED_AT_TEST_TIME','CANONICAL_GIT_HEAD_TREE'].includes(state.sourceOrigin)||
     (state.sourceOrigin==='OWNER_SUPPLIED_AT_TEST_TIME'&&state.sourceFile!=='input/domain-source.zip')||
     (state.sourceOrigin==='CANONICAL_GIT_HEAD_TREE'&&(!state.siteGit||state.sourceGit!==null||state.sourceFile!==null||state.sourceSha256!==state.siteGit.sourceSha256))||
     state.engineeringInput!=='engineering-input.json'||
     !['STANDARD','ONE_DAY'].includes(state.executionProfile)||state.productionActivation!==false) throw new Error('FACTORY2_DOMAIN_RUN_STATE_INVALID');
}
function assertProductRunState(state){
  if(state?.schema==='IWXA_T2_ACCEPTED_PRODUCT_RUN_V1'){
    if(state.status!=='T2_READY'||state.sourceOrigin!=='ACCEPTED_CANONICAL_GIT'||
      state.productionActivation!==false||state.terminalResult!=='STUDIO_TERMINAL_RESULT.json'||
      state.engineeringInput!=='engineering-input.json'||!/^[a-f0-9]{64}$/.test(state.sourceSha256??'')||
      !state.acceptedGit) throw new Error('FACTORY2_ACCEPTED_PRODUCT_RUN_INVALID');
    return;
  }
  assertRunState(state);
}
function assertProductSourceBytes(root,state){
  // An accepted canonical Git subject is verified against its historical
  // Human decision inside the product gate. No source ZIP is required.
  if(state.schema==='IWXA_T2_ACCEPTED_PRODUCT_RUN_V1') return;
  assertRunSourceBytes(root,state);
}
function assertRunSourceBytes(root,state){
  if(state.sourceOrigin==='CANONICAL_GIT_HEAD_TREE'){
    verifyCanonicalGitDescendant(state.siteGit.checkout,state.siteGit.subject,state.siteGit.sourceSha256,{fetchRemote:true});
    return;
  }
  const bytes=readFileSync(resolve(root,state.sourceFile));
  validateFactory2DomainSourceZip(bytes);
  if(sha256(bytes)!==state.sourceSha256) throw new Error('FACTORY2_DOMAIN_RUN_SOURCE_BYTES_CHANGED');
}
function assertRunSubject(state,value,label){
  if(value?.domainId!==state.domainId||value?.sourceSha256!==state.sourceSha256) throw new Error(`FACTORY2_DOMAIN_RUN_SUBJECT_MISMATCH:${label}`);
}
const EOCD=0x06054b50,CENTRAL=0x02014b50,LOCAL=0x04034b50;

function findZipEocd(bytes){
  if(bytes.length<22) throw new Error('FACTORY2_DOMAIN_RUN_SOURCE_ZIP_INVALID:EOCD_MISSING');
  const min=Math.max(0,bytes.length-22-0xffff);
  for(let i=bytes.length-22;i>=min;i--){
    if(bytes.readUInt32LE(i)!==EOCD) continue;
    if(i+22+bytes.readUInt16LE(i+20)===bytes.length) return i;
  }
  throw new Error('FACTORY2_DOMAIN_RUN_SOURCE_ZIP_INVALID:EOCD_MISSING');
}
export function validateFactory2DomainSourceZip(value){
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(value);
  const eocd=findZipEocd(bytes);
  const disk=bytes.readUInt16LE(eocd+4),centralDisk=bytes.readUInt16LE(eocd+6);
  const diskEntries=bytes.readUInt16LE(eocd+8),entries=bytes.readUInt16LE(eocd+10);
  const centralSize=bytes.readUInt32LE(eocd+12),centralOffset=bytes.readUInt32LE(eocd+16);
  if(entries===0) throw new Error('FACTORY2_DOMAIN_RUN_SOURCE_ZIP_INVALID:EMPTY_ARCHIVE');
  if(entries===0xffff||centralSize===0xffffffff||centralOffset===0xffffffff) throw new Error('FACTORY2_DOMAIN_RUN_SOURCE_ZIP_INVALID:ZIP64_UNSUPPORTED');
  if(disk!==0||centralDisk!==0||diskEntries!==entries) throw new Error('FACTORY2_DOMAIN_RUN_SOURCE_ZIP_INVALID:MULTI_DISK_UNSUPPORTED');
  const centralEnd=centralOffset+centralSize;
  if(centralEnd!==eocd||centralOffset<0||centralEnd>bytes.length) throw new Error('FACTORY2_DOMAIN_RUN_SOURCE_ZIP_INVALID:CENTRAL_DIRECTORY_BOUNDS');
  let offset=centralOffset;
  for(let n=0;n<entries;n++){
    if(offset+46>centralEnd||bytes.readUInt32LE(offset)!==CENTRAL) throw new Error('FACTORY2_DOMAIN_RUN_SOURCE_ZIP_INVALID:CENTRAL_ENTRY');
    const flags=bytes.readUInt16LE(offset+8),compressedSize=bytes.readUInt32LE(offset+20);
    const nameLength=bytes.readUInt16LE(offset+28),extraLength=bytes.readUInt16LE(offset+30),commentLength=bytes.readUInt16LE(offset+32);
    const localOffset=bytes.readUInt32LE(offset+42);
    if((flags&1)!==0) throw new Error('FACTORY2_DOMAIN_RUN_SOURCE_ZIP_INVALID:ENCRYPTED_UNSUPPORTED');
    const next=offset+46+nameLength+extraLength+commentLength;
    if(next>centralEnd||localOffset+30>centralOffset||bytes.readUInt32LE(localOffset)!==LOCAL) throw new Error('FACTORY2_DOMAIN_RUN_SOURCE_ZIP_INVALID:ENTRY_BOUNDS');
    const localNameLength=bytes.readUInt16LE(localOffset+26),localExtraLength=bytes.readUInt16LE(localOffset+28);
    if(localOffset+30+localNameLength+localExtraLength+compressedSize>centralOffset) throw new Error('FACTORY2_DOMAIN_RUN_SOURCE_ZIP_INVALID:LOCAL_DATA_BOUNDS');
    offset=next;
  }
  if(offset!==centralEnd) throw new Error('FACTORY2_DOMAIN_RUN_SOURCE_ZIP_INVALID:CENTRAL_DIRECTORY_SIZE');
  return Object.freeze({format:'ZIP',entryCount:entries});
}

export function initFactory2DomainRun({sourceZip,domainId,out,executionProfile='STANDARD'}){
  const id=String(domainId).trim().toUpperCase();
  const profile=String(executionProfile).trim().toUpperCase();
  if(!['STANDARD','ONE_DAY'].includes(profile)) throw new Error('FACTORY2_DOMAIN_RUN_EXECUTION_PROFILE_INVALID');
  if(!DOMAIN.test(id)) throw new Error('FACTORY2_DOMAIN_RUN_DOMAIN_ID_INVALID');
  const bytes=readFileSync(resolve(sourceZip)); if(bytes.length===0) throw new Error('FACTORY2_DOMAIN_RUN_SOURCE_EMPTY');
  const sourceArchive=validateFactory2DomainSourceZip(bytes);
  const sourceSha256=sha256(bytes);
  const root=resolve(out); if(existsSync(root)) throw new Error('FACTORY2_DOMAIN_RUN_OUTPUT_EXISTS');
  mkdirSync(resolve(root,'input'),{recursive:true});
  copyFileSync(resolve(sourceZip),resolve(root,'input','domain-source.zip'));
  const bootstrap=buildFactory2EngineeringBootstrap({domainId:id,sourceOrigin:'OWNER_SUPPLIED_AT_TEST_TIME',sourceSha256,genericWriteAuthority:false,ownerApprovalGranted:false,productionActivation:false});
  const state={schema:'IWXA_T2_FACTORY2_DOMAIN_RUN_STATE_V1',status:'BOOTSTRAPPED',domainId:id,sourceOrigin:'OWNER_SUPPLIED_AT_TEST_TIME',sourceSha256,sourceFile:'input/domain-source.zip',sourceArchiveFormat:sourceArchive.format,sourceArchiveEntryCount:sourceArchive.entryCount,mode:'FACTORY2_T25_44_OF_44',executionProfile:profile,engineeringInput:'engineering-input.json',engineeringInputSha256:null,engineeringSession:null,engineeringSessionSha256:null,studioModel:null,studioModelSha256:null,studioSubmission:null,studioSubmissionSha256:null,terminalResult:null,productionActivation:false};
  writeJson(resolve(root,'DOMAIN_RUN.json'),state);
  writeJson(resolve(root,'ENGINEERING_BOOTSTRAP.json'),bootstrap);
  writeJson(resolve(root,'engineering-input.template.json'),{
    sourceOrigin:'OWNER_SUPPLIED_AT_TEST_TIME',genericWriteAuthority:false,productionActivation:false,
    transformation:{
      intake:{domainId:id,productName:'OWNER_SUPPLIED_PRODUCT_NAME',currentSourceRef:`sha256:${sourceSha256}`,authorityStatus:'OWNER_DECISION_REQUIRED',ownerRefs:[],sourceTruthRefs:[],schemaRefs:[],schemaMapStatus:'PENDING',ownerCommandMapStatus:'PENDING',processResultMapStatus:'PENDING',compatibilityMapStatus:'PENDING',rollbackPlanStatus:'PENDING',compatibilityConstraints:[]},
      schemaMap:{},ownerCommandMap:{},resultAcceptanceMap:{},compatibilityMap:{},rollbackPlan:{}
    }
  });
  return Object.freeze(state);
}
export function initFactory2SiteRun({siteCheckout,domainId,out,executionProfile='STANDARD'}){
 const id=String(domainId).trim().toUpperCase(),profile=String(executionProfile).trim().toUpperCase();
 if(!DOMAIN.test(id))throw new Error('FACTORY2_DOMAIN_RUN_DOMAIN_ID_INVALID');
 if(!['STANDARD','ONE_DAY'].includes(profile))throw new Error('FACTORY2_DOMAIN_RUN_EXECUTION_PROFILE_INVALID');
 const root=resolve(out);
 if(existsSync(root))throw new Error('FACTORY2_DOMAIN_RUN_OUTPUT_EXISTS');
 const siteRoot=realpathSync(siteCheckout);
 let ancestor=root;const tail=[];
 while(!existsSync(ancestor)){tail.unshift(ancestor.slice(dirname(ancestor).length+1));ancestor=dirname(ancestor);}
 const output=resolve(realpathSync(ancestor),...tail);
 const rel=relative(siteRoot,output);
 if(!rel||(rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel)))
   throw new Error('FACTORY2_DOMAIN_RUN_OUTPUT_INSIDE_SOURCE');
 const site=inspectCanonicalGitSource(siteCheckout,{fetchRemote:true});
 const sourceSha256=site.sourceSha256,sourceOrigin='CANONICAL_GIT_HEAD_TREE';
 const authorityStatus=domainResultAuthorityReadiness(id).status;
 const state={schema:'IWXA_T2_FACTORY2_DOMAIN_RUN_STATE_V1',status:'BOOTSTRAPPED',domainId:id,
   sourceOrigin,sourceSha256,sourceFile:null,sourceGit:null,
   siteGit:{checkout:resolve(siteCheckout),subject:site.subject,sourceSha256},
   sourceArchiveFormat:null,sourceArchiveEntryCount:0,mode:'FACTORY2_T25_44_OF_44',
   executionProfile:profile,engineeringInput:'engineering-input.json',engineeringInputSha256:null,
   engineeringSession:null,engineeringSessionSha256:null,studioModel:null,studioModelSha256:null,
   studioSubmission:null,studioSubmissionSha256:null,terminalResult:null,productionActivation:false};
 const bootstrap=buildFactory2EngineeringBootstrap({domainId:id,sourceOrigin,sourceSha256,
   genericWriteAuthority:false,ownerApprovalGranted:false,productionActivation:false});
 mkdirSync(root,{recursive:true});
 writeJson(resolve(root,'DOMAIN_RUN.json'),state);
 writeJson(resolve(root,'ENGINEERING_BOOTSTRAP.json'),bootstrap);
 writeJson(resolve(root,'engineering-input.template.json'),{
   sourceOrigin,genericWriteAuthority:false,productionActivation:false,
   transformation:{intake:{domainId:id,productName:'EXISTING_SITE',currentSourceRef:'sha256:'+sourceSha256,
     authorityStatus,ownerRefs:[],sourceTruthRefs:[],schemaRefs:[],
     schemaMapStatus:'PENDING',ownerCommandMapStatus:'PENDING',processResultMapStatus:'PENDING',
     compatibilityMapStatus:'PENDING',rollbackPlanStatus:'PENDING',compatibilityConstraints:[]},
     schemaMap:{},ownerCommandMap:{},resultAcceptanceMap:{},compatibilityMap:{},rollbackPlan:{}}});
 return Object.freeze(state);
}
export function evaluateFactory2DomainRun(rootValue){
  const root=resolve(rootValue), state=readJson(resolve(root,'DOMAIN_RUN.json'));
  assertRunState(state);
  assertRunSourceBytes(root,state);
  if(!PRE_SUBMISSION_STATES.has(state.status)) throw new Error('FACTORY2_DOMAIN_RUN_INVALID_STATE_FOR_EVALUATION');
  const inputPath=resolve(root,state.engineeringInput);
  const inputBytes=readFileSync(inputPath);
  const input=JSON.parse(inputBytes.toString('utf8'));
  const session=evaluateFactory2DomainEngineering(input);
  assertRunSubject(state,session,'ENGINEERING_SESSION');
  const studio=buildFactory2StudioModel(session);
  assertRunSubject(state,studio,'STUDIO_MODEL');
  const sessionPath=resolve(root,'ENGINEERING_SESSION.json');
  const studioPath=resolve(root,'STUDIO_MODEL.json');
  writeJson(sessionPath,session);
  writeJson(studioPath,studio);
  const next={...state,status:session.candidateValidation?.status==='READY_FOR_HUMAN_REVIEW'?(state.sourceOrigin==='CANONICAL_GIT_HEAD_TREE'?'GIT_ENGINEERING_READY':'READY_FOR_STUDIO_SUBMISSION'):session.status,engineeringInputSha256:sha256(inputBytes),engineeringSession:'ENGINEERING_SESSION.json',engineeringSessionSha256:sha256(readFileSync(sessionPath)),studioModel:'STUDIO_MODEL.json',studioModelSha256:sha256(readFileSync(studioPath))};
  writeJson(resolve(root,'DOMAIN_RUN.json'),next);
  return Object.freeze(next);
}
export function submitFactory2DomainRun(rootValue){
  const root=resolve(rootValue), state=readJson(resolve(root,'DOMAIN_RUN.json'));
  assertRunState(state);
  assertRunSourceBytes(root,state);
  if(state.status!=='READY_FOR_STUDIO_SUBMISSION'||state.engineeringSession!=='ENGINEERING_SESSION.json'||state.studioModel!=='STUDIO_MODEL.json') throw new Error('FACTORY2_DOMAIN_RUN_NOT_READY_FOR_SUBMISSION');
  assertRunArtifactBytes(root,state.engineeringInput,state.engineeringInputSha256,'ENGINEERING_INPUT');
  assertRunArtifactBytes(root,state.engineeringSession,state.engineeringSessionSha256,'ENGINEERING_SESSION');
  assertRunArtifactBytes(root,state.studioModel,state.studioModelSha256,'STUDIO_MODEL');
  const session=readJson(resolve(root,state.engineeringSession));
  const studio=readJson(resolve(root,state.studioModel));
  assertRunSubject(state,session,'ENGINEERING_SESSION');
  assertRunSubject(state,studio,'STUDIO_MODEL');
  if(session.schema!=='IWXA_T2_FACTORY2_DOMAIN_ENGINEERING_SESSION_V1'||session.generation!==2||
     session.candidateValidation?.status!=='READY_FOR_HUMAN_REVIEW'||
     studio.schema!=='IWXA_T2_FACTORY2_DOMAIN_STUDIO_MODEL_V1'||studio.generation!==2||
     studio.humanReviewRequired!==true||!Array.isArray(studio.availableActions)||!studio.availableActions.includes('OPEN_HUMAN_REVIEW')) throw new Error('FACTORY2_DOMAIN_RUN_NOT_READY_FOR_SUBMISSION');
  const submission={schema:'IWXA_T2_FACTORY2_STUDIO_SUBMISSION_V1',status:'SUBMITTED_FOR_STUDIO_ACCEPTANCE',domainId:state.domainId,sourceSha256:state.sourceSha256,engineeringSession:'ENGINEERING_SESSION.json',studioModel:'STUDIO_MODEL.json',t25Coverage:'44_OF_44_TRANSFER_CLOSED',evidenceRefs:session.candidateValidation.evidenceRefs,rollbackRef:session.candidateValidation.rollbackRef,ownerApprovalGranted:false,productionActivation:false};
  const submissionPath=resolve(root,'STUDIO_SUBMISSION.json');
  writeJson(submissionPath,submission);
  const next={...state,status:'SUBMITTED_FOR_STUDIO_ACCEPTANCE',studioSubmission:'STUDIO_SUBMISSION.json',studioSubmissionSha256:sha256(readFileSync(submissionPath))}; writeJson(resolve(root,'DOMAIN_RUN.json'),next); return Object.freeze(submission);
}
export function decideFactory2DomainRun(rootValue,decisionValue){
  const root=resolve(rootValue), state=readJson(resolve(root,'DOMAIN_RUN.json'));
  assertRunState(state);
  assertRunSourceBytes(root,state);
  if(state.status!=='SUBMITTED_FOR_STUDIO_ACCEPTANCE'||state.studioSubmission!=='STUDIO_SUBMISSION.json'||state.engineeringSession!=='ENGINEERING_SESSION.json'||state.studioModel!=='STUDIO_MODEL.json') throw new Error('FACTORY2_DOMAIN_RUN_NOT_SUBMITTED');
  assertRunArtifactBytes(root,state.engineeringInput,state.engineeringInputSha256,'ENGINEERING_INPUT');
  assertRunArtifactBytes(root,state.engineeringSession,state.engineeringSessionSha256,'ENGINEERING_SESSION');
  assertRunArtifactBytes(root,state.studioModel,state.studioModelSha256,'STUDIO_MODEL');
  assertRunArtifactBytes(root,state.studioSubmission,state.studioSubmissionSha256,'STUDIO_SUBMISSION');
  const submission=readJson(resolve(root,state.studioSubmission));
  assertRunSubject(state,submission,'STUDIO_SUBMISSION');
  if(submission.schema!=='IWXA_T2_FACTORY2_STUDIO_SUBMISSION_V1'||submission.status!=='SUBMITTED_FOR_STUDIO_ACCEPTANCE') throw new Error('FACTORY2_DOMAIN_RUN_NOT_SUBMITTED');
  const d=decisionValue;
  if(d?.schema!=='IWXA_T2_FACTORY2_STUDIO_HUMAN_DECISION_V1'||d.decisionSource!=='HUMAN_EXPLICIT'||!['APPROVE','REJECT'].includes(d.decision)) throw new Error('FACTORY2_STUDIO_DECISION_INVALID');
  if(d.domainId!==state.domainId||d.sourceSha256!==state.sourceSha256) throw new Error('FACTORY2_STUDIO_DECISION_SUBJECT_MISMATCH');
  const decisionId=requiredToken(d.decisionId,'FACTORY2_STUDIO_DECISION_ID_REQUIRED');
  const decidedBy=requiredToken(d.decidedBy,'FACTORY2_STUDIO_DECIDED_BY_REQUIRED');
  const decidedAt=requiredToken(d.decidedAt,'FACTORY2_STUDIO_DECIDED_AT_REQUIRED');
  if(Number.isNaN(Date.parse(decidedAt))) throw new Error('FACTORY2_STUDIO_DECIDED_AT_INVALID');
  const accepted=d.decision==='APPROVE';
  const result={schema:'IWXA_T2_FACTORY2_STUDIO_TERMINAL_RESULT_V1',status:accepted?'T2_READY':'NOT_T2_READY',domainId:state.domainId,sourceSha256:state.sourceSha256,decisionId,decidedBy,decidedAt,explicitHumanDecision:true,productionActivation:false};
  writeJson(resolve(root,'STUDIO_TERMINAL_RESULT.json'),result);
  writeJson(resolve(root,'DOMAIN_RUN.json'),{...state,status:result.status,terminalResult:'STUDIO_TERMINAL_RESULT.json',productionActivation:false});
  return Object.freeze(result);
}
async function main(){const [cmd,...args]=process.argv.slice(2);try{
 if(cmd==='init-site'){const [siteCheckout,id,out,profile='STANDARD']=args;console.log(JSON.stringify(initFactory2SiteRun({siteCheckout,domainId:id,out,executionProfile:profile}),null,2));}
 else if(cmd==='init'){const [src,id,out,profile='STANDARD']=args;console.log(JSON.stringify(initFactory2DomainRun({sourceZip:src,domainId:id,out,executionProfile:profile}),null,2));}
 else if(cmd==='init-product-accepted'){const [canonical,out]=args;console.log(JSON.stringify(initAcceptedProductRun(canonical,out),null,2));}
 else if(cmd==='evaluate'){console.log(JSON.stringify(evaluateFactory2DomainRun(args[0]),null,2));}
 else if(cmd==='submit'){console.log(JSON.stringify(submitFactory2DomainRun(args[0]),null,2));}
 else if(cmd==='decide'){console.log(JSON.stringify(decideFactory2DomainRun(args[0],readJson(args[1])),null,2));}
 else if(cmd==='qualify-product'){const runRoot=resolve(args[0]);const state=readJson(resolve(runRoot,'DOMAIN_RUN.json'));assertProductRunState(state);if(state.sourceOrigin==='CANONICAL_GIT_HEAD_TREE'&&args.length!==2)throw new Error('SITE_ONLY_ROUTE_TAKES_ONE_CHECKOUT');assertProductSourceBytes(runRoot,state);console.log(JSON.stringify(await qualifyFactory2DomainProduct({runRoot,siteRoot:requiredToken(args[1],'SITE_ROOT_REQUIRED'),runState:state,canonicalRoot:args[2]}),null,2));}
 else if(cmd==='verify-product'){const runRoot=resolve(args[0]);const state=readJson(resolve(runRoot,'DOMAIN_RUN.json'));assertProductRunState(state);if(state.sourceOrigin==='CANONICAL_GIT_HEAD_TREE'&&args.length!==2)throw new Error('SITE_ONLY_ROUTE_TAKES_ONE_CHECKOUT');assertProductSourceBytes(runRoot,state);console.log(JSON.stringify(await verifyFactory2DomainProduct({runRoot,siteRoot:requiredToken(args[1],'SITE_ROOT_REQUIRED'),runState:state,canonicalRoot:args[2]}),null,2));}
 else throw new Error('usage: factory2-domain-run-cli.mjs init-product-accepted <canonical-checkout> <fresh-output-run> | qualify-product <run> <site-checkout> [legacy-only-canonical-checkout] | verify-product <run> <site-checkout> [legacy-only-canonical-checkout] | init-site <site-checkout> <Dxx> <out> [STANDARD|ONE_DAY] | init <source.zip> <Dxx> <out> [STANDARD|ONE_DAY] | evaluate <run> | submit <run> | decide <run> <decision.json>');
}catch(e){console.error(e?.stack||String(e));process.exit(1);}}
if(import.meta.url===pathToFileURL(resolve(process.argv[1]??'')).href) main();
