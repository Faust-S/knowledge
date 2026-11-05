import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTRACT_VERSION, InteropError, describeCapabilities, resolveRequirements,
  buildInvocationPlan, verifyInvocationReadiness } from '../index.mjs';
import { OllamaLocalModelProvider, MODEL_INPUT, MODEL_OUTPUT } from '../adapters/ollama-local.mjs';
import { draftAgentModelRequest } from '../adapters/agent-port-handoff.mjs';

const NAME = 'smollm2:135m-instruct-q2_K';
const PIN_A = 'a'.repeat(64), PIN_B = 'b'.repeat(64);
const failure = code => err => err instanceof InteropError && err.code === code;
const cap = modelPin => ({
  kind:'model', capabilityId:'text.generate', supported:true, inputSchema: MODEL_INPUT,
  outputSchema: MODEL_OUTPUT, effectClass:'MODEL_INFERENCE', providerFeeUsd:0,
  latencyMsP50:null, inputModes:['text'], outputModes:['text'],
  ...(modelPin ? {modelPin} : {}),
});
const desc = (id, pin) => ({
  contractVersion:CONTRACT_VERSION, providerId:id, availability:'available',
  capabilities:[cap(pin)],
});
const req = (pin, modes=['text'])=>({
  solutionId:'pin-selection', requirements:[{
    requirementId:'generation', kind:'model', capabilityId:'text.generate',
    effectClass:'MODEL_INFERENCE', inputSchema: MODEL_INPUT, outputSchema: MODEL_OUTPUT,
    required:true, inputModes:modes, outputModes:['text'],
    ...(pin ? {modelPin:pin} : {}),
  }],
});
const pinA={name:NAME,digest:PIN_A};
const pinB={name:NAME,digest:PIN_B};
const model = descriptor => ({
  modelName:NAME, expectedDigest:PIN_A, describeCapabilities:async()=>descriptor,
});

test('exact pinned model wins regardless of advertised price ordering', () => {
  const selected=resolveRequirements(req(pinA),[
    desc('cheap-wrong',pinB),
    {...desc('correct',pinA),capabilities:[{...cap(pinA),providerFeeUsd:0.01}]},
  ]);
  assert.equal(selected.status,'SUPPORTED');
  assert.equal(selected.selected[0].providerId,'correct');
  assert.deepEqual(selected.selected[0].modelPin,pinA);
  const plan=buildInvocationPlan({taskId:'PIN-TEST',solutionId:'pin-selection'},[],selected);
  assert.deepEqual(plan.steps[0].modelPin,pinA);
});
test('unknown pin and wrong model pin produce explicit mismatch',()=>{
  const a=resolveRequirements(req(pinA),[desc('unbound',null)]);
  const b=resolveRequirements(req(pinA),[desc('wrong',pinB)]);
  assert.equal(a.status,'UNSUPPORTED');
  assert.equal(a.missing[0].reason,'PIN_MISMATCH');
  assert.equal(b.missing[0].reason,'PIN_MISMATCH');
});
test('image-only model cannot satisfy text requirement',()=>{
  const d=desc('image-provider',pinA);
  d.capabilities[0].inputModes=['image'];
  const r=resolveRequirements(req(pinA),[d]);
  assert.equal(r.status,'UNSUPPORTED');
  assert.equal(r.missing[0].reason,'MODE_MISMATCH');
});
test('invalid, repeated and empty modes reject; tool with modelPin rejects',async()=>{
  for(const modes of [[],['text','text'],['Text'],['invalid mode']]){
    const d=desc('model',pinA);
    d.capabilities[0].inputModes=modes;
    await assert.rejects(describeCapabilities({describeCapabilities:async()=>d}),failure('INVALID_DESCRIPTOR'));
  }
  for(const invalidPin of [{name:NAME,digest:'bad'},{name:NAME,digest:PIN_A,unexpected:true},{name:'x:cloud',digest:PIN_A}]){
    const d=desc('model',invalidPin);
    await assert.rejects(describeCapabilities({describeCapabilities:async()=>d}),failure('INVALID_DESCRIPTOR'));
  }
});
test('changed pinned model is detected before invocation readiness',async()=>{
  const d=desc('ollama-local-pinned',pinA);
  const selected=resolveRequirements(req(pinA),[d]);
  const plan=buildInvocationPlan({taskId:'PIN-TEST',solutionId:'pin-selection'},[],selected);
  const current=desc('ollama-local-pinned',pinB);
  await assert.rejects(verifyInvocationReadiness(plan,'generation',model(current),plan.planDigest),failure('BINDING_CHANGED'));
  assert.equal((await verifyInvocationReadiness(plan,'generation',model(d),plan.planDigest)).status,'MATCHED_NOT_AUTHORIZED');
});
test('Agent handoff rejects host-native model pin unlike the selected plan',async()=>{
  const d=desc('ollama-local-pinned',pinA);
  const selected=resolveRequirements(req(pinA),[d]);
  const plan=buildInvocationPlan({taskId:'PIN-TEST',solutionId:'pin-selection'},[],selected);
  const p=model(d);
  const options={
    plan,trustedPlanDigest:plan.planDigest,requirementId:'generation',
    provider:p,input:{system:'',prompt:'hello',max_output_tokens:4},
    nativeBinding:{
      logicalProviderId:'OLLAMA_LOCAL_V1',providerBindingDigest:'1'.repeat(64),
      localModelPin:pinA,
    },requestId:'PIN-HANDOFF-01',
  };
  const good=await draftAgentModelRequest(options);
  assert.deepEqual(good.portRequest.payload.local_model,pinA);
  const {nativeBinding,...rest}=options;
  await assert.rejects(draftAgentModelRequest({...rest,nativeBinding:{...nativeBinding,localModelPin:pinB}}),failure('BINDING_CHANGED'));
});
test('actual Ollama capability descriptor includes exact immutable model reference',async()=>{
  const provider=new OllamaLocalModelProvider({
    modelName:NAME,expectedDigest:PIN_A,
    fetchImpl:async()=>new Response(JSON.stringify({models:[{name:NAME,digest:PIN_A}]}),{status:200}),
  });
  const descriptor=await describeCapabilities(provider);
  assert.deepEqual(descriptor.capabilities[0].modelPin,pinA);
  assert.equal(resolveRequirements(req(pinA),[descriptor]).status,'SUPPORTED');
});
