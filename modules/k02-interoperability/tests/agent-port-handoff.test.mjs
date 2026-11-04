import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTRACT_VERSION, InteropError, resolveRequirements, buildInvocationPlan,
  verifyInvocationReadiness,
} from '../index.mjs';
import {
  draftAgentModelRequest, draftAgentToolRequest, AGENT_PORT_HANDOFF_VERSION,
} from '../adapters/agent-port-handoff.mjs';
import { MODEL_INPUT, MODEL_OUTPUT } from '../adapters/ollama-local.mjs';
import { GIT_INPUT, GIT_OUTPUT } from '../adapters/git-cli.mjs';

const MD = '8'.repeat(64);
const D1 = '1'.repeat(64);
const D2 = '2'.repeat(64);
const D3 = '3'.repeat(64);
const D4 = '4'.repeat(64);
const id = 'smollm2:135m-instruct-q2_K';
const modelInput = { system: 'Only a test.', prompt: 'Hello.', max_output_tokens: 12 };
const toolInput = { revision: 'f'.repeat(40), path: 'solutions/meeting-followup/agent.json' };
const failure = name => err => err instanceof InteropError && err.code === name;

const modelCapability = {
  kind: 'model', capabilityId: 'text.generate', supported: true,
  inputSchema: MODEL_INPUT, outputSchema: MODEL_OUTPUT,
  effectClass: 'MODEL_INFERENCE', providerFeeUsd: 0, latencyMsP50: null,
  inputModes: ['text'], outputModes: ['text'],
};
const toolCapability = {
  kind: 'tool', capabilityId: 'source.git.show', supported: true,
  inputSchema: GIT_INPUT, outputSchema: GIT_OUTPUT,
  effectClass: 'HOST_AUTHORIZED_READ', providerFeeUsd: 0, latencyMsP50: null,
};
function setup() {
  const providers = [
    { contractVersion: CONTRACT_VERSION, providerId: 'ollama-local-pinned',
      availability: 'available', capabilities: [modelCapability] },
    { contractVersion: CONTRACT_VERSION, providerId: 'github-public-rest',
      availability: 'available', capabilities: [toolCapability] },
  ];
  const solution = {
    solutionId: 'K02-PORT-HANDOFF-TEST', requirements: [
      { requirementId: 'generation', kind: 'model', capabilityId: 'text.generate',
        inputSchema: MODEL_INPUT, outputSchema: MODEL_OUTPUT,
        effectClass: 'MODEL_INFERENCE', required: true },
      { requirementId: 'source', kind: 'tool', capabilityId: 'source.git.show',
        inputSchema: GIT_INPUT, outputSchema: GIT_OUTPUT,
        effectClass: 'HOST_AUTHORIZED_READ', required: true },
    ],
  };
  const resolution = resolveRequirements(solution, providers);
  const plan = buildInvocationPlan({ taskId: 'K02-CONFORMANCE-NOT-PRODUCT-TASK',
    solutionId: solution.solutionId }, [], resolution);
  let invoked = 0;
  const model = {
    modelName: id, expectedDigest: MD,
    describeCapabilities: async()=>providers[0],
    invoke: async()=>{invoked++; throw new Error('SHOULD_NOT_INVOKE_MODEL');},
  };
  const tool = {
    describeCapabilities: async()=>providers[1],
    invoke: async()=>{invoked++; throw new Error('SHOULD_NOT_INVOKE_TOOL');},
  };
  const modelBinding = { logicalProviderId: 'OLLAMA_LOCAL_V1', providerBindingDigest: D1,
    localModelPin: { name: id, digest: MD } };
  const toolBinding = {
    logicalProviderId: 'GITHUB_PUBLIC_TOOL', providerSlot: 'tool',
    providerBindingDigest: D2, descriptorDigest: D3, nativeToolPlanDigest: D4,
  };
  return { model, tool, modelBinding, toolBinding, plan, invocations: () => invoked };
}
const modelDraft = x => draftAgentModelRequest({
  plan: x.plan, trustedPlanDigest: x.plan.planDigest,
  requirementId: 'generation', provider: x.model,
  nativeBinding: x.modelBinding, input: modelInput, requestId: 'MODEL-REQ-01',
});
const toolDraft = x => draftAgentToolRequest({
  plan: x.plan, trustedPlanDigest: x.plan.planDigest,
  requirementId: 'source', provider: x.tool,
  nativeBinding: x.toolBinding, input: toolInput, requestId: 'TOOL-REQ-01',
});

test('model request maps to existing PA model port; no native authority is created', async()=>{
  const x = setup();
  const result = await modelDraft(x);
  assert.equal(result.schema, AGENT_PORT_HANDOFF_VERSION);
  assert.equal(result.targetPort.contractId, 'PA.PORT.MODEL_PROVIDER');
  assert.equal(result.targetPort.contractVersion, '1.0.0');
  assert.equal(result.status, 'REQUEST_DRAFT_NOT_AUTHORIZED');
  assert.equal(result.hostAuthorityGranted, false);
  assert.equal(result.nativeBindingVerified, false);
  assert.equal(result.resultProduced, false);
  assert.equal(result.selected.k02PlanDigest, x.plan.planDigest);
  assert.equal(result.portRequest.logical_provider_id, 'OLLAMA_LOCAL_V1');
  assert.deepEqual(result.portRequest.binding_ref, {
    slot_id: 'model', provider_id: 'OLLAMA_LOCAL_V1', binding_digest: D1,
  });
  assert.deepEqual(result.portRequest.payload, { ...modelInput, local_model: { name: id, digest: MD } });
  assert.equal(result.portRequest.request_id, 'MODEL-REQ-01');
  assert.ok(!JSON.stringify(result).includes('hostApproved'));
  assert.equal(x.invocations(), 0);
});
test('tool request uses host-native digests; never swaps in K02 plan digest', async()=>{
  const x = setup();
  const result = await toolDraft(x);
  assert.equal(result.targetPort.contractId, 'PA.PORT.TOOL_PROVIDER');
  assert.equal(result.portRequest.operation, 'source.git.show');
  assert.deepEqual(result.portRequest.tool_descriptor_ref, {
    tool_id: 'source.git.show', descriptor_digest: D3, provider_slot: 'tool',
    provider_binding_digest: D2,
  });
  assert.equal(result.portRequest.tool_plan_digest_or_none, D4);
  assert.deepEqual(result.portRequest.arguments, toolInput);
  assert.equal(result.portRequest.target, null);
  assert.equal(result.portRequest.idempotency_key_or_none, null);
  assert.equal(result.resultProduced,false);
  assert.equal(x.invocations(), 0);
});
test('tool plan digest is absent unless the host explicitly supplies its OWN digest', async()=>{
  const x = setup();
  delete x.toolBinding.nativeToolPlanDigest;
  const result = await toolDraft(x);
  assert.equal(result.portRequest.tool_plan_digest_or_none, null);
  assert.notEqual(result.selected.k02PlanDigest, result.portRequest.tool_plan_digest_or_none);
});
test('native binding cannot be forged by recycling K02 plan or capability digest', async()=>{
  for (const illegal of ['planDigest', 'capabilityDigest']) {
    const x = setup();
    const same = illegal === 'planDigest' ? x.plan.planDigest :
      x.plan.steps.find(s => s.requirementId === 'source').capabilityDigest;
    x.toolBinding.nativeToolPlanDigest = same;
    await assert.rejects(toolDraft(x), failure('INVALID_HANDOFF'));
    const y=setup();
    y.modelBinding.providerBindingDigest = illegal==='planDigest' ? y.plan.planDigest :
      y.plan.steps.find(s=>s.requirementId==='generation').capabilityDigest;
    await assert.rejects(modelDraft(y), failure('INVALID_HANDOFF'));
  }
});
test('modified native binding, swapped model, missing local pin, incorrect argument shape reject', async()=>{
  const x=setup();
  x.modelBinding.localModelPin.digest='a'.repeat(64);
  await assert.rejects(modelDraft(x),failure('BINDING_CHANGED'));
  const y=setup();
  y.modelBinding.logicalProviderId='REMOTE_PROVIDER';
  await assert.rejects(modelDraft(y),failure('INVALID_HANDOFF'));
  const z=setup();
  delete z.modelBinding.localModelPin;
  await assert.rejects(modelDraft(z),failure('INVALID_HANDOFF'));
  const w=setup();
  w.toolBinding.descriptorDigest='not-a-digest';
  await assert.rejects(toolDraft(w),failure('INVALID_HANDOFF'));
  const v=setup();
  v.toolBinding.extraAuthority='GRANTED';
  await assert.rejects(toolDraft(v),failure('INVALID_HANDOFF'));
});
test('binding revalidation detects a changed descriptor and an untrusted plan',async()=>{
  const x=setup();
  x.tool.describeCapabilities=async()=>({
    contractVersion: CONTRACT_VERSION, providerId:'github-public-rest',
    availability:'available',
    capabilities:[{...toolCapability, latencyMsP50: 9}],
  });
  await assert.rejects(toolDraft(x),failure('BINDING_CHANGED'));
  const y=setup();
  const changed=structuredClone(y.plan);
  changed.taskId='changed';
  await assert.rejects(draftAgentToolRequest({
    plan:changed, trustedPlanDigest:y.plan.planDigest,
    requirementId:'source', provider:y.tool, nativeBinding:y.toolBinding,
    input:toolInput, requestId:'TOOL-REQ-01',
  }),failure('INVALID_PLAN'));
});
test('revalidates plan AFTER asynchronous provider probe to reject a mid-probe mutation',async()=>{
  const x=setup();
  const changed=structuredClone(x.plan), trusted=x.plan.planDigest;
  const provider={describeCapabilities:async()=>{
    changed.taskId='MUTATED-DURING-PROBE';
    return { contractVersion:CONTRACT_VERSION,providerId:'github-public-rest',
      availability:'available',capabilities:[toolCapability] };
  }};
  await assert.rejects(verifyInvocationReadiness(changed,'source',provider,trusted),
    failure('INVALID_PLAN'));
});
