import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  CONTRACT_VERSION, InteropError, resolveRequirements, buildInvocationPlan,
} from '../index.mjs';

// Public synthetic mappings to external vendor trials; private Agent research
// files and measurements are NOT copied into this test fixture.
const shape = {
  type: 'object', required: ['input'], additionalProperties: false,
  properties: { input: { type: 'string' } },
};
const output = {
  type: 'object', required: ['content'], additionalProperties: false,
  properties: { content: { type: 'string' } },
};
const capability = (id, fee, latency) => ({
  kind: 'tool', capabilityId: id, supported: true,
  inputSchema: shape, outputSchema: output, effectClass: 'HOST_AUTHORIZED_READ',
  providerFeeUsd: fee, latencyMsP50: latency,
});
const descriptor = (id, cap) => ({
  contractVersion: CONTRACT_VERSION, providerId: id, availability: 'available',
  capabilities: [cap],
});
function fixture(capabilityId, choices) {
  return {
    solution: { solutionId: 'task-solution', requirements: [{
      requirementId: 'execute', kind: 'tool', capabilityId,
      inputSchema: shape, outputSchema: output, effectClass: 'HOST_AUTHORIZED_READ',
      required: true,
    }] },
    available: choices.map(([id, fee, latency]) =>
      descriptor(id, capability(capabilityId, fee, latency))),
  };
}
const stack = (providerId, capabilityId, modelId, executorVersion, mode, operatingSystem) => ({
  providerId, kind: 'tool', capabilityId, modelId, executorVersion, mode, operatingSystem,
});
const failed = (config, taskKey, failureKind, proofRef='test:independently-observed') => ({
  ...config, taskKey, failureKind, proofRef,
});
function scope(taskKey, configurations, failures) {
  return { taskKey, candidateConfigurations: configurations, failures };
}
const resolvedName = r => r.selected[0]?.providerId ?? null;
const bad = code => e => e instanceof InteropError && e.code === code;
const patch = 'code.patch', readWrite = 'read.compute.write', webhook = 'workflow.webhook';

function examples() {
  const a = fixture(patch, [
    ['editor-small', 0.001, 80],
    ['editor-large', 0.02, 150],
  ]);
  const aSmall = stack('editor-small',patch,'model-small','0.86.0','whole','Linux-version-A');
  const aLarge = stack('editor-large',patch,'model-large','0.86.0','whole','Linux-version-A');
  a.observations = scope('invoice_patch', [aSmall,aLarge],
    [failed(aSmall,'invoice_patch','NO_REQUIRED_CHANGE')]);

  const b = fixture(patch, [
    ['editor-incorrect', 0.001, 50],
    ['plain-model-skills', 0.03, 400],
  ]);
  const bWrong = stack('editor-incorrect',patch,'model-medium','0.86.0','diff','Linux-version-A');
  b.observations = scope('boundary_patch',[bWrong],
    [failed(bWrong,'boundary_patch','INCORRECT_RESULT')]);

  const c = fixture(readWrite, [
    ['shell-model-small',0.001,70],
    ['shell-model-medium',0.005,100],
    ['plain-model-skills',0.025,300],
  ]);
  const cSmall = stack('shell-model-small',readWrite,'small-local','1.55.0',null,'Linux-version-A');
  const cMedium = stack('shell-model-medium',readWrite,'medium-local','1.55.0',null,'Linux-version-A');
  c.observations = scope('read_compute_write',[cSmall,cMedium],
    [failed(cSmall,'read_compute_write','INCOMPLETE_TASK'),
     failed(cMedium,'read_compute_write','INCOMPLETE_TASK')]);

  const d = fixture(webhook, [
    ['workflow-low-cost',0.001,90],
    ['alternative-tool',0.025,120],
  ]);
  const dRisk = stack('workflow-low-cost',webhook,null,'2.46.4',null,'Linux-version-A');
  d.observations = scope('no_duplicate_external_effects',[dRisk],
    [failed(dRisk,'no_duplicate_external_effects','REPEATED_EXTERNAL_EFFECTS')]);
  return [a,b,c,d];
}
test('Aider-type: a failed exact small-model edit loses against a more expensive compatible model', () => {
  const e=examples()[0];
  const baseline=resolveRequirements(e.solution,e.available);
  const selected=resolveRequirements(e.solution,e.available,e.observations);
  assert.equal(resolvedName(baseline),'editor-small');
  assert.equal(resolvedName(selected),'editor-large');
  assert.equal(selected.evidenceExclusions.length,1);
  assert.equal(selected.evidenceExclusions[0].reason,'OBSERVED_TASK_FAILURE');
  assert.equal(selected.evidenceExclusions[0].failureKind,'NO_REQUIRED_CHANGE');
  assert.equal(baseline.estimates.providerFeeUsd,0.001);
  assert.equal(selected.estimates.providerFeeUsd,0.02);
  const plan=buildInvocationPlan({taskId:'TASK-01',solutionId:e.solution.solutionId},[],selected);
  assert.equal(plan.invocationAuthority,undefined);
  assert.equal(plan.steps[0].invocationAuthority,'HOST_ONLY');
  assert.equal(plan.steps[0].proofOfInvoke,null);
});
test('Aider-type: CLI success and a non-empty but incorrect diff is task failure; model+Skill option remains available', () => {
  const e=examples()[1];
  assert.equal(resolvedName(resolveRequirements(e.solution,e.available)),'editor-incorrect');
  const after=resolveRequirements(e.solution,e.available,e.observations);
  assert.equal(resolvedName(after),'plain-model-skills');
  assert.equal(after.evidenceExclusions[0].failureKind,'INCORRECT_RESULT');
  assert.equal(after.status,'SUPPORTED');
});
test('Goose-type: different local model failures only exclude their exact tested stacks', () => {
  const e=examples()[2];
  assert.equal(resolvedName(resolveRequirements(e.solution,e.available)),'shell-model-small');
  const selected=resolveRequirements(e.solution,e.available,e.observations);
  assert.equal(resolvedName(selected),'plain-model-skills');
  assert.equal(selected.evidenceExclusions.length,2);
  const unknown=stack('shell-model-small',readWrite,'different-model','1.55.0',null,'Linux-version-A');
  const other=scope('read_compute_write',[unknown],e.observations.failures);
  assert.equal(resolvedName(resolveRequirements(e.solution,e.available,other)),'shell-model-small');
});
test('n8n-type: a successful HTTP/webhook status is not proof of no repeated side effects', () => {
  const e=examples()[3];
  const baseline=resolveRequirements(e.solution,e.available);
  assert.equal(resolvedName(baseline),'workflow-low-cost');
  const noObservation=scope('no_duplicate_external_effects',e.observations.candidateConfigurations,[]);
  const noClaim=resolveRequirements(e.solution,e.available,noObservation);
  assert.equal(resolvedName(noClaim),'workflow-low-cost');
  assert.equal(noClaim.evidenceExclusions.length,0);
  assert.equal('realExecutionVerified' in noClaim,false);
  assert.equal(resolvedName(resolveRequirements(e.solution,e.available,e.observations)),'alternative-tool');
});
test('strict task/model/version/mode/OS scoping never spreads an observed failure',()=>{
  const e=examples()[0],entry=e.observations.failures[0];
  const variants=[
    {taskKey:'different_task'},
    {failures:[{...entry,modelId:'different-model'}]},
    {failures:[{...entry,executorVersion:'0.87.0'}]},
    {failures:[{...entry,mode:'diff'}]},
    {failures:[{...entry,operatingSystem:'Windows-version-B'}]},
    {candidateConfigurations:e.observations.candidateConfigurations.slice(1)},
  ];
  for(const change of variants){
    const result=resolveRequirements(e.solution,e.available,{...e.observations,...change});
    assert.equal(resolvedName(result),'editor-small');
    assert.equal(result.evidenceExclusions.length,0);
  }
});
test('all exact failures report unsupported rather than promote an unqualified executor',()=>{
  const e=examples()[0],trial=e.observations.candidateConfigurations[1];
  const denied={...e.observations,failures:[
    ...e.observations.failures,failed(trial,'invoice_patch','INCORRECT_RESULT'),
  ]};
  const result=resolveRequirements(e.solution,e.available,denied);
  assert.equal(result.status,'UNSUPPORTED');
  assert.equal(result.missing[0].reason,'OBSERVED_TASK_FAILURE');
  assert.equal(result.selected.length,0);
  assert.equal(result.evidenceExclusions.length,2);
});
test('absence of evidence keeps existing result shape, costs, and model+Skills route',()=>{
  const e=examples()[1];
  const normal=resolveRequirements(e.solution,e.available);
  const explicitNull=resolveRequirements(e.solution,e.available,null);
  assert.deepEqual(normal,explicitNull);
  assert.equal('evidenceExclusions' in normal,false);
  assert.equal(resolvedName(normal),'editor-incorrect');
});
test('malformed, contradictory or oversize trial metadata is rejected',()=>{
  const e=examples()[0];
  const broken=[
    {...e.observations,taskKey:''},
    {...e.observations,candidateConfigurations:[e.observations.candidateConfigurations[0], e.observations.candidateConfigurations[0]]},
    {...e.observations,failures:[e.observations.failures[0],e.observations.failures[0]]},
    {...e.observations,failures:[{...e.observations.failures[0],failureKind:'VENDOR_SUCCESS'}]},
    {...e.observations,failures:[{...e.observations.failures[0],executorVersion:''}]},
    {...e.observations,candidateConfigurations:[{...e.observations.candidateConfigurations[0],extra:'unexpected'}]},
  ];
  for(const input of broken)
    assert.throws(()=>resolveRequirements(e.solution,e.available,input),bad('INVALID_DESCRIPTOR'));
});
test('no network probes or vendor execution are introduced by evidence filtering',()=>{
  const e=examples()[0];let invokes=0;
  e.available.forEach(x=>Object.defineProperty(x,'invoke',{get(){invokes++;throw Error('unexpected');}}));
  const r=resolveRequirements(e.solution,e.available,e.observations);
  assert.equal(r.status,'SUPPORTED');
  assert.equal(invokes,0);
});
test('comparison: four known-bad primary choices are excluded with explicit cost/time observations',()=>{
  const rows=examples().map((e,i)=>{
    const before=resolveRequirements(e.solution,e.available);
    const after=resolveRequirements(e.solution,e.available,e.observations);
    const invalid=new Set(e.observations.failures.map(x=>x.providerId));
    return {
      caseId:i+1, before:resolvedName(before), after:resolvedName(after),
      beforeKnownBad:invalid.has(resolvedName(before)),
      afterKnownBad:invalid.has(resolvedName(after)),
      beforeFee:before.estimates.providerFeeUsd,afterFee:after.estimates.providerFeeUsd,
      beforeLatencyMs:before.estimates.latencyMs,afterLatencyMs:after.estimates.latencyMs,
      observedFailuresApplied:after.evidenceExclusions.length,
    };
  });
  assert.equal(rows.filter(x=>x.beforeKnownBad).length,4);
  assert.equal(rows.filter(x=>x.afterKnownBad).length,0);
  // Measure selection CPU work only, not model inference or actual vendor cost.
  const N=2000;
  let baselineStart=performance.now();
  for(let i=0;i<N;i++){
    const e=examples()[i%4]; resolveRequirements(e.solution,e.available);
  }
  const baselineMs=performance.now()-baselineStart;
  let filteredStart=performance.now();
  for(let i=0;i<N;i++){
    const e=examples()[i%4]; resolveRequirements(e.solution,e.available,e.observations);
  }
  const filteredMs=performance.now()-filteredStart;
  process.stdout.write(JSON.stringify({kind:'K02_EVIDENCE_SELECTION_COMPARISON',
    cases:rows,knownBadPrimaryChoicesBefore:4,knownBadPrimaryChoicesAfter:0,
    observedVendorExecutionCount:0,
    resolutionCallsPerMode:N,
    baselineTotalResolutionMs:Number(baselineMs.toFixed(2)),
    evidenceTotalResolutionMs:Number(filteredMs.toFixed(2)),
    note:'Synthetic choice/cost regression; not vendor execution or end-to-end IWXA proof',
  })+'\n');
});
