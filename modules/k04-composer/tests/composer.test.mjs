import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  CONTRACT_VERSION, PLAN_VERSION, ComposerError, describeSolution, matchTask,
  resolveRequiredCapabilities, resolveModelAndSkills, createHostNeutralPlan, checkMeetingEvidence,
  evaluateResultAgainstCriteria
} from '../index.mjs';
import {solution, sampleAvailability, runOpenHost, extractStructuredMeeting} from '../sample/open-host.mjs';

const err = code => e => e instanceof ComposerError && e.code === code;
const transcript = await readFile(new URL('../sample/meeting.txt', import.meta.url), 'utf8');
const clone = x => structuredClone(x);
function task() {
  return {taskId: 'K04-001', kind: 'meeting_followup', input: {transcript_text: transcript},
    source: {ref: 'fixture', revision: '1', rights: 'AUTHOR_OWNED', authorized: true}};
}
const resolve = (available = sampleAvailability(), options = {}) =>
  resolveRequiredCapabilities(solution, available, options);
const plan = () => createHostNeutralPlan({task: task(), solution, resolution: resolve()});
async function observation() {
  const r = await runOpenHost();
  return {plan: r.plan, transcript, draft: r.draft, receipts: r.receipts,
    humanReview: {status: 'PENDING'}, taskReport: {status: 'NOT_SUBMITTED'},
    goalDecision: {status: 'NOT_DECIDED'}};
}
test('lookup exact version, no duplicated catalog item or verified claim', () => {
  assert.equal(describeSolution(solution.id, solution.version, [solution]).schema, CONTRACT_VERSION);
  assert.throws(() => describeSolution(solution.id, '9.9.9', [solution]), err('SOLUTION_NOT_FOUND'));
  assert.throws(() => describeSolution(solution.id, solution.version, [solution, solution]), err('DUPLICATE_SOLUTION'));
  assert.equal(solution.qualification.iwxaVerified, false);
  assert.equal(solution.qualification.twoColdRestartsVerified, false);
});
test('matching task and missing inputs, direct model+Skills alternative', () => {
  assert.equal(matchTask(task(), [solution]).candidates[0].status, 'CANDIDATE');
  assert.equal(matchTask(task(), [solution]).alternative.mode, 'model_skills');
  const missing = task(); missing.input = {transcript_text: ''};
  assert.deepEqual(matchTask(missing, [solution]).candidates[0].missingInputs, ['transcript_text']);
  const unrelated = task(); unrelated.kind = 'code_review';
  assert.deepEqual(matchTask(unrelated, [solution]).candidates, []);
});
test('K02 compatible capabilities and Skill, no authority granted', () => {
  const r = resolve();
  assert.equal(r.status, 'SUPPORTED');
  assert.equal(r.chosenOption, 'structured_rule');
  assert.deepEqual(r.selected.map(s => s.requirementId), ['exact_source_audit', 'structured_rule']);
  assert.deepEqual(r.skills.map(s => s.skillId), ['exact-source-audit']);
  assert.equal(r.hostAuthorityGranted, false);
  const a = sampleAvailability(); a.providers.reverse();
  assert.deepEqual(resolve(a), r);
});
test('alternative model route stays draft-only and host-bound', () => {
  const r = resolve(sampleAvailability({withModel: true}), {preferOption: 'model_json'});
  assert.equal(r.chosenOption, 'model_json');
  const p = createHostNeutralPlan({task: task(), solution, resolution: r});
  assert.equal(p.branches.extraction, 'model_json');
  assert.equal(p.steps[1].selected.kind, 'model');
  assert.equal(p.executionState, 'NOT_EXECUTED');
});
test('missing capabilities and Skill, incompatible effect/schema/availability fail closed', () => {
  assert.equal(resolve(sampleAvailability({withoutAudit: true})).status, 'UNSUPPORTED');
  assert.equal(resolve(sampleAvailability({noSkill: true})).status, 'UNSUPPORTED');
  const none = sampleAvailability(); none.providers = [none.providers[0]];
  assert.equal(resolve(none).status, 'UNSUPPORTED');
  for (const field of ['effect', 'schema', 'supported', 'availability']) {
    const a = sampleAvailability(), c = a.providers[1].capabilities[0];
    if (field === 'effect') c.effectClass = 'SIDE_EFFECT';
    if (field === 'schema') c.inputSchema = {type:'object',properties:{},required:[],additionalProperties:false};
    if (field === 'supported') c.supported = false;
    if (field === 'availability') a.providers[1].availability = 'unavailable';
    assert.equal(resolve(a).status, 'UNSUPPORTED', field);
  }
});
test('model modalities and pins select only viable fallback', () => {
  const s = clone(solution);
  s.requires.alternatives[1].inputModes = ['image'];
  const a = sampleAvailability({withModel: true});
  assert.equal(resolveRequiredCapabilities(s, a, {preferOption: 'model_json'}).chosenOption, 'structured_rule');
  const pinned = clone(solution); pinned.requires.alternatives[1].modelPin = {name:'pin',digest:'a'.repeat(64)};
  assert.equal(resolveRequiredCapabilities(pinned, a, {preferOption: 'model_json'}).chosenOption, 'structured_rule');
});
test('pure versioned plan and unapproved source is blocked', () => {
  const p = plan();
  assert.equal(p.schema, PLAN_VERSION);
  assert.equal(p.planDigest, plan().planDigest);
  assert.equal(p.steps[3].type, 'HOST_GATE');
  assert.equal(p.steps[3].decision, 'PENDING');
  assert.equal(p.hostApprovalRequired, true);
  assert.equal(JSON.stringify(p).includes(transcript), false);
  const t = task(); t.source.authorized = false;
  assert.throws(() => createHostNeutralPlan({task: t, solution, resolution: resolve()}),
    err('INVALID_OR_UNAUTHORIZED_INPUT'));
  assert.throws(() => createHostNeutralPlan({task: task(), solution,
    resolution: resolve(sampleAvailability({withoutAudit: true}))}), err('INVALID_PLAN_INPUT'));
});
test('model+Skills works independently of catalog Solution', () => {
  const a = sampleAvailability({withModel: true});
  const r = resolveModelAndSkills({modelRequirement: solution.requires.alternatives[1],
    toolRequirements: solution.requires.fixed, selectedSkillIds: ['exact-source-audit']}, a);
  const p = createHostNeutralPlan({task: task(), resolution:r, mode:'model_skills',
    selectedSkills:['exact-source-audit']});
  assert.equal(p.solutionRef, null);
  assert.deepEqual(p.steps.map(s => s.id), ['model','skills','human_review']);
  assert.equal(p.executionState, 'NOT_EXECUTED');
  assert.throws(() => createHostNeutralPlan({task: task(),resolution:r,mode:'model_skills'}),
    err('MODEL_SKILLS_NOT_RESOLVED'));
});
test('real local extraction and audit: two actions, exact source and waiting human', async () => {
  const out = await runOpenHost();
  assert.equal(out.evaluation.passed, true);
  assert.equal(out.evaluation.status, 'DRAFT_READY_FOR_HUMAN_REVIEW');
  assert.equal(out.draft.action_items.length, 2);
  assert.equal(out.draft.action_items[0].assignee, 'Мария');
  assert.equal(out.draft.action_items[1].due_date, 'UNKNOWN');
  assert.ok(out.receipts.every(x => x.status === 'SUCCEEDED' && x.durationMs >= 0));
  assert.equal(out.evaluation.assignmentsExecuted, false);
  assert.equal(out.evaluation.taskCreated, false);
});
test('Unicode code point source spans are valid', () => {
  const source = '🧪' + transcript, draft = extractStructuredMeeting(source);
  assert.equal(checkMeetingEvidence(source, draft).passed, true);
  assert.equal(draft.action_items[0].start,
    Array.from(source.slice(0, source.indexOf('Поручение:'))).length);
});
test('negative: fabricated quote, owner, due date and execution status', async () => {
  for (const mutate of [
    d => { d.action_items[0].start += 1; },
    d => { d.action_items[0].assignee = 'Пётр'; },
    d => { d.action_items[0].due_date = 'вчера'; },
    d => { d.action_items[0].actual_work_status = 'COMPLETED'; },
    d => { d.action_items[0].worker_kind = 'model'; }
  ]) {
    const o = await observation(); mutate(o.draft);
    assert.equal(evaluateResultAgainstCriteria(o).passed, false);
  }
});
test('duplicate assignment, incorrect worker and empty draft fail', () => {
  const d = extractStructuredMeeting(transcript);
  d.action_items.push(clone(d.action_items[0]));
  assert.equal(checkMeetingEvidence(transcript, d).passed, false);
  d.action_items.pop();
  d.action_items[0].worker_kind = 'model';
  assert.equal(checkMeetingEvidence(transcript, d).passed, false);
  assert.equal(checkMeetingEvidence(transcript, {action_items:[],open_questions:[]}).passed, false);
});
test('negative: tampered receipts, plan and source fail', async () => {
  for (const mutate of [
    o => { o.receipts[0].outputDigest = 'f'.repeat(64); },
    o => { o.receipts[1].output.passed = false; },
    o => { o.receipts.pop(); },
    o => { o.receipts[1] = clone(o.receipts[0]); },
    o => { o.plan.planDigest = '0'.repeat(64); },
    o => { o.transcript = 'changed source'; }
  ]) {
    const o = await observation(); mutate(o);
    assert.equal(evaluateResultAgainstCriteria(o).passed, false);
  }
});
test('ambiguous transcript abstains, does not invent an assignment', async () => {
  const out = await runOpenHost({transcript:
    'Протокол встречи: идеи обсуждали, но решений и исполнителей не назначили. Примечание.'});
  assert.equal(out.draft.action_items.length, 0);
  assert.equal(out.draft.open_questions.length, 1);
  assert.equal(out.evaluation.passed, true);
});
test('accepted Task report is not executed assignment or Goal completion', async () => {
  const o = await observation(); o.taskReport.status = 'ACCEPTED';
  const e = evaluateResultAgainstCriteria(o);
  assert.equal(e.passed, true);
  assert.equal(e.taskReportStatus, 'ACCEPTED');
  assert.equal(e.goalCompletionAttested, false);
  assert.equal(e.assignmentsExecuted, false);
});
test('human rejection cannot yield an accepted result', async () => {
  const o = await observation(); o.humanReview.status = 'REJECTED';
  const e = evaluateResultAgainstCriteria(o);
  assert.equal(e.passed, false);
  assert.equal(e.status, 'DRAFT_REJECTED_BY_HUMAN');
});
test('no third-party code reused or external effects granted', () => {
  assert.equal(solution.provenance.thirdPartyCodeCopied, false);
  assert.equal(solution.provenance.upstreamRights, 'NOT_VERIFIED_FOR_REDISTRIBUTION');
  assert.equal(solution.provenance.adapterLicense, 'OWNER_LICENSE_DECISION_PENDING');
  assert.deepEqual(solution.allowedExternalEffects, []);
});

test('plan is bound to exact manifest and resolution, not caller-mutated picks', () => {
  const r = resolve(), modified = clone(r);
  modified.selected[1].providerId = 'attacker';
  assert.throws(() => createHostNeutralPlan({task: task(), solution, resolution: modified}),
    err('RESOLUTION_DIGEST_MISMATCH'));
  const altered = clone(solution);
  altered.requires.alternatives[0].effectClass = 'SIDE_EFFECT';
  assert.throws(() => createHostNeutralPlan({task: task(), solution: altered, resolution: r}),
    err('UNRESOLVED_REQUIREMENTS'));
  const missingDigest = clone(r); delete missingDigest.resolutionDigest;
  assert.throws(() => createHostNeutralPlan({task: task(), solution, resolution: missingDigest}),
    err('UNBOUND_RESOLUTION'));
});
test('model+Skills resolution is concrete, with no model execution', () => {
  const r = resolveModelAndSkills({modelRequirement: solution.requires.alternatives[1],
    toolRequirements: solution.requires.fixed, selectedSkillIds: ['exact-source-audit']},
    sampleAvailability({withModel: true}));
  assert.equal(r.status, 'SUPPORTED');
  assert.equal(r.selected.length, 2);
  const p = createHostNeutralPlan({task: task(), resolution: r, mode:'model_skills',
    selectedSkills:['exact-source-audit']});
  assert.equal(p.executionState, 'NOT_EXECUTED');
  assert.equal(p.steps[1].selectedCapabilities.length, 1);
  const missing = resolveModelAndSkills({modelRequirement: solution.requires.alternatives[1],
    toolRequirements: solution.requires.fixed, selectedSkillIds: ['exact-source-audit']},
    sampleAvailability());
  assert.equal(missing.status, 'UNSUPPORTED');
  assert.throws(() => createHostNeutralPlan({task:task(),resolution:missing,mode:'model_skills',
    selectedSkills:['exact-source-audit']}), err('INVALID_PLAN_INPUT'));
});
test('model route must include explicit JSON normalization before evidence audit', () => {
  const r = resolve(sampleAvailability({withModel:true}), {preferOption:'model_json'});
  const p = createHostNeutralPlan({task:task(),solution,resolution:r});
  assert.deepEqual(p.steps.map(s => s.id), ['input','extract','normalize','audit','human_review']);
  assert.equal(p.steps[2].operation, 'PARSE_JSON_ACTION_DRAFT');
  assert.deepEqual(p.steps[3].dependsOn, ['normalize']);
});
test('duplicate providers or capabilities and repeated Skill descriptors fail', () => {
  const duplicate = sampleAvailability();
  duplicate.providers.push(clone(duplicate.providers[0]));
  assert.throws(() => resolve(duplicate), err('INVALID_PROVIDER_DESCRIPTOR'));
  const duplicateCaps = sampleAvailability();
  duplicateCaps.providers[0].capabilities.push(clone(duplicateCaps.providers[0].capabilities[0]));
  assert.throws(() => resolve(duplicateCaps), err('INVALID_PROVIDER_DESCRIPTOR'));
  const duplicateSkills = sampleAvailability();
  duplicateSkills.skills.push(clone(duplicateSkills.skills[0]));
  assert.throws(() => resolve(duplicateSkills), err('INVALID_SKILL_DESCRIPTOR'));
});
test('receipt verification binds exact plan, selected provider descriptor and input', async () => {
  for (const mutate of [
    o => { o.receipts[0].planDigest = '0'.repeat(64); },
    o => { o.receipts[1].planDigest = '0'.repeat(64); },
    o => { o.receipts[0].descriptorDigest = 'f'.repeat(64); },
    o => { o.receipts[1].descriptorDigest = 'f'.repeat(64); },
    o => { o.receipts[0].inputDigest = 'f'.repeat(64); },
    o => { o.receipts[1].inputDigest = 'f'.repeat(64); }
  ]) {
    const o = await observation(); mutate(o);
    assert.equal(evaluateResultAgainstCriteria(o).passed, false);
  }
});
