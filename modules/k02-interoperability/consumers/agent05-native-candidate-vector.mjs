// Synthetic cross-language vector for Agent 0.5 P01 compatibility.
// Neither an Agent receipt nor measured model quality. All pins are fixtures.
import {CONTRACT_VERSION} from '../index.mjs';
import {MODEL_INPUT,MODEL_OUTPUT} from '../adapters/ollama-local.mjs';
import {recommendTaskStages} from '../task-step-composition.mjs';
import {prepareAgent05OllamaCandidate} from '../agent05-native-model-candidate.mjs';
import {prepareAgent05OwnerRequestDraft} from '../agent05-owner-request-draft.mjs';

const A={name:'fixture-small:latest',digest:'a'.repeat(64)};
const B={name:'fixture-strong:latest',digest:'b'.repeat(64)};
const provider=(id,pin,latency)=>({
  contractVersion:CONTRACT_VERSION,providerId:id,availability:'available',
  capabilities:[{kind:'model',capabilityId:'text.generate',supported:true,
    inputSchema:MODEL_INPUT,outputSchema:MODEL_OUTPUT,
    effectClass:'MODEL_INFERENCE',inputModes:['text'],outputModes:['text'],
    modelPin:pin,providerFeeUsd:0,latencyMsP50:latency}],
});
const candidates=[provider('candidate-small',A,30),provider('candidate-strong',B,120)];
const requirements=['read','write'].map(requirementId=>({
  requirementId,kind:'model',capabilityId:'text.generate',required:true,
  inputSchema:MODEL_INPUT,outputSchema:MODEL_OUTPUT,
  effectClass:'MODEL_INFERENCE',inputModes:['text'],outputModes:['text'],
}));
const solution={solutionId:'synthetic-cross-lang-task',requirements};
const taskId='TASK-K02-P01-VECTOR';
const context={ref:'source:fixture',digest:'c'.repeat(64)};
const stages=['read','write'].map((id,index)=>({
  stageId:'stage-'+id,requirementId:id,requiredContextTokens:300,
  step:{taskClass:index?'report':'extract',difficulty:index?'complex':'simple',
    minObservedSuccessRate:0.8,minSamples:10,maxAttempts:1,
    maxLatencyMs:null,maxMemoryMiB:null},
}));
const profiles=[
  {providerId:'candidate-small',modelPin:A,runtimeVersion:'synthetic-ollama-v1',
    memoryMiB:256,computeUsdPerAttempt:null,costBasis:'UNKNOWN'},
  {providerId:'candidate-strong',modelPin:B,runtimeVersion:'synthetic-ollama-v1',
    memoryMiB:900,computeUsdPerAttempt:null,costBasis:'UNKNOWN'},
];
const resourceProfiles=profiles.map(x=>({providerId:x.providerId,modelPin:x.modelPin,
  minRamMiB:x.memoryMiB,minVramMiB:0,contextWindowTokens:4096,
  basis:'ESTIMATED'}));
const values=[['candidate-small',A,'extract','simple',9],
  ['candidate-strong',B,'extract','simple',10],
  ['candidate-small',A,'report','complex',3],
  ['candidate-strong',B,'report','complex',9]];
const qualityEvidence=values.map(([providerId,modelPin,taskClass,difficulty,passed])=>({
  providerId,modelPin,taskClass,difficulty,passed,attempts:10,
  operatingSystem:'Windows 11',runtimeVersion:'synthetic-ollama-v1',
  proofRef:'fixture-only-quality-evidence',
}));
const recommendation=recommendTaskStages({
  task:{taskId,solutionId:solution.solutionId},solution,stages,
  available:candidates,profiles,qualityEvidence,resourceProfiles,
  resourceObservation:{availableRamMiB:3000,availableVramMiB:null,
    observedAtMs:100,maxAgeMs:500,sourceRef:'fixture:resources'},
  environment:{operatingSystem:'Windows 11'},nowMs:105,
  contextBinding:context,selectedSkills:[],
});
const native=prepareAgent05OllamaCandidate({
  recommendation,trustedRecommendationDigest:recommendation.recommendationDigest,
  trustedPlanDigest:recommendation.plan.planDigest,taskId,
  requirementId:'write',expectedContextBinding:context,
  candidateDescriptor:candidates[1],
  nativeDescriptor:provider('OLLAMA_LOCAL_V1',B,120),
  candidateBinding:{candidateProviderId:'candidate-strong',
    nativeProviderId:'OLLAMA_LOCAL_V1',modelPin:B,
    sourceRef:'host:explicit-configured-source'},
  activeBinding:{providerId:'OLLAMA_LOCAL_V1',bindingDigest:'core-native-binding-v1'},
  trustedNativeBindingDigest:'core-native-binding-v1',
  localAiSetup:{source_confirmed:true,daemon_ready:true,
    selected_model:A.name,selected_model_expected_digest:A.digest,
    local_models:[{name:A.name,digest:A.digest},{name:B.name,digest:B.digest}]},
  trustedInventoryRef:'host:explicit-configured-source',nowMs:108,
});
const expectedContextSnapshot={taskId,snapshotId:'CSN-contract-vector',
  snapshotDigest:'d'.repeat(64),contextBinding:context};
const contextObservation={taskId,observedAtMs:106,maxAgeMs:1000,
  status:{snapshot_id:expectedContextSnapshot.snapshotId,
    snapshot_digest:expectedContextSnapshot.snapshotDigest,state:'FRESH',
    integrity:[],reasons:[],unverifiable:[]}};
const owner=prepareAgent05OwnerRequestDraft({
  nativeCandidate:native,trustedScopedPlanDigest:native.scopedPlanPreview.planDigest,
  nativeDescriptor:provider('OLLAMA_LOCAL_V1',B,120),
  nativeProfile:{providerId:'OLLAMA_LOCAL_V1',modelPin:B,
    runtimeVersion:'independent-native-trial-v1',memoryMiB:900,
    computeUsdPerAttempt:null,costBasis:'UNKNOWN'},
  nativeQualityEvidence:[{providerId:'OLLAMA_LOCAL_V1',modelPin:B,
    taskClass:'report',difficulty:'complex',
    operatingSystem:'Windows 11',runtimeVersion:'independent-native-trial-v1',
    passed:9,attempts:10,proofRef:'synthetic:native-observations-not-alias'}],
  step:stages[1].step,environment:{operatingSystem:'Windows 11'},
  taskId,requirementId:'write',expectedTaskContextSnapshot:expectedContextSnapshot,
  taskContextObservation:contextObservation,nowMs:108,
});
process.stdout.write(JSON.stringify({
  schema:'IWXA.K02.AGENT05_NATIVE_CANDIDATE_VECTOR/0.1.0',
  scope:'SYNTHETIC_CONTRACT_ONLY_NO_AGENT_RESULT',
  taskId,context,recommendation,native,owner,
})+'\n');
