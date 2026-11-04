import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CONTRACT_VERSION, PLAN_BINDING_VERSION, InteropError, describeCapabilities,
  resolveRequirements, buildInvocationPlan, verifyInvocationReadiness,
  verifySkillBinding, digest
} from '../index.mjs';
import { GitCliProvider, GIT_INPUT, GIT_OUTPUT } from '../adapters/git-cli.mjs';

const sha256 = /^[a-f0-9]{64}$/;
const bad = code => e => e instanceof InteropError && e.code === code;
const skill = JSON.parse(await readFile(new URL('../skills/exact-source-audit.skill.json', import.meta.url), 'utf8'));
const instructions = await readFile(new URL('../skills/exact-source-audit.instructions.json', import.meta.url));

const make = async () => {
  const provider = new GitCliProvider(process.cwd());
  const descriptor = await describeCapabilities(provider);
  const requirements = { solutionId:'binding-test', requirements: [{
    requirementId:'source', kind:'tool', capabilityId:'source.git.show',
    inputSchema:GIT_INPUT, outputSchema:GIT_OUTPUT,
    effectClass:'HOST_AUTHORIZED_READ',required:true,
  }] };
  // The audited skill needs the evidence capability, so this plan does not activate it.
  const resolved = resolveRequirements(requirements,[descriptor]);
  assert.equal(resolved.status,'SUPPORTED');
  const plan = buildInvocationPlan({taskId:'PLAN-1',solutionId:'binding-test'},[],resolved);
  return { provider, descriptor, resolved, plan };
};
test('capability hash is stable and pinned to exact provider and schema',async()=>{
  const {provider,descriptor,resolved,plan}=await make();
  assert.match(resolved.selected[0].capabilityDigest,sha256);
  assert.equal(plan.bindingVersion,PLAN_BINDING_VERSION);
  assert.equal(plan.contractVersion,CONTRACT_VERSION);
  assert.equal(plan.steps[0].capabilityDigest,resolved.selected[0].capabilityDigest);
  const ready=await verifyInvocationReadiness(plan,'source',provider,plan.planDigest);
  assert.equal(ready.status,'MATCHED_NOT_AUTHORIZED');
  assert.equal(ready.planDigest,plan.planDigest);
  assert.equal(ready.capabilityDigest,plan.steps[0].capabilityDigest);
  assert.deepEqual(resolved,resolveRequirements(
    {solutionId:'binding-test',requirements:[{
      requirementId:'source',kind:'tool',capabilityId:'source.git.show',
      inputSchema:GIT_INPUT,outputSchema:GIT_OUTPUT,effectClass:'HOST_AUTHORIZED_READ',required:true,
    }]},[descriptor]));
});
test('reject changed plan payload, external trusted digest, wrong requirement',async()=>{
  const {provider,plan}=await make();
  await assert.rejects(verifyInvocationReadiness({...plan,taskId:'TAMPER'},'source',provider,plan.planDigest),bad('INVALID_PLAN'));
  await assert.rejects(verifyInvocationReadiness(plan,'source',provider,'f'.repeat(64)),bad('INVALID_PLAN'));
  await assert.rejects(verifyInvocationReadiness(plan,'missing',provider,plan.planDigest),bad('INVALID_PLAN'));
  const injected=structuredClone(plan);
  injected.steps[0].invocationAuthority='SELF';
  await assert.rejects(verifyInvocationReadiness(injected,'source',provider,plan.planDigest),bad('INVALID_PLAN'));
});
test('reject provider name swap, descriptor revision, unavailable provider',async()=>{
  const {provider,descriptor,plan}=await make();
  const changed = structuredClone(descriptor);
  changed.capabilities[0].providerFeeUsd=0.25;
  await assert.rejects(verifyInvocationReadiness(plan,'source',{
    describeCapabilities:async()=>changed,
  },plan.planDigest),bad('BINDING_CHANGED'));
  const swapped=structuredClone(descriptor);
  swapped.providerId='other-provider';
  await assert.rejects(verifyInvocationReadiness(plan,'source',{
    describeCapabilities:async()=>swapped,
  },plan.planDigest),bad('BINDING_CHANGED'));
  const disabled=structuredClone(descriptor);
  disabled.availability='unavailable';disabled.unavailableReason='STOPPED';
  await assert.rejects(verifyInvocationReadiness(plan,'source',{
    describeCapabilities:async()=>disabled,
  },plan.planDigest),bad('PROVIDER_UNAVAILABLE'));
  // Probe and readiness are separate from executing an authorized invoke.
  assert.equal(typeof provider.invoke,'function');
});
test('Skill instruction bytes and descriptor digest are pinned', async()=>{
  const {descriptor}=await make();
  const evidenceInput={type:'object',required:['text'],properties:{text:{type:'string'}},additionalProperties:false};
  const evidenceOutput={type:'object',required:['valid'],properties:{valid:{type:'boolean'}},additionalProperties:false};
  const c={kind:'tool',capabilityId:'evidence.exact.audit',supported:true,inputSchema:evidenceInput,
    outputSchema:evidenceOutput,effectClass:'PURE_COMPUTE',providerFeeUsd:0,latencyMsP50:null};
  const solution={solutionId:'skill-binding',requirements:[{
    requirementId:'audit',kind:'tool',capabilityId:'evidence.exact.audit',
    inputSchema:evidenceInput,outputSchema:evidenceOutput,effectClass:'PURE_COMPUTE',required:true,
  }]};
  const resolution=resolveRequirements(solution,[{contractVersion:CONTRACT_VERSION,providerId:'auditor',
    availability:'available',capabilities:[c]}]);
  const plan=buildInvocationPlan({taskId:'SKILL-1',solutionId:'skill-binding'},[skill],resolution);
  assert.equal(plan.skills[0].descriptorDigest,digest(skill));
  assert.equal(verifySkillBinding(plan,skill.skillId,skill,instructions,plan.planDigest).status,'MATCHED_NOT_ACTIVATED');
  const tampered=Buffer.from(instructions);
  tampered[0]=tampered[0]^1;
  assert.throws(()=>verifySkillBinding(plan,skill.skillId,skill,tampered,plan.planDigest),bad('BINDING_CHANGED'));
  assert.throws(()=>verifySkillBinding(plan,skill.skillId,{...skill,status:'CHANGED'},instructions,plan.planDigest),bad('BINDING_CHANGED'));
  assert.throws(()=>verifySkillBinding(plan,skill.skillId,skill,instructions,'a'.repeat(64)),bad('INVALID_PLAN'));
  assert.ok(descriptor);
});
