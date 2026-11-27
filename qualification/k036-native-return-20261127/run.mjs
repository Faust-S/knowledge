// Private inputs are used only inside the disposable runner. Report bounded
// counts and machine markers, never raw output, package bytes, source or keys.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=fileURLToPath(new URL('.',import.meta.url));
const pins=JSON.parse(readFileSync(join(here,'pins.json')));
const [mode]=process.argv.slice(2);
const cwd=process.cwd(),t2=resolve('private-t2'),main=resolve('private-t2-main'),core=resolve('public-one-core'),owner=resolve('private-owner');
const temp=join(process.env.RUNNER_TEMP,'k036-native-return-20261127-'+mode);
const canonical=join(t2,'t2/current/final-successor/canonical-source');
const host=join(main,'t2/current/final-successor/canonical-source');
const packageDir=join(core,'packages/t3-core');
const successors=join(t2,'t2/current/final-successor/kernel-successors');
const receipt=join(successors,'k036-canonical-event-merge-20261125/CANDIDATE_ARCHIVE_WITNESS.json');
const artifact='iwxa-kernel-k036-canonical-event-merge-20261125-candidate.1';
const baseZip=join(successors,'k036-same-store-event-history-20261019/iwxa-kernel-k036-same-store-history-20261019-qualified.1.zip');
const candZip=join(successors,'k036-canonical-event-merge-20261125',artifact+'.zip');
const sha=x=>createHash('sha256').update(x).digest('hex');
const mark=(k,v)=>console.log('K036_'+k+'='+v);
const run=(cmd,args,dir,env=process.env,timeout=420000)=>spawnSync(cmd,args,{cwd:dir,env,encoding:'utf8',maxBuffer:64*1024*1024,timeout,windowsHide:true});
function step(label,cmd,args,dir,env,timeout){
  const r=run(cmd,args,dir,env,timeout),out=(r.stdout||'')+'\n'+(r.stderr||'');
  for(const line of out.split(/\r?\n/)){
    if(/^K036_[A-Z0-9_]{2,100}=(?:PASS|FAIL|[A-Z0-9_]{2,120})$/.test(line))console.log(line);
    if(/^# (tests|pass|fail|cancelled|skipped) \d+$/.test(line))console.log(label+'_'+line.slice(2).replace(' ','='));
    if(/^T3_D1_(?:TWO_CORP_REAL_ED25519_ORIGINAL_KERNEL_COLD_PASS|AUTHENTIC_PERSONAL_CONTROL_ORIGINAL_KERNEL_HTTPS_PASS|TWO_COLD_NODE_HOST_PROCESS_RESTART_STATUS_PASS)\b/.test(line))console.log(line.split(' ')[0]);
  }
  if(r.status!==0){
    for(const code of ['IMPORT_EVENT_ID_COLLISION','T3_INSTALLED_KERNEL_CANDIDATE_DISPOSABLE_PUBLIC_QUALIFICATION_REQUIRED','T3_INSTALLED_KERNEL_CANDIDATE_FILE_DIGEST_MISMATCH','T3_D1_DIST_CANDIDATE_NATIVE_CORPORATE_PROFILE_REQUIRED','ERR_ASSERTION','ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND','SyntaxError','TypeError','ReferenceError','ENOENT','ETIMEDOUT'])if(out.includes(code))mark(label+'_DETAIL',code);
    mark(label,'FAIL');return false;
  }
  mark(label,'PASS');return true;
}
const git=(dir,...a)=>{const r=run('git',a,dir);assert.equal(r.status,0);return r.stdout.trim();};
const assertPin=(dir,commit,tree)=>{assert.equal(git(dir,'rev-parse','HEAD'),commit);assert.equal(git(dir,'rev-parse','HEAD^{tree}'),tree);};
function requireStep(label,cmd,args,dir,env,timeout){if(!step(label,cmd,args,dir,env,timeout))throw Error(label);}
function stageArchives(){
  assert.equal(sha(readFileSync(candZip)),pins.archive);
  assert.equal(sha(readFileSync(baseZip)),'7075b8b9590ef1283e34ecb3c21dd9d1b7342697287e1aa150cd4f4a60860b68');
  const m=JSON.parse(readFileSync(receipt));
  assert.equal(m.artifactId,artifact);assert.equal(m.archiveSha256,pins.archive);assert.equal(m.releaseAccepted,false);assert.equal(m.productionActivation,false);
  assert.equal(m.files.length,4);assert.equal(m.files.find(x=>x.path.endsWith('/runtime.js')).sha256,pins.runtime);
  const paths=['_iwxa/current.json','_iwxa/loader.js','_iwxa/validator.js','_iwxa/runtime/0.3.6/runtime.js'];
  assert.deepEqual(m.files.map(x=>x.path).sort(),paths.sort());
  requireStep('EXTRACT_EXACT_ARCHIVES','python',['-c',
    'import sys,zipfile,pathlib; out=pathlib.Path(sys.argv[3]); expected=set(sys.argv[4:]);\nfor label,p in zip(("base","candidate"),sys.argv[1:3]):\n with zipfile.ZipFile(p) as z:\n  assert len(z.namelist())==4 and set(z.namelist())==expected\n  z.extractall(out/label)',baseZip,candZip,temp,...paths],cwd);
  for(const f of m.files){
    assert.equal(sha(readFileSync(join(temp,'candidate',f.path))),f.sha256);
    const old=sha(readFileSync(join(temp,'base',f.path)));
    assert.equal(old,f.path.endsWith('/runtime.js')?'e1737245aba309e900203b458087ca07cb08d9ccc89901754e1122cbc9a01e78':f.sha256);
  }
  mark('ARCHIVE_AND_FOUR_FILE_IDENTITY','PASS');
}
function reconstructDependency(){
  const p=join(temp,'source-k035'),b=join(temp,'source-k036'),t=join(temp,'source-timestamp'),c=join(temp,'source-candidate');
  requireStep('SOURCE_K035',process.execPath,['scripts/materialize-k035-atomic-graph-successor.mjs','../canonical-source-inputs/k035-rc20/SOURCE_AUTHORITY.json',t2,p],canonical);
  requireStep('SOURCE_K036',process.execPath,['scripts/materialize-k036-atomic-graph-qualified.mjs',p,b],canonical);
  requireStep('SOURCE_TIMESTAMP',process.execPath,['scripts/create-k036-import-time-candidate.mjs',b,t],canonical);
  requireStep('SOURCE_CANDIDATE',process.execPath,['scripts/create-k036-canonical-event-merge-candidate.mjs',t,c],canonical);
  assert.equal(sha(readFileSync(join(c,'src/package/import/commit.ts'))),'e72acf7cea2a965e867315719e0fe8fa43f539d78bd17db24bff6cfe4f9902ca');
  requireStep('ORIGINAL_LOCKED_DEPENDENCIES','npm',['ci','--no-audit','--no-fund'],c);
  const idb=join(c,'node_modules/fake-indexeddb/build/esm/index.js');assert.ok(existsSync(idb));return idb;
}
function signedBrowserWitness(name,blob,oldGuard){
  const path=join(packageDir,'tests',name),copy=join(packageDir,'tests','.k036-final-'+name);
  assert.equal(git(core,'hash-object',path),blob);
  let source=readFileSync(path,'utf8');
  const replace=(from,to)=>{assert.equal(source.split(from).length-1,1);source=source.replace(from,to);};
  // Only the test's input admission switches from the immutable accepted
  // archive to the original explicit, runner-restricted candidate verifier.
  // The signed operations, Host, Store, all assertions and grants stay intact.
  replace('import {assertQualifiedKernelArtifact}\n  from "../src/factory2/products/domain-completion/independent-browser-witness.mjs";','import {assertInstalledOriginalKernelArtifact} from "../scripts/installed-kernel-selection.mjs";\nimport {CANDIDATE_KERNEL_ARTIFACT} from "../scripts/installed-kernel-candidate.mjs";');
  replace(oldGuard,'assertInstalledOriginalKernelArtifact(dist,CANDIDATE_KERNEL_ARTIFACT);');
  replace('process.env.IWXA_T2_QUALIFIED_KERNEL_DIST','process.env.IWXA_T2_CANDIDATE_DIST');
  writeFileSync(copy,source,{flag:'wx'});
  try{return step(name.startsWith('t3-d1-real-host')?'SIGNED_NATIVE_COLD_HOST':'SIGNED_NATIVE_CONTROL',process.execPath,['--test','--test-reporter=tap',copy],packageDir,{...process.env,IWXA_T2_CANDIDATE_DIST:join(temp,'candidate')},330000);}
  finally{rmSync(copy,{force:true});}
}
let failed=false;
try{
  assert.equal(mode,'native');
  assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.GITHUB_REPOSITORY,'Faust-S/knowledge');assert.match(process.env.GITHUB_REF,/^refs\/heads\/ci\/once\/k036-native-return-20261127\/[0-9a-f]{40}$/);assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
  assertPin(t2,pins.candidate,pins.candidateTree);
  assert.ok(!existsSync(temp));mkdirSync(temp);
  stageArchives();
  if(mode==='native'){
    assertPin(main,pins.host,pins.hostTree);
    requireStep('T2_HOST_DEPS','npm',['ci','--ignore-scripts','--no-audit','--no-fund'],host);
    requireStep('T2_HOST_BUILD','npm',['run','build'],host);
    requireStep('T2_NATIVE_BROWSER_ENGINE','npm',['exec','--','playwright','install','--with-deps','chromium'],host,process.env,420000);
    failed=!step('T2_NATIVE_UI_QUALIFICATION',process.execPath,[join(here,'native.mjs'),host,temp,temp],cwd,process.env,660000);
  }else{
    assertPin(core,pins.core,pins.coreTree);assertPin(owner,pins.owner,pins.ownerTree);
    // Signed Exchange grants are independently issued and checked by the
    // private original owner (no authority emulation or production keys).
    if(!step('ORIGINAL_SIGNED_EXCHANGE_GRANTS',process.execPath,['--test','--test-reporter=tap','tests/t3-signed-workspace-exchange-owner.test.mjs'],owner,process.env,180000))failed=true;
    const idb=reconstructDependency();
    requireStep('T3_CORE_DEPS','npm',['ci','--ignore-scripts','--no-audit','--no-fund'],packageDir);
    requireStep('T3_COMPILED_UI','npm',['run','build'],packageDir);
    const env={...process.env,IWXA_COMPANY_TEST_QUALIFIED_T2:join(temp,'base'),IWXA_COMPANY_TEST_IDB_MODULE:idb,IWXA_COMPANY_TEST_CANDIDATE_T2:join(temp,'candidate'),IWXA_COMPANY_TEST_CANDIDATE_RECEIPT:receipt,IWXA_COMPANY_TEST_COMPILED_T3:join(packageDir,'dist')};
    if(!step('T3_CANDIDATE_RECIPE_REGRESSIONS',process.execPath,['--test','--test-reporter=tap','--test-force-exit','tests/installed-kernel-candidate.test.mjs','tests/t3-d1-signed-control-dist.test.mjs','tests/t3-d6-agent-one-dist-builder.test.mjs'],packageDir,env))failed=true;
    if(!step('T3_ACTUAL_CANDIDATE_PRODUCT_RECIPES',process.execPath,['--test','--test-reporter=tap','--test-force-exit','tests/t3-company-original-runtime-roundtrip.test.mjs'],packageDir,env))failed=true;
    requireStep('T3_NATIVE_BROWSER_ENGINE','npm',['exec','--','playwright','install','--with-deps','chromium'],packageDir,process.env,420000);
    if(!signedBrowserWitness('t3-d1-original-control-kernel.browser.mjs','e2b99bb9fc6b99ce40f709b6e8cdaca7b3f00838','assertQualifiedKernelArtifact(dist,{kernel:"0.3.6",contract:"1.3.0",\n      artifactId:ARTIFACT});'))failed=true;
    if(!signedBrowserWitness('t3-d1-real-host-process-restart.browser.mjs','923eba932c832fbe1d9e75b58380f56affe92b71','assertQualifiedKernelArtifact(dist,{kernel:VERSION,contract:CONTRACT,\n        artifactId:ARTIFACT});'))failed=true;
  }
}catch(e){
  mark('QUALIFICATION_PRECONDITION_OR_STAGE','FAIL');failed=true;
}finally{rmSync(temp,{recursive:true,force:true});}
if(failed)process.exitCode=1;
