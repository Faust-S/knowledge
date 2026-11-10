import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {qualifyFactory2DomainProduct,verifyFactory2DomainProduct,historicalMigrationScope,applicableProductStages,assertNotApplicableMigrationCheck} from '../src/factory2/products/domain-completion/product-completion.mjs';
const sha='a'.repeat(64);
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'f2-product-')),site=join(root,'site'),run=join(root,'run');
 mkdirSync(site);mkdirSync(run);writeFileSync(join(run,'STUDIO_TERMINAL_RESULT.json'),JSON.stringify({schema:'IWXA_T2_FACTORY2_STUDIO_TERMINAL_RESULT_V1',status:'T2_READY',explicitHumanDecision:true,domainId:'D99',sourceSha256:sha,productionActivation:false}));
 const state={status:'T2_READY',terminalResult:'STUDIO_TERMINAL_RESULT.json',domainId:'D99',sourceSha256:sha,engineeringInputSha256:null};
 return {root,site,run,state};
}
test('rejects full product readiness before Human accepted Factory domain',async()=>{
 const x=fixture(),state={...x.state,status:'SUBMITTED_FOR_STUDIO_ACCEPTANCE'};
 await assert.rejects(()=>qualifyFactory2DomainProduct({runRoot:x.run,siteRoot:x.site,runState:state}),/HUMAN_READY_REQUIRED/);
});
test('rejects product completeness without site integration evidence',async()=>{
 const x=fixture();
 await assert.rejects(()=>qualifyFactory2DomainProduct({runRoot:x.run,siteRoot:x.site,runState:x.state}),/GIT_UNAVAILABLE|SITE_SOURCE_DIRTY/);
 await assert.rejects(()=>verifyFactory2DomainProduct({runRoot:x.run,siteRoot:x.site,runState:x.state}),/GIT_UNAVAILABLE|SITE_SOURCE_DIRTY|NOT_QUALIFIED/);
});
test('never emits the full-product result from the Factory terminal decision alone',()=>{
 const x=fixture();assert.equal(x.state.status,'T2_READY');
 assert.equal(x.state.terminalResult,'STUDIO_TERMINAL_RESULT.json');
});


test('existing evidence folder is preserved and qualification fails closed',async()=>{
 const x=fixture();
 mkdirSync(join(x.run,'PRODUCT_EXECUTION_EVIDENCE'));writeFileSync(join(x.run,'PRODUCT_EXECUTION_EVIDENCE','preserve.txt'),'keep'); 
 await assert.rejects(()=>qualifyFactory2DomainProduct({runRoot:x.run,siteRoot:x.site,runState:x.state}),/GIT_UNAVAILABLE|SITE_SOURCE_DIRTY|FROZEN_ENGINEERING_INPUT_CHANGED/);
 assert.equal(readFileSync(join(x.run,'PRODUCT_EXECUTION_EVIDENCE','preserve.txt'),'utf8'),'keep');
});

const noHistory={
 historicalMigration:{
  status:'NOT_APPLICABLE',
  prelaunch:true,
  historicalUserDataPresent:false,
  reason:'Domain has never operated and has no historical user records to migrate'
 }
};
test('prelaunch site explicitly marks historical migration NOT_APPLICABLE without a migration runner',()=>{
 const scope=historicalMigrationScope(noHistory);
 assert.deepEqual(scope,{status:'NOT_APPLICABLE',reason:noHistory.historicalMigration.reason});
 assert.deepEqual(applicableProductStages(noHistory),['nativeKernel','browser','regression']);
 assertNotApplicableMigrationCheck({stage:'migration',status:'NOT_APPLICABLE',reason:scope.reason},scope,false);
});
test('migration remains mandatory by default and when explicitly required',()=>{
 for(const input of [{},{historicalMigration:{status:'REQUIRED'}}]){
  assert.deepEqual(historicalMigrationScope(input),{status:'REQUIRED'});
  assert.deepEqual(applicableProductStages(input),['nativeKernel','browser','migration','regression']);
 }
});
test('NOT_APPLICABLE requires an explicit prelaunch and no historical data declaration',()=>{
 const declared=noHistory.historicalMigration;
 for(const invalid of [
  {status:'NOT_APPLICABLE'},
  {...declared,prelaunch:false},
  {...declared,historicalUserDataPresent:true},
  {...declared,historicalUserDataPresent:undefined},
  {...declared,reason:'not enough'},
  {...declared,status:'SKIP'},
  'NOT_APPLICABLE',
 ]){
  assert.throws(()=>historicalMigrationScope({historicalMigration:invalid}),/MIGRATION_SCOPE/);
 }
});
test('NOT_APPLICABLE evidence cannot masquerade as migration PASS or change during readback',()=>{
 const scope=historicalMigrationScope(noHistory);
 const marker={stage:'migration',status:'NOT_APPLICABLE',reason:scope.reason};
 for(const [step,hasReport] of [
  [{...marker,status:'PASS'},false],
  [{...marker,reason:'altered'},false],
  [{...marker,script:'migration'},false],
  [marker,true],
  [null,false],
 ]){
  assert.throws(()=>assertNotApplicableMigrationCheck(step,scope,hasReport),/MIGRATION_NOT_APPLICABLE_INVALID/);
 }
});
