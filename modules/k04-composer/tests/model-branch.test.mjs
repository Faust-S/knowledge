import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ComposerError, digest, normalizeModelDraft, resolveRequiredCapabilities} from '../index.mjs';
import {solution, sampleAvailability, extractStructuredMeeting} from '../sample/open-host.mjs';
import {runK02ModelBranch} from '../sample/k02-model-host.mjs';

const transcript = await readFile(new URL('../sample/meeting.txt', import.meta.url), 'utf8');
const pin = {name:'open-test-model:stable', digest:'a'.repeat(64)};
const source = {ref:'synthetic/meeting.txt',revision:'fixture-1',rights:'IWXA_AUTHORED_SYNTHETIC',authorized:true};
const authorization = {hostApproved:true,pinnedModelDigest:pin.digest};
const error = code => x => x instanceof ComposerError && x.code === code;
function sampleProvider({text, changedPin = false, failure = false} = {}) {
  const provider = structuredClone(sampleAvailability({withModel:true}).providers.at(-1));
  provider.providerId = 'k02-model-sample';
  let probes = 0, invokes = 0;
  return {
    async describeCapabilities() {
      probes++;
      const copy = structuredClone(provider);
      if (changedPin && probes >= 2) copy.capabilities[0].modelPin.digest = 'f'.repeat(64);
      return copy;
    },
    async invoke(op,input,auth) {
      invokes++;
      assert.equal(op,'text.generate');
      assert.equal(auth.pinnedModelDigest,pin.digest);
      assert.ok(input.prompt.includes('Протокол'));
      if (failure) return {status:'FAILED'};
      return {status:'SUCCEEDED',output:{
        text:text ?? JSON.stringify(extractStructuredMeeting(transcript)),
        model:pin.name,model_digest:pin.digest},
        observation:{proofClass:'TEST_DOUBLE_NOT_REAL_MODEL_INFERENCE'}};
    },
    get invokes(){return invokes;},
    get probes(){return probes;}
  };
}
test('complete K02-shaped model route with three receipts and human gate, TEST DOUBLE only',async()=>{
  const provider=sampleProvider();
  const out=await runK02ModelBranch({provider,transcript,source,hostAuthorization:authorization,hostApproved:true});
  assert.equal(provider.invokes,1);
  assert.deepEqual(out.plan.steps.map(x=>x.id),['input','extract','normalize','audit','human_review']);
  assert.equal(out.receipts.length,3);
  assert.equal(out.evaluation.passed,true);
  assert.equal(out.evaluation.status,'DRAFT_READY_FOR_HUMAN_REVIEW');
  assert.equal(out.providerProofClass,'TEST_DOUBLE_NOT_REAL_MODEL_INFERENCE');
  assert.equal(out.draft.action_items.length,2);
  assert.equal(out.evaluation.assignmentsExecuted,false);
  assert.equal(out.evaluation.hostAuthorityVerified,false);
  assert.equal(out.humanReviewed,false);
});
test('host authorization is a mandatory separate decision',async()=>{
  const provider=sampleProvider();
  await assert.rejects(runK02ModelBranch({provider,transcript,source,
    hostAuthorization:authorization}),error('HOST_APPROVAL_REQUIRED'));
  assert.equal(provider.invokes,0);
  await assert.rejects(runK02ModelBranch({provider,transcript,source,
    hostApproved:true,hostAuthorization:{...authorization,pinnedModelDigest:'b'.repeat(64)}}),
    error('HOST_APPROVAL_REQUIRED'));
  assert.equal(provider.invokes,0);
});
test('provider descriptor drift between resolution and invocation stops execution',async()=>{
  const provider=sampleProvider({changedPin:true});
  await assert.rejects(runK02ModelBranch({provider,transcript,source,
    hostApproved:true,hostAuthorization:authorization}),error('PROVIDER_BINDING_CHANGED'));
  assert.equal(provider.invokes,0);
});
test('model branch refuses no real provider / absent pin',async()=>{
  const available=sampleAvailability({withModel:true});
  delete available.providers.at(-1).capabilities[0].modelPin;
  const r=resolveRequiredCapabilities(solution,available,{preferOption:'model_json'});
  assert.equal(r.chosenOption,'structured_rule');
  await assert.rejects(runK02ModelBranch({provider:{describeCapabilities:async()=>({
    contractVersion:'IWXA.K02.INTEROP/0.1.0',providerId:'missing',
    availability:'unavailable',capabilities:[]})},transcript,source,
    hostApproved:true,hostAuthorization:authorization}),error('MODEL_PROVIDER_INCOMPATIBLE'));
});
test('invalid JSON and model result without exact source are rejected',async()=>{
  const json=sampleProvider({text:'not JSON'});
  await assert.rejects(runK02ModelBranch({provider:json,transcript,source,
    hostApproved:true,hostAuthorization:authorization}),error('MODEL_DRAFT_NOT_JSON'));
  const bad=extractStructuredMeeting(transcript);
  bad.action_items[0].quote='This statement does not exist in the source.';
  const r=await runK02ModelBranch({provider:sampleProvider({text:JSON.stringify(bad)}),
    transcript,source,hostApproved:true,hostAuthorization:authorization});
  assert.equal(r.evaluation.passed,false);
  assert.equal(r.evaluation.status,'REVIEW_REQUIRED');
  assert.ok(r.evaluation.errors.some(x=>x.includes('SOURCE_MISMATCH')));
});
test('model response cannot report executed human work or bypass fixed pin',()=>{
  const draft=extractStructuredMeeting(transcript);
  draft.action_items[0].actual_work_status='COMPLETED';
  assert.throws(()=>normalizeModelDraft({text:JSON.stringify(draft),model:pin.name,model_digest:pin.digest},pin),
    error('MODEL_DRAFT_STRUCTURE_INVALID'));
  assert.throws(()=>normalizeModelDraft({text:JSON.stringify(extractStructuredMeeting(transcript)),
    model:'substitute',model_digest:pin.digest},pin),error('MODEL_OUTPUT_NOT_PINNED'));
});
test('tampered plan/normalization/receipt cannot pass model evaluation',async()=>{
  const out=await runK02ModelBranch({provider:sampleProvider(),transcript,source,
    hostApproved:true,hostAuthorization:authorization});
  for (const mutation of [
    o=>{o.receipts[0].inputDigest='0'.repeat(64);},
    o=>{o.receipts[1].outputDigest='0'.repeat(64);},
    o=>{o.receipts[1].operation='SKIP_JSON';},
    o=>{o.receipts[2].output.passed=false;},
    o=>{o.receipts[2].providerId='wrong';},
    o=>{o.receipts.pop();},
    o=>{o.plan.planDigest='0'.repeat(64);}
  ]) {
    const obs=structuredClone(out.observation);mutation(obs);
    const {evaluateResultAgainstCriteria}=await import('../index.mjs');
    assert.equal(evaluateResultAgainstCriteria(obs).passed,false);
  }
});
test('denied source and provider inference failure do not produce Result',async()=>{
  const denied={...source,authorized:false};
  const provider=sampleProvider();
  await assert.rejects(runK02ModelBranch({provider,transcript,source:denied,
    hostApproved:true,hostAuthorization:authorization}),error('INVALID_OR_UNAUTHORIZED_INPUT'));
  assert.equal(provider.invokes,0);
  await assert.rejects(runK02ModelBranch({provider:sampleProvider({failure:true}),transcript,source,
    hostApproved:true,hostAuthorization:authorization}),error('MODEL_INVOCATION_FAILED'));
});
