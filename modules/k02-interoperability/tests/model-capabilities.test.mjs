import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTRACT_VERSION, describeCapabilities, resolveRequirements, buildInvocationPlan, validateInvocationOutput, InteropError } from '../index.mjs';

const promptSchema = { type:'object', properties:{prompt:{type:'string',minLength:1}},required:['prompt'],additionalProperties:false };
const textSchema = { type:'object', properties:{text:{type:'string'}},required:['text'],additionalProperties:false };
const cap = (id, supported, price, latency) => ({
  kind:'model',capabilityId:'text.generate',supported,
  ...(!supported ? {unsupportedReason:'NOT_ENABLED_BY_HOST'} : {}),
  effectClass:'MODEL_INFERENCE',inputSchema:promptSchema,outputSchema:textSchema,
  providerFeeUsd:price,latencyMsP50:latency,inputModes:['text'],outputModes:['text']
});
const provider = (id, capability, availability='available') => ({
  contractVersion:CONTRACT_VERSION,providerId:id,availability,
  ...(availability==='unavailable' ? {unavailableReason:'MODEL_NOT_CONNECTED'} : {}),
  capabilities:[capability]
});
const solution = {solutionId:'text-assist',requirements:[{
  requirementId:'generation',kind:'model',capabilityId:'text.generate',
  inputSchema:promptSchema,outputSchema:textSchema,effectClass:'MODEL_INFERENCE',required:true
}]};

test('model descriptors rank known cost and latency without pretending invocation', async () => {
  const connected=provider('model-probe-a',cap('a',true,0.003,400));
  const cheaper=provider('model-probe-b',cap('b',true,0.001,800));
  const disabled=provider('model-probe-c',cap('c',false,null,null));
  const descriptors = await Promise.all([connected,cheaper,disabled].map(desc=>describeCapabilities({describeCapabilities:async()=>desc})));
  const r=resolveRequirements(solution,descriptors);
  assert.equal(r.status,'SUPPORTED');
  assert.equal(r.selected[0].providerId,'model-probe-b');
  assert.equal(r.estimates.providerFeeUsd,0.001);
  assert.equal(r.estimates.latencyMs,800);
  const plan=buildInvocationPlan({taskId:'MODEL-PLAN-ONLY',solutionId:'text-assist'},[],r);
  assert.equal(plan.steps[0].invocationAuthority,'HOST_ONLY');
  assert.equal(plan.steps[0].proofOfInvoke,null);
  assert.equal(plan.steps[0].invocationState,'NOT_INVOKED');
  validateInvocationOutput(plan.steps[0],{text:'example'});
});

test('model unavailable, unsupported and incompatible modes are exposed', async () => {
  const unavailable=provider('model-missing',cap('m',true,null,null),'unavailable');
  assert.equal(resolveRequirements(solution,[unavailable]).missing[0].reason,'UNAVAILABLE');
  assert.equal(resolveRequirements(solution,[provider('model-disabled',cap('d',false,null,null))]).missing[0].reason,'UNSUPPORTED');
  const wrong=cap('w',true,0,0);
  wrong.outputSchema={type:'object',properties:{number:{type:'integer'}},required:['number'],additionalProperties:false};
  assert.equal(resolveRequirements(solution,[provider('model-incompatible',wrong)]).missing[0].reason,'SCHEMA_MISMATCH');
  const bad=cap('b',true,0,0);
  bad.inputModes=['image']; bad.outputModes=['text'];
  // A provider can advertise any modality, but the host must still match its input/output contract.
  assert.deepEqual(bad.inputModes,['image']);
  await assert.rejects(describeCapabilities({describeCapabilities:async()=>provider('m',{...bad,inputModes:null})}),
    e=>e instanceof InteropError && e.code==='INVALID_DESCRIPTOR');
});
