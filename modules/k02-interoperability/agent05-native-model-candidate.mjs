// Optional, pure projection from a K02 model-specific candidate to the single
// native Ollama ModelProviderPort owned by Agent 0.5. Not a router or runtime.
// A scope-limited plan preview is NOT a P01 owner receipt or full Task plan.
import {
  CONTRACT_VERSION, InteropError, digest, resolveRequirements, buildInvocationPlan,
} from './index.mjs';
import { STAGE_SELECTION_VERSION } from './task-step-composition.mjs';

export const AGENT05_OLLAMA_CANDIDATE_VERSION =
  'IWXA.K02.AGENT05_OLLAMA_CANDIDATE/0.1.0';
const HEX=/^[0-9a-f]{64}$/;
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const token=x=>typeof x==='string'&&x.length>0&&x.length<=256;
const safeTime=x=>Number.isSafeInteger(x)&&x>=0;
const samePin=(a,b)=>record(a)&&record(b)&&token(a.name)&&
  HEX.test(a.digest??'')&&a.name===b.name&&a.digest===b.digest;
function invalid(reason){throw new InteropError('INVALID_AGENT05_NATIVE_CANDIDATE',reason);}
function checkSigned(obj,key,expected){
  if(!record(obj)||!HEX.test(expected??'')||obj[key]!==expected)
    invalid('trusted_'+key);
  const unsigned={...obj};delete unsigned[key];
  if(digest(unsigned)!==expected)invalid('modified_'+key);
}
function status(status,reason,properties={}){
  return {schema:AGENT05_OLLAMA_CANDIDATE_VERSION,status,reason,
    ...properties,hostAuthorityGranted:false,modelInvoked:false,
    resultProduced:false,ownerReceiptsVerified:false,
    nativeBindingVerified:false,globalModelChanged:false};
}
const hold=(reason)=>status('NATIVE_CANDIDATE_HOLD',reason,{
  scopedPlanPreview:null,nativeProviderId:null,modelPin:null});
const reject=(reason)=>status('NATIVE_CANDIDATE_HOLD',reason,{
  scopedPlanPreview:null,nativeProviderId:null,modelPin:null});
function candidateSelection(source,requirementId){
  const stages=source.stages.filter(x=>x?.requirementId===requirementId);
  const steps=source.plan.steps.filter(x=>x?.requirementId===requirementId);
  if(stages.length!==1||steps.length!==1)return null;
  const stage=stages[0],step=steps[0];
  if(stage.kind!=='model'||step.kind!=='model'||
     stage.decision!=='MODEL_PROPOSED_NOT_AUTHORIZED'||
     stage.quality?.status!=='MEETS_OBSERVED_FLOOR'||
     stage.providerId!==step.providerId||
     !samePin(stage.modelPin,step.modelPin)||
     step.capabilityId!=='text.generate'||step.effectClass!=='MODEL_INFERENCE'||
     step.invocationAuthority!=='HOST_ONLY'||step.hostApprovalRequired!==true||
     step.invocationState!=='NOT_INVOKED'||step.proofOfInvoke!==null||
     !HEX.test(step.capabilityDigest??'')||
     stage.contextRef!==source.contextBinding.ref||
     stage.contextDigest!==source.contextBinding.digest)return null;
  return {stage,step};
}

// Input descriptors are scoped host observations. candidateBinding is an
// explicit host-supplied relation, not a trusted execution grant. Verify both
// sides using the existing K02 resolver and exact model pin, schema, effect
// class, mode and price evidence. No providerId string replacement in a plan.
export function prepareAgent05OllamaCandidate({
  recommendation,trustedRecommendationDigest,trustedPlanDigest,
  requirementId,taskId,expectedContextBinding,
  candidateDescriptor,nativeDescriptor,candidateBinding,
  activeBinding,trustedNativeBindingDigest,
  localAiSetup,trustedInventoryRef,nowMs,trialEvidence=null,
}){
  checkSigned(recommendation,'recommendationDigest',trustedRecommendationDigest);
  if(recommendation.schema!==STAGE_SELECTION_VERSION||
     recommendation.hostAuthorityGranted!==false||
     recommendation.taskExecuted!==false||
     recommendation.resultProduced!==false||
     recommendation.modelSwitchExecuted!==false||
     recommendation.executionAuthority!=='P01_ONLY'||
     !token(taskId)||taskId!==recommendation.taskId||
     !token(requirementId))invalid('recommendation_envelope');
  const sourceContext=recommendation.contextBinding;
  if(!record(expectedContextBinding)||!token(expectedContextBinding.ref)||
     !HEX.test(expectedContextBinding.digest??'')||
     sourceContext?.ref!==expectedContextBinding.ref||
     sourceContext?.digest!==expectedContextBinding.digest||
     sourceContext?.transferred!==false)return hold('CONTEXT_BINDING_CHANGED');
  if(recommendation.decision!=='STAGES_PROPOSED_NOT_AUTHORIZED'||
     !record(recommendation.plan))return hold('NO_SUPPORTED_STAGE_PLAN');
  checkSigned(recommendation.plan,'planDigest',trustedPlanDigest);
  if(recommendation.plan.taskId!==taskId||
     recommendation.plan.solutionId!==recommendation.solutionId||
     recommendation.plan.contractVersion!==CONTRACT_VERSION||
     recommendation.plan.bindingVersion!=='IWXA.K02.PLAN_BINDING/0.1.0'||
     !Array.isArray(recommendation.plan.steps)||
     !Array.isArray(recommendation.stages))invalid('plan_envelope');
  const selected=candidateSelection(recommendation,requirementId);
  if(!selected)return hold('MODEL_STAGE_NOT_QUALIFIED_OR_REBOUND');
  const {stage,step}=selected;
  if(!safeTime(nowMs))invalid('now_ms');
  const resources=recommendation.resources;
  if(!record(resources)||resources.ageStatus!=='FRESH'||
     !safeTime(resources.observedAtMs)||!safeTime(resources.maxAgeMs)||
     nowMs<resources.observedAtMs||
     nowMs-resources.observedAtMs>resources.maxAgeMs)
    return hold('RESOURCE_OBSERVATION_STALE');
  if(!record(candidateBinding)||Object.keys(candidateBinding).sort().join(',')!==
      'candidateProviderId,modelPin,nativeProviderId,sourceRef'||
     !token(candidateBinding.candidateProviderId)||
     !token(candidateBinding.sourceRef)||!token(trustedInventoryRef)||
     !samePin(candidateBinding.modelPin,step.modelPin)||
     candidateBinding.candidateProviderId!==step.providerId||
     candidateBinding.nativeProviderId!=='OLLAMA_LOCAL_V1'||
     candidateBinding.sourceRef!==trustedInventoryRef)
    return hold('CANDIDATE_NATIVE_MAPPING_UNVERIFIED');
  if(!record(activeBinding)||!token(activeBinding.providerId)||
     !token(activeBinding.bindingDigest)||
     !token(trustedNativeBindingDigest))invalid('native_binding_input');
  if(activeBinding.bindingDigest!==trustedNativeBindingDigest)
    return hold('NATIVE_BINDING_CHANGED');
  if(activeBinding.providerId!=='OLLAMA_LOCAL_V1')
    return hold('NATIVE_PROVIDER_NOT_OLLAMA');
  // The configured source wins. Never borrow identities from an unknown
  // default-port daemon, even when the model tag and digest look identical.
  if(!record(localAiSetup)||localAiSetup.source_confirmed!==true||
     localAiSetup.daemon_ready!==true||!Array.isArray(localAiSetup.local_models))
    return hold('OLLAMA_CONFIGURED_SOURCE_UNAVAILABLE');
  const matching=localAiSetup.local_models.filter(x=>record(x)&&x.name===step.modelPin.name);
  if(matching.length!==1)return hold('OLLAMA_MODEL_ABSENT_OR_AMBIGUOUS');
  const current=matching[0];
  if(current.remote_host||current.remote_model||
     current.name.toLowerCase().endsWith(':cloud')||
     current.digest!==step.modelPin.digest)
    return hold('OLLAMA_MODEL_PIN_OR_SOURCE_CHANGED');
  // Re-resolve both descriptors, never repurpose an alias' capability digest
  // for the native provider. This also catches a stale alias descriptor.
  const requirement={requirementId,kind:'model',capabilityId:step.capabilityId,
    required:true,inputSchema:step.inputSchema,outputSchema:step.outputSchema,
    effectClass:step.effectClass,inputModes:['text'],outputModes:['text'],
    modelPin:step.modelPin};
  const scoped={solutionId:recommendation.solutionId,requirements:[requirement]};
  let trial,native;
  try{
    trial=resolveRequirements(scoped,[candidateDescriptor],trialEvidence);
    native=resolveRequirements(scoped,[nativeDescriptor],null);
  }catch(e){
    if(e instanceof InteropError)return hold('DESCRIPTOR_INVALID_OR_CHANGED');
    throw e;
  }
  if(trial.status!=='SUPPORTED'||trial.selected?.length!==1||
     trial.selected[0].providerId!==step.providerId||
     trial.selected[0].capabilityDigest!==step.capabilityDigest)
    return hold('CANDIDATE_DESCRIPTOR_OR_TRIAL_CHANGED');
  if(native.status!=='SUPPORTED'||native.selected?.length!==1||
     native.selected[0].providerId!=='OLLAMA_LOCAL_V1')
    return hold('NATIVE_DESCRIPTOR_OR_PIN_CHANGED');
  const original=trial.selected[0],translated=native.selected[0];
  // Re-evaluate before using estimates; otherwise a stale cheap alias could
  // be silently made into a more expensive native candidate.
  if(original.providerFeeUsd!==translated.providerFeeUsd||
     original.latencyMsP50!==translated.latencyMsP50)
    return hold('NATIVE_PRICE_OR_LATENCY_CHANGED');
  const nativePlanPreview=buildInvocationPlan(
    {taskId,solutionId:recommendation.solutionId},[],
    {contractVersion:CONTRACT_VERSION,solutionId:recommendation.solutionId,
      status:'SUPPORTED',selected:[translated],
      estimates:{providerFeeUsd:translated.providerFeeUsd,
        latencyMs:translated.latencyMsP50,hostComputeCostUsd:null}},
  );
  // Local-model override is not a Core provider switch. Agent must still
  // confirm that per-node pin and obtain separate K02/K04 owner receipts.
  const globalModelPin=localAiSetup.selected_model &&
    localAiSetup.selected_model_expected_digest?
    {name:localAiSetup.selected_model,digest:localAiSetup.selected_model_expected_digest}:null;
  return status('SCOPED_NATIVE_MODEL_PROPOSED_NOT_AUTHORIZED',
    'P01_OWNER_PLANS_AND_PER_STEP_PIN_CONFIRMATION_REQUIRED',{
      taskId,requirementId,
      candidateProviderId:step.providerId,
      nativeProviderId:'OLLAMA_LOCAL_V1',
      modelPin:{...step.modelPin},
      nativeCapabilityDigest:translated.capabilityDigest,
      nativeBindingDigest:trustedNativeBindingDigest,
      inventoryRef:trustedInventoryRef,
      originalK02PlanDigest:trustedPlanDigest,
      originalRecommendationDigest:trustedRecommendationDigest,
      scopedPlanPreview:nativePlanPreview,
      planScope:'SINGLE_MODEL_REQUIREMENT_NOT_COMPLETE_TASK',
      fullTaskPlanUsable:false,
      userModelPinPreserved:true,
      perStepPinConfirmationRequired:true,
      globallySelectedModelMatches:globalModelPin?samePin(globalModelPin,step.modelPin):null,
      qualityProofStatus:'OBSERVED_SAMPLE_NOT_FUTURE_SUCCESS_GUARANTEE',
      nativeOwnerAction:'REPLAN_WITH_PINNED_K02_K04_OWNER_CLI',
      nativeOwnerPreflightRequired:true,
    });
}
