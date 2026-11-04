import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { GitHubPublicRestProvider } from '../adapters/github-public-rest.mjs';
import { NodeEvidenceCliProvider, AUDIT_INPUT, AUDIT_OUTPUT } from '../adapters/node-evidence-cli.mjs';
import { OllamaLocalModelProvider, MODEL_INPUT, MODEL_OUTPUT } from '../adapters/ollama-local.mjs';
import { GIT_INPUT, GIT_OUTPUT } from '../adapters/git-cli.mjs';
import {
  CONTRACT_VERSION, InteropError, describeCapabilities, resolveRequirements,
  buildInvocationPlan, validateInvocationInput, validateInvocationOutput, digest
} from '../index.mjs';

const PINNED_SHA = /^[0-9a-f]{40}$/;
const SOURCE_PATH = 'solutions/meeting-followup/agent.json';
const SOLUTION_ID = 'meeting-followup-crewai';

const requirements = [
  { requirementId: 'source', kind: 'tool', capabilityId: 'source.git.show',
    inputSchema: GIT_INPUT, outputSchema: GIT_OUTPUT, effectClass: 'HOST_AUTHORIZED_READ', required: true },
  { requirementId: 'evidence', kind: 'tool', capabilityId: 'evidence.exact.audit',
    inputSchema: AUDIT_INPUT, outputSchema: AUDIT_OUTPUT, effectClass: 'PURE_COMPUTE', required: true },
  { requirementId: 'draft', kind: 'model', capabilityId: 'text.generate',
    inputSchema: MODEL_INPUT, outputSchema: MODEL_OUTPUT, effectClass: 'MODEL_INFERENCE', required: true },
];

const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');

export async function sourceBackedReview({
  sourceRevision, modelDigest, sourceProvider, evidenceProvider, modelProvider,
  hostApproval
}) {
  if (!PINNED_SHA.test(sourceRevision ?? '') || !/^[0-9a-f]{64}$/.test(modelDigest ?? '')) {
    throw new InteropError('INVALID_PLAN', 'pinned_source_and_model_required');
  }
  // These are the calling host's choices, never values read from the source.
  if (!hostApproval || hostApproval.allowSourceRead !== true ||
      hostApproval.allowEvidenceCheck !== true || hostApproval.allowModelInvoke !== true) {
    throw new InteropError('HOST_APPROVAL_REQUIRED');
  }
  const [sourceDescriptor, evidenceDescriptor, modelDescriptor] = await Promise.all([
    describeCapabilities(sourceProvider), describeCapabilities(evidenceProvider),
    describeCapabilities(modelProvider),
  ]);
  const solution = { solutionId: 'K02-SOURCE-BACKED-HUMAN-REVIEW', requirements };
  const resolution = resolveRequirements(solution, [sourceDescriptor, evidenceDescriptor, modelDescriptor]);
  if (resolution.status !== 'SUPPORTED') {
    throw new InteropError('PROVIDER_UNAVAILABLE', JSON.stringify(resolution.missing));
  }
  const skill = JSON.parse(await readFile(new URL('../skills/exact-source-audit.skill.json', import.meta.url), 'utf8'));
  const plan = buildInvocationPlan(
    { taskId: 'K02-PUBLIC-DEMO-NOT-PRODUCT-TASK', solutionId: solution.solutionId },
    [skill], resolution,
  );
  const step = name => {
    const row = plan.steps.find(item => item.requirementId === name);
    if (!row) throw new InteropError('INVALID_PLAN', 'missing_' + name);
    return row;
  };
  const inputSource = { revision: sourceRevision, path: SOURCE_PATH };
  validateInvocationInput(step('source'), inputSource);
  const source = await sourceProvider.invoke('source.git.show', inputSource, { hostApproved: true });
  if (source.status !== 'SUCCEEDED') throw new InteropError('PROVIDER_UNAVAILABLE', 'source_failed');
  validateInvocationOutput(step('source'), source.output);
  if (source.output.revision !== sourceRevision ||
      source.output.sha256 !== sha256(source.output.content) ||
      source.output.sourceRef !== 'github:Faust-S/knowledge@' + sourceRevision + ':' + SOURCE_PATH) {
    throw new InteropError('INVALID_PROVIDER_OUTPUT', 'source_provenance');
  }
  let definition;
  try { definition = JSON.parse(source.output.content); }
  catch { throw new InteropError('INVALID_PROVIDER_OUTPUT', 'solution_json'); }
  if (!definition || definition.id !== SOLUTION_ID ||
      definition.schema !== 'iwxa.specialized-agent-definition/0.1' ||
      definition.status !== 'SPEC_COMPLETE_NOT_EXECUTED') {
    throw new InteropError('INVALID_PROVIDER_OUTPUT', 'solution_identity_or_status');
  }
  const rule = definition.state_machine?.find(x => x?.id === 'human_review');
  if (!rule || typeof rule.guard !== 'string' || !rule.guard.includes('No automatic Task')) {
    throw new InteropError('INVALID_PROVIDER_OUTPUT', 'human_review_rule_missing');
  }
  const quote = rule.guard;
  const start = source.output.content.indexOf(quote);
  if (start < 0) throw new InteropError('INVALID_PROVIDER_OUTPUT', 'untraceable_quote');
  const auditInput = {
    transcript: source.output.content,
    candidates: [{ action: 'Human review before creating a task', quote, start, end: start + quote.length }],
  };
  validateInvocationInput(step('evidence'), auditInput);
  const evidence = await evidenceProvider.invoke('evidence.exact.audit', auditInput, { hostApproved: true });
  if (evidence.status !== 'SUCCEEDED') throw new InteropError('PROVIDER_UNAVAILABLE', 'evidence_failed');
  validateInvocationOutput(step('evidence'), evidence.output);
  if (evidence.output.accepted.length !== 1 || evidence.output.rejected.length !== 0 ||
      evidence.output.status !== 'REVIEW_REQUIRED' ||
      evidence.output.transcriptSha256 !== source.output.sha256 ||
      digest(evidence.output.accepted[0]) !== digest(auditInput.candidates[0])) {
    throw new InteropError('INVALID_PROVIDER_OUTPUT', 'evidence_not_verified');
  }
  const modelInput = {
    system: 'You draft suggestions, not completed tasks. Only a person can approve the Task. Reply with one short question in English.',
    prompt: 'Source requirement: "' + quote + '". Draft ONE specific question a reviewer should answer before turning a meeting follow-up draft into a task.',
    max_output_tokens: 64,
  };
  validateInvocationInput(step('draft'), modelInput);
  const model = await modelProvider.invoke('text.generate', modelInput, {
    hostApproved: true, pinnedModelDigest: modelDigest,
  });
  if (model.status !== 'SUCCEEDED') throw new InteropError('PROVIDER_UNAVAILABLE', 'generation_failed');
  validateInvocationOutput(step('draft'), model.output);
  if (model.output.model_digest !== modelDigest ||
      model.observation?.outputSha256 !== sha256(model.output.text) ||
      !Number.isSafeInteger(model.observation?.completionTokens) ||
      model.observation.completionTokens < 1 ||
      !Number.isFinite(model.observation?.durationMs) ||
      model.observation.durationMs <= 0) {
    throw new InteropError('INVALID_PROVIDER_OUTPUT', 'model_observation_invalid');
  }
  return {
    contractVersion: CONTRACT_VERSION, planDigest: plan.planDigest,
    solutionId: SOLUTION_ID, sourceDefinitionStatus: definition.status,
    status: 'DRAFT_REQUIRES_HUMAN_REVIEW', taskCreated: false, resultStored: false,
    source: {
      sourceRef: source.output.sourceRef, revision: sourceRevision, path: SOURCE_PATH,
      sha256: source.output.sha256, quote, start, end: start + quote.length,
      quoteEvidence: 'EXACT_SPAN_VERIFIED',
    },
    skill: { skillId: skill.skillId, auditStatus: evidence.output.status, accepted: evidence.output.accepted.length },
    model: {
      modelName: model.output.model, modelDigest: model.output.model_digest,
      questionDraft: model.output.text, questionDraftSha256: sha256(model.output.text),
      questionVerifiedAsFact: false, promptTokens: model.observation.promptTokens,
      completionTokens: model.observation.completionTokens,
      durationMs: model.observation.durationMs,
      inferenceProof: model.observation.proofClass,
    },
    observations: {
      sourceDurationMs: source.observation?.durationMs ?? null,
      auditDurationMs: evidence.observation?.durationMs ?? null,
      providerFeeUsd: 0, localComputeCostUsd: null,
    },
  };
}

async function main() {
  const sourceRevision = process.argv[2];
  const modelDigest = process.env.K02_MODEL_DIGEST;
  const modelName = process.env.K02_MODEL_NAME || 'smollm2:135m-instruct-q2_K';
  const receipt = await sourceBackedReview({
    sourceRevision, modelDigest,
    sourceProvider: new GitHubPublicRestProvider({ owner: 'Faust-S', repo: 'knowledge' }),
    evidenceProvider: new NodeEvidenceCliProvider(),
    modelProvider: new OllamaLocalModelProvider({ modelName, expectedDigest: modelDigest }),
    hostApproval: { allowSourceRead: true, allowEvidenceCheck: true, allowModelInvoke: true },
  });
  process.stdout.write(JSON.stringify(receipt) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => {
    process.stderr.write(JSON.stringify({ code: e.code || 'HOST_DEMO_FAILED' }) + '\n');
    process.exitCode = 1;
  });
}
