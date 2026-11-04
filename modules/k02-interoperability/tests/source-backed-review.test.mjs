import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { sourceBackedReview } from '../consumers/source-backed-review.mjs';
import { NodeEvidenceCliProvider } from '../adapters/node-evidence-cli.mjs';
import { MODEL_INPUT, MODEL_OUTPUT } from '../adapters/ollama-local.mjs';
import { GIT_INPUT, GIT_OUTPUT } from '../adapters/git-cli.mjs';
import { CONTRACT_VERSION, InteropError } from '../index.mjs';

const sha = '6d04b82f1b0b614fa22c735075b66f20c1d85f92';
const md = 'a'.repeat(64);
const sourceText = await readFile(new URL('../../../solutions/meeting-followup/agent.json', import.meta.url), 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const cap = (kind, capabilityId, inputSchema, outputSchema, effectClass) => ({
  kind, capabilityId, supported:true, inputSchema,outputSchema,effectClass,
  providerFeeUsd:0,latencyMsP50:null,...(kind==='model'?{inputModes:['text'],outputModes:['text']}:{}),
});
const descriptor = (providerId,capabilities,availability='available') => ({
  contractVersion:CONTRACT_VERSION,providerId,availability,
  ...(availability==='unavailable'?{unavailableReason:'DISCONNECTED'}:{}),
  capabilities,
});
const srcCap=cap('tool','source.git.show',GIT_INPUT,GIT_OUTPUT,'HOST_AUTHORIZED_READ');
const auditCap=cap('tool','evidence.exact.audit',
  (await import('../adapters/node-evidence-cli.mjs')).AUDIT_INPUT,
  (await import('../adapters/node-evidence-cli.mjs')).AUDIT_OUTPUT,'PURE_COMPUTE');
const modelCap=cap('model','text.generate',MODEL_INPUT,MODEL_OUTPUT,'MODEL_INFERENCE');
const makeSource=(text=sourceText) => ({
  describeCapabilities:async()=>descriptor('github-public-rest',[srcCap]),
  invoke:async()=>({status:'SUCCEEDED',output:{
    sourceRef:'github:Faust-S/knowledge@'+sha+':solutions/meeting-followup/agent.json',
    revision:sha,content:text,sha256:digest(text)},observation:{durationMs:3}})
});
const makeModel=(answer='Who should approve this draft?')=>({
  describeCapabilities:async()=>descriptor('ollama-local-pinned',[modelCap]),
  invoke:async(_,input,approval)=>{
    assert.equal(approval.pinnedModelDigest,md);
    assert.equal(approval.hostApproved,true);
    assert.ok(input.prompt.includes('No automatic Task'));
    return {status:'SUCCEEDED',output:{text:answer,model:'test-pinned',model_digest:md},
      observation:{outputSha256:digest(answer),promptTokens:55,completionTokens:8,
        durationMs:4,proofClass:'REAL_LOCAL_MODEL_INFERENCE_NOT_PRODUCT_TASK'}};
  }
});
const options=()=>({sourceRevision:sha,modelDigest:md,sourceProvider:makeSource(),
  evidenceProvider:new NodeEvidenceCliProvider(),modelProvider:makeModel(),
  hostApproval:{allowSourceRead:true,allowEvidenceCheck:true,allowModelInvoke:true}});
const error = code => e=>e instanceof InteropError&&e.code===code;

test('a complete source + evidence skill + model consumer stays an unapproved draft',async()=>{
 const r=await sourceBackedReview(options());
 assert.equal(r.status,'DRAFT_REQUIRES_HUMAN_REVIEW');
 assert.equal(r.sourceDefinitionStatus,'SPEC_COMPLETE_NOT_EXECUTED');
 assert.equal(r.source.quoteEvidence,'EXACT_SPAN_VERIFIED');
 assert.equal(r.skill.accepted,1);
 assert.equal(r.skill.auditStatus,'REVIEW_REQUIRED');
 assert.equal(r.model.questionVerifiedAsFact,false);
 assert.equal(r.taskCreated,false);
 assert.equal(r.resultStored,false);
 assert.ok(r.model.questionDraft.includes('?'));
 assert.equal(r.source.sha256,digest(sourceText));
 assert.match(r.planDigest,/^[a-f0-9]{64}$/);
});
test('host permission boundary denies without provider calls',async()=>{
 let calls=0;
 const x=options();
 x.hostApproval.allowModelInvoke=false;
 x.sourceProvider.invoke=async()=>{calls++;throw Error('called');};
 await assert.rejects(sourceBackedReview(x),error('HOST_APPROVAL_REQUIRED'));
 assert.equal(calls,0);
});
test('wrong source hash and tampered status fail before model execution',async()=>{
 for(const mutation of ['hash','status']){
  let invoked=false;
  const x=options();
  if(mutation==='hash'){
   x.sourceProvider.invoke=async()=>({status:'SUCCEEDED',output:{sourceRef:'github:Faust-S/knowledge@'+sha+':solutions/meeting-followup/agent.json',
    revision:sha,content:sourceText,sha256:'f'.repeat(64)},observation:{}});
  }else {
   const changed=sourceText.replace('"SPEC_COMPLETE_NOT_EXECUTED"','"IWXA_VERIFIED"');
   x.sourceProvider=makeSource(changed);
  }
  x.modelProvider.invoke=async()=>{invoked=true;throw Error('wrong');};
  await assert.rejects(sourceBackedReview(x),error('INVALID_PROVIDER_OUTPUT'));
  assert.equal(invoked,false);
 }
});
test('unsupported required model and wrong model digest are rejected',async()=>{
 const x=options();
 x.modelProvider.describeCapabilities=async()=>descriptor('ollama-local-pinned',[modelCap],'unavailable');
 await assert.rejects(sourceBackedReview(x),error('PROVIDER_UNAVAILABLE'));
 const y=options();
 y.modelProvider=makeModel();
 y.modelProvider.invoke=async()=>({status:'SUCCEEDED',output:{text:'draft',model:'other',model_digest:'b'.repeat(64)},
  observation:{outputSha256:digest('draft'),completionTokens:2,durationMs:1}});
 await assert.rejects(sourceBackedReview(y),error('INVALID_PROVIDER_OUTPUT'));
});
