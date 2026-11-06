import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  CONTRACT_VERSION as K02_VERSION, resolveRequirements as k02Resolve,
  buildInvocationPlan as k02Plan, verifyInvocationReadiness as k02Ready,
  InteropError,
} from '../../../.k02-peer/modules/k02-interoperability/index.mjs';
import {prepareK02StepHandoff,bindK02StepChoices} from '../k02-step-handoff.mjs';
import {ComposerError} from '../index.mjs';
import {solution} from '../sample/open-host.mjs';

const meetingText=await readFile(new URL('../sample/meeting.txt',import.meta.url),'utf8');
const pinA={name:'local-small:stable',digest:'a'.repeat(64)};
const pinB={name:'local-large:stable',digest:'b'.repeat(64)};
const clone=x=>structuredClone(x);
const profile=(id,kind,req,complexity='LOW',additional={})=>({
  stepId:id,operation:{kind,purpose:'Resolve capability for an existing host step'},
  requiredInputs:['source'],complexity:{level:complexity,signals:[{
    kind:'STEP_REQUIREMENT',evidenceRef:'fixture:source',detail:'Grounded in the accepted step requirements',
  }]},
  qualityFloor:{level:'TESTED',criteria:[{id:'check',check:'UNIT_TESTS',evidenceRef:'fixture:expected-test'}]},
  resourceLimits:{maxProviderFeeUsd:null,maxLatencyMs:null,maxOutputTokens:null,localOnly:false},
  modelRequired:req.kind==='model',deterministicAllowed:req.kind==='tool',
  preserveUserModelPin:req.kind==='model',
  choices:[{optionId:'default',requirement:req}],...additional
});
const makeModel=(req,id,pin,cost=0)=>({
  contractVersion:K02_VERSION,providerId:id,availability:'available',
  capabilities:[{
    kind:'model',capabilityId:req.capabilityId,supported:true,
    inputSchema:req.inputSchema,outputSchema:req.outputSchema,
    effectClass:req.effectClass,providerFeeUsd:cost,latencyMsP50:100,
    inputModes:['text'],outputModes:['text'],modelPin:pin,
  }],
});
const makeTool=(req,id,cost=0)=>({
  contractVersion:K02_VERSION,providerId:id,availability:'available',
  capabilities:[{
    kind:'tool',capabilityId:req.capabilityId,supported:true,
    inputSchema:req.inputSchema,outputSchema:req.outputSchema,
    effectClass:req.effectClass,providerFeeUsd:cost,latencyMsP50:10,
  }],
});
function resolveChoice(step,optionId,providers) {
  const choice=step.choices.find(c=>c.optionId===optionId);
  const resolution=k02Resolve(choice.k02Request,providers);
  if(resolution.status!=='SUPPORTED') return {resolution,choice};
  const invocationPlan=k02Plan({taskId:'TEST-'+step.stepId,solutionId:choice.k02Request.solutionId},[],resolution);
  return {stepId:step.stepId,optionId,resolution,invocationPlan,choice};
}
const failure=code=>err=>err instanceof ComposerError&&err.code===code;

test('meeting: real K02 selects model for extraction and deterministic source audit for separate steps',()=>{
  const reqs=solution.requires;
  const plan={taskRef:'MEETING-REAL-K02',steps:[
    {id:'extract',type:'CAPABILITY_REQUEST'}, {id:'audit',type:'CAPABILITY_REQUEST'},
  ]};
  const profiles=solution.stepSelectionProfiles;
  const handoff=prepareK02StepHandoff({plan,profiles,availableInputs:['transcript_text'],
    userModelPins:{extract:pinB}});
  assert.equal(handoff.status,'READY_FOR_K02');
  const extract=handoff.steps[0];
  const requested=extract.choices.find(c=>c.optionId==='model_extract').k02Request.requirements[0];
  const d1=makeModel(requested,'model-cheap-wrong',pinA,0);
  const d2=makeModel(requested,'model-correct',pinB,0.02);
  const extracted=resolveChoice(extract,'model_extract',[d1,d2]);
  assert.equal(extracted.resolution.status,'SUPPORTED');
  assert.equal(extracted.resolution.selected[0].providerId,'model-correct');
  const audit=handoff.steps[1];
  const audited=resolveChoice(audit,'deterministic_audit',[
    makeTool(audit.choices[0].k02Request.requirements[0],'exact-source-cli'),
  ]);
  const bound=bindK02StepChoices(handoff,[extracted,audited]);
  assert.equal(bound.steps.length,2);
  assert.equal(bound.steps[0].selected.providerId,'model-correct');
  assert.equal(bound.steps[1].selected.kind,'tool');
  assert.equal(bound.hostAuthorizationGranted,false);
  assert.equal(bound.modelInvocationOccurred,false);
  assert.equal(bound.qualityVerified,false);
  assert.notEqual(bound.steps[0].k02PlanDigest,bound.steps[1].k02PlanDigest);
});

test('meeting: deterministic extraction without a model remains available and separate',()=>{
  const h=prepareK02StepHandoff({plan:{taskRef:'MEET-RULE',steps:[
    {id:'extract',type:'CAPABILITY_REQUEST'}, {id:'audit',type:'CAPABILITY_REQUEST'},
  ]},profiles:solution.stepSelectionProfiles,availableInputs:['transcript_text']});
  const decisions=h.steps.map(s=>{
    const optionId=s.stepId==='extract'?'deterministic_extract':'deterministic_audit';
    const q=s.choices.find(x=>x.optionId===optionId).k02Request.requirements[0];
    return resolveChoice(s,optionId,[makeTool(q,'cli-'+s.stepId)]);
  });
  const b=bindK02StepChoices(h,decisions);
  assert.ok(b.steps.every(s=>s.selected.kind==='tool'));
});

test('programming: independent K02 plans for analysis, implementation and deterministic tests',()=>{
  const model=solution.requires.alternatives[1];
  const tool=solution.requires.fixed[0];
  const steps=[
    {id:'analysis',type:'CAPABILITY_REQUEST'},
    {id:'implementation',type:'CAPABILITY_REQUEST'},
    {id:'tests',type:'CAPABILITY_REQUEST'},
  ];
  const profiles=[
    profile('analysis','code.analysis',{...clone(model),requirementId:'analysis'},'MODERATE'),
    profile('implementation','code.patch',{...clone(model),requirementId:'implementation'},'HIGH'),
    profile('tests','code.tests',{...clone(tool),requirementId:'tests'},'LOW'),
  ];
  const handoff=prepareK02StepHandoff({
    plan:{taskRef:'CODE-REAL-K02',steps},profiles,availableInputs:['source'],
    userModelPins:{implementation:pinB},
  });
  const decisions=handoff.steps.map((step,i)=>{
    const q=step.choices[0].k02Request.requirements[0];
    return resolveChoice(step,'default',i===2?
      [makeTool(q,'test-runner')]:
      [makeModel(q,'local-small',pinA,0),makeModel(q,'local-large',pinB,0.2)]);
  });
  const bound=bindK02StepChoices(handoff,decisions);
  assert.deepEqual(bound.steps.map(s=>s.selected.providerId),
    ['local-small','local-large','test-runner']);
  assert.deepEqual(bound.steps.map(s=>s.selected.kind),['model','model','tool']);
  assert.equal(bound.hostAuthorizationGranted,false);
});

test('one unbound plain-model task uses real K02 without any Agent Solution',()=>{
  const r={...clone(solution.requires.alternatives[1]),requirementId:'simple'};
  const handoff=prepareK02StepHandoff({
    plan:{taskRef:'PLAIN-MODEL',steps:[{id:'generate',type:'CAPABILITY_REQUEST'}]},
    profiles:[profile('generate','text.generate',r)],availableInputs:['source'],
  });
  const choice=resolveChoice(handoff.steps[0],'default',[makeModel(r,'single-local',pinA)]);
  assert.equal(bindK02StepChoices(handoff,[choice]).steps.length,1);
});

test('K02 no compatible model is NOT an acceptable binding',()=>{
  const req={...clone(solution.requires.alternatives[1]),requirementId:'pinned'};
  const h=prepareK02StepHandoff({plan:{taskRef:'NO-MODEL',
    steps:[{id:'generate',type:'CAPABILITY_REQUEST'}]},
    profiles:[profile('generate','generate',req)],availableInputs:['source'],
    userModelPins:{generate:pinB}});
  const d=resolveChoice(h.steps[0],'default',[makeModel(req,'wrong',pinA)]);
  assert.equal(d.resolution.status,'UNSUPPORTED');
  assert.throws(()=>bindK02StepChoices(h,[{...d,stepId:'generate',optionId:'default'}]),
    failure('K02_SELECTION_INVALID'));
});

test('changes after K02 planning fail the existing readiness contract before invocation',async()=>{
  const req={...clone(solution.requires.alternatives[1]),requirementId:'pin'};
  const h=prepareK02StepHandoff({plan:{taskRef:'PIN-READINESS',
    steps:[{id:'generate',type:'CAPABILITY_REQUEST'}]},
    profiles:[profile('generate','generate',req)],availableInputs:['source'],
    userModelPins:{generate:pinB}});
  const currentReq=h.steps[0].choices[0].k02Request.requirements[0];
  const first=makeModel(currentReq,'chosen',pinB);
  const d=resolveChoice(h.steps[0],'default',[first]);
  bindK02StepChoices(h,[d]);
  const changed=makeModel(currentReq,'chosen',pinA);
  await assert.rejects(k02Ready(d.invocationPlan,currentReq.requirementId,
    {describeCapabilities:async()=>changed},d.invocationPlan.planDigest),
    err=>err instanceof InteropError&&err.code==='BINDING_CHANGED');
});

test('budget violation and unknown measured cost fail closed after K02 selection',()=>{
  const q={...clone(solution.requires.fixed[0]),requirementId:'audit-budget'};
  const p=profile('audit','audit',q,'HIGH',{resourceLimits:{
    maxProviderFeeUsd:0,maxLatencyMs:null,maxOutputTokens:null,localOnly:true,
  }});
  const h=prepareK02StepHandoff({plan:{taskRef:'BUDGET',
    steps:[{id:'audit',type:'CAPABILITY_REQUEST'}]},profiles:[p],availableInputs:['source']});
  const d=resolveChoice(h.steps[0],'default',[makeTool(q,'paid-tool',0.1)]);
  assert.throws(()=>bindK02StepChoices(h,[d]),failure('RESOURCE_COST_EXCEEDED'));
  const unknown=makeTool(q,'unknown-fee');
  unknown.capabilities[0].providerFeeUsd=null;
  const u=resolveChoice(h.steps[0],'default',[unknown]);
  assert.throws(()=>bindK02StepChoices(h,[u]),failure('RESOURCE_COST_NOT_MEASURED'));
});

test('tampered K02 invocation plan digest and provider substitution are rejected',()=>{
  const req={...clone(solution.requires.alternatives[1]),requirementId:'one'};
  const h=prepareK02StepHandoff({plan:{taskRef:'TAMPER',
    steps:[{id:'generate',type:'CAPABILITY_REQUEST'}]},
    profiles:[profile('generate','generate',req)],availableInputs:['source']});
  const choice=resolveChoice(h.steps[0],'default',[makeModel(req,'model-a',pinA)]);
  const a=clone(choice); a.invocationPlan.planDigest='0'.repeat(64);
  assert.throws(()=>bindK02StepChoices(h,[a]),failure('K02_PLAN_DIGEST_MISMATCH'));
  const b=clone(choice); b.invocationPlan.steps[0].providerId='impostor';
  assert.throws(()=>bindK02StepChoices(h,[b]),failure('K02_PLAN_DIGEST_MISMATCH'));
});
