import {ComposerError, digest, K02_VERSION} from './index.mjs';
import {STEP_HANDOFF_VERSION, bindK02StepChoices} from './k02-step-handoff.mjs';

// Pure optional bridge to K02's own recommendModelForStep implementation.
// Does not inspect prompts, score models, run inference, write Task, or call host APIs.
export const STEP_MODEL_BRIDGE_VERSION = 'IWXA.K04.K02_STEP_MODEL_BRIDGE/0.1.0';
export const STEP_MODEL_BINDING_VERSION = 'IWXA.K04.K02_RECOMMENDED_BINDINGS/0.1.0';
export const K02_RECOMMENDATION_VERSION = 'IWXA.K02.STEP_MODEL_RECOMMENDATION/0.1.0';
const LEVEL = Object.freeze({LOW:'simple', MODERATE:'moderate', HIGH:'complex'});
const HEX64 = /^[a-f0-9]{64}$/;
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = v => typeof v === 'string' && !!v.trim() && v.trim() === v;
const copy = v => JSON.parse(JSON.stringify(v));
function fail(code) { throw new ComposerError(code); }
function keys(value, allowed, error) {
  if (!isObject(value) || Object.keys(value).some(x => !allowed.includes(x))) fail(error);
}
function sha(value) { return typeof value === 'string' && HEX64.test(value); }
function checkHandoff(handoff) {
  if (!isObject(handoff) || handoff.schema !== STEP_HANDOFF_VERSION ||
      !sha(handoff.handoffDigest)) fail('INVALID_STEP_HANDOFF');
  const {handoffDigest, ...unsigned} = handoff;
  if (digest(unsigned) !== handoffDigest) fail('STEP_HANDOFF_CHANGED');
}
function checkPolicy(policy) {
  keys(policy, ['policyRef','minObservedSuccessRate','minSamples','maxAttempts','maxMemoryMiB','maxLatencyMs'],
    'K02_QUALITY_POLICY_REQUIRED');
  if (!str(policy.policyRef) || policy.policyRef.length > 240 ||
      typeof policy.minObservedSuccessRate !== 'number' ||
      !Number.isFinite(policy.minObservedSuccessRate) ||
      policy.minObservedSuccessRate < 0 || policy.minObservedSuccessRate > 1 ||
      !Number.isSafeInteger(policy.minSamples) || policy.minSamples < 1 ||
      policy.minSamples > 100000 || !Number.isSafeInteger(policy.maxAttempts) ||
      policy.maxAttempts < 1 || policy.maxAttempts > 4) fail('K02_QUALITY_POLICY_REQUIRED');
  for (const field of ['maxMemoryMiB', 'maxLatencyMs']) {
    const x = policy[field];
    if (x !== null && (typeof x !== 'number' || !Number.isFinite(x) ||
        x < (field === 'maxMemoryMiB' ? 1 : 0.001) || x > 1e9))
      fail('K02_QUALITY_POLICY_REQUIRED');
  }
}
function requestBody(value) {
  const {requestDigest, ...body} = value;
  if (!sha(requestDigest) || digest(body) !== requestDigest) fail('MODEL_STEP_REQUEST_CHANGED');
  return body;
}
function selectedModelProof(packet, handoff, selected) {
  keys(packet, ['request', 'recommendation'], 'MODEL_RECOMMENDATION_PROOF_INVALID');
  const request = packet.request, recommendation = packet.recommendation;
  if (!isObject(request) || request.schema !== STEP_MODEL_BRIDGE_VERSION)
    fail('MODEL_RECOMMENDATION_PROOF_INVALID');
  requestBody(request);
  const original = handoff.steps.find(s => s.stepId === request.stepId);
  const choice = original?.choices.find(c => c.optionId === request.optionId);
  if (!original || !choice || !isObject(request.k02Arguments) ||
      request.handoffDigest !== handoff.handoffDigest ||
      digest(request.k02Arguments.solution) !== digest(choice.k02Request) ||
      request.k02Arguments.requirementId !== choice.k02Request.requirements[0].requirementId ||
      request.k02Arguments.userModelPin === undefined ||
      digest(request.k02Arguments.userModelPin) !== digest(original.userModelPin) ||
      request.k02Arguments.step?.taskClass !== original.operation.kind ||
      request.k02Arguments.step?.difficulty !== LEVEL[original.complexity.level] ||
      request.k02Arguments.allowPinnedAlternatives !== false ||
      request.hostAuthorizesExecution !== false)
    fail('MODEL_RECOMMENDATION_PROOF_INVALID');
  if (!isObject(recommendation) ||
      recommendation.version !== K02_RECOMMENDATION_VERSION ||
      recommendation.contractVersion !== K02_VERSION ||
      recommendation.requirementId !== request.k02Arguments.requirementId ||
      recommendation.taskClass !== request.k02Arguments.step.taskClass ||
      recommendation.difficulty !== request.k02Arguments.step.difficulty ||
      recommendation.decision !== 'RECOMMENDED_NOT_AUTHORIZED' ||
      recommendation.hostAuthorityGranted !== false ||
      recommendation.executionState !== 'NOT_INVOKED' ||
      recommendation.proofOfInvoke !== null ||
      !isObject(recommendation.selected) ||
      !isObject(recommendation.selected.quality) ||
      recommendation.selected.quality.status !== 'MEETS_OBSERVED_FLOOR')
    fail('K02_RECOMMENDATION_NOT_QUALIFIED');
  const {selected: candidate} = recommendation;
  const {step} = request.k02Arguments;
  if (candidate.providerId !== selected.providerId ||
      candidate.capabilityDigest !== selected.capabilityDigest ||
      candidate.requirementId !== selected.requirementId ||
      candidate.capabilityId !== selected.capabilityId ||
      !isObject(candidate.modelPin) ||
      digest(candidate.modelPin) !== digest(selected.modelPin) ||
      (original.userModelPin &&
        digest(original.userModelPin) !== digest(candidate.modelPin)) ||
      !Number.isFinite(candidate.quality.observedRate) ||
      candidate.quality.observedRate < step.minObservedSuccessRate ||
      !Number.isSafeInteger(candidate.quality.samples) ||
      candidate.quality.samples < step.minSamples ||
      !str(candidate.quality.proofRef))
    fail('K02_RECOMMENDATION_SELECTION_MISMATCH');
  return {stepId:request.stepId, optionId:request.optionId,
    requestDigest:request.requestDigest,
    recommendationDigest:digest(recommendation),
    providerId:selected.providerId, capabilityDigest:selected.capabilityDigest,
    modelPin:copy(selected.modelPin),
    observedQualityProofRef:candidate.quality.proofRef,
    status:'OBSERVED_STEP_QUALITY_FLOOR_MET_NOT_RESULT_QUALITY'};
}

/**
 * Turn an EXISTING K04 step into K02 model selection arguments.
 * Numeric quality thresholds MUST come from the owner/host policy, never
 * inferred from K04's qualitative difficulty or converted into confidence.
 * K05 observations, provider profiles and availability stay host-owned.
 */
export function prepareK02ModelStepRequest(handoff, {stepId, optionId, policy, environment}) {
  checkHandoff(handoff);
  if (handoff.status !== 'READY_FOR_K02' || !str(stepId) || !str(optionId))
    fail('MODEL_STEP_NOT_READY');
  const step = handoff.steps.find(x => x.stepId === stepId);
  const choice = step?.choices.find(x => x.optionId === optionId);
  if (!step || step.status !== 'READY_FOR_K02' || !choice ||
      choice.k02Request?.requirements?.length !== 1 ||
      choice.k02Request.requirements[0].kind !== 'model')
    fail('MODEL_STEP_NOT_READY');
  if (!Object.hasOwn(LEVEL, step.complexity.level))
    fail('MODEL_STEP_DIFFICULTY_UNDETERMINED');
  checkPolicy(policy);
  keys(environment, ['operatingSystem'], 'K02_ENVIRONMENT_REQUIRED');
  if (!str(environment.operatingSystem) || environment.operatingSystem.length > 180)
    fail('K02_ENVIRONMENT_REQUIRED');
  const declaredLatency = step.resourceLimits.maxLatencyMs;
  const policyLatency = policy.maxLatencyMs;
  const maxLatencyMs = declaredLatency === null ? policyLatency :
    policyLatency === null ? declaredLatency : Math.min(declaredLatency, policyLatency);
  const body = {
    schema:STEP_MODEL_BRIDGE_VERSION, handoffDigest:handoff.handoffDigest,
    stepId, optionId, sourcePolicyRef:policy.policyRef,
    k02RecommendationVersion:K02_RECOMMENDATION_VERSION,
    k02Arguments:{
      solution:copy(choice.k02Request),
      requirementId:choice.k02Request.requirements[0].requirementId,
      step:{taskClass:step.operation.kind, difficulty:LEVEL[step.complexity.level],
        minObservedSuccessRate:policy.minObservedSuccessRate,
        minSamples:policy.minSamples, maxAttempts:policy.maxAttempts,
        maxLatencyMs, maxMemoryMiB:policy.maxMemoryMiB},
      environment:copy(environment),
      userModelPin:step.userModelPin ? copy(step.userModelPin) : null,
      allowPinnedAlternatives:false,
    },
    hostConditionsRemaining:{
      qualitativeCriteria:copy(step.qualityFloor.criteria),
      maxProviderFeeUsd:step.resourceLimits.maxProviderFeeUsd,
      maxOutputTokens:step.resourceLimits.maxOutputTokens,
      localOnly:step.resourceLimits.localOnly,
      qualityObservationSource:'HOST_SUPPLIES_K05_OR_OTHER_REAL_EVIDENCE',
      applyBeforeInvoke:true,
    },
    hostAuthorizesExecution:false,
  };
  return {...body, requestDigest:digest(body)};
}

/**
 * Join actual K02 qualified recommendations to standard K02 invocation plans.
 * Uses the unchanged legacy K04 binder first. No provider calls or authorization.
 * Tools do not need a model recommendation; every selected model does.
 */
export function bindK02RecommendedStepChoices(handoff, decisions, proofs = []) {
  checkHandoff(handoff);
  if (!Array.isArray(proofs) || !Array.isArray(decisions))
    fail('MODEL_RECOMMENDATION_PROOF_INVALID');
  const bound = bindK02StepChoices(handoff, decisions);
  const proofByStep = new Map();
  for (const packet of proofs) {
    if (!isObject(packet) || !isObject(packet.request) ||
        proofByStep.has(packet.request.stepId)) fail('MODEL_RECOMMENDATION_PROOF_INVALID');
    proofByStep.set(packet.request.stepId, packet);
  }
  if (proofByStep.size !== bound.steps.filter(s => s.selected.kind === 'model').length)
    fail('MODEL_RECOMMENDATION_PROOFS_REQUIRED');
  const qualified = [];
  for (const step of bound.steps) {
    const proof = proofByStep.get(step.stepId);
    if (step.selected.kind === 'model') {
      if (!proof) fail('MODEL_RECOMMENDATION_PROOFS_REQUIRED');
      const row = selectedModelProof(proof, handoff, step.selected);
      if (row.optionId !== step.optionId) fail('K02_RECOMMENDATION_SELECTION_MISMATCH');
      qualified.push(row);
    } else if (proof) fail('UNEXPECTED_MODEL_RECOMMENDATION');
  }
  const {bindingDigest:legacyBindingDigest} = bound;
  const body = {schema:STEP_MODEL_BINDING_VERSION, handoffDigest:handoff.handoffDigest,
    legacyBindingDigest, taskRef:bound.taskRef, hostPlanDigest:bound.hostPlanDigest,
    steps:copy(bound.steps), modelQualityObservations:qualified,
    modelRecommendationsChecked:true, actualTaskQualityVerified:false,
    hostAuthorityGranted:false, executionState:'NOT_INVOKED',
    resultProduced:false};
  return {...body, bindingDigest:digest(body)};
}
