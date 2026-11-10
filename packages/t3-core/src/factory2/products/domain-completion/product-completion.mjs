import {createHash,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {npmInvocation} from '../../../../scripts/run-current-nonwindows-qualification.mjs';
import {verifyCanonicalGitDescendant} from '../../../../scripts/factory2-canonical-git-source.mjs';
import {evaluateFactory2DomainEngineering} from '../domain-engineering/domain-engineering.mjs';
import {buildFactory2StudioModel} from '../domain-studio/domain-studio.mjs';
import {existsSync,readFileSync,writeFileSync,mkdirSync,readdirSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,relative,join,sep} from 'node:path';
import {runIndependentSiteWitness,assertQualifiedKernelArtifact} from './independent-browser-witness.mjs';
import {validateResultFamilyParity,resultKindsForProductParity} from './result-family-parity.mjs';
import {assertAcceptedProductGit} from './accepted-product-run.mjs';
import {domainResultAuthorityReadiness} from '../../../modules/base/features/project-process/domain-result-authority-registry.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=s=>{throw new Error('FACTORY2_PRODUCT_'+s)};
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x);
const validList=x=>Array.isArray(x)&&new Set(x).size===x.length&&x.every(v=>typeof v==='string'&&!!v.trim());
/** Current product gate has exactly one permitted Kernel/Runtime pair. */
export const isCurrentProductRuntime = runtime => runtime?.kernel === '0.3.6' && runtime?.contract === '1.3.0';
function scoped(root,path){if(typeof path!=='string'||!path||path.includes('\\'))fail('PATH_INVALID');const f=resolve(root,path),rel=relative(root,f);if(!rel||rel==='..'||rel.startsWith('..'+sep)||rel.startsWith(sep))fail('PATH_ESCAPE');return f}
function git(root,args){const p=spawnSync('git',args,{cwd:root,encoding:'utf8',timeout:12000});if(p.error||p.status!==0)fail('GIT_UNAVAILABLE');return p.stdout.trim()}
function gitBytes(root,args){const p=spawnSync('git',args,{cwd:root,timeout:12000});if(p.error||p.status!==0)fail('GIT_UNAVAILABLE');return p.stdout;}
function identity(root){const head=git(root,['rev-parse','HEAD']),tree=git(root,['rev-parse','HEAD^{tree}']);if(!/^[a-f0-9]{40}$/.test(head)||!/^[a-f0-9]{40}$/.test(tree)||git(root,['status','--porcelain','--untracked-files=all']))fail('SITE_SOURCE_DIRTY');return {head,tree}}
function built(root,path){const dir=scoped(root,path),list=[];if(!existsSync(dir)||!lstatSync(dir).isDirectory())fail('BUILD_MISSING');function walk(p){for(const e of readdirSync(p,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const f=join(p,e.name),s=lstatSync(f);if(s.isSymbolicLink())fail('BUILD_SYMLINK');if(s.isDirectory())walk(f);else if(s.isFile())list.push([relative(dir,f).replaceAll(sep,'/'),hash(readFileSync(f))]);else fail('BUILD_UNKNOWN_FILE')}}walk(dir);if(!list.length)fail('BUILD_EMPTY');return {sha256:hash(Buffer.from(JSON.stringify(list))),count:list.length}}
const stages=['nativeKernel','browser','migration','regression'];
// Absence of this declaration keeps the historical migration gate mandatory.
export function historicalMigrationScope(contract){
 const h=contract?.historicalMigration;
 if(h===undefined)return {status:'REQUIRED'};
 if(!obj(h)||(h.status!=='REQUIRED'&&h.status!=='NOT_APPLICABLE'))fail('MIGRATION_SCOPE');
 if(h.status==='REQUIRED')return {status:'REQUIRED'};
 if(h.prelaunch!==true||h.historicalUserDataPresent!==false||typeof h.reason!=='string'||h.reason.trim().length<20)fail('MIGRATION_SCOPE_UNPROVEN');
 return {status:'NOT_APPLICABLE',reason:h.reason.trim()};
}
export function applicableProductStages(contract){
 return stages.filter(stage=>stage!=='migration'||historicalMigrationScope(contract).status==='REQUIRED');
}
export function assertNotApplicableMigrationCheck(step,scope,reportPresent){
 if(scope?.status!=='NOT_APPLICABLE'||!obj(step)||Object.keys(step).sort().join(',')!=='reason,stage,status'||
    step.stage!=='migration'||step.status!=='NOT_APPLICABLE'||step.reason!==scope.reason||reportPresent!==false)fail('MIGRATION_NOT_APPLICABLE_INVALID');
}
function validateContract(c,s,site,root){
 if(!obj(c)||c.schema!=='IWXA_T2_PRODUCT_SITE_CONTRACT_V1'||c.domainId!==s.domainId||c.canonicalSourceSha256!==s.sourceSha256||c.productionActivation!==false)fail('CONTRACT_SUBJECT');
 if(!obj(c.site)||!/^[\w.-]+\/[\w.-]+$/.test(c.site.repository)||c.site.head!==site.head||c.site.tree!==site.tree)fail('SITE_IDENTITY');
 const remote=git(root,['config','--get','remote.origin.url']),repo=/(?:github\.com[:/])([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(remote)?.[1];if(!repo||repo.toLowerCase()!==c.site.repository.toLowerCase())fail('SITE_REPO_MISMATCH');
 if(!obj(c.runtime)||!/^[0-9a-f]{40}$/.test(c.runtime.t2Head)||c.runtime.sanctionedSurface!=='WorkspaceModuleContext.kernel'||!isCurrentProductRuntime(c.runtime))fail('RUNTIME');
 const i=c.inventory;
 if(!obj(i)||!validList(i.serviceIds)||!i.serviceIds.length||!validList(i.routes)||!i.routes.length||i.routes.some(r=>!r.startsWith('/'))||!Array.isArray(i.persistentFamilies)||!validList(i.persistentFamilies)||!Array.isArray(i.resultBindings)||i.resultBindings.some(b=>!obj(b)||!i.persistentFamilies.includes(b.family)||typeof b.resultKind!=='string')||new Set(i.resultBindings.map(b=>b.family)).size!==i.persistentFamilies.length)fail('INVENTORY');
 if(!i.persistentFamilies.length&&(!obj(i.readOnlyBoundary)||typeof i.readOnlyBoundary.reason!=='string'||i.readOnlyBoundary.reason.length<12))fail('READ_ONLY_SCOPE');
 const migrationScope=historicalMigrationScope(c);
 if(typeof c.buildDirectory!=='string'||!obj(c.scripts)||['build',...applicableProductStages(c)].some(k=>typeof c.scripts[k]!=='string'||!/^[A-Za-z0-9:._-]+$/.test(c.scripts[k]))||(migrationScope.status==='NOT_APPLICABLE'&&Object.hasOwn(c.scripts,'migration')))fail('SCRIPTS');
 scoped(root,c.buildDirectory);
}
function assertReport(r,stage,ctx){
 if(!obj(r)||r.schema!=='IWXA_T2_PRODUCT_EXECUTION_REPORT_V1'||r.stage!==stage||r.executionChallenge!==ctx.challenge||r.domainId!==ctx.state.domainId||r.canonicalSourceSha256!==ctx.state.sourceSha256||r.siteHead!==ctx.site.head||r.siteTree!==ctx.site.tree||r.status!=='PASS'||r.productionActivation!==false||!obj(r.counts)||!Number.isSafeInteger(r.counts.pass)||r.counts.pass<1||r.counts.fail!==0||r.counts.skip!==0)fail('REPORT_'+stage);
 const c=ctx.contract,i=c.inventory;
 if(stage==='nativeKernel'&&(r.runner!=='REAL_BUILT_KERNEL'||r.kernel!==c.runtime.kernel||r.contract!==c.runtime.contract||r.t2Head!==c.runtime.t2Head||r.nativeHostMounted!==true||r.sanctionedSurface!=='WorkspaceModuleContext.kernel'||r.nativeOperations<1))fail('NATIVE_NOT_PROVEN');
 if(stage==='browser'&&(r.runner!=='REAL_BROWSER_UI'||r.siteHostMounted!==true||r.nativeKernelObserved!==true||!validList(r.testedRoutes)||i.routes.some(x=>!r.testedRoutes.includes(x))))fail('BROWSER_NOT_PROVEN');
 if(stage==='migration'&&(r.runner!=='EXECUTED_MIGRATION_TESTS'||r.sourceBytesPreserved!==true||r.unknownObjectsPreserved!==true||r.idempotencyVerified!==true||r.destructiveCleanupPerformed!==false))fail('MIGRATION_NOT_PROVEN');
 if(stage==='regression'&&(r.runner!=='EXECUTED_SITE_REGRESSION'||!validList(r.testedRoutes)||!validList(r.testedServiceIds)||i.routes.some(x=>!r.testedRoutes.includes(x))||i.serviceIds.some(x=>!r.testedServiceIds.includes(x))||r.browserConsoleErrors!==0||r.privacyLeaks!==0))fail('REGRESSION_NOT_PROVEN');
}
function runScript(root,script,env,output){const invocation=npmInvocation(['run','--silent',script]);const r=spawnSync(invocation.command,invocation.args,{cwd:root,encoding:'utf8',shell:false,timeout:300000,maxBuffer:8*1024*1024,env:{...process.env,...env,IWXA_T2_PRODUCT_REPORT_PATH:output}});if(r.error||r.status!==0)fail('EXECUTION_'+script);return {script,exitCode:0,stdoutSha256:hash(Buffer.from(r.stdout||''))}}
function base(runRoot,siteRoot,runState,canonicalRoot){
 const root=resolve(runRoot),sitePath=resolve(siteRoot),s=runState;
 // Historical Factory runs retain their immutable explicit-human receipt.
 // New canonical Git engineering runs are technical product qualifications:
 // a real user's business authority remains enforced by Kernel, not by Studio.
 const gitEngineering=s.schema==='IWXA_T2_FACTORY2_DOMAIN_RUN_STATE_V1'&&s.sourceOrigin==='CANONICAL_GIT_HEAD_TREE';
 if(gitEngineering){
   if(s.status!=='GIT_ENGINEERING_READY'||
      s.engineeringSession!=='ENGINEERING_SESSION.json'||s.studioModel!=='STUDIO_MODEL.json'||
      s.productionActivation!==false)fail('GIT_ENGINEERING_NOT_READY');
   for(const [path,digest] of [[s.engineeringSession,s.engineeringSessionSha256],[s.studioModel,s.studioModelSha256]]){
     if(!/^[0-9a-f]{64}$/.test(digest??'')||hash(readFileSync(scoped(root,path)))!==digest)
       fail('GIT_ENGINEERING_EVIDENCE_CHANGED');
   }
   const session=JSON.parse(readFileSync(scoped(root,s.engineeringSession),'utf8'));
   if(session.schema!=='IWXA_T2_FACTORY2_DOMAIN_ENGINEERING_SESSION_V1'||
      session.domainId!==s.domainId||session.sourceSha256!==s.sourceSha256||
      session.sourceOrigin!=='CANONICAL_GIT_HEAD_TREE'||
      session.candidateBuildAllowed!==true||
      session.candidateValidation?.status!=='READY_FOR_HUMAN_REVIEW'||
      session.genericWriteAuthority!==false||session.ownerApprovalGranted!==false||
      session.productionActivation!==false)fail('GIT_ENGINEERING_INVALID');
   const inputBytes=readFileSync(scoped(root,'engineering-input.json'));
   if(!/^[a-f0-9]{64}$/.test(s.engineeringInputSha256??'')||
      hash(inputBytes)!==s.engineeringInputSha256)fail('FROZEN_ENGINEERING_INPUT_CHANGED');
   let calculated,calculatedStudio;
   try{
     calculated=evaluateFactory2DomainEngineering(JSON.parse(inputBytes.toString('utf8')));
     calculatedStudio=buildFactory2StudioModel(calculated);
   }catch{fail('GIT_ENGINEERING_REPLAY_INVALID');}
   if(JSON.stringify(session)!==JSON.stringify(calculated)||
      JSON.stringify(JSON.parse(readFileSync(scoped(root,s.studioModel),'utf8')))!==JSON.stringify(calculatedStudio))
      fail('GIT_ENGINEERING_REPLAY_MISMATCH');
   const studio=JSON.parse(readFileSync(scoped(root,s.studioModel),'utf8'));
   if(studio.schema!=='IWXA_T2_FACTORY2_DOMAIN_STUDIO_MODEL_V1'||
      studio.domainId!==s.domainId||studio.sourceSha256!==s.sourceSha256||
      studio.genericWriteAuthority!==false||studio.ownerApprovalGranted!==false||
      studio.productionActivation!==false)fail('GIT_STUDIO_INVALID');
 } else if(s.status!=='T2_READY'||s.terminalResult!=='STUDIO_TERMINAL_RESULT.json')fail('HUMAN_READY_REQUIRED');
 const t=gitEngineering?null:JSON.parse(readFileSync(scoped(root,s.terminalResult),'utf8'));
 if(!gitEngineering&&(t.schema!=='IWXA_T2_FACTORY2_STUDIO_TERMINAL_RESULT_V1'||t.status!=='T2_READY'||t.explicitHumanDecision!==true||t.domainId!==s.domainId||t.sourceSha256!==s.sourceSha256||t.productionActivation!==false))fail('HUMAN_DECISION');
 const site=identity(sitePath),bytes=readFileSync(scoped(root,'product-site-contract.json')),contract=JSON.parse(bytes.toString('utf8'));
 validateContract(contract,s,site,sitePath);
 if(!canonicalRoot&&!gitEngineering)fail('CANONICAL_CHECKOUT_REQUIRED');
 const canonicalPath=gitEngineering?sitePath:resolve(canonicalRoot),canonical=gitEngineering?site:identity(canonicalPath),c=contract.canonical;
 if(gitEngineering){
   if(s.sourceGit!==null||!obj(s.siteGit)||!obj(s.siteGit.subject)||
      s.siteGit.sourceSha256!==s.sourceSha256)fail('GIT_SITE_SUBJECT_REQUIRED');
   if(realpathSync(s.siteGit.checkout)!==realpathSync(sitePath))fail('GIT_SITE_CHECKOUT_MISMATCH');
   verifyCanonicalGitDescendant(sitePath,s.siteGit.subject,s.siteGit.sourceSha256,{fetchRemote:true});
   if(contract.site.branch!==undefined&&contract.site.branch!==s.siteGit.subject.branch)
     fail('GIT_SITE_BRANCH_MISMATCH');
 }
 if(!gitEngineering){
   if(!obj(c)||c.head!==canonical.head||c.tree!==canonical.tree||c.sourceSha256!==s.sourceSha256||
      typeof c.repository!=='string')fail('CANONICAL_IDENTITY');
   const canonicalRemote=git(canonicalPath,['config','--get','remote.origin.url']);
   const canonicalRepo=/(?:github\.com[:/])([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(canonicalRemote)?.[1];
   if(!canonicalRepo||canonicalRepo.toLowerCase()!==c.repository.toLowerCase())fail('CANONICAL_REPO_MISMATCH');
   if(typeof c.branch!=='string'||!c.branch||c.branch.startsWith('-')||c.branch.includes('..')||
      !/^[-A-Za-z0-9._/]+$/.test(c.branch))fail('CANONICAL_BRANCH_REQUIRED');
   git(canonicalPath,['check-ref-format','refs/heads/'+c.branch]);
   git(canonicalPath,['fetch','--no-tags','origin','refs/heads/'+c.branch]);
   if(git(canonicalPath,['rev-parse','FETCH_HEAD'])!==canonical.head||
      git(canonicalPath,['rev-parse','FETCH_HEAD^{tree}'])!==canonical.tree)
     fail('CANONICAL_REMOTE_SUBJECT_MISMATCH');
 }
 if(!gitEngineering&&contract.inventory.persistentFamilies.length&&!domainResultAuthorityReadiness(s.domainId).sourceTruthBindingAllowed)fail('DOMAIN_AUTHORITY_REQUIRED');
 // Product completion of a previously accepted domain must not require the
 // original Factory input ZIP or a newly invented Factory Domain Run. Anchor
 // the existing explicit Human decision in canonical Git history instead.
 if(gitEngineering){
   // Technical Git qualification does not bind historical domain-native Results.
   // The mandatory live Kernel/browser witness proves actual scoped authority and denied writes.
   // Never synthesize a registry grant or an owner decision for this Git candidate.
 } else if(s.schema==='IWXA_T2_ACCEPTED_PRODUCT_RUN_V1'){
   try {
     assertAcceptedProductGit({
       canonicalRoot:canonicalPath,runState:s,
       terminalBytes:readFileSync(scoped(root,s.terminalResult)),
       engineeringBytes:readFileSync(scoped(root,'engineering-input.json')),
     });
   } catch {
     fail('CANONICAL_ACCEPTED_GIT_EVIDENCE_INVALID');
   }
 } else {
 const f=contract.factoryQualification;
 if(!obj(f)||typeof f.terminalReceiptPath!=='string'||!/^[a-f0-9]{64}$/.test(f.terminalReceiptSha256??''))fail('CANONICAL_HUMAN_EVIDENCE_REQUIRED');
 scoped(canonicalPath,f.terminalReceiptPath);
 const approvedBytes=gitBytes(canonicalPath,['show',canonical.head+':'+f.terminalReceiptPath]);
 const terminalBytes=readFileSync(scoped(root,s.terminalResult));
 // Bind the original accepted canonical receipt, not a caller's new JSON APPROVE flag.
 if(hash(approvedBytes)!==f.terminalReceiptSha256||hash(terminalBytes)!==f.terminalReceiptSha256)fail('CANONICAL_HUMAN_EVIDENCE_MISMATCH');
 if(!t.decisionId||!t.decidedBy||Number.isNaN(Date.parse(t.decidedAt)))fail('HUMAN_DECISION_IDENTITY_REQUIRED');
 if(typeof f.domainRunPath!=='string'||!/^[a-f0-9]{64}$/.test(f.domainRunSha256??''))fail('CANONICAL_FACTORY_STATE_REQUIRED');
 scoped(canonicalPath,f.domainRunPath);
 const approvedRunBytes=gitBytes(canonicalPath,['show',canonical.head+':'+f.domainRunPath]);
 if(hash(approvedRunBytes)!==f.domainRunSha256)fail('CANONICAL_FACTORY_STATE_MISMATCH');
 const approvedRun=JSON.parse(approvedRunBytes);
 if(approvedRun.schema!=='IWXA_T2_FACTORY2_DOMAIN_RUN_STATE_V1'||approvedRun.status!=='T2_READY'||approvedRun.domainId!==s.domainId||approvedRun.sourceSha256!==s.sourceSha256||approvedRun.engineeringInputSha256!==s.engineeringInputSha256||approvedRun.productionActivation!==false)fail('CANONICAL_FACTORY_STATE_MISMATCH');
 }
 const inputBytes=readFileSync(scoped(root,'engineering-input.json'));
 if(!/^[a-f0-9]{64}$/.test(s.engineeringInputSha256)||hash(inputBytes)!==s.engineeringInputSha256)fail('FROZEN_ENGINEERING_INPUT_CHANGED');
 const engineering=JSON.parse(inputBytes.toString('utf8'));
 try{
  const kinds=resultKindsForProductParity(engineering?.transformation?.resultAcceptanceMap?.entries,{sourceOrigin:s.sourceOrigin});
  validateResultFamilyParity(contract.inventory.persistentFamilies,contract.inventory.resultBindings,kinds);
 }catch{fail('RESULT_FAMILY_PARITY')}
 return {root,sitePath,canonicalPath,canonical:{repository:gitEngineering?contract.site.repository:c.repository,branch:gitEngineering?s.siteGit.subject.branch:c.branch,...canonical,sourceSha256:s.sourceSha256},state:s,site,contract,contractSha256:hash(bytes)};
}
export async function qualifyFactory2DomainProduct({runRoot,siteRoot,runState,canonicalRoot}){
 const ctx=base(runRoot,siteRoot,runState,canonicalRoot),{root,sitePath,site,contract}=ctx,output=resolve(root,'DOMAIN_PRODUCT_RESULT.json');
 if(existsSync(output))fail('ALREADY_QUALIFIED');
 const pkg=JSON.parse(readFileSync(resolve(sitePath,'package.json'),'utf8'));if(!obj(pkg.scripts)||['build',...applicableProductStages(contract)].some(k=>!Object.hasOwn(pkg.scripts,contract.scripts[k])))fail('SCRIPTS_MISSING');
 const evidence=resolve(root,'PRODUCT_EXECUTION_EVIDENCE');if(existsSync(evidence))fail('EVIDENCE_DIRECTORY_EXISTS');mkdirSync(evidence,{recursive:true});
 const challenge=randomBytes(32).toString('hex'),env={IWXA_T2_PRODUCT_CHALLENGE:challenge,IWXA_T2_PRODUCT_DOMAIN_ID:runState.domainId,IWXA_T2_PRODUCT_SOURCE_SHA256:runState.sourceSha256,IWXA_T2_PRODUCT_SITE_HEAD:site.head,IWXA_T2_PRODUCT_SITE_TREE:site.tree,IWXA_T2_PRODUCT_KERNEL:contract.runtime.kernel,IWXA_T2_PRODUCT_RUNTIME_CONTRACT:contract.runtime.contract},checks=[];
 checks.push(runScript(sitePath,contract.scripts.build,env,resolve(evidence,'build.report.json')));
 const initialBuild=built(sitePath,contract.buildDirectory);
 const migrationScope=historicalMigrationScope(contract);
 for(const stage of stages){
  if(stage==='migration'&&migrationScope.status==='NOT_APPLICABLE'){
   // A scoped non-applicability decision is not an executed migration PASS.
   checks.push({stage:'migration',status:'NOT_APPLICABLE',reason:migrationScope.reason});
   continue;
  }
  const path=resolve(evidence,stage+'.report.json');if(existsSync(path))fail('REPORT_PREEXISTING');
  const step=runScript(sitePath,contract.scripts[stage],env,path);if(!existsSync(path))fail('REPORT_MISSING');
  const bytes=readFileSync(path);assertReport(JSON.parse(bytes.toString('utf8')),stage,{...ctx,challenge});
  checks.push({...step,receiptSha256:hash(bytes)});
 }
 const witness=await runIndependentSiteWitness({siteRoot:sitePath,contract,inventory:contract.inventory,buildDirectory:contract.buildDirectory,qualificationRoot:root});
 if(witness.status!=='PASS'||witness.runner!=='T2_OWNED_PLAYWRIGHT'||witness.productionActivation!==false)fail('WITNESS_NOT_PROVEN');
 const witnessFile=resolve(evidence,'independent-browser-witness.json');writeFileSync(witnessFile,JSON.stringify({...witness,executionChallenge:challenge},null,2)+'\n');
 const canonicalAfter=identity(ctx.canonicalPath);if(canonicalAfter.head!==ctx.canonical.head||canonicalAfter.tree!==ctx.canonical.tree)fail('CANONICAL_CHANGED');
 const after=identity(sitePath),builtAfter=built(sitePath,contract.buildDirectory);if(after.head!==site.head||after.tree!==site.tree||builtAfter.sha256!==initialBuild.sha256)fail('SOURCE_CHANGED');
 const result={schema:'IWXA_T2_DOMAIN_PRODUCT_COMPLETION_V1',status:'DOMAIN_T2_PRODUCT_COMPLETE',factoryStatus:ctx.state.sourceOrigin==='CANONICAL_GIT_HEAD_TREE'?'GIT_ENGINEERING_VERIFIED':'T2_READY',siteStatus:'SITE_T2_CONNECTED_AND_QUALIFIED',domainId:runState.domainId,canonicalSourceSha256:runState.sourceSha256,canonical:ctx.canonical,site:{...contract.site,buildSha256:initialBuild.sha256,buildFileCount:initialBuild.count},runtime:contract.runtime,inventory:contract.inventory,contractSha256:ctx.contractSha256,executionChallenge:challenge,independentWitnessSha256:hash(readFileSync(witnessFile)),checks,productionActivation:false,productionDeployed:false};
 writeFileSync(output,JSON.stringify(result,null,2)+'\n');return result;
}
export async function verifyFactory2DomainProduct({runRoot,siteRoot,runState,canonicalRoot}){
 const ctx=base(runRoot,siteRoot,runState,canonicalRoot),path=scoped(ctx.root,'DOMAIN_PRODUCT_RESULT.json');if(!existsSync(path))fail('NOT_QUALIFIED');
 const r=JSON.parse(readFileSync(path,'utf8'));
 if(r.schema!=='IWXA_T2_DOMAIN_PRODUCT_COMPLETION_V1'||r.status!=='DOMAIN_T2_PRODUCT_COMPLETE'||r.factoryStatus!==(ctx.state.sourceOrigin==='CANONICAL_GIT_HEAD_TREE'?'GIT_ENGINEERING_VERIFIED':'T2_READY')||r.siteStatus!=='SITE_T2_CONNECTED_AND_QUALIFIED'||r.productionActivation!==false||r.productionDeployed!==false||r.domainId!==ctx.state.domainId||r.canonicalSourceSha256!==ctx.state.sourceSha256||r.contractSha256!==ctx.contractSha256||r.site?.head!==ctx.site.head||r.site?.tree!==ctx.site.tree)fail('RESULT_INVALID');
 if(JSON.stringify(r.runtime)!==JSON.stringify(ctx.contract.runtime)||JSON.stringify(r.inventory)!==JSON.stringify(ctx.contract.inventory)||r.site.repository!==ctx.contract.site.repository)fail('RESULT_CONTRACT_DRIFT');
 if(JSON.stringify(r.canonical)!==JSON.stringify(ctx.canonical))fail('CANONICAL_CHANGED');
 const b=built(ctx.sitePath,ctx.contract.buildDirectory);if(b.sha256!==r.site.buildSha256||b.count!==r.site.buildFileCount)fail('BUILD_CHANGED');
 const wb=readFileSync(scoped(ctx.root,'PRODUCT_EXECUTION_EVIDENCE/independent-browser-witness.json'));if(hash(wb)!==r.independentWitnessSha256)fail('WITNESS_CHANGED');
 const w=JSON.parse(wb.toString('utf8'));if(w.schema!=='IWXA_T2_INDEPENDENT_BROWSER_WITNESS_V1'||w.status!=='PASS'||w.runner!=='T2_OWNED_PLAYWRIGHT'||w.executionChallenge!==r.executionChallenge||w.productionActivation!==false||!Array.isArray(w.observations)||ctx.contract.inventory.persistentFamilies.some(f=>!w.observations.some(x=>x.family===f)))fail('WITNESS_INVALID');
 if(!Array.isArray(r.checks)||r.checks.length!==stages.length+1)fail('CHECKS_MISSING');
 const migrationScope=historicalMigrationScope(ctx.contract);
 for(const stage of stages){
  if(stage==='migration'&&migrationScope.status==='NOT_APPLICABLE'){
   const entries=r.checks.filter(x=>x.stage==='migration');
   if(entries.length!==1)fail('MIGRATION_NOT_APPLICABLE_INVALID');
   assertNotApplicableMigrationCheck(entries[0],migrationScope,existsSync(resolve(ctx.root,'PRODUCT_EXECUTION_EVIDENCE/migration.report.json')));
   continue;
  }
  const step=r.checks.find(x=>x.script===ctx.contract.scripts[stage]);
  const data=readFileSync(scoped(ctx.root,'PRODUCT_EXECUTION_EVIDENCE/'+stage+'.report.json'));
  if(!step||hash(data)!==step.receiptSha256)fail('REPORT_CHANGED');
  assertReport(JSON.parse(data.toString('utf8')),stage,{...ctx,challenge:r.executionChallenge});
 }
 const kernelArtifact=assertQualifiedKernelArtifact(resolve(ctx.sitePath,ctx.contract.buildDirectory),ctx.contract.runtime);
 if(JSON.stringify(w.kernelArtifact)!==JSON.stringify(kernelArtifact)||w.isolatedReader!==true||r.inventory.persistentFamilies.some(f=>!w.observations.some(x=>x.family===f&&x.freshUiChallenge===true&&x.independentReader===true&&x.afterKernelRestart===true&&x.afterPageReload===true&&x.historyPreserved===true)))fail('TRUSTED_WITNESS_REQUIRED');
 const replay=await runIndependentSiteWitness({siteRoot:ctx.sitePath,contract:ctx.contract,inventory:ctx.contract.inventory,buildDirectory:ctx.contract.buildDirectory,qualificationRoot:ctx.root});
 if(replay.status!=='PASS')fail('EXECUTABLE_READBACK_FAILED');
 const siteAfter=identity(ctx.sitePath),canonicalAfter=identity(ctx.canonicalPath),buildAfter=built(ctx.sitePath,ctx.contract.buildDirectory);
 if(siteAfter.head!==ctx.site.head||siteAfter.tree!==ctx.site.tree||canonicalAfter.head!==ctx.canonical.head||canonicalAfter.tree!==ctx.canonical.tree||buildAfter.sha256!==r.site.buildSha256)fail('SOURCE_CHANGED_DURING_READBACK');
 return Object.freeze({...r,verifiedReadback:true,verificationWitness:replay});
}
