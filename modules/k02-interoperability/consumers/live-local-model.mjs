import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { OllamaLocalModelProvider, MODEL_INPUT, MODEL_OUTPUT } from '../adapters/ollama-local.mjs';
import { describeCapabilities, resolveRequirements, buildInvocationPlan, validateInvocationInput, validateInvocationOutput, verifyInvocationReadiness } from '../index.mjs';

const modelName = process.env.K02_MODEL_NAME || 'smollm2:135m-instruct-q2_K';
const expectedDigest = process.env.K02_MODEL_DIGEST;
if (!expectedDigest || !/^[a-f0-9]{64}$/.test(expectedDigest)) throw new Error('K02_MODEL_DIGEST_REQUIRED');
const provider = new OllamaLocalModelProvider({ modelName, expectedDigest });
const descriptor = await describeCapabilities(provider);
assert.equal(descriptor.availability, 'available', descriptor.unavailableReason || 'model unavailable');

const solution = {
  solutionId: 'K02-OPEN-MODEL-SAMPLE',
  requirements: [{ requirementId: 'generation', kind: 'model', capabilityId: 'text.generate', effectClass: 'MODEL_INFERENCE', required: true,
    inputSchema: MODEL_INPUT, outputSchema: MODEL_OUTPUT }],
};
const selected = resolveRequirements(solution, [descriptor]);
assert.equal(selected.status, 'SUPPORTED');
const plan = buildInvocationPlan({ taskId: 'SYNTHETIC-MODEL-REAL-INVOKE', solutionId: solution.solutionId }, [], selected);
await verifyInvocationReadiness(plan, 'generation', provider, plan.planDigest);
const input = { system: 'Return a short plain-language reply.', prompt: 'Complete this greeting in English: Hello,', max_output_tokens: 48 };
validateInvocationInput(plan.steps[0], input);
const result = await provider.invoke('text.generate', input, {
  hostApproved: true, pinnedModelDigest: expectedDigest,
});
validateInvocationOutput(plan.steps[0], result.output);
assert.equal(result.status, 'SUCCEEDED');
assert.ok(result.output.text.trim());
assert.equal(result.output.model_digest, expectedDigest);
assert.ok(result.observation.completionTokens > 0);
assert.ok(result.observation.durationMs > 0);
assert.equal(result.observation.outputSha256, createHash('sha256').update(result.output.text, 'utf8').digest('hex'));
assert.equal(plan.steps[0].invocationState, 'NOT_INVOKED');
assert.equal(plan.steps[0].proofOfInvoke, null);
process.stdout.write(JSON.stringify({
  contractVersion: plan.contractVersion,
  provider: result.observation.providerId,
  modelName: result.observation.modelName,
  modelDigest: result.observation.modelDigest,
  status: result.status,
  promptTokens: result.observation.promptTokens,
  completionTokens: result.observation.completionTokens,
  durationMs: Number(result.observation.durationMs.toFixed(2)),
  modelTotalDurationNs: result.observation.totalDurationNs,
  providerFeeUsd: result.observation.actualProviderFeeUsd,
  hostComputeCostUsd: result.observation.hostComputeCostUsd,
  answerDigest: result.observation.outputSha256,
  proofClass: result.observation.proofClass,
}) + '\n');
