// Optional, pure handoff check for the existing Agent 0.5 P01 model port.
// This does not add a selector, runtime, graph, approval or owner receipt.
// The caller MUST independently obtain current Core snapshots and native
// binding_digest; no browser/default-port Ollama discovery is accepted.
import {digest, InteropError} from './index.mjs';
import {STAGE_SELECTION_VERSION} from './task-step-composition.mjs';

export const AGENT05_MODEL_STAGE_HANDOFF_VERSION='IWXA.K02.AGENT05_MODEL_STAGE_HANDOFF/0.1.0';
const HEX=/^[a-f0-9]{64}$/;
const MODEL_ROUTE=new Set(['OLLAMA_LOCAL_V1','IWXA_BASIC_RUNTIME_V1']);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const scalar=v=>typeof v==='string'&&v.length>0&&v.length<=256;
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const samePin=(a,b)=>object(a)&&object(b)&&
  a.name===b.name&&a.digest===b.digest&&
  typeof a.name==='string'&&a.name.length<=240&&HEX.test(a.digest??'');
const invalid=message=>{throw new InteropError('INVALID_AGENT05_HANDOFF',message);};
function verifyDigest(value,key,trusted,reason){
  if(!object(value)||!HEX.test(trusted??'')||value[key]!==trusted)invalid(reason);
  const copy={...value};delete copy[key];
  if(digest(copy)!==trusted)invalid(reason);
}
function deny(reason,modelPin=null){
  return {schema:AGENT05_MODEL_STAGE_HANDOFF_VERSION,
    status:'NATIVE_MODEL_NOT_READY',reason,
    modelPin,hostAuthorityGranted:false,modelInvoked:false,resultProduced:false,
    nativeBindingVerified:false,ownerReceiptsVerified:false};
}
function routeStatus(providerId,snapshot,modelPin){
  if(providerId==='OLLAMA_LOCAL_V1'){
    if(!object(snapshot)||snapshot.source_confirmed!==true||
       snapshot.daemon_ready!==true||!Array.isArray(snapshot.local_models))
      return 'OLLAMA_CONFIGURED_SOURCE_NOT_READY';
    // A configured Agent source owns the identity. Do not borrow tags from
    // an unrelated daemon at the default localhost port.
    const exact=snapshot.local_models.filter(row=>object(row)&&row.name===modelPin.name);
    if(exact.length!==1)return 'OLLAMA_MODEL_MISSING_OR_AMBIGUOUS';
    const row=exact[0];
    if(row.remote_host||row.remote_model||
       row.name.toLowerCase().endsWith(':cloud')||
       row.digest!==modelPin.digest)return 'OLLAMA_MODEL_DIGEST_OR_SOURCE_CHANGED';
    return null;
  }
  if(providerId==='IWXA_BASIC_RUNTIME_V1'){
    if(!object(snapshot)||snapshot.active!==true||
       snapshot.ready!==true||snapshot.component_verified!==true)
      return 'BASIC_MODEL_NOT_READY';
    if(!samePin(snapshot.pin,modelPin))return 'BASIC_MODEL_PIN_CHANGED';
    return null;
  }
  return 'NATIVE_MODEL_PROVIDER_UNSUPPORTED';
}
// A read-only native preflight for ONE already selected model step. P01 uses
// its own latest Core model inventory, binding check, K04 owner plans and
// approval. A matched preflight is never a native attestation or invocation.
export function inspectAgent05ModelStep({
  recommendation,trustedRecommendationDigest,trustedPlanDigest,
  taskId,requirementId,expectedContextBinding,
  activeBinding,trustedNativeBindingDigest,
  localAiSetup=null,basicModelStatus=null,nowMs,
}){
  verifyDigest(recommendation,'recommendationDigest',
    trustedRecommendationDigest,'stage_recommendation_changed');
  if(recommendation.schema!==STAGE_SELECTION_VERSION||
     recommendation.hostAuthorityGranted!==false||
     recommendation.taskExecuted!==false||
     recommendation.resultProduced!==false||
     recommendation.modelSwitchExecuted!==false||
     recommendation.executionAuthority!=='P01_ONLY'||
     !scalar(taskId)||recommendation.taskId!==taskId||
     !scalar(requirementId))invalid('stage_envelope');
  if(!object(expectedContextBinding)||!scalar(expectedContextBinding.ref)||
     !HEX.test(expectedContextBinding.digest??'')||
     recommendation.contextBinding?.ref!==expectedContextBinding.ref||
     recommendation.contextBinding?.digest!==expectedContextBinding.digest||
     recommendation.contextBinding?.transferred!==false)
    return deny('CONTEXT_BINDING_CHANGED');
  const plan=recommendation.plan;
  if(recommendation.decision!=='STAGES_PROPOSED_NOT_AUTHORIZED'||!object(plan))
    return deny('NO_SUPPORTED_STAGE_PLAN');
  verifyDigest(plan,'planDigest',trustedPlanDigest,'native_plan_changed');
  if(plan.taskId!==taskId||plan.solutionId!==recommendation.solutionId||
     plan.bindingVersion!=='IWXA.K02.PLAN_BINDING/0.1.0'||
     plan.contractVersion!=='IWXA.K02.INTEROP/0.1.0'||
     !Array.isArray(plan.steps)||!Array.isArray(recommendation.stages))
    invalid('plan_identity');
  const stages=recommendation.stages.filter(x=>x?.requirementId===requirementId);
  const steps=plan.steps.filter(x=>x?.requirementId===requirementId);
  if(stages.length!==1||steps.length!==1||stages[0].kind!=='model'||
     steps[0].kind!=='model')return deny('MODEL_STEP_NOT_FOUND_OR_AMBIGUOUS');
  const stage=stages[0],step=steps[0];
  if(stage.decision!=='MODEL_PROPOSED_NOT_AUTHORIZED'||
     stage.providerId!==step.providerId||
     stage.quality?.status!=='MEETS_OBSERVED_FLOOR'||
     step.capabilityId!=='text.generate'||step.effectClass!=='MODEL_INFERENCE'||
     step.hostApprovalRequired!==true||step.invocationAuthority!=='HOST_ONLY'||
     step.invocationState!=='NOT_INVOKED'||step.proofOfInvoke!==null||
     !samePin(stage.modelPin,step.modelPin)||
     stage.contextRef!==expectedContextBinding.ref||
     stage.contextDigest!==expectedContextBinding.digest)
    return deny('MODEL_STEP_NOT_QUALIFIED_OR_REBOUND');
  if(!integer(nowMs))invalid('now_ms');
  const resources=recommendation.resources;
  if(!object(resources)||resources.ageStatus!=='FRESH'||
     !integer(resources.observedAtMs)||!integer(resources.maxAgeMs)||
     nowMs<resources.observedAtMs||
     nowMs-resources.observedAtMs>resources.maxAgeMs)
    return deny('RESOURCE_OBSERVATION_STALE_OR_UNAVAILABLE',stage.modelPin);
  if(!object(activeBinding)||!scalar(activeBinding.providerId)||
     !scalar(activeBinding.bindingDigest)||!scalar(trustedNativeBindingDigest))
    invalid('native_binding_input');
  if(activeBinding.bindingDigest!==trustedNativeBindingDigest)
    return deny('NATIVE_BINDING_CHANGED',stage.modelPin);
  if(!MODEL_ROUTE.has(activeBinding.providerId)||
     activeBinding.providerId!==step.providerId)
    return deny('NATIVE_PROVIDER_ID_MISMATCH',stage.modelPin);
  const observed=activeBinding.providerId==='OLLAMA_LOCAL_V1'?localAiSetup:basicModelStatus;
  const state=routeStatus(activeBinding.providerId,observed,stage.modelPin);
  if(state)return deny(state,stage.modelPin);
  return {schema:AGENT05_MODEL_STAGE_HANDOFF_VERSION,
    status:'MODEL_STEP_MATCHED_P01_ATTESTATION_REQUIRED',
    reason:'NATIVE_P01_K04_RECEIPTS_AND_APPROVAL_REQUIRED',
    taskId,requirementId,providerId:step.providerId,
    modelPin:{...step.modelPin},capabilityDigest:step.capabilityDigest,
    k02PlanDigest:trustedPlanDigest,
    recommendationDigest:trustedRecommendationDigest,
    expectedContextBinding:{...expectedContextBinding},
    nativeBindingDigest:trustedNativeBindingDigest,
    needs:[
      'P01_FRESH_MODEL_PROVIDER_PORT_PREFLIGHT',
      'P01_K02_K04_OWNER_RECEIPT_VALIDATION',
      'P01_GRAPH_MODEL_CHOICE_PREPARE',
      'P01_USER_APPROVAL_AND_RESULT_READBACK',
    ],
    hostAuthorityGranted:false,modelInvoked:false,resultProduced:false,
    nativeBindingVerified:false,ownerReceiptsVerified:false,
  };
}
