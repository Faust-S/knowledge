import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=fileURLToPath(new URL('.',import.meta.url));
const pins=JSON.parse(readFileSync(join(here,'pins.json')));
const mode=process.argv[2],cwd=process.cwd();
const t2=resolve('private-t2'),kern=resolve('private-kernel');
const host=join(t2,'t2/current/final-successor/canonical-source');
const core=resolve('packages/t3-core');
const temp=join(process.env.RUNNER_TEMP,'exchange-receipt-semantics-20261127-'+mode);
const sha=x=>createHash('sha256').update(x).digest('hex');
const mark=(k,v)=>console.log('K036_'+k+'='+v);
function exec(cmd,args,dir,timeout=420000){
  return spawnSync(cmd,args,{cwd:dir,env:process.env,encoding:'utf8',maxBuffer:64*1024*1024,timeout});
}
function step(name,cmd,args,dir,timeout){
  const r=exec(cmd,args,dir,timeout),out=(r.stdout||'')+'\n'+(r.stderr||'');
  for(const line of out.split(/\r?\n/)){
    if(/^K036_[A-Z0-9_]+=[A-Z0-9_]+$/.test(line))console.log(line);
    // Vitest summary only; never echo private source snippets or logs.
    const clean=line.replace(/\x1b\[[0-9;]*m/g,'').trim();
    if(/^(Test Files|Tests)\s+\d+ (passed|failed)/.test(clean))console.log(name+' '+clean);
  }
  if(r.status!==0){
    for(const code of ['TS2322','TS2345','TS2532','TS18048','TS2379','TS2352','ERR_ASSERTION','TimeoutError','SyntaxError','ERR_MODULE_NOT_FOUND'])if(out.includes(code))mark(name+'_DETAIL',code);
    mark(name,'FAIL');return false;
  }
  mark(name,'PASS');return true;
}
function required(name,...args){if(!step(name,...args))throw Error(name);}
function pin(dir,commit,tree){assert.equal(exec('git',['rev-parse','HEAD'],dir).stdout.trim(),commit);assert.equal(exec('git',['rev-parse','HEAD^{tree}'],dir).stdout.trim(),tree);}
let fail=false;
try{
  assert.equal(process.env.GITHUB_REPOSITORY,'Faust-S/knowledge');
  assert.equal(process.env.GITHUB_ACTIONS,'true');
  assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
  const subject=mode==='t2'?host:core;
  assert.ok(mode==='t2'||mode==='t3');
  if(mode==='t2'){pin(t2,pins.t2,pins.t2Tree);pin(kern,pins.kernel,pins.kernelTree);}
  else{
    const actual=exec('git',['rev-parse','HEAD'],cwd).stdout.trim();
    assert.equal(actual,process.env.GITHUB_SHA);
    const expected=exec('git',['rev-parse',pins.t3+':packages/t3-core'],cwd).stdout.trim();
    const current=exec('git',['rev-parse','HEAD:packages/t3-core'],cwd).stdout.trim();
    assert.equal(current,expected);
  }
  required(mode.toUpperCase()+'_DEPS','npm',['ci','--ignore-scripts','--no-audit','--no-fund'],subject);
  // Existing tests, not an independent receipt implementation.
  const targets=['tests/exchange','tests/import-'];
  if(!step(mode.toUpperCase()+'_EXCHANGE_TESTS','npm',['exec','--','vitest','run',...targets],subject))fail=true;
  if(!step(mode.toUpperCase()+'_TYPECHECK','npm',['run','typecheck'],subject))fail=true;
  if(!step(mode.toUpperCase()+'_BUILD','npm',['run','build'],subject))fail=true;
  if(mode==='t3'){
    if(!step('T3_ORIGINAL_COMPANY_READBACK_REGRESSION','node',['--test','tests/t3-company-workspace-readback.test.mjs'],subject))fail=true;
  }else if(existsSync(join(host,'dist','exchange','index.html'))){
    mkdirSync(temp,{recursive:true});
    const root=join(kern,'t2/current/final-successor/kernel-successors');
    const base=join(root,'k036-same-store-event-history-20261019/iwxa-kernel-k036-same-store-history-20261019-qualified.1.zip');
    const cand=join(root,'k036-canonical-event-merge-20261125/iwxa-kernel-k036-canonical-event-merge-20261125-candidate.1.zip');
    assert.equal(sha(readFileSync(base)),'7075b8b9590ef1283e34ecb3c21dd9d1b7342697287e1aa150cd4f4a60860b68');
    assert.equal(sha(readFileSync(cand)),'5320dcb6c42d5fca410880677c8a8b595d4c9a2a6cedf51089b5f60f4ceeb52a');
    required('EXACT_ARCHIVES','python',['-c','import sys,zipfile,pathlib\nfor label,p in zip(("base","candidate"),sys.argv[1:3]):\n with zipfile.ZipFile(p) as z:\n  assert set(z.namelist())=={"_iwxa/current.json","_iwxa/loader.js","_iwxa/validator.js","_iwxa/runtime/0.3.6/runtime.js"}\n  z.extractall(pathlib.Path(sys.argv[3])/label)',base,cand,temp],cwd);
    assert.equal(sha(readFileSync(join(temp,'base/_iwxa/runtime/0.3.6/runtime.js'))),'e1737245aba309e900203b458087ca07cb08d9ccc89901754e1122cbc9a01e78');
    assert.equal(sha(readFileSync(join(temp,'candidate/_iwxa/runtime/0.3.6/runtime.js'))),'559e8dd74988144733394114b020ea89a78d49ae5bbc8d49faafb86f9325c1e7');
    required('NATIVE_BROWSER_ENGINE','npm',['exec','--','playwright','install','--with-deps','chromium'],host);
    if(!step('ORDINARY_NATIVE_REPEAT','node',[join(here,'native.mjs'),host,temp,temp],cwd,360000))fail=true;
  }else{mark('ORDINARY_NATIVE_REPEAT','BLOCKED_BUILD');fail=true;}
}catch(e){mark('QUALIFICATION_PRECONDITION_OR_STAGE','FAIL');fail=true;}
finally{rmSync(temp,{recursive:true,force:true});}
if(fail)process.exitCode=1;
