// Public, synthetic, non-executing vector. Matches the existing Agent 0.5
// Core model-route observation and K02 plan envelopes; nothing is invoked.
import {CONTRACT_VERSION} from '../index.mjs';
import {MODEL_INPUT,MODEL_OUTPUT} from '../adapters/ollama-local.mjs';
import {recommendTaskStages} from '../task-step-composition.mjs';
import {inspectAgent05ModelStep} from '../agent05-model-stage-handoff.mjs';

const pin={name:'fixture-local:latest',digest:'7'.repeat(64)};
const providerId='OLLAMA_LOCAL_V1';
const solution={solutionId:'agent05-K02-owner-vector',requirements:[{
  requirementId:'answer',kind:'model',capabilityId:'text.generate',
  required:true,inputSchema:MODEL_INPUT,outputSchema:MODEL_OUTPUT,
  effectClass:'MODEL_INFERENCE',inputModes:['text'],outputModes:['text'],
}]};
const taskId='TASK-OWNER-K02-VECTOR';
const context={ref:'task:owner-context-revision',digest:'c'.repeat(64)};
const available=[{contractVersion:CONTRACT_VERSION,providerId,availability:'available',
  capabilities:[{kind:'model',capabilityId:'text.generate',supported:true,
    inputSchema:MODEL_INPUT,outputSchema:MODEL_OUTPUT,effectClass:'MODEL_INFERENCE',
    inputModes:['text'],outputModes:['text'],modelPin:pin,
    providerFeeUsd:0,latencyMsP50:120}]}];
const stage={stageId:'answer-stage',requirementId:'answer',requiredContextTokens:256,
  step:{taskClass:'verification',difficulty:'simple',minObservedSuccessRate:0.8,
    minSamples:10,maxAttempts:1,maxLatencyMs:null,maxMemoryMiB:null}};
const profiles=[{providerId,modelPin:pin,runtimeVersion:'fixture-version',
  memoryMiB:512,computeUsdPerAttempt:null,costBasis:'UNKNOWN'}];
const qualityEvidence=[{providerId,modelPin:pin,taskClass:'verification',
  difficulty:'simple',operatingSystem:'Windows 11',
  runtimeVersion:'fixture-version',passed:9,attempts:10,
  proofRef:'synthetic:contract-shape-only-not-real-quality'}];
const recommendation=recommendTaskStages({
 task:{taskId,solutionId:solution.solutionId},solution,stages:[stage],available,
 profiles,qualityEvidence,
 resourceProfiles:[{providerId,modelPin:pin,minRamMiB:512,minVramMiB:0,
   contextWindowTokens:4096,basis:'ESTIMATED'}],
 resourceObservation:{availableRamMiB:2048,availableVramMiB:null,
   observedAtMs:2000,maxAgeMs:10000,sourceRef:'fixture:windows-mem'},
 nowMs:2050,environment:{operatingSystem:'Windows 11'},
 contextBinding:context,selectedSkills:[],
});
const handoff=inspectAgent05ModelStep({
 recommendation,trustedRecommendationDigest:recommendation.recommendationDigest,
 trustedPlanDigest:recommendation.plan.planDigest,
 taskId,requirementId:'answer',expectedContextBinding:context,
 activeBinding:{providerId,bindingDigest:'fixture-native-binding-1'},
 trustedNativeBindingDigest:'fixture-native-binding-1',nowMs:2060,
 localAiSetup:{source_confirmed:true,daemon_ready:true,
   local_models:[{name:pin.name,digest:pin.digest,size:250000000}]},
});
process.stdout.write(JSON.stringify({
  schema:'IWXA.K02.AGENT05_CROSS_LANGUAGE_HANDOFF_VECTOR/0.1.0',
  evidenceScope:'SYNTHETIC_SHAPE_ONLY_NOT_AGENT_EXECUTION',
  requirementId:'answer',providerId,pin,taskId,context,
  recommendation,handoff,
})+'\n');
