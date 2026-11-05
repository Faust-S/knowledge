import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NodeEvidenceCliProvider, AUDIT_INPUT, AUDIT_OUTPUT } from '../adapters/node-evidence-cli.mjs';
import { OllamaLocalModelProvider, MODEL_INPUT, MODEL_OUTPUT } from '../adapters/ollama-local.mjs';
import {
  CONTRACT_VERSION, describeCapabilities, resolveRequirements, buildInvocationPlan,
  verifySkillBinding,
} from '../index.mjs';
import { draftAgentModelRequest, draftAgentToolRequest } from '../adapters/agent-port-handoff.mjs';

const MODEL_NAME = 'smollm2:135m-instruct-q2_K';
const MODEL_DIGEST = '888e2e49aff1c1ff0c073a0c46afa26f54f4fad02f31bb5ad911b0124830852b';
const NATIVE_MODEL_BINDING = '1'.repeat(64);
const NATIVE_TOOL_BINDING = '2'.repeat(64);
const NATIVE_TOOL_DESCRIPTOR = '3'.repeat(64);
const NATIVE_TOOL_PLAN = '4'.repeat(64);
const LIVE = process.argv.includes('--live');
const model = LIVE ? new OllamaLocalModelProvider({
  modelName: MODEL_NAME, expectedDigest: MODEL_DIGEST,
}) : {
  modelName: MODEL_NAME, expectedDigest: MODEL_DIGEST,
  describeCapabilities: async () => ({
    contractVersion: CONTRACT_VERSION, providerId: 'ollama-local-pinned',
    availability: 'available',
    capabilities: [{
      kind: 'model', capabilityId: 'text.generate', supported: true,
      inputSchema: MODEL_INPUT, outputSchema: MODEL_OUTPUT,
      effectClass: 'MODEL_INFERENCE', providerFeeUsd: 0, latencyMsP50: null,
      inputModes: ['text'], outputModes: ['text'],
      modelPin: { name: MODEL_NAME, digest: MODEL_DIGEST },
    }],
  }),
};
const tool = new NodeEvidenceCliProvider();
const descriptors = await Promise.all([
  describeCapabilities(model), describeCapabilities(tool),
]);
const solution = {
  solutionId: 'K02-NATIVE-HANDOFF-CONFORMANCE',
  requirements: [
    { requirementId: 'generation', kind: 'model', capabilityId: 'text.generate',
      inputSchema: MODEL_INPUT, outputSchema: MODEL_OUTPUT,
      effectClass: 'MODEL_INFERENCE', required: true,
      inputModes: ['text'], outputModes: ['text'],
      modelPin: { name: MODEL_NAME, digest: MODEL_DIGEST } },
    { requirementId: 'audit', kind: 'tool', capabilityId: 'evidence.exact.audit',
      inputSchema: AUDIT_INPUT, outputSchema: AUDIT_OUTPUT,
      effectClass: 'PURE_COMPUTE', required: true },
  ],
};
const resolution = resolveRequirements(solution, descriptors);
assert.equal(resolution.status, 'SUPPORTED');
const skill = JSON.parse(await readFile(new URL('../skills/exact-source-audit.skill.json', import.meta.url), 'utf8'));
const instruction = await readFile(new URL('../skills/exact-source-audit.instructions.json', import.meta.url));
const plan = buildInvocationPlan({
  taskId: 'CONFORMANCE-NOT-PRODUCT-TASK',
  solutionId: solution.solutionId,
}, [skill], resolution);
const verifiedSkill = verifySkillBinding(plan, skill.skillId, skill, instruction, plan.planDigest);
assert.equal(verifiedSkill.status, 'MATCHED_NOT_ACTIVATED');
const modelInput = {
  system: 'This is a conformance fixture, not permission to run an AI Task.',
  prompt: 'Say hello.',
  max_output_tokens: 12,
};
const toolInput = {
  transcript: 'A meeting follow-up needs human review.',
  candidates: [{
    action: 'Human review', quote: 'human review', start: 26, end: 38,
  }],
};
const modelDraft = await draftAgentModelRequest({
  plan, trustedPlanDigest: plan.planDigest,
  requirementId: 'generation', provider: model,
  nativeBinding: {
    logicalProviderId: 'OLLAMA_LOCAL_V1',
    providerBindingDigest: NATIVE_MODEL_BINDING,
    localModelPin: { name: MODEL_NAME, digest: MODEL_DIGEST },
  },
  input: modelInput, requestId: 'CONFORMANCE-MODEL-REQUEST',
});
const toolDraft = await draftAgentToolRequest({
  plan, trustedPlanDigest: plan.planDigest,
  requirementId: 'audit', provider: tool,
  nativeBinding: {
    logicalProviderId: 'SYNTHETIC_TOOL_PROVIDER',
    providerSlot: 'tool',
    providerBindingDigest: NATIVE_TOOL_BINDING,
    descriptorDigest: NATIVE_TOOL_DESCRIPTOR,
    nativeToolPlanDigest: NATIVE_TOOL_PLAN,
  },
  input: toolInput, requestId: 'CONFORMANCE-TOOL-REQUEST',
});
assert.equal(modelDraft.hostAuthorityGranted, false);
assert.equal(toolDraft.hostAuthorityGranted, false);
assert.equal(modelDraft.resultProduced, false);
assert.equal(toolDraft.resultProduced, false);
process.stdout.write(JSON.stringify({
  schema: 'IWXA.K02.AGENT_PORT_VECTOR/0.1.0',
  mode: LIVE ? 'LIVE_OLLAMA_PROBED_NOT_INVOKED' : 'SYNTHETIC_MODEL_DESCRIPTOR',
  plan, descriptors, skill,
  modelInput, toolInput,
  modelDraft, toolDraft,
}) + '\n');
