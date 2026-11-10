import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {initAcceptedProductRun,assertAcceptedProductGit} from '../src/factory2/products/domain-completion/accepted-product-run.mjs';
const digest='a'.repeat(64);
const git=(cwd,...a)=>execFileSync('git',a,{cwd,encoding:'utf8'}).trim();
const put=(root,path,value)=>{const file=resolve(root,path);mkdirSync(resolve(root,'t2'),{recursive:true});writeFileSync(file,JSON.stringify(value,null,2)+'\n');};
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'t2-product-adopt-')),repo=join(root,'canonical'),run=join(root,'product');
 mkdirSync(repo);git(repo,'init','-q');git(repo,'config','user.name','Test');git(repo,'config','user.email','test@example.invalid');
 writeFileSync(join(repo,'README.md'),'canonical source');git(repo,'add','-A');git(repo,'commit','-qm','original source');
 const commit=git(repo,'rev-parse','HEAD'),tree=git(repo,'rev-parse','HEAD^{tree}');
 put(repo,'t2/FACTORY2_ENGINEERING_INPUT_CURRENT.json',{sourceSha256:digest,sourceSubjectCommit:commit,sourceSubjectTree:tree,input:{sourceOrigin:'OWNER_SUPPLIED_AT_TEST_TIME',genericWriteAuthority:false,productionActivation:false,transformation:{intake:{domainId:'D06',currentSourceRef:'sha256:'+digest},resultAcceptanceMap:{entries:[{resultKind:'accepted',status:'BOUND'}]}}}});
 git(repo,'add','-A');git(repo,'commit','-qm','engineering');
 const common={domainId:'D06',sourceSha256:digest,decisionId:'historical-human-1',decidedBy:'IWXA_OWNER',decidedAt:'2026-10-07T09:19:00Z',productionActivation:false};
 put(repo,'t2/FACTORY2_STUDIO_HUMAN_DECISION_CURRENT.json',{...common,schema:'IWXA_T2_FACTORY2_STUDIO_HUMAN_DECISION_V1',decisionSource:'HUMAN_EXPLICIT',decision:'APPROVE'});
 git(repo,'add','-A');git(repo,'commit','-qm','Human decision');
 put(repo,'t2/FACTORY2_STUDIO_TERMINAL_RESULT_CURRENT.json',{...common,schema:'IWXA_T2_FACTORY2_STUDIO_TERMINAL_RESULT_V1',status:'T2_READY',explicitHumanDecision:true});
 git(repo,'add','-A');git(repo,'commit','-qm','T2 ready');
 return {root,repo,run};
}
function validate(f,state){
 return assertAcceptedProductGit({canonicalRoot:f.repo,runState:state,terminalBytes:readFileSync(join(f.run,'STUDIO_TERMINAL_RESULT.json')),engineeringBytes:readFileSync(join(f.run,'engineering-input.json'))});
}
test('historical accepted product starts without any source ZIP or fresh Human decision',()=>{
 const f=fixture();try{const state=initAcceptedProductRun(f.repo,f.run);assert.equal(state.schema,'IWXA_T2_ACCEPTED_PRODUCT_RUN_V1');assert.equal(state.sourceSha256,digest);assert.ok(validate(f,state).terminalSha256);assert.equal(state.sourceFile,undefined);assert.equal(git(f.repo,'status','--porcelain'),'');}finally{rmSync(f.root,{force:true,recursive:true});}
});
test('changing historical Human evidence fails closed',()=>{
 const f=fixture();try{const p=join(f.repo,'t2/FACTORY2_STUDIO_HUMAN_DECISION_CURRENT.json');const decision=JSON.parse(readFileSync(p));decision.decisionId='forged';writeFileSync(p,JSON.stringify(decision));git(f.repo,'add','-A');git(f.repo,'commit','-qm','forgery');assert.throws(()=>initAcceptedProductRun(f.repo,f.run),/ACCEPTED_BYTES_CHANGED/);}finally{rmSync(f.root,{force:true,recursive:true});}
});
test('tampered adopted terminal cannot qualify product',()=>{
 const f=fixture();try{const state=initAcceptedProductRun(f.repo,f.run);const p=join(f.run,'STUDIO_TERMINAL_RESULT.json');const bytes=readFileSync(p);bytes[8]^=1;writeFileSync(p,bytes);assert.throws(()=>validate(f,state),/ACCEPTANCE_INCONSISTENT/);}finally{rmSync(f.root,{force:true,recursive:true});}
});
test('original canonical source tree cannot be replaced by a metadata claim',()=>{
 const f=fixture();try{const p=join(f.repo,'t2/FACTORY2_ENGINEERING_INPUT_CURRENT.json');const record=JSON.parse(readFileSync(p));record.sourceSubjectTree='f'.repeat(40);writeFileSync(p,JSON.stringify(record));git(f.repo,'add','-A');git(f.repo,'commit','-qm','forged source');assert.throws(()=>initAcceptedProductRun(f.repo,f.run),/ACCEPTED_BYTES_CHANGED/);}finally{rmSync(f.root,{force:true,recursive:true});}
});
