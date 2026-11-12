import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTRACT_VERSION, verifyInvocationReadiness, digest,
} from '../index.mjs';
import {MODEL_INPUT,MODEL_OUTPUT} from '../adapters/ollama-local.mjs';
import {prepareAgent05OwnerRequestDraft,AGENT05_OWNER_REQUEST_DRAFT_VERSION}
  from '../agent05-owner-request-draft.mjs';
import {recommendTaskStages} from '../task-step-composition.mjs';
import {inspectAgent05ModelStep} from '../agent05-model-stage-handoff.mjs';
import {
  prepareAgent05OllamaCandidate,AGENT05_OLLAMA_CANDIDATE_VERSION,
} from '../agent05-native-model-candidate.mjs';

const SMALL={name:'local-small:latest',digest:'a'.repeat(64)};
const STRONG={name:'local-strong:latest',digest:'b'.repeat(64)};
const CONTEXT={ref:'task:source-revision',digest:'c'.repeat(64)};
const NOW=10_050;
const PROVIDER='OLLAMA_LOCAL_V1';
const definition=(providerId,pin,fee=0,latency=120)=>({
  contractVersion:CONTRACT_VERSION,providerId,availability:'available',
  capabilities:[{kind:'model',capabilityId:'text.generate',
    supported:true,inputSchema:MODEL_INPUT,outputSchema:MODEL_OUTPUT,
    effectClass:'MODEL_INFERENCE',providerFeeUsd:fee,latencyMsP50:latency,
    inputModes:['text'],outputModes:['text'],modelPin:pin}],
});
const small=definition('candidate-small',SMALL,0,30);
const strong=definition('candidate-strong',STRONG,0,120);
const nativeStrong=definition(PROVIDER,STRONG,0,120);
const nativeSmall=definition(PROVIDER,SMALL,0,30);
const requirement=id=>({requirementId:id,kind:'model',capabilityId:'text.generate',
  required:true,inputSchema:MODEL_INPUT,outputSchema:MODEL_OUTPUT,
  effectClass:'MODEL_INFERENCE',inputModes:['text'],outputModes:['text']});
const SOLUTION={solutionId:'doc-calculation-and-report',
  requirements:[requirement('read'),requirement('write')]};
const TASK_ID='TASK-K02-NATIVE';
const makeStep=(id,taskClass,difficulty)=>({stageId:'stage-'+id,
  requirementId:id,requiredContextTokens:700,
  step:{taskClass,difficulty,minObservedSuccessRate:0.8,
    minSamples:10,maxAttempts:1,maxLatencyMs:null,maxMemoryMiB:null}});
const stages=[makeStep('read','extraction','simple'),makeStep('write','summary','complex')];
const profiles=[['candidate-small',SMALL,300],['candidate-strong',STRONG,900]].map(
  ([providerId,modelPin,memoryMiB])=>({providerId,modelPin,runtimeVersion:'Ollama-v1',
    memoryMiB,computeUsdPerAttempt:null,costBasis:'UNKNOWN'}));
const quality=[
  ['candidate-small',SMALL,'extraction','simple',9],
  ['candidate-strong',STRONG,'extraction','simple',10],
  ['candidate-small',SMALL,'summary','complex',1],
  ['candidate-strong',STRONG,'summary','complex',9],
].map(([providerId,modelPin,taskClass,difficulty,passed])=>({
  providerId,modelPin,taskClass,difficulty,passed,attempts:10,
  operatingSystem:'Windows 11',runtimeVersion:'Ollama-v1',
  proofRef:'synthetic:qualified-test-only'}));
const resources=profiles.map(x=>({providerId:x.providerId,modelPin:x.modelPin,
  minRamMiB:x.memoryMiB,minVramMiB:0,contextWindowTokens:4096,basis:'ESTIMATED'}));
const observation={availableRamMiB:4096,availableVramMiB:null,
  observedAtMs:10_000,maxAgeMs:500,sourceRef:'test:memory-current'};
const local={
  source_confirmed:true,daemon_ready:true,
  selected_model:SMALL.name,selected_model_expected_digest:SMALL.digest,
  local_models:[{name:SMALL.name,digest:SMALL.digest,size:280000000},
    {name:STRONG.name,digest:STRONG.digest,size:890000000}],
};
const activeBinding={providerId:PROVIDER,bindingDigest:'native-binding-ref-v1'};
const SOURCE_REF='host:configured-ollama-inventory';
function recommendation(other={}){
  return recommendTaskStages({
    task:{taskId:TASK_ID,solutionId:SOLUTION.solutionId},
    solution:SOLUTION,stages,available:[small,strong],profiles,
    qualityEvidence:quality,resourceProfiles:resources,
    environment:{operatingSystem:'Windows 11'},
    resourceObservation:observation,nowMs:NOW,
    selectedSkills:[],contextBinding:CONTEXT,...other});
}
function prepare(p=recommendation(),req='write',overrides={}){
  const selected=p.stages.find(x=>x.requirementId===req);
  return prepareAgent05OllamaCandidate({
    recommendation:p,trustedRecommendationDigest:p.recommendationDigest,
    trustedPlanDigest:p.plan?.planDigest??'0'.repeat(64),
    requirementId:req,taskId:TASK_ID,expectedContextBinding:CONTEXT,
    candidateDescriptor:req==='write'?strong:small,
    nativeDescriptor:req==='write'?nativeStrong:nativeSmall,
    candidateBinding:{candidateProviderId:selected.providerId,
      nativeProviderId:PROVIDER,modelPin:selected.modelPin,sourceRef:SOURCE_REF},
    activeBinding,trustedNativeBindingDigest:activeBinding.bindingDigest,
    localAiSetup:local,trustedInventoryRef:SOURCE_REF,nowMs:NOW+20,
    ...overrides,
  });
}
test('two real candidate IDs resolve different stage pins without changing the sole Agent native provider',async()=>{
  const selected=recommendation();
  assert.equal(selected.decision,'STAGES_PROPOSED_NOT_AUTHORIZED');
  assert.deepEqual(selected.stages.map(x=>x.providerId),
    ['candidate-small','candidate-strong']);
  // The previous direct P01 check rightfully refuses an alias providerId.
  const legacy=inspectAgent05ModelStep({
    recommendation:selected,
    trustedRecommendationDigest:selected.recommendationDigest,
    trustedPlanDigest:selected.plan.planDigest,
    taskId:TASK_ID,requirementId:'write',expectedContextBinding:CONTEXT,
    activeBinding,trustedNativeBindingDigest:activeBinding.bindingDigest,
    localAiSetup:local,nowMs:NOW+20,
  });
  assert.equal(legacy.reason,'NATIVE_PROVIDER_ID_MISMATCH');
  const read=prepare(selected,'read');
  const write=prepare(selected,'write');
  for(const p of [read,write]){
    assert.equal(p.schema,AGENT05_OLLAMA_CANDIDATE_VERSION);
    assert.equal(p.status,'SCOPED_NATIVE_MODEL_PROPOSED_NOT_AUTHORIZED');
    assert.equal(p.nativeProviderId,PROVIDER);
    assert.equal(p.planScope,'SINGLE_MODEL_REQUIREMENT_NOT_COMPLETE_TASK');
    assert.equal(p.fullTaskPlanUsable,false);
    assert.equal(p.nativeBindingVerified,false);
    assert.equal(p.ownerReceiptsVerified,false);
    assert.equal(p.modelInvoked,false);
    assert.equal(p.resultProduced,false);
    assert.equal(p.globalModelChanged,false);
    assert.equal(p.hostAuthorityGranted,false);
    assert.equal(p.scopedPlanPreview.steps.length,1);
    assert.equal(p.scopedPlanPreview.steps[0].providerId,PROVIDER);
    assert.equal(p.scopedPlanPreview.steps[0].hostApprovalRequired,true);
    assert.equal(p.scopedPlanPreview.steps[0].invocationAuthority,'HOST_ONLY');
    assert.equal(p.scopedPlanPreview.steps[0].proofOfInvoke,null);
    assert.notEqual(p.scopedPlanPreview.steps[0].capabilityDigest,
      selected.plan.steps.find(x=>x.requirementId===p.requirementId).capabilityDigest);
  }
  assert.deepEqual(read.modelPin,SMALL);
  assert.deepEqual(write.modelPin,STRONG);
  assert.equal(read.globallySelectedModelMatches,true);
  assert.equal(write.globallySelectedModelMatches,false);
  const readProbe={describeCapabilities:async()=>nativeSmall};
  const writeProbe={describeCapabilities:async()=>nativeStrong};
  assert.equal((await verifyInvocationReadiness(
    read.scopedPlanPreview,'read',readProbe,read.scopedPlanPreview.planDigest)).status,
    'MATCHED_NOT_AUTHORIZED');
  assert.equal((await verifyInvocationReadiness(
    write.scopedPlanPreview,'write',writeProbe,write.scopedPlanPreview.planDigest)).status,
    'MATCHED_NOT_AUTHORIZED');
});
test('unchanged manual/owner selection is preserved; no fallback to another local model',()=>{
  const p=recommendation({userModelPins:{write:STRONG}});
  assert.equal(prepare(p,'write').modelPin.name,STRONG.name);
  const wrong=recommendation({userModelPins:{write:SMALL}});
  assert.equal(wrong.decision,'INCOMPATIBLE');
  assert.equal(prepare(wrong,'write').status,'NATIVE_CANDIDATE_HOLD');
  const source={...local,local_models:[local.local_models[0]]};
  assert.equal(prepare(p,'write',{localAiSetup:source}).reason,
    'OLLAMA_MODEL_ABSENT_OR_AMBIGUOUS');
});
test('stale inventory binding, offline configured daemon or unrelated default-port source never enable a model',()=>{
  const p=recommendation();
  const base=prepare(p,'write');
  assert.equal(base.status,'SCOPED_NATIVE_MODEL_PROPOSED_NOT_AUTHORIZED');
  assert.equal(prepare(p,'write',{candidateBinding:{
    candidateProviderId:'candidate-strong',nativeProviderId:PROVIDER,
    modelPin:STRONG,sourceRef:'unrelated-inventory'}}).reason,
    'CANDIDATE_NATIVE_MAPPING_UNVERIFIED');
  assert.equal(prepare(p,'write',{localAiSetup:{...local,daemon_ready:false}}).reason,
    'OLLAMA_CONFIGURED_SOURCE_UNAVAILABLE');
  assert.equal(prepare(p,'write',{localAiSetup:{...local,source_confirmed:false}}).reason,
    'OLLAMA_CONFIGURED_SOURCE_UNAVAILABLE');
  assert.equal(prepare(p,'write',{activeBinding:{...activeBinding,
    bindingDigest:'changed'}}).reason,'NATIVE_BINDING_CHANGED');
  assert.equal(prepare(p,'write',{activeBinding:{providerId:'IWXA_BASIC_RUNTIME_V1',
    bindingDigest:activeBinding.bindingDigest}}).reason,'NATIVE_PROVIDER_NOT_OLLAMA');
});
test('ambiguous, remote or changed model digest never maps a cheap alias into the native provider',()=>{
  const p=recommendation();
  const remotes={...local,local_models:[
    local.local_models[0],{...local.local_models[1],remote_host:'remote'}]};
  assert.equal(prepare(p,'write',{localAiSetup:remotes}).reason,
    'OLLAMA_MODEL_PIN_OR_SOURCE_CHANGED');
  const changed={...local,local_models:[
    local.local_models[0],{...local.local_models[1],digest:'f'.repeat(64)}]};
  assert.equal(prepare(p,'write',{localAiSetup:changed}).reason,
    'OLLAMA_MODEL_PIN_OR_SOURCE_CHANGED');
  const duplicate={...local,local_models:[
    ...local.local_models,local.local_models[1]]};
  assert.equal(prepare(p,'write',{localAiSetup:duplicate}).reason,
    'OLLAMA_MODEL_ABSENT_OR_AMBIGUOUS');
});
test('native descriptor and originally selected candidate must be independently consistent',()=>{
  const p=recommendation();
  assert.equal(prepare(p,'write',{nativeDescriptor:{
    ...nativeStrong,capabilities:[{...nativeStrong.capabilities[0],
      latencyMsP50:900}]}}).reason,'NATIVE_PRICE_OR_LATENCY_CHANGED');
  assert.equal(prepare(p,'write',{nativeDescriptor:{
    ...nativeStrong,capabilities:[{...nativeStrong.capabilities[0],
      modelPin:SMALL}]}}).reason,'NATIVE_DESCRIPTOR_OR_PIN_CHANGED');
  assert.equal(prepare(p,'write',{candidateDescriptor:{
    ...strong,capabilities:[{...strong.capabilities[0],
      providerFeeUsd:0.4}]}}).reason,'CANDIDATE_DESCRIPTOR_OR_TRIAL_CHANGED');
  assert.equal(prepare(p,'write',{nativeDescriptor:{
    ...nativeStrong,availability:'unavailable',
    unavailableReason:'NATIVE_OFFLINE'}}).reason,'NATIVE_DESCRIPTOR_OR_PIN_CHANGED');
});
test('a stale Task/context or rewritten signed model selection never becomes an owner input',()=>{
  const p=recommendation();
  assert.equal(prepare(p,'write',{nowMs:NOW+900}).reason,
    'RESOURCE_OBSERVATION_STALE');
  assert.equal(prepare(p,'write',{expectedContextBinding:{...CONTEXT,
    digest:'e'.repeat(64)}}).reason,'CONTEXT_BINDING_CHANGED');
  assert.throws(()=>prepare(p,'write',{taskId:'TASK-ANOTHER'}),/INVALID_AGENT05_NATIVE_CANDIDATE/);
  const forged=structuredClone(p);
  forged.stages[1].providerId='FORGED';
  assert.throws(()=>prepare(forged,'write'),/INVALID_AGENT05_NATIVE_CANDIDATE/);
  const plan=structuredClone(p);
  plan.plan.steps[1].providerId='FORGED';
  assert.throws(()=>prepare(plan,'write'),/INVALID_AGENT05_NATIVE_CANDIDATE/);
});
test('unknown model quality cannot be translated into a fake native proposal',()=>{
  const p=recommendation({qualityEvidence:[]});
  assert.equal(p.decision,'INCOMPATIBLE');
  const choice=prepare(p,'write');
  assert.equal(choice.reason,'NO_SUPPORTED_STAGE_PLAN');
  assert.equal(choice.scopedPlanPreview,null);
  assert.equal(choice.modelInvoked,false);
});
test('provider chosen from quality evidence needs fresh host mapping for each exact model',()=>{
  const p=recommendation();
  const mapping={candidateProviderId:'candidate-small',nativeProviderId:PROVIDER,
    modelPin:STRONG,sourceRef:SOURCE_REF};
  assert.equal(prepare(p,'write',{candidateBinding:mapping}).reason,
    'CANDIDATE_NATIVE_MAPPING_UNVERIFIED');
  assert.equal(prepare(p,'write',{nativeDescriptor:definition(
    'custom-node-provider',STRONG,0,120)}).reason,'NATIVE_DESCRIPTOR_OR_PIN_CHANGED');
});

const nativeQuality=({providerId='OLLAMA_LOCAL_V1',modelPin=STRONG,
    operatingSystem='Windows 11',runtimeVersion='Ollama-v1',
    passed=9,attempts=10,taskClass='summary',difficulty='complex'}={})=>[{
  providerId,modelPin,operatingSystem,runtimeVersion,passed,attempts,
  taskClass,difficulty,
  proofRef:'host-native-separate-observation-not-alias-proof',
}];
const nativeProfile={providerId:'OLLAMA_LOCAL_V1',modelPin:STRONG,
  runtimeVersion:'Ollama-v1',memoryMiB:900,computeUsdPerAttempt:null,
  costBasis:'UNKNOWN'};
function ownerDraft(recommended=recommendation(),overrides={}){
  const native=prepare(recommended,'write');
  return prepareAgent05OwnerRequestDraft({
    nativeCandidate:native,trustedScopedPlanDigest:native.scopedPlanPreview?.planDigest??
      '0'.repeat(64),nativeDescriptor:nativeStrong,nativeProfile,
    nativeQualityEvidence:nativeQuality(),step:stages[1].step,
    environment:{operatingSystem:'Windows 11'},
    taskId:TASK_ID,requirementId:'write',...overrides,
  });
}
test('native quality trial produces exact existing Agent owner-CLI request, with no U01 invoke',()=>{
  const original=recommendation();
  const candidate=prepare(original,'write');
  const x=ownerDraft(original);
  assert.equal(x.schema,AGENT05_OWNER_REQUEST_DRAFT_VERSION);
  assert.equal(x.status,'OWNER_REQUEST_DRAFT_NOT_EXECUTED');
  assert.equal(x.ownerRequest.schema,'PA.K02_K04.OWNER_REQUEST/0.1.0');
  assert.equal(x.ownerRequest.task_id,TASK_ID);
  assert.deepEqual(Object.keys(x.ownerRequest.k02.model_recommendation).sort(),
    ['environment','profiles','quality_evidence','requirement_id','step','user_model_pin'].sort());
  assert.equal(x.ownerRequest.k02.providers.length,1);
  assert.equal(x.ownerRequest.k02.providers[0].providerId,'OLLAMA_LOCAL_V1');
  assert.equal(x.ownerRequest.k02.solution.requirements.length,1);
  assert.equal(x.ownerRequest.k02.model_recommendation.requirement_id,'write');
  assert.deepEqual(x.ownerRequest.k02.model_recommendation.user_model_pin,STRONG);
  assert.equal(x.ownerRequest.k02.model_recommendation.quality_evidence[0].providerId,
    'OLLAMA_LOCAL_V1');
  assert.equal(x.expectedOwnerPlanDigest,candidate.scopedPlanPreview.planDigest);
  assert.equal(x.ownerRequestDigest,digest(x.ownerRequest));
  assert.equal(x.ownerExecuted,false);
  assert.equal(x.ownerReceiptsVerified,false);
  assert.equal(x.graphChanged,false);
  assert.equal(x.hostAuthorityGranted,false);
  assert.equal(x.fullTaskPlanUsable,false);
});
test('alias quality evidence cannot be rebadged or silently inherited for native owner',()=>{
  const rejected=ownerDraft(undefined,{
    nativeQualityEvidence:nativeQuality({providerId:'candidate-strong'}),
  });
  assert.equal(rejected.status,'OWNER_REQUEST_HOLD');
  assert.equal(rejected.reason,'INDEPENDENT_NATIVE_QUALITY_EVIDENCE_REQUIRED');
  assert.equal(rejected.ownerRequest,null);
  for(const row of [
    nativeQuality({modelPin:SMALL}),
    nativeQuality({operatingSystem:'Linux'}),
    nativeQuality({runtimeVersion:'other-runtime'}),
    nativeQuality({taskClass:'arithmetic'}),
  ]){
    assert.equal(ownerDraft(undefined,{nativeQualityEvidence:row}).status,'OWNER_REQUEST_HOLD');
  }
  assert.equal(ownerDraft(undefined,{nativeQualityEvidence:[]}).status,'OWNER_REQUEST_HOLD');
});
test('insufficient native quality leaves owner recommendation unavailable, not an assumed PASS',()=>{
  for(const evidence of [nativeQuality({passed:1}),
    nativeQuality({passed:7}),
    nativeQuality({passed:1,attempts:3})]){
    const draft=ownerDraft(undefined,{nativeQualityEvidence:evidence});
    assert.equal(draft.status,'OWNER_REQUEST_HOLD');
    assert.equal(draft.ownerExecuted,false);
    assert.equal(draft.ownerRequest,null);
  }
});
test('changed native descriptor and cost fail to construct owner request',()=>{
  const moved={...nativeStrong,capabilities:[{
    ...nativeStrong.capabilities[0],latencyMsP50:999,
  }]};
  assert.equal(ownerDraft(undefined,{nativeDescriptor:moved}).reason,
    'NATIVE_CAPABILITY_CHANGED');
  const offline={...nativeStrong,availability:'unavailable',unavailableReason:'offline'};
  assert.equal(ownerDraft(undefined,{nativeDescriptor:offline}).reason,
    'NATIVE_CAPABILITY_UNAVAILABLE');
});
test('a non-native or altered scoped model plan cannot be laundered into existing Agent CLI',()=>{
  const original=recommendation();
  const actual=prepare(original,'write');
  assert.equal(ownerDraft(original,{nativeCandidate:{
    ...actual,hostAuthorityGranted:true,
  }}).status,'OWNER_REQUEST_HOLD');
  assert.equal(ownerDraft(original,{taskId:'TASK-OTHER'}).reason,
    'NATIVE_CANDIDATE_SCOPE_CHANGED');
  assert.throws(()=>ownerDraft(original,{trustedScopedPlanDigest:'f'.repeat(64)}),
    /INVALID_AGENT05_OWNER_DRAFT/);
  const tampered=structuredClone(actual);
  tampered.scopedPlanPreview.steps[0].providerId='other';
  assert.throws(()=>ownerDraft(original,{nativeCandidate:tampered}),
    /INVALID_AGENT05_OWNER_DRAFT/);
});
test('manual pinned model without independently observed quality is not converted to an owner result',()=>{
  const selected=recommendation({userModelPins:{write:STRONG}});
  assert.equal(ownerDraft(selected,{nativeQualityEvidence:[]}).status,'OWNER_REQUEST_HOLD');
  assert.equal(ownerDraft(selected).status,'OWNER_REQUEST_DRAFT_NOT_EXECUTED');
});
