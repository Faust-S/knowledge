import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { describeCapabilities,resolveRequirements,buildInvocationPlan,validateInvocationInput,validateInvocationOutput,validatePayload,InteropError } from '../index.mjs';
import { GitCliProvider,GIT_INPUT,GIT_OUTPUT } from '../adapters/git-cli.mjs';
import { NodeEvidenceCliProvider,AUDIT_INPUT,AUDIT_OUTPUT } from '../adapters/node-evidence-cli.mjs';

const solution=JSON.parse(await readFile(new URL('../../../solutions/meeting-followup/agent.json',import.meta.url)));
const skill=JSON.parse(await readFile(new URL('../skills/exact-source-audit.skill.json',import.meta.url)));
const req=(kind,capabilityId,inputSchema,outputSchema,effectClass,requirementId=capabilityId)=>({kind,capabilityId,inputSchema,outputSchema,effectClass,requirementId,required:true});
const needs={solutionId:solution.id,requirements:[req('tool','source.git.show',GIT_INPUT,GIT_OUTPUT,'HOST_AUTHORIZED_READ','source'),req('tool','evidence.exact.audit',AUDIT_INPUT,AUDIT_OUTPUT,'PURE_COMPUTE','evidence')]};
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'iwxa-k02-'));
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
 git('init','-q');git('config','user.name','K02 CI');git('config','user.email','k02@example.invalid');
 writeFileSync(join(root,'transcript.txt'),'Поручение: Ольга готовит акт к пятнице. Других решений нет.\n');
 git('add','transcript.txt');git('commit','-qm','synthetic authorized source');
 return {root,sha:git('rev-parse','HEAD'),clean:()=>rmSync(root,{recursive:true,force:true})};
}
const code=(c)=>(e)=>e instanceof InteropError&&e.code===c;

test('two actual CLI adapters, host-neutral plan and verified output',async()=>{
 const f=fixture();
 try{
  const git=new GitCliProvider(f.root),node=new NodeEvidenceCliProvider();
  const providers=await Promise.all([describeCapabilities(git),describeCapabilities(node)]);
  const result=resolveRequirements(needs,providers.reverse());
  assert.equal(solution.status,'SPEC_COMPLETE_NOT_EXECUTED');
  assert.equal(result.status,'SUPPORTED');
  assert.deepEqual(result.selected.map(x=>x.providerId),['git-cli','node-evidence-cli']);
  assert.equal(result.estimates.providerFeeUsd,0);
  assert.equal(result.estimates.latencyMs,null);
  const task={taskId:'SYNTHETIC-TASK',solutionId:solution.id};
  const plan=buildInvocationPlan(task,[skill],result);
  assert.deepEqual(plan,buildInvocationPlan(task,[skill],resolveRequirements(needs,providers.reverse())));
  assert.equal(plan.steps[0].proofOfInvoke,null);
  await assert.rejects(git.invoke('source.git.show',{revision:f.sha,path:'transcript.txt'}),code('HOST_APPROVAL_REQUIRED'));
  const source=await git.invoke('source.git.show',{revision:f.sha,path:'transcript.txt'},{hostApproved:true});
  validateInvocationOutput(plan.steps[0],source.output);
  assert.equal(source.status,'SUCCEEDED');assert.equal(source.output.revision,f.sha);
  assert.ok(source.observation.durationMs>0);
  const quote='Ольга готовит акт к пятнице',start=source.output.content.indexOf(quote);
  const input={transcript:source.output.content,candidates:[{action:'Подготовить акт',quote,start,end:start+quote.length}]};
  validateInvocationInput(plan.steps[1],input);
  const audited=await node.invoke('evidence.exact.audit',input,{hostApproved:true});
  validateInvocationOutput(plan.steps[1],audited.output);
  assert.equal(audited.output.accepted.length,1);
  assert.equal(audited.output.status,'REVIEW_REQUIRED');
  assert.ok(audited.observation.durationMs>0);
  assert.equal(audited.observation.actualProviderFeeUsd,0);
 }finally{f.clean()}
});
test('unavailable, unsupported and schema mismatch, no plan',async()=>{
 const git=new GitCliProvider(process.cwd()),node=new NodeEvidenceCliProvider();
 const providers=await Promise.all([describeCapabilities(git),describeCapabilities(node)]);
 const copy=structuredClone(providers);
 copy[0].availability='unavailable';copy[0].unavailableReason='not_running';
 assert.equal(resolveRequirements(needs,copy).missing[0].reason,'UNAVAILABLE');
 copy[0].availability='available';copy[0].capabilities[0].supported=false;copy[0].capabilities[0].unsupportedReason='unsupported';
 assert.equal(resolveRequirements(needs,copy).missing[0].reason,'UNSUPPORTED');
 copy[0].capabilities[0].supported=true;
 copy[0].capabilities[0].inputSchema={type:'object',properties:{},required:[],additionalProperties:false};
 assert.equal(resolveRequirements(needs,copy).missing[0].reason,'SCHEMA_MISMATCH');
 assert.equal(resolveRequirements(needs,[providers[1]]).missing[0].reason,'ABSENT');
 assert.throws(()=>buildInvocationPlan({taskId:'t',solutionId:solution.id},[skill],resolveRequirements(needs,[providers[1]])),code('INVALID_PLAN'));
});
test('input rejects unknown data, invalid fields, unsupported schema keywords',()=>{
 const input={transcript:'abc',candidates:[{action:'a',quote:'abc',start:0,end:3}]};
 validatePayload(AUDIT_INPUT,input);
 assert.throws(()=>validatePayload(AUDIT_INPUT,{...input,shell:'bad'}),code('SCHEMA_VALUE_INVALID'));
 assert.throws(()=>validatePayload(AUDIT_INPUT,{...input,candidates:[]}),code('SCHEMA_VALUE_INVALID'));
 assert.throws(()=>validatePayload(AUDIT_INPUT,{...input,candidates:[{...input.candidates[0],start:-1}]}),code('SCHEMA_VALUE_INVALID'));
 assert.throws(()=>validatePayload({type:'object',properties:{},required:[],additionalProperties:false,$ref:'abc'},{}),code('UNSUPPORTED_SCHEMA'));
});
test('negative evidence and git path: no unapproved execution',async()=>{
 const f=fixture();
 try{
  const git=new GitCliProvider(f.root),node=new NodeEvidenceCliProvider();
  await assert.rejects(git.invoke('source.git.show',{revision:'HEAD',path:'transcript.txt'},{hostApproved:true}),code('INVALID_SOURCE_REF'));
  await assert.rejects(git.invoke('source.git.show',{revision:f.sha,path:'../AGENTS.md'},{hostApproved:true}),code('INVALID_SOURCE_REF'));
  const bad={transcript:'abc',candidates:[{action:'a',quote:'bad',start:0,end:3}]};
  await assert.rejects(node.invoke('evidence.exact.audit',bad),code('HOST_APPROVAL_REQUIRED'));
  const r=await node.invoke('evidence.exact.audit',bad,{hostApproved:true});
  assert.equal(r.output.accepted.length,0);assert.equal(r.output.rejected[0].reason,'SOURCE_SPAN_MISMATCH');
 }finally{f.clean()}
});
test('cost then latency then provider ID; unknown estimates do not win',()=>{
 const cap=(id,cost,latency)=>({contractVersion:'IWXA.K02.INTEROP/0.1.0',providerId:id,availability:'available',capabilities:[{kind:'tool',capabilityId:'x',supported:true,effectClass:'PURE_COMPUTE',inputSchema:GIT_INPUT,outputSchema:GIT_OUTPUT,providerFeeUsd:cost,latencyMsP50:latency}]});
 const selection=resolveRequirements({solutionId:'s',requirements:[req('tool','x',GIT_INPUT,GIT_OUTPUT,'PURE_COMPUTE')]},[cap('costly',0.3,1),cap('cheap-z',0,5),cap('cheap-a',0,5),cap('unknown',null,null)]);
 assert.equal(selection.selected[0].providerId,'cheap-a');
});
