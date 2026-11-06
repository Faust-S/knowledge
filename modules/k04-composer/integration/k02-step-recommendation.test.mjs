import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ComposerError} from '../index.mjs';
import {prepareK02StepHandoff} from '../k02-step-handoff.mjs';
import {prepareK02ModelStepRequest,bindK02RecommendedStepChoices,
  STEP_MODEL_BRIDGE_VERSION, STEP_MODEL_BINDING_VERSION} from '../k02-model-step-bridge.mjs';
import {solution} from '../sample/open-host.mjs';
import {CONTRACT_VERSION,resolveRequirements,buildInvocationPlan} from
  '../../../.k02-peer/modules/k02-interoperability/index.mjs';
import {recommendModelForStep,STEP_MODEL_RECOMMENDATION_VERSION} from
  '../../../.k02-peer/modules/k02-interoperability/model-step-selection.mjs';
const transcript=await readFile(new URL('../sample/meeting.txt',import.meta.url),'utf8');
const clone=x=>structuredClone(x);
const error=code=>x=>x instanceof ComposerError&&x.code===code;
const A={name:'small-local',digest:'a'.repeat(64)};
const B={name:'large-local',digest:'b'.repeat(64)};
const policy={policyRef:'owner:quality-policy-v1',minObservedSuccessRate:0.8,
  minSamples:10,maxAttempts:2,maxMemoryMiB:null,maxLatencyMs:null};
const environment={operatingSystem:'Windows 11'};
const manifest=solution;
function meeting(pin=null) {
  return prepareK02StepHandoff({plan:{taskRef:'TASK-MEETING',
    steps:[{id:'extract',type:'CAPABILITY_REQUEST'}, {id:'audit',type:'CAPABILITY_REQUEST'}]},
    profiles:manifest.stepSelectionProfiles,availableInputs:['transcript_text'],
    userModelPins:pin?{extract:pin}:{}});
}
function descriptor(req,id,modelPin,fee=0.001) {
  return {contractVersion:CONTRACT_VERSION,providerId:id,availability:'available',
    capabilities:[{kind:'model',capabilityId:req.capabilityId,supported:true,
      inputSchema:req.inputSchema,outputSchema:req.outputSchema,effectClass:req.effectClass,
      inputModes:['text'],outputModes:['text'],modelPin,providerFeeUsd:fee,latencyMsP50:100}]};
}
function toolDescriptor(req,id) {
  return {contractVersion:CONTRACT_VERSION,providerId:id,availability:'available',
    capabilities:[{kind:'tool',capabilityId:req.capabilityId,supported:true,
      inputSchema:req.inputSchema,outputSchema:req.outputSchema,effectClass:req.effectClass,
      providerFeeUsd:0,latencyMsP50:5}]};
}
const runtimeProfile=(providerId,modelPin,cost=0.002)=>({
  providerId,modelPin,runtimeVersion:'1.0',memoryMiB:512,
  computeUsdPerAttempt:cost,costBasis:'ESTIMATED'});
const observation=(providerId,modelPin,passed=19,kind='meeting.action_extraction',difficulty='simple')=>({
  providerId,modelPin,taskClass:kind,difficulty,operatingSystem:environment.operatingSystem,
  runtimeVersion:'1.0',passed,attempts:20,proofRef:'test:synthetic-observed-meeting'});
function modelDecision(hand, optionId='model_extract', pinned=null) {
  const request=prepareK02ModelStepRequest(hand,{stepId:'extract',optionId,policy,environment});
  const req=request.k02Arguments.solution.requirements[0];
  const providers=[descriptor(req,'small',A),descriptor(req,'large',B,0.02)];
  const evidence=[observation('small',A,16),observation('large',B,19)];
  const recommendation=recommendModelForStep({
    ...request.k02Arguments,available:providers,
    profiles:[runtimeProfile('small',A),runtimeProfile('large',B)],
    qualityEvidence:evidence});
  const selected=recommendation.selected;
  if(!selected)return {request,recommendation,decision:null};
  const picked=providers.filter(p=>p.providerId===selected.providerId);
  const resolution=resolveRequirements(request.k02Arguments.solution,picked);
  const invocationPlan=buildInvocationPlan({taskId:'TASK-MEETING',
    solutionId:resolution.solutionId},[],resolution);
  return {request,recommendation,decision:{
    stepId:'extract',optionId,resolution,invocationPlan}};
}
function auditDecision(hand) {
  const step=hand.steps.find(s=>s.stepId==='audit'), optionId='deterministic_audit';
  const req=step.choices[0].k02Request;
  const resolution=resolveRequirements(req,[toolDescriptor(req.requirements[0],'audit-cli')]);
  const invocationPlan=buildInvocationPlan({taskId:'TASK-MEETING',solutionId:resolution.solutionId},[],resolution);
  return {stepId:'audit',optionId,resolution,invocationPlan};
}
test('K04 maps qualitative difficulty only and leaves the numerical policy with the host',()=>{
  const hand=meeting();
  const request=prepareK02ModelStepRequest(hand,{stepId:'extract',optionId:'model_extract',policy,environment});
  assert.equal(request.schema,STEP_MODEL_BRIDGE_VERSION);
  assert.equal(request.k02RecommendationVersion,STEP_MODEL_RECOMMENDATION_VERSION);
  assert.equal(request.k02Arguments.step.difficulty,'simple');
  assert.equal(request.k02Arguments.step.taskClass,'meeting.action_extraction');
  assert.equal(request.k02Arguments.step.minObservedSuccessRate,policy.minObservedSuccessRate);
  assert.equal(request.sourcePolicyRef,policy.policyRef);
  assert.deepEqual(request.hostConditionsRemaining.qualitativeCriteria,hand.steps[0].qualityFloor.criteria);
  assert.equal('confidence' in request.k02Arguments.step,false);
  assert.equal(request.hostAuthorizesExecution,false);
});
test('real K02 independently recommends an observed compatible model and retains host gates',()=>{
  const hand=meeting(), model=modelDecision(hand);
  assert.equal(model.recommendation.decision,'RECOMMENDED_NOT_AUTHORIZED');
  assert.equal(model.recommendation.selected.providerId,'small');
  const binding=bindK02RecommendedStepChoices(hand,[model.decision,auditDecision(hand)],[
    {request:model.request,recommendation:model.recommendation}]);
  assert.equal(binding.schema,STEP_MODEL_BINDING_VERSION);
  assert.equal(binding.steps[0].selected.providerId,'small');
  assert.equal(binding.modelQualityObservations[0].observedQualityProofRef,
    'test:synthetic-observed-meeting');
  assert.equal(binding.actualTaskQualityVerified,false);
  assert.equal(binding.hostAuthorityGranted,false);
  assert.equal(binding.executionState,'NOT_INVOKED');
});
test('per-task pin is retained and K02 cannot silently select another model',()=>{
  const hand=meeting(B), model=modelDecision(hand);
  assert.equal(model.recommendation.selected.providerId,'large');
  const binding=bindK02RecommendedStepChoices(hand,[model.decision,auditDecision(hand)],[
    {request:model.request,recommendation:model.recommendation}]);
  assert.deepEqual(binding.steps[0].selected.modelPin,B);
  assert.deepEqual(binding.modelQualityObservations[0].modelPin,B);
});
test('K02 unknown quality is never promoted by a K04 bridge',()=>{
  const hand=meeting(), model=modelDecision(hand);
  const bad=clone(model.recommendation);
  bad.decision='QUALITY_UNKNOWN';
  bad.selected=null;
  assert.throws(()=>bindK02RecommendedStepChoices(hand,[model.decision,auditDecision(hand)],[
    {request:model.request,recommendation:bad}]),error('K02_RECOMMENDATION_NOT_QUALIFIED'));
  const unsupported=clone(model.recommendation);
  unsupported.selected.quality.status='UNKNOWN';
  assert.throws(()=>bindK02RecommendedStepChoices(hand,[model.decision,auditDecision(hand)],[
    {request:model.request,recommendation:unsupported}]),error('K02_RECOMMENDATION_NOT_QUALIFIED'));
});
test('model recommendation mismatch and changed request fail closed',()=>{
  const hand=meeting(),model=modelDecision(hand);
  const wrong=clone(model.recommendation);
  wrong.selected.providerId='large';
  assert.throws(()=>bindK02RecommendedStepChoices(hand,[model.decision,auditDecision(hand)],[
    {request:model.request,recommendation:wrong}]),error('K02_RECOMMENDATION_SELECTION_MISMATCH'));
  const altered=clone(model.request);
  altered.k02Arguments.step.difficulty='complex';
  assert.throws(()=>bindK02RecommendedStepChoices(hand,[model.decision,auditDecision(hand)],[
    {request:altered,recommendation:model.recommendation}]),error('MODEL_STEP_REQUEST_CHANGED'));
});
test('lack of matching model recommendations is not silently bypassed',()=>{
  const hand=meeting(),model=modelDecision(hand);
  assert.throws(()=>bindK02RecommendedStepChoices(hand,[model.decision,auditDecision(hand)],[]),
    error('MODEL_RECOMMENDATION_PROOFS_REQUIRED'));
});
test('unsupported difficulty and missing explicit host policy must not synthesize numbers',()=>{
  const hand=meeting(),bad=clone(hand);
  bad.steps[0].complexity.level='UNDETERMINED';
  const {handoffDigest,...rest}=bad;
  // Corrupted handoff must be detected even before undecided difficulty.
  assert.throws(()=>prepareK02ModelStepRequest(bad,{stepId:'extract',
    optionId:'model_extract',policy,environment}),error('STEP_HANDOFF_CHANGED'));
  assert.throws(()=>prepareK02ModelStepRequest(hand,{stepId:'extract',
    optionId:'model_extract',policy:{...policy,minObservedSuccessRate:1.2},environment}),
    error('K02_QUALITY_POLICY_REQUIRED'));
  assert.throws(()=>prepareK02ModelStepRequest(hand,{stepId:'extract',
    optionId:'model_extract',policy:undefined,environment}),error('K02_QUALITY_POLICY_REQUIRED'));
});
test('deterministic audit remains direct tool selection without model recommendation',()=>{
  const hand=meeting();
  const extract=hand.steps[0].choices.find(c=>c.optionId==='deterministic_extract');
  const req=extract.k02Request;
  const resolution=resolveRequirements(req,[toolDescriptor(req.requirements[0],'rule-cli')]);
  const invocationPlan=buildInvocationPlan({taskId:'TASK-MEETING',solutionId:resolution.solutionId},[],resolution);
  const binding=bindK02RecommendedStepChoices(hand,[
    {stepId:'extract',optionId:'deterministic_extract',resolution,invocationPlan},
    auditDecision(hand)],[]);
  assert.equal(binding.modelQualityObservations.length,0);
  assert.equal(binding.steps[0].selected.kind,'tool');
});
test('pure model request is opt-in, not a new mandatory dependency for regular Task',()=>{
  assert.equal(typeof prepareK02ModelStepRequest,'function');
  assert.equal(typeof bindK02RecommendedStepChoices,'function');
  assert.equal(manifest.qualification.iwxaVerified,false);
});
