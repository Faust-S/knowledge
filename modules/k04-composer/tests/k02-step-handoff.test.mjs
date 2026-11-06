import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareK02StepHandoff,bindK02StepChoices,STEP_HANDOFF_VERSION} from '../k02-step-handoff.mjs';
import {createHostNeutralPlan,resolveRequiredCapabilities,ComposerError,digest} from '../index.mjs';
import {solution,sampleAvailability} from '../sample/open-host.mjs';
const reason=code=>e=>e instanceof ComposerError&&e.code===code;
const transcript=await readFile(new URL('../sample/meeting.txt',import.meta.url),'utf8');
const existingTask={taskId:'MEETING-TASK',kind:'meeting_followup',input:{transcript_text:transcript},source:{
  ref:'sample/meeting.txt',revision:'fixture-v1',rights:'AUTHOR_OWNED',authorized:true,
}};
const plan=createHostNeutralPlan({task:existingTask,solution,resolution:resolveRequiredCapabilities(solution,sampleAvailability())});
const profiles=solution.stepSelectionProfiles;
const inputs=['transcript_text'];
const preparation=(opts={})=>prepareK02StepHandoff({
  plan,profiles,availableInputs:inputs,userModelPins:{},...opts
});
const copy=x=>structuredClone(x);
const shape={type:'object',additionalProperties:false,required:['input'],properties:{input:{type:'string'}}};
const output={type:'object',additionalProperties:false,required:['content'],properties:{content:{type:'string'}}};
const req=(requirementId,kind='model')=>({requirementId,kind,capabilityId:kind==='model'?'text.generate':'code.patch',
  inputSchema:shape,outputSchema:output,effectClass:kind==='model'?'MODEL_INFERENCE':'PURE_COMPUTE',
  required:true,...(kind==='model'?{inputModes:['text'],outputModes:['text']}:{})});
const quality=(level,check)=>({level,criteria:[{id:check.toLowerCase(),check,evidenceRef:'evidence:task/criteria'}]});
const limits={maxProviderFeeUsd:null,maxLatencyMs:null,maxOutputTokens:128,localOnly:false};
const stepProfile=(stepId,kind,level,requiredInputs,requirement,extra={})=>({
  stepId,operation:{kind,purpose:'Complete the given step without creating another Task'},
  requiredInputs,complexity:{level,signals:[{kind:'TASK_STEP',evidenceRef:'task:'+stepId,detail:'Qualitative source-bound step properties'}]},
  qualityFloor:quality(level==='HIGH'?'TESTED':'BASIC',level==='HIGH'?'UNIT_TESTS':'SCHEMA_VALID'),
  resourceLimits:limits,modelRequired:requirement.kind==='model',deterministicAllowed:requirement.kind==='tool',
  preserveUserModelPin:requirement.kind==='model',
  choices:[{optionId:'choice',requirement}],...extra
});
const programmingPlan={taskRef:'CODE-TASK',steps:[
  {id:'analysis',type:'CAPABILITY_REQUEST'},
  {id:'implementation',type:'CAPABILITY_REQUEST',dependsOn:['analysis']},
  {id:'testing',type:'CAPABILITY_REQUEST',dependsOn:['implementation']},
]};
const programmingProfiles=[
  stepProfile('analysis','code.analysis','MODERATE',['requirements'],req('analyze')),
  stepProfile('implementation','code.implementation','HIGH',['requirements','repository'],req('implement')),
  stepProfile('testing','code.testing','LOW',['repository'],req('run-tests','tool')),
];

test('meeting produces two different evidence-backed step descriptions, not a model score',()=>{
  const h=preparation();
  assert.equal(h.schema,STEP_HANDOFF_VERSION);
  assert.equal(h.status,'READY_FOR_K02');
  assert.deepEqual(h.steps.map(x=>x.stepId),['extract','audit']);
  assert.deepEqual(h.steps.map(x=>x.complexity.level),['LOW','HIGH']);
  assert.deepEqual(h.steps.map(x=>x.modelRequired),[false,false]);
  assert.equal(h.steps[0].choices.length,2);
  assert.equal(h.steps[1].choices.length,1);
  assert.equal(h.steps[1].choices[0].k02Request.requirements[0].kind,'tool');
  assert.equal(h.priceRankingPerformed,false);
  assert.equal(h.qualityRankingPerformed,false);
  assert.equal(h.qualityAndResourceHintsStatus,'K02_EXTENSION_REQUIRED');
  assert.equal(h.hostAuthorizationGranted,false);
  assert.equal('confidence' in h.steps[0].complexity,false);
  assert.equal(h.steps[0].complexity.signals[0].kind,'BOUNDED_EXTRACTION');
  assert.equal(h.steps[1].complexity.signals[0].kind,'SOURCE_GROUNDING');
});
test('programming example uses three existing ordered steps with independent requirements',()=>{
  const h=prepareK02StepHandoff({plan:programmingPlan,profiles:programmingProfiles,
    availableInputs:['requirements','repository']});
  assert.equal(h.status,'READY_FOR_K02');
  assert.deepEqual(h.steps.map(x=>x.stepId),['analysis','implementation','testing']);
  assert.deepEqual(h.steps.map(x=>x.complexity.level),['MODERATE','HIGH','LOW']);
  assert.deepEqual(h.steps.map(x=>x.modelRequired),[true,true,false]);
  assert.deepEqual(h.steps.map(x=>x.choices[0].k02Request.requirements[0].kind),
    ['model','model','tool']);
  assert.notEqual(h.steps[0].choices[0].k02Request.solutionId,h.steps[1].choices[0].k02Request.solutionId);
});
test('one straightforward model call needs no Agent Solution or Skills',()=>{
  const h=prepareK02StepHandoff({plan:{taskRef:'PLAIN-001',steps:[{id:'model',type:'CAPABILITY_REQUEST'}]},
    profiles:[stepProfile('model','text.rewrite','LOW',['text'],req('rewrite'))],
    availableInputs:['text']});
  assert.equal(h.steps.length,1);
  assert.equal(h.steps[0].choices.length,1);
  assert.equal(h.steps[0].modelRequired,true);
});
test('deterministic capability is not forced into model selection',()=>{
  const h=prepareK02StepHandoff({plan:{taskRef:'STATIC-001',
    steps:[{id:'validate',type:'CAPABILITY_REQUEST'}]},
    profiles:[stepProfile('validate','code.tests','LOW',['source'],req('test','tool'))],
    availableInputs:['source']});
  assert.equal(h.steps[0].modelRequired,false);
  assert.equal(h.steps[0].choices[0].k02Request.requirements[0].kind,'tool');
});
test('insufficient source material leads to NEEDS_INPUT with no selectable K02 requests',()=>{
  const h=prepareK02StepHandoff({plan:programmingPlan,profiles:programmingProfiles,
    availableInputs:['requirements']});
  assert.equal(h.status,'NEEDS_INPUT');
  assert.deepEqual(h.steps[1].missingInputs,['repository']);
  assert.deepEqual(h.steps[2].missingInputs,['repository']);
  assert.equal(h.steps[1].choices.length,0);
  assert.throws(()=>bindK02StepChoices(h,[]),reason('K02_HANDOFF_NOT_READY'));
});
test('qualitative complexity requires evidence, never a confidence score',()=>{
  const ps=copy(profiles);
  ps[0].complexity={level:'HIGH',signals:[],confidence:0.99};
  assert.throws(()=>preparation({profiles:ps}),reason('INVALID_COMPLEXITY'));
  delete ps[0].complexity.confidence;
  assert.throws(()=>preparation({profiles:ps}),reason('COMPLEXITY_EVIDENCE_REQUIRED'));
});
test('user model pin copies into every model option, not the deterministic alternative',()=>{
  const userPin={name:'model:fixed',digest:'a'.repeat(64)};
  const h=preparation({userModelPins:{extract:userPin}});
  const model=h.steps[0].choices.find(x=>x.optionId==='model_extract');
  const tool=h.steps[0].choices.find(x=>x.optionId==='deterministic_extract');
  assert.deepEqual(model.k02Request.requirements[0].modelPin,userPin);
  assert.equal('modelPin' in tool.k02Request.requirements[0],false);
  const q=copy(h);q.steps[0].complexity.level='HIGH';
  assert.throws(()=>bindK02StepChoices(q,[]),reason('HANDOFF_CHANGED'));
  const conflict=copy(profiles);
  conflict[0].choices[1].requirement.modelPin={name:'different',digest:'f'.repeat(64)};
  assert.throws(()=>preparation({profiles:conflict,userModelPins:{extract:userPin}}),
    reason('USER_MODEL_PIN_CONFLICT'));
});
test('wrong or extra steps and unapproved source variants fail closed',()=>{
  assert.throws(()=>preparation({profiles:[profiles[0]]}),reason('STEP_COVERAGE_MISMATCH'));
  assert.throws(()=>preparation({plan:{...plan,steps:[...plan.steps,plan.steps[1]]}}),
    reason('HOST_PLAN_DIGEST_MISMATCH'));
  assert.throws(()=>preparation({userModelPins:{unknown:{name:'x',digest:'a'.repeat(64)}}}),
    reason('UNEXPECTED_USER_MODEL_PIN'));
});
test('no inference, ranking, external permissions or Graph execution occurs',()=>{
  const h=preparation({plan:copy(plan)});
  assert.equal(h.modelInvocationOccurred,false);
  assert.equal(h.hostAuthorizationGranted,false);
  assert.equal(h.evaluationOwnership,'K02');
});
