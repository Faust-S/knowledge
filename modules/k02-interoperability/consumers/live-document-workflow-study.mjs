import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {OllamaLocalModelProvider,MODEL_INPUT,MODEL_OUTPUT} from '../adapters/ollama-local.mjs';
import {JqCalculationCliProvider,CALCULATION_INPUT,CALCULATION_OUTPUT} from '../adapters/jq-calculation-cli.mjs';
import {GitCliProvider,GIT_INPUT,GIT_OUTPUT} from '../adapters/git-cli.mjs';
import {NodeEvidenceCliProvider,AUDIT_INPUT,AUDIT_OUTPUT} from '../adapters/node-evidence-cli.mjs';
import {CONTRACT_VERSION,resolveRequirements,buildInvocationPlan,
  verifyInvocationReadiness,verifySkillBinding,validateInvocationOutput} from '../index.mjs';
import {recommendTaskStages} from '../task-step-composition.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const modelArgs=[
  {id:'mini',providerId:'ollama-mini',modelName:process.env.K02_MODEL_NAME,
   expectedDigest:process.env.K02_MODEL_DIGEST,thinkingMode:'auto'},
  {id:'qwen',providerId:'ollama-qwen',modelName:process.env.K02_SECOND_MODEL_NAME,
   expectedDigest:process.env.K02_SECOND_MODEL_DIGEST,thinkingMode:'disabled'},
];
if(modelArgs.some(x=>!x.modelName||!/^[a-f0-9]{64}$/.test(x.expectedDigest??'')))
  throw new Error('TWO_PINNED_REAL_MODELS_REQUIRED');
const textDocs=await Promise.all([
  new URL('../fixtures/document-task/INV-1042.txt',import.meta.url),
  new URL('../fixtures/document-task/INV-1043.txt',import.meta.url),
].map(x=>readFile(x,'utf8')));
const data=JSON.parse(await readFile(new URL('../fixtures/document-task/orders.json',import.meta.url),'utf8'));
assert.equal(data.project,'K02-COMPOSITE-01');
assert.deepEqual(data.orders.map(o=>o.documentId),['INV-1042','INV-1043']);
assert.match(textDocs[0],/quantity 12 at 125.00 RUB/);
assert.match(textDocs[1],/quantity 7 at 45.00 RUB/);
assert.match(textDocs[0],/discount: 10% on line items. Shipping: 60.00 RUB/);
assert.match(textDocs[1],/discount: 0% on line items. Shipping: 20.00 RUB/);
const context=textDocs.join('\n\n')+'\n'+JSON.stringify(data);
const contextDigest=sha(context),docText=textDocs.join('\n\n');
const outDir=process.env.K02_CASE_OUTPUT_DIR||join(tmpdir(),'k02-live-document-case');
await mkdir(outDir,{recursive:true});
const memAvailable=()=>{
 try{const t=readFileSync('/proc/meminfo','utf8'),m=t.match(/^MemAvailable:\s+(\d+)\s+kB/m);
   return m?Math.floor(Number(m[1])/1024):null;}catch{return null;}
};
async function ps(){
 try{const r=await fetch('http://127.0.0.1:11434/api/ps');
   if(!r.ok)return null;
   return (await r.json()).models.map(x=>({name:x.name,
     sizeMiB:Math.round(x.size/1048576),vramMiB:Math.round((x.size_vram??0)/1048576)}));
 }catch{return null;}
}
const version=(await (await fetch('http://127.0.0.1:11434/api/version')).json()).version;
const osVersion='linux-'+process.arch+';ollama-'+version;
let providers=Object.fromEntries(modelArgs.map(x=>[x.id,new OllamaLocalModelProvider(x)]));
const counts={mini:0,qwen:0},measurements=[],calibration=[],problems=[],reports=[];
const requirement=(id,kind,cap,input,output)=>({requirementId:id,kind,
 capabilityId:cap,inputSchema:input,outputSchema:output,
 effectClass:kind==='model'?'MODEL_INFERENCE':cap==='source.git.show'?'HOST_AUTHORIZED_READ':'PURE_COMPUTE',required:true,
 ...(kind==='model'?{inputModes:['text'],outputModes:['text']}:{}),
});
async function invokeModel(id,prompt,phase){
 if(!phase.startsWith('calibration:')){
   assert.ok(prompt.includes(textDocs[0].trim()),'CONTEXT_DOC_A_DROPPED');
   assert.ok(prompt.includes(textDocs[1].trim()),'CONTEXT_DOC_B_DROPPED');
 }
 const provider=providers[id],desc=await provider.describeCapabilities();
 assert.equal(desc.availability,'available',desc.unavailableReason??'UNAVAILABLE');
 const sol={solutionId:'study-'+id,requirements:[
   {...requirement('invoke','model','text.generate',MODEL_INPUT,MODEL_OUTPUT),
     modelPin:{name:provider.modelName,digest:provider.expectedDigest}}]};
 const resolved=resolveRequirements(sol,[desc]);assert.equal(resolved.status,'SUPPORTED');
 const plan=buildInvocationPlan({taskId:'study-model-task-'+id,solutionId:sol.solutionId},[],resolved);
 await verifyInvocationReadiness(plan,'invoke',provider,plan.planDigest);
 const result=await provider.invoke('text.generate',{
   system:'Reply with only the requested facts. No fabricated data.',
   prompt,max_output_tokens:128,
 },{hostApproved:true,pinnedModelDigest:provider.expectedDigest});
 validateInvocationOutput(plan.steps[0],result.output);
 counts[id]++;
 const row={id,phase,durationMs:Number(result.observation.durationMs.toFixed(2)),
   promptTokens:result.observation.promptTokens,completionTokens:result.observation.completionTokens,
   thinkingMode:result.observation.thinkingMode,
   proofClass:result.observation.proofClass,memory:await ps()};
 measurements.push(row);
 return result.output.text.trim();
}
const match=(text,expected)=>text.toUpperCase().trim().replace(/["'.,!? \n\r\t]/g,'')===
  expected.toUpperCase().replace(/["'.,!? \n\r\t]/g,'');
const calibrationCases=[
 ['documents','simple',[
  ['Project: CASE-21. Return the project ID only.','CASE-21'],
  ['Invoice INV-508 is for fixtures. Return the invoice ID only.','INV-508'],
 ]],
 ['arithmetic','moderate',[
  ['4 items at 25 RUB each plus shipping 10 RUB. Return total number only.','110'],
  ['Compute 75 plus 90. Return number only.','165'],
 ]],
 ['summary','complex',[
  ['Status is PENDING, not completed. Return status word only.','PENDING'],
  ['Reference codes R-01 and R-02. Return second code only.','R-02'],
 ]],
];
for(const [taskClass,difficulty,cases] of calibrationCases){
 for(const id of ['mini','qwen']){
   let passed=0;const timings=[];
   for(const [prompt,expected] of cases){
     const start=performance.now();
     try{const actual=await invokeModel(id,prompt,'calibration:'+taskClass);
       passed+=Number(match(actual,expected));}
     catch(e){problems.push({phase:'calibration',id,taskClass,error:String(e.code??e.message)});}
     timings.push(performance.now()-start);
   }
   calibration.push({id,taskClass,difficulty,passed,attempts:cases.length,
     medianDurationMs:timings.sort((a,b)=>a-b)[Math.floor(timings.length/2)]});
 }
}
const tags=await (await fetch('http://127.0.0.1:11434/api/tags')).json();
const profiles=[],resources=[],quality=[],available=[];
for(const a of modelArgs){
 const sample=calibration.filter(x=>x.id===a.id);
 const measured=sample.map(x=>x.medianDurationMs).sort((x,y)=>x-y);
 const median=measured[Math.floor(measured.length/2)]??null;
 const provider=new OllamaLocalModelProvider({...a,latencyMsP50:median});
 providers[a.id]=provider;
 available.push(await provider.describeCapabilities());
 const loaded=tags.models.find(x=>x.name===a.modelName&&x.digest===a.expectedDigest);
 assert.ok(loaded,'MODEL_DIGEST_OR_TAG_CHANGED');
 const modelPin={name:a.modelName,digest:a.expectedDigest};
 const basis=osVersion+';thinking:'+a.thinkingMode;
 profiles.push({providerId:a.providerId,modelPin,runtimeVersion:basis,
   memoryMiB:Math.ceil(loaded.size/1048576+256),
   computeUsdPerAttempt:null,costBasis:'UNKNOWN'});
 resources.push({providerId:a.providerId,modelPin,
   minRamMiB:Math.ceil(loaded.size/1048576+256),minVramMiB:0,
   contextWindowTokens:4096,basis:'ESTIMATED'});
 for(const x of sample)quality.push({providerId:a.providerId,modelPin,taskClass:x.taskClass,
   difficulty:x.difficulty,operatingSystem:osVersion,runtimeVersion:basis,
   passed:x.passed,attempts:x.attempts,
   proofRef:'open-study-calibration:'+sha(JSON.stringify(x)).slice(0,32)});
}
const names=[['extract','documents','simple'],
 ['arithmetic','arithmetic','moderate'],['report','summary','complex']];
const solution={solutionId:'k02-document-comparison',requirements:names.map(([id])=>
 requirement(id,'model','text.generate',MODEL_INPUT,MODEL_OUTPUT))};
const stages=names.map(([id,taskClass,difficulty])=>({stageId:'task-step-'+id,
 requirementId:id,requiredContextTokens:1800,
 step:{taskClass,difficulty,minObservedSuccessRate:0.5,minSamples:2,
   maxAttempts:1,maxLatencyMs:null,maxMemoryMiB:null}}));
const startRam=memAvailable();
const observedAtMs=Date.now();
const recommendation=recommendTaskStages({
 task:{taskId:'k02-document-task',solutionId:solution.solutionId},
 solution,stages,available,profiles,qualityEvidence:quality,resourceProfiles:resources,
 resourceObservation:startRam===null?null:{availableRamMiB:startRam,
   availableVramMiB:null,observedAtMs,maxAgeMs:10000,
   sourceRef:'linux-proc-MemAvailable'},
 environment:{operatingSystem:osVersion},nowMs:Date.now(),selectedSkills:[],
 contextBinding:{ref:'public-open-documents',digest:contextDigest},
});
const extractPrompt='Read both documents, output ONLY project ID.\n'+docText;
const calcPrompt='Compute grand payable RUB for both invoices after discounts and shipping. Return ONE number only, no commentary.\n'+docText;
const reportPrompt=total=>'Prepare a concise report including project code, INV-1042 total, INV-1043 total, and grand total in RUB. Include only verified figures.\n'+docText+
 '\nPrevious calculation: '+total;
const money=text=>{const t=text.replace(/(?:RUB|₽)$/iu,'').trim().replace(/ /g,'');
 return /^\d+(\.\d{1,2})?$/.test(t)?Math.round(Number(t)*100):null;};
const assess=(read,calc,body)=>({project:read==='K02-COMPOSITE-01',
 total:calc===174500,finalFields:['K02-COMPOSITE-01','INV-1042','INV-1043',
 '1410','335','1745'].every(x=>body.includes(x))});
async function skillAudit(){
 const p=new NodeEvidenceCliProvider(),d=await p.describeCapabilities();
 assert.equal(d.availability,'available');
 const skill=JSON.parse(await readFile(new URL('../skills/exact-source-audit.skill.json',import.meta.url),'utf8'));
 const bytes=new Uint8Array(await readFile(new URL('../skills/exact-source-audit.instructions.json',import.meta.url)));
 const sol={solutionId:'open-skill-audit',requirements:[requirement('audit',
   'tool','evidence.exact.audit',AUDIT_INPUT,AUDIT_OUTPUT)]};
 const res=resolveRequirements(sol,[d]),plan=buildInvocationPlan({taskId:'open-audit',solutionId:sol.solutionId},[skill],res);
 verifySkillBinding(plan,skill.skillId,skill,bytes,plan.planDigest);
 await verifyInvocationReadiness(plan,'audit',p,plan.planDigest);
 const markers=['Line item: brackets, quantity 12 at 125.00 RUB each.',
   'Line item: cable fittings, quantity 7 at 45.00 RUB each.'];
 const candidates=markers.map((quote,i)=>({action:'Check invoice '+(i+1),quote,
   start:docText.indexOf(quote),end:docText.indexOf(quote)+quote.length}));
 const r=await p.invoke('evidence.exact.audit',{transcript:docText,candidates},{hostApproved:true});
 assert.equal(r.status,'SUCCEEDED');assert.equal(r.output.accepted.length,2);
 assert.equal(r.output.rejected.length,0);
 return {verified:true,durationMs:r.observation.durationMs,proofClass:'REAL_NODE_CLI'};
}
async function jqCalculate(){
 const p=new JqCalculationCliProvider(),d=await p.describeCapabilities();
 assert.equal(d.availability,'available','JQ_CLI_NOT_INSTALLED');
 const sol={solutionId:'open-jq-verify',requirements:[requirement('calculate',
   'tool','invoice.calculate',CALCULATION_INPUT,CALCULATION_OUTPUT)]};
 const res=resolveRequirements(sol,[d]),plan=buildInvocationPlan({taskId:'open-jq',solutionId:sol.solutionId},[],res);
 await verifyInvocationReadiness(plan,'calculate',p,plan.planDigest);
 const r=await p.invoke('invoice.calculate',{orders:data.orders},{hostApproved:true});
 validateInvocationOutput(plan.steps[0],r.output);
 assert.deepEqual(r.output.lines.map(x=>x.totalCents),[141000,33500]);
 assert.equal(r.output.grandTotalCents,174500);
 return {total:174500,durationMs:r.observation.durationMs,proofClass:r.observation.proofClass};
}
async function variant(id,models,{skill=false,program=false}={}){
 const start=performance.now(),calls=[];let project='',total=null,body='',audit=null,jq=null;
 let status='REAL_INVOKE';
 const k02Preflight=async requirementId=>{
   if(id!=='k02-by-stage')return;
   assert.equal(recommendation.contextBinding.digest,contextDigest);
   const step=recommendation.plan.steps.find(x=>x.requirementId===requirementId);
   assert.equal(step.providerId,providers[models[requirementId]].providerId);
   const check=await verifyInvocationReadiness(recommendation.plan,requirementId,
     providers[models[requirementId]],recommendation.plan.planDigest);
   assert.equal(check.status,'MATCHED_NOT_AUTHORIZED');
 };
 try{
   await k02Preflight('extract');
   project=await invokeModel(models.extract,extractPrompt,id+':extract');
   calls.push(models.extract);
   if(skill)audit=await skillAudit();
   if(program){jq=await jqCalculate();total=jq.total;}
   else{await k02Preflight('arithmetic');
     total=money(await invokeModel(models.arithmetic,calcPrompt,id+':arithmetic'));
     calls.push(models.arithmetic);}
   await k02Preflight('report');
   body=await invokeModel(models.report,reportPrompt(
     total===null?'UNKNOWN':(total/100).toFixed(2)+' RUB'),id+':report');
   calls.push(models.report);
 }catch(e){status='EXECUTION_INCOMPLETE';
   problems.push({phase:id,error:String(e.code??e.message)});}
 const checks=assess(project,total,body);
 const successful=checks.project&&checks.total&&checks.finalFields&&
   (!skill||audit?.verified===true)&&(!program||jq?.total===174500);
 const text='# Document analysis\n\n'+body+'\n\n'+
   (audit?'Verified source spans: 2\n\n':'')+
   (jq?'Verified jq total RUB: '+(jq.total/100).toFixed(2)+'\n':'');
 const path=join(outDir,id+'.md');
 await writeFile(path,text,'utf8');
 const readback=await readFile(path,'utf8');assert.equal(sha(readback),sha(text));
 const item={id,status,modelCalls:calls,checks,userResultSuccessful:successful,
   durationMs:Number((performance.now()-start).toFixed(2)),
   skillVerified:audit?.verified??false,jqExecuted:!!jq,
   fileReadback:true,fileDigest:sha(text),providerFeeUsd:0,
   hostComputeCostUsd:null,contextPreserved:true};
 reports.push(item);
}
async function toolFirstVariant(withModel=true){
 const id=withModel?'k02-source-skill-jq':'k02-tools-only',started=performance.now();
 const realGit=new GitCliProvider(process.cwd());
 const realAudit=new NodeEvidenceCliProvider();
 const realJq=new JqCalculationCliProvider();
 const activeQwen=providers.qwen;
 const descs=await Promise.all([
   realGit.describeCapabilities(),realAudit.describeCapabilities(),
   realJq.describeCapabilities(),
   ...(withModel?[activeQwen.describeCapabilities()]:[]),
 ]);
 assert.ok(descs.every(x=>x.availability==='available'),'TOOL_FIRST_PROVIDER_UNAVAILABLE');
 const skill=JSON.parse(await readFile(new URL('../skills/exact-source-audit.skill.json',import.meta.url),'utf8'));
 const skillBytes=new Uint8Array(await readFile(new URL('../skills/exact-source-audit.instructions.json',import.meta.url)));
 const stepSolution={solutionId:'k02-source-verified-report',requirements:[
   requirement('invoice-a','tool','source.git.show',GIT_INPUT,GIT_OUTPUT),
   requirement('invoice-b','tool','source.git.show',GIT_INPUT,GIT_OUTPUT),
   requirement('order-data','tool','source.git.show',GIT_INPUT,GIT_OUTPUT),
   requirement('quote-audit','tool','evidence.exact.audit',AUDIT_INPUT,AUDIT_OUTPUT),
   requirement('compute','tool','invoice.calculate',CALCULATION_INPUT,CALCULATION_OUTPUT),
   ...(withModel?[requirement('report','model','text.generate',MODEL_INPUT,MODEL_OUTPUT)]:[]),
 ]};
 const staged=[
   ['invoice-a','read-invoice-a'],['invoice-b','read-invoice-b'],
   ['order-data','read-order-data'],['quote-audit','audit-source'],
   ['compute','calculate-confirmed'],
 ].map(([requirementId,stageId])=>({requirementId,stageId,requiredContextTokens:1200}));
 if(withModel)staged.push({stageId:'optional-model-summary',requirementId:'report',requiredContextTokens:1800,
   step:{taskClass:'summary',difficulty:'complex',minObservedSuccessRate:0.5,
     minSamples:2,maxAttempts:1,maxLatencyMs:null,maxMemoryMiB:null}});
 const selectionInput={
   task:{taskId:'open-verified-document-report',solutionId:stepSolution.solutionId},
   solution:stepSolution,stages:staged,available:descs,profiles,
   qualityEvidence:quality,resourceProfiles:resources,selectedSkills:[skill],
   resourceObservation:startRam===null?null:{availableRamMiB:startRam,
     availableVramMiB:null,observedAtMs:Date.now(),maxAgeMs:10000,
     sourceRef:'linux-proc-MemAvailable'},
   nowMs:Date.now(),environment:{operatingSystem:osVersion},
   contextBinding:{ref:'public-open-documents',digest:contextDigest},
 };
 const rejectedSkill=recommendTaskStages({...selectionInput,
   selectedSkills:[{...skill,requiredCapabilities:['nonexistent.unapproved.skill.capability']}]});
 assert.equal(rejectedSkill.decision,'INCOMPATIBLE');
 assert.equal(rejectedSkill.plan,null);
 assert.ok(rejectedSkill.blocked.some(x=>x.reason==='SKILL_UNSUPPORTED_OR_UNVERIFIED'));
 const recommended=recommendTaskStages(selectionInput);
 if(recommended.decision!=='STAGES_PROPOSED_NOT_AUTHORIZED')
   process.stdout.write('K02_TOOL_FIRST_REFUSAL '+JSON.stringify({
     blocked:recommended.blocked,stages:recommended.stages.map(x=>[x.requirementId,x.decision])})+'\n');
 assert.equal(recommended.decision,'STAGES_PROPOSED_NOT_AUTHORIZED');
 assert.equal(recommended.plan.steps.length,withModel?6:5);
 assert.equal(recommended.plan.skills[0].skillId,'exact-source-audit');
 assert.equal(verifySkillBinding(recommended.plan,skill.skillId,skill,
   skillBytes,recommended.plan.planDigest).status,'MATCHED_NOT_ACTIVATED');
 const latestRevision=process.env.GITHUB_SHA;
 assert.match(latestRevision??'',/^[a-f0-9]{40}$/);
 const readPaths=['INV-1042.txt','INV-1043.txt','orders.json'];
 const actualContents=[];
 for(let i=0;i<readPaths.length;i++){
   const stageId=['invoice-a','invoice-b','order-data'][i];
   const b=await verifyInvocationReadiness(recommended.plan,stageId,realGit,
     recommended.plan.planDigest);
   assert.equal(b.status,'MATCHED_NOT_AUTHORIZED');
   const got=await realGit.invoke('source.git.show',{
     revision:latestRevision,path:'modules/k02-interoperability/fixtures/document-task/'+readPaths[i],
   },{hostApproved:true});
   assert.equal(got.status,'SUCCEEDED');
   actualContents.push(got.output.content);
   assert.equal(got.output.sha256,sha(got.output.content));
 }
 assert.equal(actualContents[0],textDocs[0]);
 assert.equal(actualContents[1],textDocs[1]);
 const values=JSON.parse(actualContents[2]);
 assert.deepEqual(values,data);
 assert.equal(sha(actualContents[0]+'\n\n'+actualContents[1]+'\n'+JSON.stringify(values)),contextDigest);
 const quoteStep=await verifyInvocationReadiness(recommended.plan,'quote-audit',realAudit,
   recommended.plan.planDigest);
 assert.equal(quoteStep.status,'MATCHED_NOT_AUTHORIZED');
 const verifiedText=actualContents[0]+'\n\n'+actualContents[1];
 const excerpts=[
   'Line item: brackets, quantity 12 at 125.00 RUB each.',
   'Line item: cable fittings, quantity 7 at 45.00 RUB each.',
 ].map((quote,i)=>({action:'Check '+readPaths[i],quote,
   start:verifiedText.indexOf(quote),end:verifiedText.indexOf(quote)+quote.length}));
 const quoteCheck=await realAudit.invoke('evidence.exact.audit',
   {transcript:verifiedText,candidates:excerpts},{hostApproved:true});
 assert.equal(quoteCheck.status,'SUCCEEDED');
 assert.equal(quoteCheck.output.accepted.length,2);
 assert.equal(quoteCheck.output.rejected.length,0);
 const calcStep=await verifyInvocationReadiness(recommended.plan,'compute',realJq,
   recommended.plan.planDigest);
 assert.equal(calcStep.status,'MATCHED_NOT_AUTHORIZED');
 const computed=await realJq.invoke('invoice.calculate',{orders:values.orders},{hostApproved:true});
 assert.equal(computed.status,'SUCCEEDED');
 assert.deepEqual(computed.output.lines.map(x=>x.totalCents),[141000,33500]);
 assert.equal(computed.output.grandTotalCents,174500);
 let proposalValid=null;
 if(withModel){
   await verifyInvocationReadiness(recommended.plan,'report',activeQwen,recommended.plan.planDigest);
   let proposal='';
   try{proposal=await invokeModel('qwen',reportPrompt('1745.00 RUB'),'tool-first:report');}
   catch(e){problems.push({phase:'tool-first-model-suggestion',error:String(e.code??e.message)});}
   proposalValid=assess(values.project,computed.output.grandTotalCents,proposal).finalFields;
 }
 // A failed model draft is not allowed to corrupt a verified file. The host
 // writes a deterministic report from independently observed tool output.
 const reportText=[
   '# Verified procurement document report',
   '',
   'Project: '+values.project,
   'Currency: '+values.currency,
   '',
   '| Invoice | Payable (RUB) |',
   '| --- | ---: |',
   ...computed.output.lines.map(x=>'| '+x.documentId+' | '+(x.totalCents/100).toFixed(2)+' |'),
   '',
   'Grand total: '+(computed.output.grandTotalCents/100).toFixed(2)+' RUB',
   '',
   'Source revision: '+latestRevision,
   'Source SHA-256 A: '+sha(actualContents[0]),
   'Source SHA-256 B: '+sha(actualContents[1]),
   'Source SHA-256 data: '+sha(actualContents[2]),
   '',
   'Exact source quotations verified: '+quoteCheck.output.accepted.length,
   ...quoteCheck.output.accepted.map(x=>'- '+x.quote),
   '',
   'Model commentary: '+(!withModel?'NOT_REQUIRED':proposalValid?'APPROVED_FOR_DRAFT':'REJECTED_INCORRECT_OR_INCOMPLETE'),
   'Human Review: REQUIRED before a Personal Agent Result can be accepted.',
 ].join('\n')+'\n';
 const path=join(outDir,id+'.md');
 await writeFile(path,reportText,'utf8');
 const loaded=await readFile(path,'utf8');
 assert.equal(sha(loaded),sha(reportText));
 const correct=assess(values.project,computed.output.grandTotalCents,loaded);
 assert.ok(correct.project&&correct.total&&correct.finalFields);
 assert.equal(recommended.hostAuthorityGranted,false);
 reports.push({id,status:'REAL_INVOKE',userResultSuccessful:true,
   durationMs:Number((performance.now()-started).toFixed(2)),
   checks:correct,modelDraftVerified:proposalValid,
   modelDraftIncluded:false,deterministicVerifiedFallback:withModel&&!proposalValid,
   incompatibleSkillRejected:true,modelInvoked:withModel,
   sourceFilesReadByGit:3,sourceQuotesVerified:2,jqExecuted:true,
   toolProofClasses:['REAL_GIT_CLI','REAL_NODE_CLI','REAL_JQ_PROCESS_NOT_PRODUCT_TASK'],
   selected:recommended.stages.map(x=>[x.requirementId,x.providerId]),
   fileReadback:true,fileDigest:sha(loaded),providerFeeUsd:0,
   hostComputeCostUsd:null,contextPreserved:true});
}

const direct={extract:'qwen',arithmetic:'qwen',report:'qwen'};
await variant('single-model',direct);
if(recommendation.decision==='STAGES_PROPOSED_NOT_AUTHORIZED'){
 const map={};
 for(const x of recommendation.stages)map[x.requirementId]=x.providerId==='ollama-mini'?'mini':'qwen';
 await variant('k02-by-stage',map);
}else reports.push({id:'k02-by-stage',status:'NOT_RUN',
 reason:recommendation.blocked,userResultSuccessful:false,hostComputeCostUsd:null});
await variant('model-and-skill',direct,{skill:true});
await variant('model-and-cli',direct,{program:true});
await toolFirstVariant(true);
await toolFirstVariant(false);
assert.ok(counts.mini>=2 && counts.qwen>=2,'TWO_REAL_MODEL_VARIANTS_MUST_RUN');
assert.equal(reports.length,6);
assert.equal(reports.find(x=>x.id==='k02-source-skill-jq')?.userResultSuccessful,true);
assert.equal(reports.find(x=>x.id==='k02-tools-only')?.userResultSuccessful,true);
const measured={schema:'IWXA.K02.LIVE_DOCUMENT_STUDY/0.1.0',
  sourceDigest:contextDigest,modelVariants:modelArgs,calibration,
  recommendation:{decision:recommendation.decision,blocked:recommendation.blocked,
    stages:recommendation.stages,planDigest:recommendation.plan?.planDigest??null,
    hostAuthorityGranted:recommendation.hostAuthorityGranted},
  reports,modelCalls:counts,measurements,problems,
  observedResources:{availableRamBeforeMiB:startRam,availableRamAfterMiB:memAvailable(),
    loadedModels:await ps(),nodeRssMiB:Math.round(process.memoryUsage().rss/1048576),
    memoryMeaning:'MEMAVAILABLE_AND_OLLAMA_LOADED_SIZE_NOT_PEAK'},
  userResults:reports.filter(x=>x.userResultSuccessful).length,
  pricing:'LOCAL_PROVIDER_FEE_ZERO; HOST_COMPUTE_UNKNOWN',
  qualification:'OPEN_TASK_WITH_REAL_INVOKES_NOT_INSTALLED_AGENT_E2E'};
await writeFile(join(outDir,'measurements.json'),JSON.stringify(measured,null,2)+'\n','utf8');
process.stdout.write('K02_REAL_STAGE_COMPARISON '+JSON.stringify({
  models:counts,calibration:calibration.map(x=>({id:x.id,taskClass:x.taskClass,
    passed:x.passed,attempts:x.attempts,medianDurationMs:Number(x.medianDurationMs.toFixed(2))})),
  selected:recommendation.stages.map(x=>[x.requirementId,x.providerId]),
  decision:recommendation.decision,
  results:reports.map(x=>({id:x.id,status:x.status,success:x.userResultSuccessful,
    durationMs:x.durationMs,skill:x.skillVerified,jq:x.jqExecuted})),
  errors:problems.map(x=>({stage:x.phase,code:x.error})),
})+'\n');
