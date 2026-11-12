import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CONTRACT_VERSION,resolveRequirements} from '../index.mjs';
import {recommendTaskStages,STAGE_SELECTION_VERSION} from '../task-step-composition.mjs';
import {MODEL_INPUT,MODEL_OUTPUT} from '../adapters/ollama-local.mjs';
import {AUDIT_INPUT,AUDIT_OUTPUT} from '../adapters/node-evidence-cli.mjs';
import {CALCULATION_INPUT,CALCULATION_OUTPUT} from '../adapters/jq-calculation-cli.mjs';
import {GitCliProvider,GIT_INPUT,GIT_OUTPUT} from '../adapters/git-cli.mjs';

const pin=(name,digit)=>({name,digest:digit.repeat(64)});
const SMALL=pin('smollm2:135m-instruct-q2_K','a');
const LARGE=pin('qwen3:0.6b','b');
const M=(id,modelPin,fee,latency)=>({contractVersion:CONTRACT_VERSION,providerId:id,
  availability:'available',capabilities:[{kind:'model',capabilityId:'text.generate',supported:true,
    effectClass:'MODEL_INFERENCE',inputModes:['text'],outputModes:['text'],modelPin,
    inputSchema:MODEL_INPUT,outputSchema:MODEL_OUTPUT,providerFeeUsd:fee,latencyMsP50:latency}]});
const T=(id,capabilityId,inputSchema,outputSchema)=>({contractVersion:CONTRACT_VERSION,providerId:id,
  availability:'available',capabilities:[{kind:'tool',capabilityId,supported:true,
    effectClass:'PURE_COMPUTE',inputSchema,outputSchema,providerFeeUsd:0,latencyMsP50:null}]});
const available=[
  M('small',SMALL,0,70),M('large',LARGE,0,220),
  T('audit','evidence.exact.audit',AUDIT_INPUT,AUDIT_OUTPUT),
  T('jq','invoice.calculate',CALCULATION_INPUT,CALCULATION_OUTPUT),
];
const requirement=(requirementId,kind,capabilityId,inputSchema,outputSchema)=>({
  requirementId,kind,capabilityId,required:true,inputSchema,outputSchema,
  effectClass:kind==='model'?'MODEL_INFERENCE':'PURE_COMPUTE',
  ...(kind==='model'?{inputModes:['text'],outputModes:['text']}:{}),
});
const solution={solutionId:'document-review-report',requirements:[
  requirement('read','model','text.generate',MODEL_INPUT,MODEL_OUTPUT),
  requirement('audit','tool','evidence.exact.audit',AUDIT_INPUT,AUDIT_OUTPUT),
  requirement('calculate','tool','invoice.calculate',CALCULATION_INPUT,CALCULATION_OUTPUT),
  requirement('summarize','model','text.generate',MODEL_INPUT,MODEL_OUTPUT),
]};
const task={taskId:'document-report-task',solutionId:solution.solutionId};
const step=(taskClass,difficulty)=>({taskClass,difficulty,minObservedSuccessRate:0.8,
  minSamples:10,maxAttempts:2,maxLatencyMs:null,maxMemoryMiB:null});
const stages=[
  {stageId:'read-documents',requirementId:'read',requiredContextTokens:900,step:step('document_extraction','simple')},
  {stageId:'verify-quotes',requirementId:'audit',requiredContextTokens:900},
  {stageId:'calculate-values',requirementId:'calculate',requiredContextTokens:900},
  {stageId:'draft-file',requirementId:'summarize',requiredContextTokens:1250,step:step('final_summary','complex')},
];
const profiles=[
  {providerId:'small',modelPin:SMALL,runtimeVersion:'test-1',
    memoryMiB:300,computeUsdPerAttempt:null,costBasis:'UNKNOWN'},
  {providerId:'large',modelPin:LARGE,runtimeVersion:'test-1',
    memoryMiB:1500,computeUsdPerAttempt:null,costBasis:'UNKNOWN'},
];
const resourceProfiles=[
  {providerId:'small',modelPin:SMALL,minRamMiB:300,minVramMiB:0,
    contextWindowTokens:4096,basis:'ESTIMATED'},
  {providerId:'large',modelPin:LARGE,minRamMiB:1500,minVramMiB:0,
    contextWindowTokens:4096,basis:'ESTIMATED'},
];
const env={operatingSystem:'Ubuntu 24.04'};
const evidence=(providerId,modelPin,taskClass,difficulty,passed)=>({providerId,modelPin,
  taskClass,difficulty,operatingSystem:env.operatingSystem,runtimeVersion:'test-1',
  passed,attempts:10,proofRef:'test:sample-not-real'});
const qualityEvidence=[
  evidence('small',SMALL,'document_extraction','simple',9),
  evidence('large',LARGE,'document_extraction','simple',10),
  evidence('small',SMALL,'final_summary','complex',2),
  evidence('large',LARGE,'final_summary','complex',9),
];
const skill=JSON.parse(readFileSync(new URL('../skills/exact-source-audit.skill.json',import.meta.url)));
const budget={availableRamMiB:4096,availableVramMiB:0,
  observedAtMs:100000,maxAgeMs:10000,sourceRef:'test:host-observation'};
const options=()=>({task,solution,stages,available,profiles,qualityEvidence,environment:env,
  resourceProfiles,resourceObservation:budget,nowMs:100100,selectedSkills:[skill],
  contextBinding:{ref:'task:source-revision:1',digest:'d'.repeat(64)}});
const go=(change={})=>recommendTaskStages({...options(),...change});
const pick=(r,id)=>r.stages.find(s=>s.requirementId===id);
test('uses lightweight model for extraction, stronger observed model for final stage',()=>{
  const r=go();
  assert.equal(r.schema,STAGE_SELECTION_VERSION);
  assert.equal(r.decision,'STAGES_PROPOSED_NOT_AUTHORIZED');
  assert.equal(pick(r,'read').providerId,'small');
  assert.equal(pick(r,'summarize').providerId,'large');
  assert.equal(pick(r,'audit').providerId,'audit');
  assert.equal(pick(r,'calculate').providerId,'jq');
  assert.deepEqual(r.plan.steps.map(x=>x.requirementId),['read','audit','calculate','summarize']);
  assert.equal(r.plan.skills.length,1);
  assert.equal(r.plan.skills[0].skillId,'exact-source-audit');
});
test('unmodified baseline uses one cheap model for both steps and ignores observed poor final quality',()=>{
  const r=resolveRequirements(solution,available);
  assert.equal(r.status,'SUPPORTED');
  assert.equal(r.selected.find(x=>x.requirementId==='read').providerId,'small');
  assert.equal(r.selected.find(x=>x.requirementId==='summarize').providerId,'small');
  assert.equal(pick(go(),'summarize').providerId,'large');
});
test('incompatible Skill blocks whole multi-step recommendation rather than pretending execution',()=>{
  const bad={...skill,requiredCapabilities:['program.completely.unavailable']};
  const r=go({selectedSkills:[bad]});
  assert.equal(r.decision,'INCOMPATIBLE');
  assert.equal(r.plan,null);
  assert.equal(r.blocked.at(-1).reason,'SKILL_UNSUPPORTED_OR_UNVERIFIED');
});
test('unknown quality remains unknown and never selects an automatic model',()=>{
  const r=go({qualityEvidence:[]});
  assert.equal(r.decision,'INCOMPATIBLE');
  assert.equal(r.plan,null);
  assert.equal(pick(r,'read').decision,'QUALITY_UNKNOWN');
  assert.equal(pick(r,'summarize').decision,'QUALITY_UNKNOWN');
  assert.equal(r.resultProduced,false);
});
test('user model pin overrides cost but never creates a silent switch',()=>{
  const r=go({userModelPins:{read:LARGE}});
  assert.equal(pick(r,'read').providerId,'large');
  const bad=go({userModelPins:{summarize:SMALL}});
  assert.equal(bad.plan,null);
  assert.equal(bad.decision,'INCOMPATIBLE');
  assert.equal(pick(bad,'summarize').providerId,null);
});
test('current RAM floor rules out a larger model even if its quality is sufficient',()=>{
  const r=go({resourceObservation:{...budget,availableRamMiB:700}});
  assert.equal(r.decision,'INCOMPATIBLE');
  assert.equal(pick(r,'read').providerId,'small');
  assert.ok(pick(r,'summarize').excluded.some(x=>x.providerId==='large'&&x.reason==='RAM_INSUFFICIENT'));
});
test('VRAM unknown never assumes accelerator is available',()=>{
  const rr=resourceProfiles.map(p=>p.providerId==='large'?{...p,minVramMiB:500}:p);
  const r=go({resourceProfiles:rr,resourceObservation:{...budget,availableVramMiB:null}});
  assert.ok(pick(r,'summarize').excluded.some(x=>x.reason==='VRAM_UNKNOWN'));
  assert.equal(r.plan,null);
});
test('stale capacity reading invalidates selection without executing a provider',()=>{
  const r=go({nowMs:200000});
  assert.equal(r.resources.ageStatus,'STALE');
  assert.equal(r.decision,'INCOMPATIBLE');
  assert.ok(pick(r,'read').excluded.some(x=>x.reason==='RESOURCE_OBSERVATION_STALE'));
  assert.equal(r.plan,null);
});
test('missing host resource profile cannot be silently replaced with provider model description',()=>{
  const r=go({resourceProfiles:resourceProfiles.filter(x=>x.providerId!=='small')});
  assert.ok(pick(r,'read').excluded.some(x=>x.reason==='RESOURCE_REQUIREMENT_UNKNOWN'));
  assert.equal(pick(r,'read').providerId,'large');
});
test('host reports loss of tool capability, so whole plan is unsupported',()=>{
  const unavailable=available.map(x=>x.providerId==='jq'?{...x,availability:'unavailable',
    unavailableReason:'JQ_NOT_INSTALLED'}:x);
  const r=go({available:unavailable});
  assert.equal(r.decision,'INCOMPATIBLE');
  assert.equal(pick(r,'calculate').providerId,null);
  assert.equal(r.plan,null);
});
test('pinned tool provider is not replaced by a different installed tool',()=>{
  const altered=stages.map(x=>x.requirementId==='calculate'?{...x,providerId:'absent-tool'}:x);
  const r=go({stages:altered});
  assert.equal(r.decision,'INCOMPATIBLE');
  assert.equal(pick(r,'calculate').providerId,null);
});
test('context capacity, binding and observation are explicit and never executed or transferred',()=>{
  const r=go();
  assert.equal(r.contextBinding.transferred,false);
  assert.equal(r.modelSwitchExecuted,false);
  assert.equal(r.hostAuthorityGranted,false);
  assert.equal(r.resultProduced,false);
  assert.equal(r.taskExecuted,false);
  assert.equal(r.executionAuthority,'P01_ONLY');
  assert.ok(r.stages.every(x=>x.contextDigest==='d'.repeat(64)));
  assert.ok(r.plan.steps.every(x=>x.invocationAuthority==='HOST_ONLY'&&x.proofOfInvoke===null));
  const tooLong=go({stages:stages.map(x=>x.requirementId==='read'?{...x,requiredContextTokens:6000}:x)});
  assert.ok(pick(tooLong,'read').excluded.some(x=>x.reason==='CONTEXT_CAPACITY_INSUFFICIENT'));
});
test('changed resource model pin is detected before quality evidence evaluation',()=>{
  const r=go({resourceProfiles:resourceProfiles.map(x=>x.providerId==='small'?
    {...x,modelPin:LARGE}:x)});
  assert.ok(pick(r,'read').excluded.some(x=>x.reason==='RESOURCE_BINDING_CHANGED'));
});
test('incompatible operating-system quality trials do not become qualified models',()=>{
  const r=go({environment:{operatingSystem:'Windows 11'}});
  assert.equal(pick(r,'read').decision,'QUALITY_UNKNOWN');
  assert.equal(r.plan,null);
});
test('resource data and context from host are not host grants or measured prices',()=>{
  const r=go();
  assert.equal(r.plan.estimates.hostComputeCostUsd,null);
  assert.equal(r.resources.resourceCost,'OBSERVED_AVAILABLE_NOT_RESERVED');
  assert.match(r.recommendationDigest,/^[a-f0-9]{64}$/);
  assert.equal(pick(r,'summarize').quality.qualification,'OBSERVED_SAMPLE_NOT_FUTURE_SUCCESS_GUARANTEE');
});

test('real Git CLI source read must use HOST_AUTHORIZED_READ, never PURE_COMPUTE',async t=>{
  const git=new GitCliProvider(process.cwd());
  const desc=await git.describeCapabilities();
  if(desc.availability!=='available'){t.diagnostic('GIT_UNAVAILABLE:NOT_RUN');return;}
  const correct={solutionId:'source-tool-step',requirements:[{
    requirementId:'source',kind:'tool',capabilityId:'source.git.show',
    inputSchema:GIT_INPUT,outputSchema:GIT_OUTPUT,effectClass:'HOST_AUTHORIZED_READ',required:true,
  }]};
  const wrong={...correct,requirements:[{...correct.requirements[0],effectClass:'PURE_COMPUTE'}]};
  assert.equal(resolveRequirements(wrong,[desc]).missing[0].reason,'EFFECT_MISMATCH');
  assert.equal(resolveRequirements(correct,[desc]).status,'SUPPORTED');
  const r=recommendTaskStages({task:{taskId:'real-tool-scope',solutionId:correct.solutionId},
    solution:correct,stages:[{stageId:'read-source',requirementId:'source',
      requiredContextTokens:100}],available:[desc],profiles:[],qualityEvidence:[],
    environment:env,nowMs:100100,selectedSkills:[],resourceProfiles:[],
    resourceObservation:null,contextBinding:{ref:'public-source',digest:'f'.repeat(64)}});
  assert.equal(r.decision,'STAGES_PROPOSED_NOT_AUTHORIZED');
  assert.equal(r.plan.steps[0].effectClass,'HOST_AUTHORIZED_READ');
  assert.equal(r.hostAuthorityGranted,false);
});

test('missing required K04 step never generates a partial approved-looking Task plan',()=>{
  const r=go({stages:stages.filter(x=>x.requirementId!=='calculate')});
  assert.equal(r.decision,'INCOMPATIBLE');
  assert.equal(r.plan,null);
  assert.ok(r.blocked.some(x=>x.requirementId==='calculate'&&x.reason==='REQUIRED_STAGE_MISSING'));
  assert.equal(r.hostAuthorityGranted,false);
});
test('an omitted optional K04 step stays optional and does not require a Graph rewrite',()=>{
  const alternative={...solution,requirements:solution.requirements.map(r=>
    r.requirementId==='calculate'?{...r,required:false}:r)};
  const remaining=stages.filter(x=>x.requirementId!=='calculate');
  const r=go({solution:alternative,stages:remaining});
  assert.equal(r.decision,'STAGES_PROPOSED_NOT_AUTHORIZED');
  assert.equal(r.plan.steps.length,3);
  assert.ok(r.plan.steps.every(x=>x.requirementId!=='calculate'));
  assert.equal(r.taskExecuted,false);
});
test('duplicate stage ids and unknown user model pins fail before producing any execution plan',()=>{
  const alias=stages.map(x=>({...x}));
  alias[1].stageId=alias[0].stageId;
  assert.throws(()=>go({stages:alias}),/INVALID_STAGE_SELECTION/);
  assert.throws(()=>go({userModelPins:{unknownStage:SMALL}}),/INVALID_STAGE_SELECTION/);
  assert.throws(()=>go({userModelPins:{calculate:SMALL}}),/INVALID_STAGE_SELECTION/);
});
test('duplicate declared requirements cannot be hidden by omitting one occurrence',()=>{
  const duplicated={...solution,requirements:[...solution.requirements,solution.requirements[2]]};
  assert.throws(()=>go({solution:duplicated}),/INVALID_STAGE_SELECTION/);
});
