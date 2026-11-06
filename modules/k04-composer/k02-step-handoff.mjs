import {digest, ComposerError, K02_VERSION} from './index.mjs';

export const STEP_HANDOFF_VERSION = 'IWXA.K04.K02_STEP_REQUIREMENTS/0.1.0';
export const STEP_BINDING_VERSION = 'IWXA.K04.K02_STEP_BINDINGS/0.1.0';
const K02_BINDING_VERSION = 'IWXA.K02.PLAN_BINDING/0.1.0';
const MODEL_CHECKS = new Set(['SCHEMA_VALID','SOURCE_GROUNDED','INDEPENDENT_REPLAY','UNIT_TESTS','HUMAN_REVIEW','MANUAL_CHECK']);
const COMPLEXITY = new Set(['LOW','MODERATE','HIGH','UNDETERMINED']);
const QUALITY = new Set(['BASIC','SOURCE_GROUNDED','TESTED']);
const STEP_TYPES = new Set(['CAPABILITY_REQUEST','HOST_TRANSFORM','HOST_INPUT','HOST_GATE','HOST_SKILLS_REQUEST']);
const reqKeys = new Set(['requirementId','kind','capabilityId','inputSchema','outputSchema','effectClass','required','inputModes','outputModes','modelPin']);
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,159}$/;
const sha = /^[a-f0-9]{64}$/;
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const string = x => typeof x === 'string' && x.length > 0 && x.trim() === x;
const clone = x => JSON.parse(JSON.stringify(x));
function reject(code) { throw new ComposerError(code); }
function keys(value, allowed, code) {
  if (!plain(value) || Object.keys(value).some(k => !allowed.includes(k))) reject(code);
}
function ident(x, code) { if (!string(x) || !idPattern.test(x)) reject(code); }
function pin(value) {
  keys(value, ['name','digest'], 'MODEL_PIN_INVALID');
  ident(value.name, 'MODEL_PIN_INVALID');
  if (!sha.test(value.digest ?? '') || value.name.toLowerCase().endsWith(':cloud')) reject('MODEL_PIN_INVALID');
  return clone(value);
}
function checkRequirement(value) {
  if (!plain(value) || Object.keys(value).some(k => !reqKeys.has(k)))
    reject('INVALID_K02_REQUIREMENT');
  ident(value.requirementId, 'INVALID_K02_REQUIREMENT');
  ident(value.capabilityId, 'INVALID_K02_REQUIREMENT');
  ident(value.effectClass, 'INVALID_K02_REQUIREMENT');
  if (!['model','tool'].includes(value.kind) || !plain(value.inputSchema) ||
      !plain(value.outputSchema) || (value.required !== undefined && value.required !== true))
    reject('INVALID_K02_REQUIREMENT');
  if (value.kind === 'model') {
    if (!Array.isArray(value.inputModes) || !value.inputModes.length ||
        !Array.isArray(value.outputModes) || !value.outputModes.length)
      reject('INVALID_K02_REQUIREMENT');
    if (value.modelPin !== undefined) pin(value.modelPin);
  } else if (value.inputModes !== undefined || value.outputModes !== undefined ||
             value.modelPin !== undefined) reject('INVALID_K02_REQUIREMENT');
  return {...clone(value), required:true};
}
function checkProfile(profile) {
  keys(profile, ['stepId','operation','requiredInputs','complexity','qualityFloor',
    'resourceLimits','modelRequired','deterministicAllowed','preserveUserModelPin','choices'], 'INVALID_STEP_PROFILE');
  ident(profile.stepId, 'INVALID_STEP_PROFILE');
  keys(profile.operation, ['kind','purpose'], 'INVALID_OPERATION');
  ident(profile.operation.kind, 'INVALID_OPERATION');
  if (!string(profile.operation.purpose) || profile.operation.purpose.length > 240)
    reject('INVALID_OPERATION');
  if (!Array.isArray(profile.requiredInputs) || profile.requiredInputs.some(x => !string(x)) ||
      new Set(profile.requiredInputs).size !== profile.requiredInputs.length)
    reject('INVALID_REQUIRED_INPUTS');
  keys(profile.complexity, ['level','signals'], 'INVALID_COMPLEXITY');
  if (!COMPLEXITY.has(profile.complexity.level) || !Array.isArray(profile.complexity.signals) ||
      profile.complexity.signals.length > 12) reject('INVALID_COMPLEXITY');
  for (const signal of profile.complexity.signals) {
    keys(signal, ['kind','evidenceRef','detail'], 'INVALID_COMPLEXITY');
    ident(signal.kind, 'INVALID_COMPLEXITY');
    if (!string(signal.evidenceRef) || !string(signal.detail) ||
        signal.detail.length > 240) reject('INVALID_COMPLEXITY');
  }
  if (profile.complexity.level !== 'UNDETERMINED' && !profile.complexity.signals.length)
    reject('COMPLEXITY_EVIDENCE_REQUIRED');
  keys(profile.qualityFloor, ['level','criteria'], 'INVALID_QUALITY_FLOOR');
  if (!QUALITY.has(profile.qualityFloor.level) || !Array.isArray(profile.qualityFloor.criteria) ||
      !profile.qualityFloor.criteria.length || profile.qualityFloor.criteria.length > 20)
    reject('INVALID_QUALITY_FLOOR');
  const criterionIds = new Set();
  for (const c of profile.qualityFloor.criteria) {
    keys(c, ['id','check','evidenceRef'], 'INVALID_QUALITY_FLOOR');
    ident(c.id, 'INVALID_QUALITY_FLOOR');
    if (!MODEL_CHECKS.has(c.check) || !string(c.evidenceRef) ||
        criterionIds.has(c.id)) reject('INVALID_QUALITY_FLOOR');
    criterionIds.add(c.id);
  }
  keys(profile.resourceLimits, ['maxProviderFeeUsd','maxLatencyMs','maxOutputTokens','localOnly'], 'INVALID_RESOURCE_LIMITS');
  const r = profile.resourceLimits;
  if (typeof r.localOnly !== 'boolean') reject('INVALID_RESOURCE_LIMITS');
  if (r.maxProviderFeeUsd !== null && (typeof r.maxProviderFeeUsd !== 'number' ||
      !Number.isFinite(r.maxProviderFeeUsd) || r.maxProviderFeeUsd < 0))
    reject('INVALID_RESOURCE_LIMITS');
  for (const field of ['maxLatencyMs','maxOutputTokens'])
    if (r[field] !== null && (!Number.isSafeInteger(r[field]) || r[field] < 1))
      reject('INVALID_RESOURCE_LIMITS');
  for (const b of ['modelRequired','deterministicAllowed','preserveUserModelPin'])
    if (typeof profile[b] !== 'boolean') reject('INVALID_STEP_PROFILE');
  if (!Array.isArray(profile.choices) || !profile.choices.length ||
      profile.choices.length > 8) reject('INVALID_STEP_PROFILE');
  const ids = new Set();
  let models = 0, tools = 0;
  for (const choice of profile.choices) {
    keys(choice, ['optionId','requirement'], 'INVALID_STEP_CHOICE');
    ident(choice.optionId, 'INVALID_STEP_CHOICE');
    if (ids.has(choice.optionId)) reject('DUPLICATE_OPTION');
    ids.add(choice.optionId);
    const req = checkRequirement(choice.requirement);
    if (req.kind === 'model') models++; else tools++;
  }
  if (profile.modelRequired && (!models || tools) ||
      !profile.modelRequired && !profile.deterministicAllowed && tools ||
      tools && !profile.deterministicAllowed)
    reject('INVALID_MODEL_OPTIONALITY');
  if (profile.preserveUserModelPin && !models) reject('INVALID_MODEL_OPTIONALITY');
}

/** K04 exports per-step task requirements, without ranking providers or invoking K02. */
export function prepareK02StepHandoff({plan, profiles, availableInputs = [], userModelPins = {}}) {
  if (!plain(plan) || !string(plan.taskRef) || !Array.isArray(plan.steps) ||
      !plan.steps.length || !Array.isArray(profiles) || !plain(userModelPins) ||
      !Array.isArray(availableInputs) || availableInputs.some(x => !string(x)))
    reject('INVALID_HOST_PLAN');
  if (plan.planDigest !== undefined) {
    if (!sha.test(plan.planDigest)) reject('HOST_PLAN_DIGEST_MISMATCH');
    const {planDigest, ...body} = plan;
    if (digest(body) !== planDigest) reject('HOST_PLAN_DIGEST_MISMATCH');
  }
  const seen = new Set(), actionable = [];
  for (const step of plan.steps) {
    if (!plain(step) || !string(step.id) || !STEP_TYPES.has(step.type) ||
        seen.has(step.id)) reject('INVALID_HOST_PLAN');
    seen.add(step.id);
    if (step.type === 'CAPABILITY_REQUEST') actionable.push(step);
  }
  if (profiles.length !== actionable.length || !profiles.length) reject('STEP_COVERAGE_MISMATCH');
  if (Object.keys(userModelPins).some(id => !seen.has(id))) reject('UNEXPECTED_USER_MODEL_PIN');
  const inputs = new Set(availableInputs), profileIds = new Set();
  const steps = [];
  for (const p of profiles) {
    checkProfile(p);
    if (profileIds.has(p.stepId)) reject('DUPLICATE_STEP_PROFILE');
    profileIds.add(p.stepId);
    const planStep = actionable.find(s => s.id === p.stepId);
    if (!planStep) reject('STEP_COVERAGE_MISMATCH');
    const hasPin = Object.hasOwn(userModelPins, p.stepId);
    if (hasPin && !p.preserveUserModelPin) reject('UNEXPECTED_USER_MODEL_PIN');
    const userPin = hasPin ? pin(userModelPins[p.stepId]) : null;
    const missingInputs = p.requiredInputs.filter(x => !inputs.has(x));
    const choices = p.choices.map(choice => {
      const req = checkRequirement(choice.requirement);
      if (userPin && req.kind === 'model') {
        if (req.modelPin && digest(req.modelPin) !== digest(userPin))
          reject('USER_MODEL_PIN_CONFLICT');
        req.modelPin = clone(userPin);
      }
      const solutionId = 'k04-step-' + digest([plan.taskRef,p.stepId,choice.optionId]).slice(0,32);
      return {optionId:choice.optionId, k02Request:{
        solutionId, requirements:[req],
      }, k02ContractVersion:K02_VERSION};
    });
    if (userPin && !choices.some(c => c.k02Request.requirements[0].kind === 'model'))
      reject('UNEXPECTED_USER_MODEL_PIN');
    steps.push({stepId:p.stepId, operation:clone(p.operation),
      complexity:clone(p.complexity), qualityFloor:clone(p.qualityFloor),
      resourceLimits:clone(p.resourceLimits),
      modelRequired:p.modelRequired, deterministicAllowed:p.deterministicAllowed,
      preserveUserModelPin:p.preserveUserModelPin,
      userModelPin:userPin, missingInputs,
      status:missingInputs.length ? 'NEEDS_INPUT' : 'READY_FOR_K02',
      choices:missingInputs.length ? [] : choices,
      unboundAlternatives:missingInputs.length ? choices.map(x => x.optionId) : [],
      previousSelection:planStep.selected ? clone(planStep.selected) : null});
  }
  if (actionable.some(s => !profileIds.has(s.id))) reject('STEP_COVERAGE_MISMATCH');
  const body={schema:STEP_HANDOFF_VERSION, taskRef:plan.taskRef,
    hostPlanDigest:plan.planDigest ?? digest(plan),
    status:steps.some(s => s.status==='NEEDS_INPUT') ? 'NEEDS_INPUT' : 'READY_FOR_K02',
    steps, evaluationOwnership:'K02',
    priceRankingPerformed:false, qualityRankingPerformed:false,
    qualityAndResourceHintsStatus:'K02_EXTENSION_REQUIRED',
    hostAuthorizationGranted:false, modelInvocationOccurred:false};
  return {...body, handoffDigest:digest(body)};
}
function assertHandoff(handoff) {
  if (!plain(handoff) || handoff.schema !== STEP_HANDOFF_VERSION ||
      !sha.test(handoff.handoffDigest ?? '')) reject('INVALID_HANDOFF');
  const {handoffDigest,...body}=handoff;
  if (digest(body)!==handoffDigest) reject('HANDOFF_CHANGED');
}
function validateK02Decision(entry, choice) {
  const r=entry.resolution, p=entry.invocationPlan, req=choice.k02Request.requirements[0];
  if (!plain(r) || r.contractVersion !== K02_VERSION ||
      r.solutionId !== choice.k02Request.solutionId ||
      r.status !== 'SUPPORTED' || !Array.isArray(r.selected) || r.selected.length !== 1 ||
      !Array.isArray(r.missing) || r.missing.length ||
      !plain(p) || p.contractVersion !== K02_VERSION ||
      p.bindingVersion !== K02_BINDING_VERSION || p.solutionId !== r.solutionId ||
      !sha.test(p.planDigest ?? '') || !Array.isArray(p.steps) ||
      p.steps.length !== 1 || !sha.test(r.selected[0]?.capabilityDigest ?? ''))
    reject('K02_SELECTION_INVALID');
  const {planDigest,...unsigned}=p;
  if (digest(unsigned) !== planDigest) reject('K02_PLAN_DIGEST_MISMATCH');
  const selected = r.selected[0], step=p.steps[0];
  if (selected.requirementId !== req.requirementId ||
      selected.kind !== req.kind || selected.capabilityId !== req.capabilityId ||
      selected.effectClass !== req.effectClass ||
      digest(selected.inputSchema) !== digest(req.inputSchema) ||
      digest(selected.outputSchema) !== digest(req.outputSchema) ||
      step.requirementId !== req.requirementId ||
      step.capabilityDigest !== selected.capabilityDigest ||
      step.providerId !== selected.providerId ||
      step.kind !== selected.kind || step.capabilityId !== selected.capabilityId ||
      step.hostApprovalRequired !== true ||
      step.invocationAuthority !== 'HOST_ONLY' || step.invocationState !== 'NOT_INVOKED' ||
      step.proofOfInvoke !== null)
    reject('K02_SELECTION_INVALID');
  if (req.kind === 'model') {
    if (!plain(selected.modelPin) || !plain(step.modelPin) ||
        digest(selected.modelPin) !== digest(step.modelPin) ||
        (req.modelPin && digest(req.modelPin) !== digest(selected.modelPin)))
      reject('K02_MODEL_PIN_CHANGED');
  }
  return {k02PlanDigest:p.planDigest, selected:clone(selected),
    status:'K02_SELECTED_HOST_NOT_AUTHORIZED',
    hostRevalidationRequired:true};
}
/** Bind K02-selected per-step plans; the host owns readiness and all execution. */
export function bindK02StepChoices(handoff, decisions) {
  assertHandoff(handoff);
  if (handoff.status !== 'READY_FOR_K02' || !Array.isArray(decisions) ||
      decisions.length !== handoff.steps.length)
    reject('K02_HANDOFF_NOT_READY');
  const ids = new Set(), bound = [];
  for (const d of decisions) {
    keys(d, ['stepId','optionId','resolution','invocationPlan'], 'K02_SELECTION_INVALID');
    ident(d.stepId, 'K02_SELECTION_INVALID');
    if (ids.has(d.stepId)) reject('K02_SELECTION_INVALID');
    ids.add(d.stepId);
    const step = handoff.steps.find(s => s.stepId === d.stepId);
    const choice = step?.choices.find(c => c.optionId === d.optionId);
    if (!choice || step.status !== 'READY_FOR_K02') reject('K02_SELECTION_INVALID');
    const verified=validateK02Decision(d, choice);
    if (step.userModelPin && verified.selected.kind === 'model' &&
        digest(verified.selected.modelPin) !== digest(step.userModelPin))
      reject('K02_MODEL_PIN_CHANGED');
    // Enforce declared hard resource limits, never rank candidates here.
    // Missing cost/latency evidence must not imply compliance.
    const limits=step.resourceLimits;
    const selected=verified.selected;
    if (limits.maxProviderFeeUsd !== null) {
      if (selected.providerFeeUsd === null || selected.providerFeeUsd === undefined)
        reject('RESOURCE_COST_NOT_MEASURED');
      if (selected.providerFeeUsd > limits.maxProviderFeeUsd)
        reject('RESOURCE_COST_EXCEEDED');
    }
    if (limits.maxLatencyMs !== null) {
      if (selected.latencyMsP50 === null || selected.latencyMsP50 === undefined)
        reject('RESOURCE_LATENCY_NOT_MEASURED');
      if (selected.latencyMsP50 > limits.maxLatencyMs)
        reject('RESOURCE_LATENCY_EXCEEDED');
    }
    // K02 provider descriptors cannot independently attest localOnly.
    // The consuming host must verify it before it invokes any capability.

    if (step.modelRequired && verified.selected.kind !== 'model' ||
        !step.deterministicAllowed && verified.selected.kind === 'tool')
      reject('K02_SELECTION_INVALID');
    // A legacy K04 selection is merely a candidate, never an authority to
    // overrule K02's own model/provider choice. Only a user pin is binding.
    bound.push({stepId:step.stepId, operation:clone(step.operation),
      optionId:d.optionId, ...verified,
      userModelPin:step.userModelPin});
  }
  const body={schema:STEP_BINDING_VERSION, handoffDigest:handoff.handoffDigest,
    taskRef:handoff.taskRef, hostPlanDigest:handoff.hostPlanDigest,
    steps:handoff.steps.map(s=>bound.find(b=>b.stepId===s.stepId)),
    qualityVerified:false, resourceLimitsVerified:false,
    modelInvocationOccurred:false, hostAuthorizationGranted:false,
    resultProduced:false};
  return {...body, bindingDigest:digest(body)};
}
