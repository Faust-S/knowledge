import {createHash} from 'node:crypto';

export const CONTRACT_VERSION = 'IWXA.K04.SOLUTION/0.1.0';
export const PLAN_VERSION = 'IWXA.K04.HOST_PLAN/0.1.0';
export const K02_VERSION = 'IWXA.K02.INTEROP/0.1.0';
export const K02_SKILL_VERSION = 'IWXA.K02.SKILL/0.1.0';
const MAX_INPUT_BYTES = 1_000_000;

export class ComposerError extends Error {
  constructor(code, detail = '') {
    super(code + (detail ? ':' + detail : ''));
    this.name = 'ComposerError';
    this.code = code;
  }
}
const fail = (code, detail = '') => { throw new ComposerError(code, detail); };
const obj = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const str = value => typeof value === 'string' && value.trim().length > 0;
const copy = value => JSON.parse(JSON.stringify(value));
const stable = value => Array.isArray(value) ? value.map(stable) :
  obj(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])) : value;

export function digest(value) {
  let serialized;
  try { serialized = JSON.stringify(stable(value)); } catch { fail('NON_JSON_INPUT'); }
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > 2_000_000) fail('NON_JSON_INPUT');
  return createHash('sha256').update(serialized).digest('hex');
}
function requirements(solution) {
  if (!obj(solution) || solution.schema !== CONTRACT_VERSION ||
    !str(solution.id) || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(solution.version) ||
    !Array.isArray(solution.taskKinds) || !solution.taskKinds.length ||
    !Array.isArray(solution.inputs) || !obj(solution.requires) ||
    !Array.isArray(solution.requires.fixed) || !solution.requires.fixed.length ||
    !Array.isArray(solution.requires.alternatives) || !solution.requires.alternatives.length ||
    !Array.isArray(solution.requires.skills) || !solution.requires.skills.length ||
    !Array.isArray(solution.stages) || solution.stages.join(',') !== 'input,extract,audit,human_review' ||
    !Array.isArray(solution.allowedExternalEffects) || solution.allowedExternalEffects.length ||
    !obj(solution.provenance) || solution.provenance.thirdPartyCodeCopied !== false ||
    !obj(solution.qualification) || solution.qualification.iwxaVerified !== false)
    fail('INVALID_SOLUTION');
  const seen = new Set();
  for (const r of [...solution.requires.fixed, ...solution.requires.alternatives]) {
    if (!obj(r) || !str(r.requirementId) || !str(r.capabilityId) ||
      !['model', 'tool'].includes(r.kind) || !str(r.effectClass) ||
      !obj(r.inputSchema) || !obj(r.outputSchema) || seen.has(r.requirementId))
      fail('INVALID_REQUIREMENT');
    seen.add(r.requirementId);
  }
  for (const s of solution.requires.skills) {
    if (!obj(s) || !str(s.skillId) || s.schema !== K02_SKILL_VERSION) fail('INVALID_SKILL_REQUIREMENT');
  }
  return solution;
}
export function describeSolution(id, version, registry) {
  if (!str(id) || !str(version) || !Array.isArray(registry)) fail('INVALID_LOOKUP');
  const matching = registry.filter(item => item?.id === id && item?.version === version);
  if (matching.length !== 1) fail(matching.length ? 'DUPLICATE_SOLUTION' : 'SOLUTION_NOT_FOUND');
  return copy(requirements(matching[0]));
}
export function matchTask(task, solutions) {
  if (!obj(task) || !str(task.taskId) || !str(task.kind) || !obj(task.input) ||
    !Array.isArray(solutions)) fail('INVALID_TASK');
  const candidates = solutions.map(def => {
    const solution = requirements(def);
    const kindMatched = solution.taskKinds.includes(task.kind);
    const missing = solution.inputs.filter(field => field.required &&
      (!str(task.input[field.name]) ||
        (field.minLength && task.input[field.name].length < field.minLength))).map(field => field.name);
    return {id: solution.id, version: solution.version, kindMatched,
      missingInputs: missing, status: kindMatched ? (missing.length ? 'NEEDS_INPUT' : 'CANDIDATE') : 'NOT_MATCHED'};
  }).filter(r => r.kindMatched).sort((a, b) => a.id.localeCompare(b.id) || a.version.localeCompare(b.version));
  return {schema: CONTRACT_VERSION, taskId: task.taskId, candidates,
    alternative: {mode: 'model_skills', hostResolutionRequired: true, allowed: true},
    taskCreated: false, executionStarted: false};
}
function findProvider(req, providers) {
  const reasons = new Set();
  const matches = [];
  for (const provider of providers) {
    if (!obj(provider) || provider.contractVersion !== K02_VERSION ||
      !str(provider.providerId) || !Array.isArray(provider.capabilities)) {
      reasons.add('INVALID_PROVIDER_DESCRIPTOR'); continue;
    }
    const cap = provider.capabilities.find(x => obj(x) &&
      x.kind === req.kind && x.capabilityId === req.capabilityId);
    if (!cap) continue;
    if (provider.availability !== 'available') { reasons.add('UNAVAILABLE'); continue; }
    if (cap.supported !== true) { reasons.add('UNSUPPORTED'); continue; }
    if (cap.effectClass !== req.effectClass) { reasons.add('EFFECT_MISMATCH'); continue; }
    if (digest(cap.inputSchema) !== digest(req.inputSchema) ||
        digest(cap.outputSchema) !== digest(req.outputSchema)) {
      reasons.add('SCHEMA_MISMATCH'); continue;
    }
    if (req.kind === 'model' &&
      (req.inputModes || []).some(mode => !cap.inputModes?.includes(mode))) {
      reasons.add('MODE_MISMATCH'); continue;
    }
    if (req.kind === 'model' &&
      (req.outputModes || []).some(mode => !cap.outputModes?.includes(mode))) {
      reasons.add('MODE_MISMATCH'); continue;
    }
    if (req.modelPin && (!cap.modelPin || digest(req.modelPin) !== digest(cap.modelPin))) {
      reasons.add('PIN_MISMATCH'); continue;
    }
    matches.push({requirementId: req.requirementId, kind: req.kind,
      capabilityId: req.capabilityId, effectClass: req.effectClass,
      providerId: provider.providerId, descriptorDigest: digest({providerId: provider.providerId, cap})});
  }
  matches.sort((a, b) => a.providerId.localeCompare(b.providerId, 'en'));
  return {match: matches[0] ?? null, reason: [...reasons].sort()[0] ?? 'ABSENT'};
}
export function resolveRequiredCapabilities(solution, available, options = {}) {
  requirements(solution);
  if (!obj(available) || !Array.isArray(available.providers) ||
      !Array.isArray(available.skills) || !obj(options)) fail('INVALID_AVAILABILITY');
  const selected = [], missing = [];
  for (const req of solution.requires.fixed) {
    const r = findProvider(req, available.providers);
    if (r.match) selected.push(r.match);
    else missing.push({requirementId: req.requirementId, reason: r.reason});
  }
  const ordered = [...solution.requires.alternatives];
  if (options.preferOption) {
    if (!ordered.some(r => r.requirementId === options.preferOption)) fail('UNKNOWN_OPTION');
    ordered.sort((a, b) => (a.requirementId === options.preferOption ? -1 :
      b.requirementId === options.preferOption ? 1 : 0));
  }
  let chosenOption = null;
  for (const req of ordered) {
    const r = findProvider(req, available.providers);
    if (r.match) { chosenOption = req.requirementId; selected.push(r.match); break; }
  }
  if (!chosenOption) missing.push({requirementId: 'extraction_alternative', reason: 'NO_COMPATIBLE_OPTION'});
  const skills = [];
  for (const req of solution.requires.skills) {
    const skill = available.skills.find(s => obj(s) && s.schema === req.schema &&
      s.skillId === req.skillId && Array.isArray(s.requiredCapabilities));
    if (!skill) { missing.push({skillId: req.skillId, reason: 'SKILL_ABSENT'}); continue; }
    if (skill.requiredCapabilities.some(id => !selected.some(s => s.capabilityId === id))) {
      missing.push({skillId: req.skillId, reason: 'SKILL_CAPABILITY_MISSING'}); continue;
    }
    skills.push({skillId: skill.skillId, descriptorDigest: digest(skill)});
  }
  return {schema: CONTRACT_VERSION, solutionId: solution.id, solutionVersion: solution.version,
    status: missing.length ? 'UNSUPPORTED' : 'SUPPORTED', chosenOption, selected, skills, missing,
    hostAuthorityGranted: false, invocationOccurred: false};
}
function validateTask(task, solution = null) {
  if (!obj(task) || !str(task.taskId) || !str(task.kind) ||
    !obj(task.input) || !str(task.input.transcript_text) ||
    Buffer.byteLength(task.input.transcript_text) > MAX_INPUT_BYTES ||
    !obj(task.source) || !str(task.source.ref) || !str(task.source.revision) ||
    !str(task.source.rights) || task.source.authorized !== true) fail('INVALID_OR_UNAUTHORIZED_INPUT');
  if (solution && (!solution.taskKinds.includes(task.kind) || solution.inputs.some(
    f => f.required && (!str(task.input[f.name]) || task.input[f.name].length < (f.minLength ?? 1))))) {
    fail('TASK_NOT_ELIGIBLE');
  }
}
export function createHostNeutralPlan({task, solution = null, resolution, mode = 'solution', selectedSkills = []}) {
  if (!['solution', 'model_skills'].includes(mode) || !obj(resolution) ||
    resolution.status !== 'SUPPORTED' || resolution.hostAuthorityGranted === true ||
    !Array.isArray(selectedSkills)) fail('INVALID_PLAN_INPUT');
  if (mode === 'solution') {
    requirements(solution);
    validateTask(task, solution);
    if (resolution.schema !== CONTRACT_VERSION || resolution.solutionId !== solution.id ||
      resolution.solutionVersion !== solution.version ||
      !solution.requires.fixed.every(r => resolution.selected?.some(s => s.requirementId === r.requirementId)) ||
      !solution.requires.alternatives.some(r => r.requirementId === resolution.chosenOption &&
        resolution.selected?.some(s => s.requirementId === r.requirementId)) ||
      !solution.requires.skills.every(r => resolution.skills?.some(s => s.skillId === r.skillId))) {
      fail('UNRESOLVED_REQUIREMENTS');
    }
  } else {
    validateTask(task);
    if (solution !== null || !resolution.selected?.some(s => s.kind === 'model' && s.capabilityId === 'text.generate') ||
      !selectedSkills.length || selectedSkills.some(s => !str(s))) fail('MODEL_SKILLS_NOT_RESOLVED');
  }
  const common = {schema: PLAN_VERSION, mode, taskRef: task.taskId,
    input: {sourceRef: task.source.ref, sourceRevision: task.source.revision,
      sourceRights: task.source.rights, transcriptDigest: digest(task.input.transcript_text)},
    solutionRef: mode === 'solution' ? {id: solution.id, version: solution.version} : null,
    branches: mode === 'solution' ? {extraction: resolution.chosenOption} : null,
    hostApprovalRequired: true, executionState: 'NOT_EXECUTED',
    resultState: 'NOT_PRODUCED', externalEffectsAuthorized: false};
  const selected = resolution.selected;
  const steps = mode === 'solution'
    ? [{id: 'input', type: 'HOST_INPUT', authorizedSourceRef: task.source.ref},
      {id: 'extract', type: 'CAPABILITY_REQUEST', dependsOn: ['input'],
        selected: copy(selected.find(s => s.requirementId === resolution.chosenOption))},
      {id: 'audit', type: 'CAPABILITY_REQUEST', dependsOn: ['extract'],
        selected: copy(selected.find(s => s.requirementId === solution.requires.fixed[0].requirementId))},
      {id: 'human_review', type: 'HOST_GATE', dependsOn: ['audit'],
        decision: 'PENDING', createsTask: false, authorizesExternalEffects: false}]
    : [{id: 'model', type: 'CAPABILITY_REQUEST', selected: copy(selected.find(s =>
        s.kind === 'model' && s.capabilityId === 'text.generate'))},
      {id: 'skills', type: 'HOST_SKILLS_REQUEST', selectedSkillIds: [...selectedSkills],
        dependsOn: ['model']},
      {id: 'human_review', type: 'HOST_GATE', decision: 'PENDING', dependsOn: ['skills']}];
  const plan = {...common, steps};
  return {...plan, planDigest: digest(plan)};
}
export function checkMeetingEvidence(transcript, draft) {
  const errors = [];
  if (!str(transcript) || !obj(draft) ||
      !Array.isArray(draft.action_items) || !Array.isArray(draft.open_questions))
    return {passed: false, errors: ['INVALID_DRAFT'], accepted: []};
  const chars = Array.from(transcript);
  const seen = new Set(), accepted = [];
  if (!draft.action_items.length && !draft.open_questions.length) errors.push('EMPTY_WITHOUT_QUESTION');
  for (const [index, item] of draft.action_items.entries()) {
    const code = 'ITEM_' + index + '_';
    if (!obj(item) || !str(item.action) || !str(item.quote) ||
      !Number.isSafeInteger(item.start) || !Number.isSafeInteger(item.end) ||
      item.start < 0 || item.end <= item.start || item.end > chars.length ||
      chars.slice(item.start, item.end).join('') !== item.quote) {
      errors.push(code + 'SOURCE_MISMATCH'); continue;
    }
    if (!str(item.assignee) || !str(item.due_date) ||
      (item.assignee !== 'UNKNOWN' && !item.quote.includes(item.assignee)) ||
      (item.due_date !== 'UNKNOWN' && !item.quote.includes(item.due_date))) {
      errors.push(code + 'UNSUPPORTED_ASSIGNMENT'); continue;
    }
    if (item.worker_kind !== (item.assignee === 'UNKNOWN' ? 'unassigned' : 'human') ||
      item.actual_work_status !== 'NOT_EXECUTED') {
      errors.push(code + 'WORKER_OR_EXECUTION_CLAIM'); continue;
    }
    const key = JSON.stringify([item.start, item.end, item.action, item.assignee, item.due_date]);
    if (seen.has(key)) { errors.push(code + 'DUPLICATE'); continue; }
    seen.add(key);
    accepted.push(item);
  }
  if (draft.open_questions.some(q => !str(q))) errors.push('INVALID_QUESTIONS');
  return {passed: errors.length === 0, errors, accepted};
}
export function evaluateResultAgainstCriteria(observation) {
  const errors = [];
  if (!obj(observation) || !obj(observation.plan) ||
    observation.plan.schema !== PLAN_VERSION || observation.plan.mode !== 'solution')
    return {passed: false, status: 'REVIEW_REQUIRED', errors: ['INVALID_PLAN']};
  const {plan, transcript, draft, receipts} = observation;
  const {planDigest, ...unsigned} = plan;
  if (planDigest !== digest(unsigned)) errors.push('PLAN_DIGEST_MISMATCH');
  if (!str(transcript) || digest(transcript) !== plan.input?.transcriptDigest)
    errors.push('SOURCE_DIGEST_MISMATCH');
  const verified = checkMeetingEvidence(transcript, draft);
  errors.push(...verified.errors);
  if (!Array.isArray(receipts)) errors.push('RECEIPTS_REQUIRED');
  else {
    if (receipts.length !== 2 || new Set(receipts.map(r => r?.stepId)).size !== 2)
      errors.push('RECEIPT_COUNT');
    for (const stepId of ['extract', 'audit']) {
      const receipt = receipts.find(r => r?.stepId === stepId);
      const step = plan.steps.find(s => s.id === stepId);
      if (!obj(receipt) || !step || receipt.status !== 'SUCCEEDED' ||
        receipt.providerId !== step.selected?.providerId ||
        receipt.capabilityId !== step.selected?.capabilityId ||
        !obj(receipt.output) || receipt.outputDigest !== digest(receipt.output)) {
        errors.push('RECEIPT_INVALID_' + stepId); continue;
      }
      if (stepId === 'extract' && digest(receipt.output) !== digest(draft))
        errors.push('EXTRACT_OUTPUT_MISMATCH');
      if (stepId === 'audit' &&
        (receipt.output.passed !== true || !Array.isArray(receipt.output.errors) ||
         receipt.output.errors.length || digest(receipt.output.accepted) !== digest(draft?.action_items)))
        errors.push('AUDIT_OUTPUT_MISMATCH');
    }
  }
  const review = observation.humanReview?.status ?? 'PENDING';
  if (!['PENDING', 'APPROVED', 'REJECTED'].includes(review)) errors.push('INVALID_HUMAN_REVIEW');
  const report = observation.taskReport?.status ?? 'NOT_SUBMITTED';
  if (!['NOT_SUBMITTED', 'SUBMITTED', 'ACCEPTED', 'REJECTED'].includes(report))
    errors.push('INVALID_TASK_REPORT');
  const status = errors.length ? 'REVIEW_REQUIRED' :
    review === 'PENDING' ? 'DRAFT_READY_FOR_HUMAN_REVIEW' :
    review === 'REJECTED' ? 'DRAFT_REJECTED_BY_HUMAN' : 'DRAFT_REVIEWED';
  return {passed: errors.length === 0 && review !== 'REJECTED', status, errors,
    quoteEvidenceVerified: verified.passed && errors.length === 0,
    humanReviewStatus: review, taskReportStatus: report,
    assignmentsExecuted: false, goalCompletionAttested: false,
    hostGoalDecisionObserved: observation.goalDecision?.status ?? 'NOT_DECIDED',
    taskCreated: false, externalEffectsPerformed: false};
}
