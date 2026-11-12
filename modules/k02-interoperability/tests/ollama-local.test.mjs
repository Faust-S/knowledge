import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { OllamaLocalModelProvider, MODEL_INPUT, MODEL_OUTPUT } from '../adapters/ollama-local.mjs';
import { describeCapabilities, resolveRequirements, buildInvocationPlan, validateInvocationInput, validateInvocationOutput, InteropError } from '../index.mjs';

const modelName = 'smollm2:135m-instruct-q2_K';
const digest = 'a'.repeat(64);
const entry = () => ({ models: [{ name: modelName, digest }] });
const output = () => ({ model: modelName, done: true, response: 'The verified response.', prompt_eval_count: 8, eval_count: 6, total_duration: 40000000, eval_duration: 25000000 });
const json = data => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
const error = code => e => e instanceof InteropError && e.code === code;
const inputs = { system: 'Answer with one sentence.', prompt: 'Say hello.', max_output_tokens: 32 };
function makeFetch({ tags = entry(), generation = output() } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return json(url.endsWith('/api/tags') ? tags : generation);
  };
  return { calls, fetchImpl };
}
test('pinned model capability + plan, genuine invocation transport contract', async () => {
  const { calls, fetchImpl } = makeFetch();
  const provider = new OllamaLocalModelProvider({ modelName, expectedDigest: digest, fetchImpl });
  const descriptor = await describeCapabilities(provider);
  assert.equal(descriptor.availability, 'available');
  assert.equal(descriptor.capabilities[0].kind, 'model');
  const requirements = { solutionId: 'model-test', requirements: [{ requirementId: 'generate', kind: 'model', capabilityId: 'text.generate', inputSchema: MODEL_INPUT, outputSchema: MODEL_OUTPUT, effectClass: 'MODEL_INFERENCE', required: true }] };
  const resolution = resolveRequirements(requirements, [descriptor]);
  assert.equal(resolution.status, 'SUPPORTED');
  const plan = buildInvocationPlan({ taskId: 'SYNTHETIC-MODEL-TEST', solutionId: 'model-test' }, [], resolution);
  assert.equal(plan.steps[0].proofOfInvoke, null);
  validateInvocationInput(plan.steps[0], inputs);
  await assert.rejects(provider.invoke('text.generate', inputs, { hostApproved: true }), error('HOST_APPROVAL_REQUIRED'));
  const result = await provider.invoke('text.generate', inputs, { hostApproved: true, pinnedModelDigest: digest });
  validateInvocationOutput(plan.steps[0], result.output);
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(result.output.model_digest, digest);
  assert.equal(result.observation.completionTokens, 6);
  assert.equal(result.observation.actualProviderFeeUsd, 0);
  assert.equal(result.observation.hostComputeCostUsd, null);
  assert.equal(result.observation.outputSha256, createHash('sha256').update(output().response).digest('hex'));
  assert.equal(calls.length, 4);
  assert.ok(calls.every(x => x.url.startsWith('http://127.0.0.1:11434/api/') && x.opts.redirect === 'error'));
  const generation = calls.find(x => x.url.endsWith('/api/generate'));
  assert.equal(generation.opts.method, 'POST');
  assert.equal(JSON.parse(generation.opts.body).stream, false);
  assert.equal(JSON.parse(generation.opts.body).model, modelName);
});
test('probe is unavailable rather than fabricating model ability', async () => {
  const missing = new OllamaLocalModelProvider({ modelName, expectedDigest: digest, fetchImpl: async () => json({ models: [] }) });
  assert.equal((await describeCapabilities(missing)).availability, 'unavailable');
  const changed = new OllamaLocalModelProvider({ modelName, expectedDigest: digest, fetchImpl: async () => json({ models: [{ name: modelName, digest: 'b'.repeat(64) }] }) });
  assert.match((await describeCapabilities(changed)).unavailableReason, /MODEL_DIGEST_CHANGED/);
  await assert.rejects(changed.invoke('text.generate', inputs, { hostApproved: true, pinnedModelDigest: digest }), error('PROVIDER_UNAVAILABLE'));
});
test('rejects wrong model response, empty answer, absent usage and digest swap after call', async () => {
  for (const invalid of [
    { ...output(), model: 'different-model' },
    { ...output(), response: '  ' },
    { ...output(), eval_count: undefined },
    { ...output(), eval_count: 0 },
  ]) {
    const provider = new OllamaLocalModelProvider({ modelName, expectedDigest: digest, fetchImpl: makeFetch({ generation: invalid }).fetchImpl });
    await assert.rejects(provider.invoke('text.generate', inputs, { hostApproved: true, pinnedModelDigest: digest }), error('INVALID_PROVIDER_OUTPUT'));
  }
  let tagsCalls = 0;
  const provider = new OllamaLocalModelProvider({
    modelName, expectedDigest: digest,
    fetchImpl: async url => {
      if (url.endsWith('/api/tags')) {
        tagsCalls++;
        return json({ models: [{ name: modelName, digest: tagsCalls === 1 ? digest : 'f'.repeat(64) }] });
      }
      return json(output());
    },
  });
  await assert.rejects(provider.invoke('text.generate', inputs, { hostApproved: true, pinnedModelDigest: digest }), error('PROVIDER_UNAVAILABLE'));
});
test('does not allow remote endpoints, unpinned model, cloud tag or unsupported operation', async () => {
  assert.throws(() => new OllamaLocalModelProvider({ modelName, expectedDigest: 'invalid' }), error('INVALID_DESCRIPTOR'));
  assert.throws(() => new OllamaLocalModelProvider({ modelName: 'some:cloud', expectedDigest: digest }), error('INVALID_DESCRIPTOR'));
  const provider = new OllamaLocalModelProvider({ modelName, expectedDigest: digest, fetchImpl: makeFetch().fetchImpl });
  await assert.rejects(provider.invoke('another.operation', inputs, { hostApproved: true, pinnedModelDigest: digest }), error('UNSUPPORTED'));
  await assert.rejects(provider.invoke('text.generate', { ...inputs, unwanted: true }, { hostApproved: true, pinnedModelDigest: digest }), error('SCHEMA_VALUE_INVALID'));
});

test('two exact local model bindings can coexist without a second runtime',async()=>{
  const first=new OllamaLocalModelProvider({modelName,expectedDigest:digest,
    providerId:'ollama-small',fetchImpl:makeFetch().fetchImpl});
  const second=new OllamaLocalModelProvider({modelName,expectedDigest:digest,
    providerId:'ollama-large',fetchImpl:makeFetch().fetchImpl});
  const descriptors=await Promise.all([first,second].map(p=>p.describeCapabilities()));
  assert.deepEqual(descriptors.map(d=>d.providerId),['ollama-small','ollama-large']);
  assert.ok(descriptors.every(d=>d.availability==='available'));
  assert.throws(()=>new OllamaLocalModelProvider({modelName,expectedDigest:digest,
    providerId:'invalid provider id'}),error('INVALID_DESCRIPTOR'));
});
test('reasoning mode defaults to model automatic behavior; explicit host choice is sent unchanged',async()=>{
  const {calls,fetchImpl}=makeFetch();
  const automatic=new OllamaLocalModelProvider({modelName,expectedDigest:digest,fetchImpl});
  await automatic.invoke('text.generate',inputs,{hostApproved:true,pinnedModelDigest:digest});
  assert.equal(JSON.parse(calls.find(x=>x.url.endsWith('/api/generate')).opts.body).think,undefined);
  const choices=[['enabled',true],['disabled',false]];
  for(const [thinkingMode,expected] of choices){
    const live=makeFetch();
    const p=new OllamaLocalModelProvider({modelName,expectedDigest:digest,
      fetchImpl:live.fetchImpl,thinkingMode,providerId:'ollama-study'});
    const r=await p.invoke('text.generate',inputs,{hostApproved:true,pinnedModelDigest:digest});
    assert.equal(JSON.parse(live.calls.find(x=>x.url.endsWith('/api/generate')).opts.body).think,expected);
    assert.equal(r.observation.thinkingMode,thinkingMode);
  }
  assert.throws(()=>new OllamaLocalModelProvider({modelName,expectedDigest:digest,
    thinkingMode:'always-automatic'}),error('INVALID_DESCRIPTOR'));
});
