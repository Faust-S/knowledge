import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {
  K02_VERSION, K02_SKILL_VERSION, digest, matchTask, resolveRequiredCapabilities,
  createHostNeutralPlan, evaluateResultAgainstCriteria
} from '../index.mjs';

export const solution = JSON.parse(await readFile(new URL('../meeting-followup.solution.json', import.meta.url), 'utf8'));
const makeCapability = requirement => ({
  kind: requirement.kind, capabilityId: requirement.capabilityId,
  supported: true, effectClass: requirement.effectClass,
  inputSchema: requirement.inputSchema, outputSchema: requirement.outputSchema,
  providerFeeUsd: 0, latencyMsP50: 1,
  ...(requirement.kind === 'model' ? {inputModes: ['text'], outputModes: ['text']} : {})
});
export function sampleAvailability({withModel = false, withoutAudit = false, noSkill = false} = {}) {
  const providers = [];
  if (!withoutAudit) providers.push({contractVersion: K02_VERSION, providerId: 'open-host-exact-audit',
    availability: 'available', capabilities: [makeCapability(solution.requires.fixed[0])]});
  providers.push({contractVersion: K02_VERSION, providerId: 'open-host-structured-extractor',
    availability: 'available', capabilities: [makeCapability(solution.requires.alternatives[0])]});
  if (withModel) providers.push({contractVersion: K02_VERSION, providerId: 'model-request-only',
    availability: 'available', capabilities: [makeCapability(solution.requires.alternatives[1])]});
  const skills = noSkill ? [] : [{schema: K02_SKILL_VERSION, skillId: 'exact-source-audit',
    requiredCapabilities: ['evidence.exact.audit'], status: 'HOST_VERIFICATION_REQUIRED'}];
  return {providers, skills};
}
export function extractStructuredMeeting(transcript) {
  const action_items = [], open_questions = [];
  if (typeof transcript !== 'string') throw new TypeError('transcript_required');
  for (const match of transcript.matchAll(/^Поручение:\s*([^|\r\n]+)\s*\|\s*([^|\r\n]+)\s*\|\s*срок:\s*([^\r\n]+)$/gmu)) {
    const quote = match[0], person = match[1].trim(), action = match[2].trim();
    const deadline = match[3].trim().replace(/\.$/u, '');
    if (!person || !action || !deadline) continue;
    const owner = person === 'UNKNOWN' ? 'UNKNOWN' : person;
    const start = Array.from(transcript.slice(0, match.index)).length;
    action_items.push({
      action, quote, start, end: start + Array.from(quote).length,
      assignee: owner, due_date: deadline,
      worker_kind: owner === 'UNKNOWN' ? 'unassigned' : 'human',
      actual_work_status: 'NOT_EXECUTED'
    });
    if (deadline === 'UNKNOWN') open_questions.push('Уточнить срок: ' + action);
    if (owner === 'UNKNOWN') open_questions.push('Уточнить исполнителя: ' + action);
  }
  if (!action_items.length) open_questions.push('Нет явно структурированных поручений; требуется уточнение.');
  return {action_items, open_questions};
}
export function auditDraftAgainstSource(transcript, draft) {
  const accepted = [], errors = [], codepoints = Array.from(transcript);
  for (const [i, item] of draft.action_items.entries()) {
    if (!item || codepoints.slice(item.start, item.end).join('') !== item.quote ||
      (item.assignee !== 'UNKNOWN' && !item.quote.includes(item.assignee)) ||
      (item.due_date !== 'UNKNOWN' && !item.quote.includes(item.due_date)) ||
      item.actual_work_status !== 'NOT_EXECUTED') errors.push('REJECTED_ITEM_' + i);
    else accepted.push(item);
  }
  if (!accepted.length && !draft.open_questions.length) errors.push('EMPTY_NO_CLARIFICATION');
  return {passed: !errors.length, errors, accepted};
}
export async function runOpenHost({transcript, sourceRevision = 'fixture-v1'} = {}) {
  const content = transcript ?? await readFile(new URL('meeting.txt', import.meta.url), 'utf8');
  const task = {taskId: 'OPEN-HOST-MEETING-001', kind: 'meeting_followup',
    input: {transcript_text: content},
    source: {ref: 'modules/k04-composer/sample/meeting.txt', revision: sourceRevision,
      rights: 'IWXA_AUTHORED_SYNTHETIC', authorized: true}};
  const selected = matchTask(task, [solution]);
  if (selected.candidates[0]?.status !== 'CANDIDATE') throw new Error('sample_task_not_matched');
  const resolution = resolveRequiredCapabilities(solution, sampleAvailability());
  if (resolution.status !== 'SUPPORTED' || resolution.chosenOption !== 'structured_rule')
    throw new Error('sample_requirements_not_resolved');
  const plan = createHostNeutralPlan({task, solution, resolution});
  const t0 = performance.now();
  const draft = extractStructuredMeeting(content);
  const extractMs = performance.now() - t0;
  const t1 = performance.now();
  const audit = auditDraftAgainstSource(content, draft);
  const auditMs = performance.now() - t1;
  const receipts = [
    {stepId: 'extract', providerId: plan.steps[1].selected.providerId,
      capabilityId: plan.steps[1].selected.capabilityId,
      status: 'SUCCEEDED', output: draft, outputDigest: digest(draft), durationMs: extractMs},
    {stepId: 'audit', providerId: plan.steps[2].selected.providerId,
      capabilityId: plan.steps[2].selected.capabilityId,
      status: 'SUCCEEDED', output: audit, outputDigest: digest(audit), durationMs: auditMs}
  ];
  const observation = {plan, transcript: content, draft, receipts,
    humanReview: {status: 'PENDING'}, taskReport: {status: 'NOT_SUBMITTED'},
    goalDecision: {status: 'NOT_DECIDED'}};
  return {plan, draft, audit, receipts, evaluation: evaluateResultAgainstCriteria(observation),
    provenance: {ref: task.source.ref, revision: task.source.revision, rights: task.source.rights},
    counters: {actions: draft.action_items.length, questions: draft.open_questions.length,
      durationMs: extractMs + auditMs}};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outcome = await runOpenHost();
  process.stdout.write(JSON.stringify({schema: outcome.plan.schema,
    planDigest: outcome.plan.planDigest, branch: outcome.plan.branches,
    provenance: outcome.provenance, evaluation: outcome.evaluation,
    counters: outcome.counters, action_items: outcome.draft.action_items}) + '\n');
  if (!outcome.evaluation.passed) process.exitCode = 1;
}
