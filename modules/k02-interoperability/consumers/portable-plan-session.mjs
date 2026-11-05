import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { GitCliProvider, GIT_INPUT, GIT_OUTPUT } from '../adapters/git-cli.mjs';
import { NodeEvidenceCliProvider, AUDIT_INPUT, AUDIT_OUTPUT } from '../adapters/node-evidence-cli.mjs';
import { OllamaLocalModelProvider, MODEL_INPUT, MODEL_OUTPUT } from '../adapters/ollama-local.mjs';
import { CONTRACT_VERSION, InteropError, describeCapabilities, resolveRequirements,
  buildInvocationPlan, verifyPortablePlan, digest } from '../index.mjs';

const SESSION_SCHEMA = 'IWXA.K02.PORTABLE_PLAN_SESSION/0.1.0';
const MODEL_NAME = 'smollm2:135m-instruct-q2_K';
const MODEL_DIGEST = process.env.K02_MODEL_DIGEST ||
  '888e2e49aff1c1ff0c073a0c46afa26f54f4fad02f31bb5ad911b0124830852b';
const PIN = { name: MODEL_NAME, digest: MODEL_DIGEST };
const REQS = [
  { requirementId: 'source', kind: 'tool', capabilityId: 'source.git.show',
    inputSchema: GIT_INPUT, outputSchema: GIT_OUTPUT, effectClass: 'HOST_AUTHORIZED_READ', required: true },
  { requirementId: 'evidence', kind: 'tool', capabilityId: 'evidence.exact.audit',
    inputSchema: AUDIT_INPUT, outputSchema: AUDIT_OUTPUT, effectClass: 'PURE_COMPUTE', required: true },
  { requirementId: 'generation', kind: 'model', capabilityId: 'text.generate',
    inputSchema: MODEL_INPUT, outputSchema: MODEL_OUTPUT, effectClass: 'MODEL_INFERENCE',
    inputModes: ['text'], outputModes: ['text'], modelPin: PIN, required: true },
];
const SIMPLE_MODEL_CAP = {
  kind: 'model', capabilityId: 'text.generate', supported: true, inputSchema: MODEL_INPUT,
  outputSchema: MODEL_OUTPUT, effectClass: 'MODEL_INFERENCE',
  inputModes: ['text'], outputModes: ['text'], modelPin: PIN,
  providerFeeUsd: 0, latencyMsP50: null,
};

function testModelProvider({ changedModel = false, missingModel = false } = {}) {
  const capability = changedModel
    ? { ...SIMPLE_MODEL_CAP, modelPin: { ...PIN, digest: 'f'.repeat(64) } }
    : SIMPLE_MODEL_CAP;
  return {
    async describeCapabilities() {
      return {
        contractVersion: CONTRACT_VERSION, providerId: 'ollama-local-pinned',
        availability: missingModel ? 'unavailable' : 'available',
        ...(missingModel ? { unavailableReason: 'MODEL_NOT_INSTALLED' } : {}),
        capabilities: [capability],
      };
    },
  };
}
function providers({ live = false, changedModel = false, missingModel = false } = {}) {
  const model = live && !changedModel && !missingModel
    ? new OllamaLocalModelProvider({ modelName: MODEL_NAME, expectedDigest: MODEL_DIGEST })
    : testModelProvider({ changedModel, missingModel });
  return [
    new GitCliProvider(process.cwd()),
    new NodeEvidenceCliProvider(),
    model,
  ];
}
function sessionVector(bundle) {
  return { schema: 'IWXA.K02.CROSS_LANGUAGE_VECTOR/0.1.0',
    plan: bundle.plan, descriptors: bundle.descriptors, skill: bundle.skill };
}
function fail(reason) { throw new InteropError('INVALID_PLAN', reason); }

export async function createPortableSession(filepath, { live = false } = {}) {
  const linked = providers({ live });
  const descriptors = await Promise.all(linked.map(describeCapabilities));
  const resolution = resolveRequirements(
    { solutionId: 'K02-PORTABLE-PLAN-TEST', requirements: REQS }, descriptors);
  if (resolution.status !== 'SUPPORTED') fail('requirements_not_supported');
  const skill = JSON.parse(await readFile(
    new URL('../skills/exact-source-audit.skill.json', import.meta.url), 'utf8'));
  const plan = buildInvocationPlan(
    { taskId: 'PORTABLE-DEMO-NOT-PRODUCT-TASK', solutionId: resolution.solutionId },
    [skill], resolution);
  const bundle = { schema: SESSION_SCHEMA, plan, descriptors, skill };
  // The independent host retains plan.planDigest, not the received bundle.
  const serialized = JSON.stringify(bundle);
  if (Buffer.byteLength(serialized, 'utf8') > 1_000_000) fail('oversized_bundle');
  await writeFile(filepath, serialized, { encoding: 'utf8', flag: 'wx' });
  return { status: 'SAVED_NOT_AUTHORIZED', trustedDigest: plan.planDigest,
    steps: plan.steps.length, skills: plan.skills.length,
    modelPin: PIN, bytes: Buffer.byteLength(serialized, 'utf8') };
}

export async function resumePortableSession(filepath, trustedDigest, options = {}) {
  const serialized = await readFile(filepath, 'utf8');
  if (Buffer.byteLength(serialized, 'utf8') > 1_000_000) fail('oversized_bundle');
  let bundle;
  try { bundle = JSON.parse(serialized); } catch { fail('invalid_bundle_json'); }
  if (!bundle || bundle.schema !== SESSION_SCHEMA ||
      !bundle.plan || !Array.isArray(bundle.descriptors) || !bundle.skill) {
    fail('invalid_bundle_shape');
  }
  const linked = providers(options);
  const providerDescriptors = await Promise.all(linked.map(describeCapabilities));
  const providerMap = new Map(linked.map((provider, i) =>
    [providerDescriptors[i].providerId, provider]));
  // The original plan is NOT rebuilt, and requirements are NOT re-resolved.
  const plan = bundle.plan;
  if (plan.planDigest !== trustedDigest || !/^[a-f0-9]{64}$/.test(trustedDigest ?? '')) {
    fail('host_owned_plan_digest_missing_or_changed');
  }
  const skillBytes = await readFile(
    new URL('../skills/exact-source-audit.instructions.json', import.meta.url));
  // K02's reusable verification checks the reloaded plan against native
  // host-provided providers and bytes; saved descriptors are compared separately.
  const restored = await verifyPortablePlan(plan, trustedDigest,
    linked.map((provider, i) => ({ providerId: providerDescriptors[i].providerId, provider })),
    [{ descriptor: bundle.skill, instructionBytes: skillBytes }]);
  for (const step of plan.steps) {
    const captured = bundle.descriptors.find(x => x.providerId === step.providerId);
    const cap = captured?.capabilities?.find(x => x.kind === step.kind &&
      x.capabilityId === step.capabilityId);
    if (!cap || digest({
      contractVersion: CONTRACT_VERSION, providerId: step.providerId, capability: cap,
    }) !== step.capabilityDigest) {
      throw new InteropError('BINDING_CHANGED', 'saved_provider_descriptor');
    }
  }
  return { status: 'RESTORED_NOT_AUTHORIZED', planDigest: trustedDigest,
    steps: restored.checkedSteps.length, skills: restored.checkedSkills.length,
    modelPin: plan.steps.find(x => x.kind === 'model')?.modelPin,
    invocations: 0, taskCreated: false, resultProduced: false };
}

async function main() {
  const [command, filepath, trustedDigest, ...flags] = process.argv.slice(2);
  if (!filepath || !['create', 'resume'].includes(command)) fail('usage');
  const options = {
    live: flags.includes('--live') || trustedDigest === '--live',
    changedModel: flags.includes('--changed-model'),
    missingModel: flags.includes('--missing-model'),
  };
  const result = command === 'create'
    ? await createPortableSession(filepath, options)
    : await resumePortableSession(filepath, trustedDigest, options);
  process.stdout.write(JSON.stringify(result) + '\n');
}
if (process.argv[1]?.endsWith('/portable-plan-session.mjs')) {
  main().catch(err => {
    process.stderr.write(JSON.stringify({ errorCode: err.code || 'SESSION_ERROR' }) + '\n');
    process.exitCode = 1;
  });
}
