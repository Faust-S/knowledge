import test from 'node:test';
import assert from 'node:assert/strict';
import {CONTRACT_VERSION,digest} from '../index.mjs';
import {MODEL_INPUT,MODEL_OUTPUT} from '../adapters/ollama-local.mjs';
import {recommendTaskStages} from '../task-step-composition.mjs';
import {inspectAgent05ModelStep,AGENT05_MODEL_STAGE_HANDOFF_VERSION} from '../agent05-model-stage-handoff.mjs';

const PIN={name:'local-model-one:latest',digest:'a'.repeat(64)};
const RESOURCE_TIME=1000;
const selectedDescriptor=(providerId='OLLAMA_LOCAL_V1')=>({
 contractVersion:CONTRACT_VERSION,providerId,availability:'available',
 capabilities:[{kind:'model',capabilityId:'text.generate',
  supported:true,inputSchema:MODEL_INPUT,outputSchema:MODEL_OUTPUT,
  effectClass:'MODEL_INFERENCE',providerFeeUsd:0,latencyMsP50:40,
  inputModes:['text'],outputModes:['text'],modelPin:PIN}],
});
const requirement={requirementId:'compose',kind:'model',capabilityId:'text.generate',
  required:true,inputSchema:MODEL_INPUT,outputSchema:MODEL_OUTPUT,
  effectClass:'MODEL_INFERENCE',inputModes:['text'],outputModes:['text']};
const solution={solutionId:'p01-task-stage',requirements:[requirement]};
const context={ref:'task:verified-context',digest:'c'.repeat(64)};
const stage={stageId:'write-report',requirementId:'compose',requiredContextTokens:1000,
 step:{taskClass:'document_report',difficulty:'moderate',minObservedSuccessRate:0.8,
  minSamples:10,maxAttempts:1,maxLatencyMs:null,maxMemoryMiB:null}};
function select({providerId='OLLAMA_LOCAL_V1',quality=true}={}){
  return recommendTaskStages({
    task:{taskId:'TASK-WORK-05',solutionId:solution.solutionId},solution,
    stages:[stage],available:[selectedDescriptor(providerId)],
    profiles:[{providerId,modelPin:PIN,runtimeVersion:'native-1',
      memoryMiB:750,computeUsdPerAttempt:null,costBasis:'UNKNOWN'}],
    qualityEvidence:quality?[{providerId,modelPin:PIN,taskClass:'document_report',
      difficulty:'moderate',operatingSystem:'Windows 11',runtimeVersion:'native-1',
      attempts:10,passed:9,proofRef:'test:artificial-quality-not-measurement'}]:[],
    resourceProfiles:[{providerId,modelPin:PIN,minRamMiB:750,
      minVramMiB:0,contextWindowTokens:4096,basis:'ESTIMATED'}],
    resourceObservation:{availableRamMiB:3000,availableVramMiB:null,
      observedAtMs:RESOURCE_TIME,maxAgeMs:1000,sourceRef:'test:host-memory'},
    nowMs:RESOURCE_TIME+1,selectedSkills:[],
    environment:{operatingSystem:'Windows 11'},contextBinding:context,
  });
}
const binding={providerId:'OLLAMA_LOCAL_V1',bindingDigest:'current-native-binding-v1'};
const localState={source_confirmed:true,daemon_ready:true,
  local_models:[{name:PIN.name,digest:PIN.digest,size:700000000}]};
function observe(plan=select(),overrides={}){
  return inspectAgent05ModelStep({
    recommendation:plan,trustedRecommendationDigest:plan.recommendationDigest,
    trustedPlanDigest:plan.plan?.planDigest??'0'.repeat(64),
    taskId:'TASK-WORK-05',requirementId:'compose',expectedContextBinding:context,
    activeBinding:binding,trustedNativeBindingDigest:binding.bindingDigest,
    localAiSetup:localState,nowMs:RESOURCE_TIME+20,...overrides,
  });
}
test('current configured Agent 0.5 Ollama model pin maps to P01 without any native execution',()=>{
 const plan=select();
 assert.equal(plan.decision,'STAGES_PROPOSED_NOT_AUTHORIZED');
 const observed=observe(plan);
 assert.equal(observed.schema,AGENT05_MODEL_STAGE_HANDOFF_VERSION);
 assert.equal(observed.status,'MODEL_STEP_MATCHED_P01_ATTESTATION_REQUIRED');
 assert.deepEqual(observed.modelPin,PIN);
 assert.equal(observed.providerId,'OLLAMA_LOCAL_V1');
 assert.equal(observed.hostAuthorityGranted,false);
 assert.equal(observed.nativeBindingVerified,false);
 assert.equal(observed.ownerReceiptsVerified,false);
 assert.equal(observed.modelInvoked,false);
 assert.equal(observed.resultProduced,false);
 assert.ok(observed.needs.includes('P01_K02_K04_OWNER_RECEIPT_VALIDATION'));
});
test('Agent 0.5 configured Ollama outage never falls back to unrelated default port',()=>{
 const bad={...localState,source_confirmed:true,daemon_ready:false};
 assert.equal(observe(select(),{localAiSetup:bad}).reason,'OLLAMA_CONFIGURED_SOURCE_NOT_READY');
 const unconfigured={source_confirmed:false,daemon_ready:true,
  local_models:localState.local_models};
 assert.equal(observe(select(),{localAiSetup:unconfigured}).reason,'OLLAMA_CONFIGURED_SOURCE_NOT_READY');
});
test('exact local model digest and identity must match Core inventory',()=>{
 const swapped={...localState,local_models:[{name:PIN.name,digest:'b'.repeat(64)}]};
 assert.equal(observe(select(),{localAiSetup:swapped}).reason,'OLLAMA_MODEL_DIGEST_OR_SOURCE_CHANGED');
 assert.equal(observe(select(),{localAiSetup:{...localState,local_models:[]}}).reason,
   'OLLAMA_MODEL_MISSING_OR_AMBIGUOUS');
 const duplicate={...localState,local_models:[...localState.local_models,...localState.local_models]};
 assert.equal(observe(select(),{localAiSetup:duplicate}).reason,'OLLAMA_MODEL_MISSING_OR_AMBIGUOUS');
 const remote={...localState,local_models:[{...localState.local_models[0],remote_host:'remote'}]};
 assert.equal(observe(select(),{localAiSetup:remote}).reason,'OLLAMA_MODEL_DIGEST_OR_SOURCE_CHANGED');
});
test('fresh actual native provider and binding are required before a model may be proposed',()=>{
 const p=select();
 assert.equal(observe(p,{activeBinding:{...binding,bindingDigest:'changed'}}).reason,
   'NATIVE_BINDING_CHANGED');
 assert.equal(observe(p,{activeBinding:{...binding,providerId:'IWXA_BASIC_RUNTIME_V1'}}).reason,
   'NATIVE_PROVIDER_ID_MISMATCH');
 const alias=select({providerId:'temporary-ollama-alias'});
 assert.equal(observe(alias).reason,'NATIVE_PROVIDER_ID_MISMATCH');
});
test('IWXA Basic Runtime can only recommend its currently active exact selected model',()=>{
 const p=select({providerId:'IWXA_BASIC_RUNTIME_V1'});
 const status={pin:PIN,active:true,ready:true,component_verified:true};
 const active={providerId:'IWXA_BASIC_RUNTIME_V1',bindingDigest:binding.bindingDigest};
 assert.equal(observe(p,{activeBinding:active,basicModelStatus:status,localAiSetup:null}).status,
   'MODEL_STEP_MATCHED_P01_ATTESTATION_REQUIRED');
 assert.equal(observe(p,{activeBinding:active,basicModelStatus:{...status,ready:false}}).reason,
   'BASIC_MODEL_NOT_READY');
 assert.equal(observe(p,{activeBinding:active,basicModelStatus:{...status,
   pin:{...PIN,digest:'b'.repeat(64)}}}).reason,'BASIC_MODEL_PIN_CHANGED');
});
test('model suggestion never transfers context or accepts stale resource evidence',()=>{
 const p=select();
 assert.equal(observe(p,{expectedContextBinding:{...context,digest:'0'.repeat(64)}}).reason,
   'CONTEXT_BINDING_CHANGED');
 assert.equal(observe(p,{nowMs:RESOURCE_TIME+1001}).reason,
   'RESOURCE_OBSERVATION_STALE_OR_UNAVAILABLE');
 assert.equal(p.contextBinding.transferred,false);
});
test('plan and recommendation digests are independently trusted and immutable',()=>{
 const p=select();
 const forged=structuredClone(p);forged.stages[0].providerId='another';
 assert.throws(()=>observe(forged),/INVALID_AGENT05_HANDOFF/);
 const forgedPlan=structuredClone(p);forgedPlan.plan.steps[0].providerId='some-other';
 // An attacker can rehash the recommendation; the host still holds its old
 // external expected digests and must refuse the altered plan.
 const oldPlanDigest=forgedPlan.plan.planDigest;
 const unsigned={...forgedPlan.plan};delete unsigned.planDigest;
 forgedPlan.plan.planDigest=digest(unsigned);
 const recBody={...forgedPlan};delete recBody.recommendationDigest;
 forgedPlan.recommendationDigest=digest(recBody);
 assert.notEqual(oldPlanDigest,forgedPlan.plan.planDigest);
 assert.throws(()=>observe(forgedPlan,{
   trustedRecommendationDigest:p.recommendationDigest,trustedPlanDigest:oldPlanDigest,
 }),/INVALID_AGENT05_HANDOFF/);
});
test('unknown quality and a partial Task can never become native ready model plan',()=>{
 const unknown=select({quality:false});
 assert.equal(unknown.decision,'INCOMPATIBLE');
 assert.equal(observe(unknown).reason,'NO_SUPPORTED_STAGE_PLAN');
});
test('another task or unrelated requirement cannot reuse a current recommendation',()=>{
 const p=select();
 assert.throws(()=>observe(p,{taskId:'TASK-OTHER'}),/INVALID_AGENT05_HANDOFF/);
 assert.equal(observe(p,{requirementId:'wrong'}).reason,'MODEL_STEP_NOT_FOUND_OR_AMBIGUOUS');
});
