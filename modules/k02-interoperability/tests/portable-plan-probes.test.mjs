import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTRACT_VERSION, InteropError, resolveRequirements, buildInvocationPlan,
  verifyInvocationReadiness, verifyPortablePlan,
} from '../index.mjs';
import { GIT_INPUT, GIT_OUTPUT } from '../adapters/git-cli.mjs';
import { AUDIT_INPUT, AUDIT_OUTPUT } from '../adapters/node-evidence-cli.mjs';

const errorCode = code => error => error instanceof InteropError && error.code === code;
const capability = (id, inputSchema, outputSchema, effectClass) => ({
  kind: 'tool', capabilityId: id, supported: true,
  inputSchema, outputSchema, effectClass,
  providerFeeUsd: 0, latencyMsP50: null,
});
const gitCap = capability('source.git.show', GIT_INPUT, GIT_OUTPUT, 'HOST_AUTHORIZED_READ');
const auditCap = capability('evidence.exact.audit', AUDIT_INPUT, AUDIT_OUTPUT, 'PURE_COMPUTE');
const descriptor = (id, capabilities) => ({
  contractVersion: CONTRACT_VERSION, providerId: id,
  availability: 'available', capabilities,
});
const request = (id, cap) => ({
  requirementId: id, kind: 'tool', capabilityId: cap.capabilityId,
  inputSchema: cap.inputSchema, outputSchema: cap.outputSchema,
  effectClass: cap.effectClass, required: true,
});
const solution = {
  solutionId: 'K02-PROBE-SNAPSHOT-TEST',
  requirements: [request('source', gitCap), request('audit', auditCap)],
};
function createPlan(descriptors) {
  const resolution = resolveRequirements(solution, descriptors);
  assert.equal(resolution.status, 'SUPPORTED');
  return buildInvocationPlan({
    taskId: 'PROBE-SNAPSHOT-NOT-PRODUCT-TASK', solutionId: solution.solutionId,
  }, [], resolution);
}
const makeEntry = (description, onProbe = () => {}) => {
  let probes = 0, invokes = 0;
  const provider = {
    async describeCapabilities() {
      probes++;
      await onProbe();
      return structuredClone(description);
    },
    async invoke() { invokes++; throw new Error('PROVIDER_INVOKE_NOT_EXPECTED'); },
  };
  return { providerId: description.providerId, provider,
    probes: () => probes, invokes: () => invokes };
};
test('one provider with two capabilities is probed only once on portable restore', async () => {
  const one = descriptor('combined-provider', [gitCap, auditCap]);
  const plan = createPlan([one]);
  const entry = makeEntry(one);
  const result = await verifyPortablePlan(plan, plan.planDigest, [entry], []);
  assert.equal(result.status, 'RESTORED_NOT_AUTHORIZED');
  assert.deepEqual(result.checkedSteps.map(s => s.requirementId), ['source', 'audit']);
  assert.equal(entry.probes(), 1, 'duplicate probe adds latency and may change snapshot');
  assert.equal(entry.invokes(), 0);
  assert.equal(result.providerInvocations, 0);
});
test('independent selected providers can be discovered concurrently; unused provider is not probed', async () => {
  const first = descriptor('git-provider', [gitCap]);
  const second = descriptor('audit-provider', [auditCap]);
  const unused = descriptor('unused-provider', [gitCap]);
  const plan = createPlan([first, second]);
  let active = 0, peak = 0;
  const probe = async () => {
    active++;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active--;
  };
  const a = makeEntry(first, probe);
  const b = makeEntry(second, probe);
  const never = makeEntry(unused, () => { throw Error('unused provider probed'); });
  const result = await verifyPortablePlan(plan, plan.planDigest, [a, b, never], []);
  assert.equal(result.checkedSteps.length, 2);
  assert.equal(a.probes(), 1);
  assert.equal(b.probes(), 1);
  assert.equal(never.probes(), 0);
  assert.equal(peak, 2);
});
test('a second selected capability changing in a shared provider rejects whole snapshot', async () => {
  const original = descriptor('combined-provider', [gitCap, auditCap]);
  const plan = createPlan([original]);
  const changed = structuredClone(original);
  changed.capabilities[1].providerFeeUsd = 0.5;
  const entry = makeEntry(changed);
  await assert.rejects(
    verifyPortablePlan(plan, plan.planDigest, [entry], []),
    errorCode('BINDING_CHANGED'));
  assert.equal(entry.probes(), 1);
});
test('invoke readiness always takes a fresh provider probe after recovery', async () => {
  const original = descriptor('combined-provider', [gitCap, auditCap]);
  const plan = createPlan([original]);
  let probes = 0;
  const provider = {
    async describeCapabilities() {
      probes++;
      const next = structuredClone(original);
      if (probes > 1) next.capabilities[0].providerFeeUsd = 0.02;
      return next;
    },
  };
  await verifyPortablePlan(plan, plan.planDigest,
    [{providerId: original.providerId, provider}], []);
  assert.equal(probes, 1);
  await assert.rejects(
    verifyInvocationReadiness(plan, 'source', provider, plan.planDigest),
    errorCode('BINDING_CHANGED'));
  assert.equal(probes, 2, 'invocation readiness must not reuse recovery snapshot');
});
test('plan mutation during asynchronous provider discovery cannot pass restore', async () => {
  const original = descriptor('combined-provider', [gitCap, auditCap]);
  const plan = createPlan([original]);
  const provider = {
    async describeCapabilities() {
      await Promise.resolve();
      plan.taskId = 'CHANGED_DURING_PROBE';
      return structuredClone(original);
    },
  };
  await assert.rejects(
    verifyPortablePlan(plan, plan.planDigest,
      [{providerId: original.providerId, provider}], []),
    errorCode('INVALID_PLAN'));
});
test('provider availability and identity changes are reported without invoking providers', async () => {
  const original = descriptor('combined-provider', [gitCap, auditCap]);
  const plan = createPlan([original]);
  const unavailable = {...original, availability: 'unavailable', unavailableReason: 'DISCONNECTED'};
  const a = makeEntry(unavailable);
  await assert.rejects(
    verifyPortablePlan(plan, plan.planDigest, [a], []),
    errorCode('PROVIDER_UNAVAILABLE'));
  assert.equal(a.invokes(), 0);
  const other = makeEntry({...original, providerId: 'replaced-provider'});
  const offered = {...other, providerId: original.providerId};
  await assert.rejects(
    verifyPortablePlan(plan, plan.planDigest, [offered], []),
    errorCode('BINDING_CHANGED'));
  assert.equal(other.invokes(), 0);
});
