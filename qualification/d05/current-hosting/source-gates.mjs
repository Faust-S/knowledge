import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
const cwd=process.cwd(), temp=process.env.RUNNER_TEMP;
const require=createRequire(join(cwd,"package.json"));
const {ESLint}=require("eslint");
const git=(...args)=>execFileSync("git",args,{encoding:"utf8",stdio:["ignore","pipe","pipe"]});
const sha=s=>createHash("sha256").update(s).digest("hex");
const tracked=new Set(git("ls-files","-z").split("\0").filter(Boolean));
const pathOf=r=>relative(cwd,r.filePath).replaceAll("\\","/");
const isSafePath=p=>/^(?:scripts|src|t2-site-module|public)\/[A-Za-z0-9_.$/-]{1,220}$/.test(p)||/^(?:eslint|vite|vitest)\.config\.(?:js|ts|mjs)$/.test(p);
const allowedFix=p=>tracked.has(p)&&(
  p==="scripts/d05-t3-real-model-witness.mjs"||
  p==="src/components/site/T3ContextActions.tsx"||
  p==="src/routes/__root.tsx"||
  /^scripts\/(?:check-|verify-)[A-Za-z0-9_.$/-]*\.(?:ts|tsx|mjs|js)$/.test(p)||
  /^(?:scripts|src)\/[A-Za-z0-9_.$/-]+\.test\.(?:ts|tsx|mjs|js)$/.test(p));
const emit=(tag,obj)=>console.log(tag+" "+JSON.stringify(obj));
function report(rows,phase){
  const errors=rows.flatMap(row=>row.messages.filter(m=>m.severity===2).map(m=>({path:pathOf(row),line:m.line,column:m.column,rule:m.ruleId||"parse"})));
  emit("D05_LINT_SUMMARY",{phase,errors:errors.length,warnings:rows.reduce((n,r)=>n+r.warningCount,0)});
  for(const e of errors.slice(0,100))if(isSafePath(e.path))emit("D05_LINT_DIAG",e);
  const grouped={};
  for(const e of errors)if(isSafePath(e.path)){const rules=grouped[e.path]||={};rules[e.rule]=(rules[e.rule]||0)+1;}
  emit("D05_LINT_FILE_COUNTS",{phase,files:grouped});
  return errors;
}
const first=await new ESLint({cwd}).lintFiles(["."]);
const errors=report(first,"before");
const eligible=first.filter(r=>r.errorCount>0&&allowedFix(pathOf(r))&&r.messages.filter(m=>m.severity===2).every(m=>m.ruleId==="prettier/prettier"));
if(eligible.length){
  const targets=eligible.map(pathOf);
  // Only the locked project's own Prettier rule may edit test-only files.
  const formatter=new ESLint({cwd,fix:m=>m.ruleId==="prettier/prettier"});
  const fixed=await formatter.lintFiles(targets);
  await ESLint.outputFixes(fixed);
  emit("D05_TEST_FORMAT_ONLY",{files:targets});
}
const last=eligible.length?await new ESLint({cwd}).lintFiles(["."]):first;
const residual=report(last,"after");
// Capture source-free reversible coordinates so the exact normalized source
// can be reproduced by the private GitHub connector. Never print code or strings.
const layout=/^[ \t\r\n"'\x60,;(){}\[\]\\]*$/u;
const isLayout=c=>c!==undefined&&layout.test(c);
for(const p of git("diff","HEAD","--name-only","-z").split("\0").filter(Boolean)){
  if(!tracked.has(p)||!isSafePath(p))continue;
  const before=git("show","HEAD:"+p),after=readFileSync(p,"utf8");
  if(before===after)continue;
  let i=0,j=0,safe=true;const edits=[];
  while(i<before.length||j<after.length){
    const start=i,begin=j;
    while(isLayout(before[i]))i++;
    while(isLayout(after[j]))j++;
    if(before.slice(start,i)!==after.slice(begin,j))edits.push([start,i-start,after.slice(begin,j)]);
    if(before[i]!==after[j]){safe=false;break;}
    if(i===before.length)break;
    i++;j++;
  }
  if(safe){
    let check=before;
    for(const [at,n,replacement] of [...edits].reverse()){
      if(!layout.test(check.slice(at,at+n))||!layout.test(replacement)){safe=false;break;}
      check=check.slice(0,at)+replacement+check.slice(at+n);
    }
    safe=safe&&check===after;
  }
  emit("D05_FORMAT_FILE",{path:p,before:sha(before),after:sha(after),coordinatesAvailable:safe&&edits.length<=3000,count:edits.length});
  if(safe&&edits.length<=3000)for(let k=0;k<edits.length;k+=60)emit("D05_FORMAT_COORDINATES",{path:p,start:k,edits:edits.slice(k,k+60)});
}
writeFileSync(join(temp,"d05-lint-result.json"),JSON.stringify({errors:residual.length,warnings:last.reduce((n,r)=>n+r.warningCount,0)}));
const groups=[
  ["prepare-static","npm",["run","prepare:static"]],
  ["package-manager","npm",["run","verify:package-manager"]],
  ["lockfile","npm",["run","verify:lockfile"]],
  ["static-contract","npm",["run","verify:static-build-contract"]],
  ["source-hygiene","npm",["run","check:source-artifact-hygiene"]],
  ["generated","npm",["run","verify:generated"]],
  ["docs","npm",["run","verify:docs"]],
  ["typecheck","npm",["run","typecheck","--","--pretty","false"]],
  ["regression-coverage","npm",["run","test:coverage","--","--reporter=json","--outputFile="+join(temp,"d05-coverage-result.json")]],
  ["t2-module","npm",["run","verify:t2-module"]],
  ["t3-skills","npm",["run","verify:t3-skills"]],
  ["native-context","node",["scripts/check-t3-native-context.mjs"]],
  ["site-owned-menu","node",["--test","scripts/site-owned-chrome.test.mjs"]],
];
const results=[{name:"lint",status:residual.length?"FAIL":"PASS",errors:residual.length}];
for(const [name,cmd,args] of groups){
  const log=join(temp,"d05-gate-"+name+".log");
  const p=spawnSync(cmd,args,{cwd,encoding:"utf8",maxBuffer:64*1024*1024,env:process.env,timeout:12*60*1000});
  const output=(p.stdout||"")+"\n"+(p.stderr||"");
  writeFileSync(log,output);
  const status=p.status===0?"PASS":"FAIL";
  const row={name,status,exit:p.status,signal:p.signal||null};
  const counts=[...output.matchAll(/^# (tests|pass|fail) (\d+)$/gm)].map(m=>[m[1],Number(m[2])]);
  if(counts.length)row.nodeCounts=counts.reduce((a,[k,v])=>({...a,[k]:(a[k]||0)+v}),{});
  if(name==="regression-coverage"){
    const reportPath=join(temp,"d05-coverage-result.json");
    if(existsSync(reportPath)){
      const report=JSON.parse(readFileSync(reportPath,"utf8"));
      row.tests={total:report.numTotalTests,passed:report.numPassedTests,failed:report.numFailedTests,pending:report.numPendingTests};
      for(const file of report.testResults||[]){
        const path=relative(cwd,file.name).replaceAll("\\","/");
        if(!isSafePath(path))continue;
        const failures=(file.assertionResults||[]).map((t,i)=>({index:i,status:t.status})).filter(t=>t.status==="failed");
        if(failures.length)emit("D05_TEST_DIAG",{path,failed:failures.map(t=>t.index)});
      }
      if(report.numFailedTests>0||!report.numTotalTests)row.status="FAIL";
    }else row.status="FAIL";
  }
  if(row.status==="FAIL"){
    for(const line of output.split(/\r?\n/)){
      const m=line.match(/^\s*((?:src|scripts|t2-site-module)\/[A-Za-z0-9_.$/-]+)\((\d+),(\d+)\): error (TS\d+):/);
      if(m)emit("D05_TYPE_DIAG",{file:m[1],line:+m[2],column:+m[3],code:m[4]});
    }
    for(const m of output.matchAll(/^not ok (\d+) -[^\n]*\n([\s\S]*?)(?=^not ok |^ok |^# tests |$)/gm)){
      const at=m[2].match(/(?:location:|at)\s*[^\n]*\/site\/((?:scripts|src|t2-site-module)\/[A-Za-z0-9_.$/-]+):(\d+):(\d+)/);
      emit("D05_NODE_TEST_DIAG",{number:Number(m[1]),path:at?.[1]||null,line:at?Number(at[2]):null});
    }
    const codes=[...new Set(output.match(/(?:CEHOVOD|IWXA|D05|T2|T3)_[A-Z0-9_]{3,100}|TS\d{4,6}|TimeoutError|AssertionError|ERR_[A-Z0-9_]+/g)||[])].slice(0,60);
    emit("D05_GATE_CODES",{name,codes});
  }
  results.push(row);emit("D05_SOURCE_GATE",row);
}
writeFileSync(join(temp,"d05-source-gates.json"),JSON.stringify(results,null,2));
if(results.some(r=>r.status!=="PASS"))process.exitCode=1;
else console.log("D05_ALL_SOURCE_GATES_PASS");
