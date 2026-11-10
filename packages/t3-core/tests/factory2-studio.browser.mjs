import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,rmSync,mkdirSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {serveRealKernelHost} from '../scripts/real-kernel-e2e.mjs';
const source=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const root=mkdtempSync(join(tmpdir(),'t2-studio-browser-'));cpSync(join(source,'dist'),join(root,'workspace'),{recursive:true});
const live=await serveRealKernelHost(root);
const browser=await chromium.launch();
const engineering=id=>({schema:'IWXA_T2_FACTORY2_DOMAIN_ENGINEERING_SESSION_V1',product:'domain-engineering',generation:2,domainId:id,sourceOrigin:'OWNER_SUPPLIED_AT_TEST_TIME',sourceSha256:'3'.repeat(64),status:'CANDIDATE_ENGINEERING_READY',candidateBuildAllowed:true,candidateValidationAllowed:true,candidateValidation:{status:'READY_FOR_HUMAN_REVIEW',evidenceRefs:['evidence:browser'],rollbackRef:'rollback:browser'},blockers:[],candidateRequirements:{},derived:{schemaMapStatus:'COMPLETE'},sourceBytesVerified:false,sourceIdentityValidationScope:'DECLARED_FINGERPRINT_CONSISTENCY_ONLY',genericWriteAuthority:false,ownerApprovalGranted:false,productionActivation:false});
for(const [id,viewport] of [['D13',{width:1440,height:1000}],['D100',{width:390,height:844}]]){
 test('Studio '+id+' displays independent gates, keyboard review and no implicit acceptance',async()=>{
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(live.origin+'/workspace/studio/');
   await page.getByTestId('factory2-studio-session-file').setInputFiles({name:'ENGINEERING_SESSION.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(engineering(id)))});
   await page.getByTestId('studio-independent-gates').waitFor();
   const gates=await page.getByTestId('studio-independent-gates').innerText();
   for(const label of ['Factory Engineering','Studio review','Решение человека','Интеграция сайта с Kernel','Завершение продукта','Production deployment'])assert.ok(gates.includes(label));
   assert.ok(gates.includes('not proven'));assert.ok(gates.includes('not qualified'));assert.ok(gates.includes('not deployed'));assert.ok(gates.includes('human decision required'));
   const button=page.getByRole('button',{name:'Открыть human review'});await button.focus();await page.keyboard.press('Enter');
   await page.getByTestId('factory2-studio-human-review').waitFor();
   assert.match(await page.getByTestId('factory2-studio-human-review').innerText(),/не создаёт Owner approval/);
   assert.equal(await page.getByRole('button',{name:/approve|deploy|одобрить/i}).count(),0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.deepEqual(errors,[]);
   const evidence=process.env.IWXA_T2_BROWSER_EVIDENCE;if(evidence){mkdirSync(evidence,{recursive:true});await page.screenshot({path:join(evidence,'studio-'+id+'.png'),fullPage:true});}
  }finally{await context.close();}
 });
}
test('Git Studio does not require technical Human review or grant business authority',async()=>{
 const context=await browser.newContext({ignoreHTTPSErrors:true});const page=await context.newPage();
 try{
  await page.goto(live.origin+'/workspace/studio/');
  await page.getByTestId('factory2-studio-session-file').setInputFiles({name:'ENGINEERING_SESSION.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...engineering('D13'),sourceOrigin:'CANONICAL_GIT_HEAD_TREE'}))});
  const gates=page.getByTestId('studio-independent-gates');await gates.waitFor();
  assert.match(await gates.innerText(),/not required for technical git/);
  assert.equal(await page.getByRole('button',{name:'Открыть human review'}).count(),0);
  assert.match(await page.locator('body').innerText(),/Только уполномоченный субъект/);
 }finally{await context.close();}
});

test.after(async()=>{await browser.close();await new Promise(r=>live.server.close(r));rmSync(root,{recursive:true,force:true});});
