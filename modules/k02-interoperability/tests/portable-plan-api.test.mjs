import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CONTRACT_VERSION, InteropError, resolveRequirements, buildInvocationPlan,
  verifyPortablePlan,
} from '../index.mjs';
import { GIT_INPUT, GIT_OUTPUT } from '../adapters/git-cli.mjs';
import { AUDIT_INPUT, AUDIT_OUTPUT } from '../adapters/node-evidence-cli.mjs';

const skills = JSON.parse(await readFile(
  new URL('../skills/exact-source-audit.skill.json', import.meta.url)));
const instructionBytes = await readFile(
  new URL('../skills/exact-source-audit.instructions.json', import.meta.url));
const cap = (capabilityId,inputSchema,outputSchema,effectClass)=>({
  kind:'tool',capabilityId,supported:true,inputSchema,outputSchema,effectClass,
  providerFeeUsd:0,latencyMsP50:null,
});
const descriptors = [
  {contractVersion:CONTRACT_VERSION,providerId:'example-git',
    availability:'available',capabilities:[
      cap('source.git.show',GIT_INPUT,GIT_OUTPUT,'HOST_AUTHORIZED_READ')]},
  {contractVersion:CONTRACT_VERSION,providerId:'example-audit',
    availability:'available',capabilities:[
      cap('evidence.exact.audit',AUDIT_INPUT,AUDIT_OUTPUT,'PURE_COMPUTE')]},
];
const requirements = {
  solutionId:'portable-consumer-test',
  requirements:[
    {requirementId:'source',kind:'tool',capabilityId:'source.git.show',
      effectClass:'HOST_AUTHORIZED_READ',required:true,
      inputSchema:GIT_INPUT,outputSchema:GIT_OUTPUT},
    {requirementId:'audit',kind:'tool',capabilityId:'evidence.exact.audit',
      effectClass:'PURE_COMPUTE',required:true,
      inputSchema:AUDIT_INPUT,outputSchema:AUDIT_OUTPUT},
  ],
};
function create(){
  const plan=buildInvocationPlan({taskId:'RECOVERY-TEST',solutionId:requirements.solutionId},
    [skills],resolveRequirements(requirements,descriptors));
  let invoked=0;
  const providers=descriptors.map(d=>({
    providerId:d.providerId,
    provider:{
      describeCapabilities:async()=>structuredClone(d),
      invoke:async()=>{invoked++;throw Error('must_not_invoke');},
    },
  }));
  return {plan,providers,
    skillBindings:[{descriptor:structuredClone(skills),instructionBytes:Buffer.from(instructionBytes)}],
    invoked:()=>invoked,
  };
}
const fails = code => err => err instanceof InteropError && err.code===code;
const resume = x=>verifyPortablePlan(x.plan,x.plan.planDigest,x.providers,x.skillBindings);

test('recovery verifies registered capabilities and bytes without invoking providers',async()=>{
  const x=create();
  const received=structuredClone(x.plan);
  x.plan=received;
  const result=await resume(x);
  assert.equal(result.status,'RESTORED_NOT_AUTHORIZED');
  assert.equal(result.planDigest,received.planDigest);
  assert.equal(result.checkedSteps.length,2);
  assert.equal(result.checkedSkills.length,1);
  assert.deepEqual(result.checkedSteps.map(s=>s.status),
    ['MATCHED_NOT_AUTHORIZED','MATCHED_NOT_AUTHORIZED']);
  assert.equal(result.providerInvocations,0);
  assert.equal(result.resultProduced,false);
  assert.equal(result.taskCreated,false);
  assert.equal(x.invoked(),0);
});
test('recovery refuses changed plan, swapped provider and wrong Skill bytes',async()=>{
  const a=create(),trusted=a.plan.planDigest;
  a.plan.taskId='changed';
  await assert.rejects(verifyPortablePlan(a.plan,trusted,a.providers,a.skillBindings),fails('INVALID_PLAN'));
  const b=create();b.providers[0].provider.describeCapabilities=async()=>({
    ...descriptors[0],providerId:'unexpected',
  });
  await assert.rejects(resume(b),fails('BINDING_CHANGED'));
  const c=create();c.skillBindings[0].instructionBytes=Buffer.from('modified');
  await assert.rejects(resume(c),fails('BINDING_CHANGED'));
});
test('recovery requires one unambiguous registered provider and one matching Skill',async()=>{
  const a=create();a.providers.push(a.providers[0]);
  await assert.rejects(resume(a),fails('INVALID_PLAN'));
  const b=create();b.skillBindings=[];
  await assert.rejects(resume(b),fails('INVALID_PLAN'));
  const c=create();c.skillBindings.push(c.skillBindings[0]);
  await assert.rejects(resume(c),fails('INVALID_PLAN'));
  const d=create();d.providers=[];
  await assert.rejects(resume(d),fails('PROVIDER_UNAVAILABLE'));
});
test('plan constructor rejects duplicate selected Skills',()=>{
  const resolution=resolveRequirements(requirements,descriptors);
  assert.throws(
    ()=>buildInvocationPlan({taskId:'S1',solutionId:requirements.solutionId},
      [skills,structuredClone(skills)],resolution),
    fails('INVALID_PLAN'));
});
