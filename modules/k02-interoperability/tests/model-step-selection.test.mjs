import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {resolveRequirements, CONTRACT_VERSION} from '../index.mjs';
import {recommendModelForStep, STEP_MODEL_RECOMMENDATION_VERSION} from '../model-step-selection.mjs';
const schema={type:'object',properties:{prompt:{type:'string'}},required:['prompt'],additionalProperties:false};
const output={type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false};
const pin=(name,n)=>({name,digest:String(n).repeat(64)});
const SMALL=pin('tiny-local', 'a'), LARGE=pin('deep-local','b'), OTHER=pin('third-local','c');
const model=(providerId,modelPin,fee,latency)=>({contractVersion:CONTRACT_VERSION,providerId,availability:'available',
 capabilities:[{kind:'model',capabilityId:'text.generate',supported:true,inputSchema:schema,outputSchema:output,
 effectClass:'MODEL_INFERENCE',inputModes:['text'],outputModes:['text'],modelPin,providerFeeUsd:fee,latencyMsP50:latency}]});
const models=[model('small',SMALL,0.001,60),model('large',LARGE,0.009,130)];
const requirement={requirementId:'compose',kind:'model',capabilityId:'text.generate',inputSchema:schema,
 outputSchema:output,effectClass:'MODEL_INFERENCE',required:true,inputModes:['text'],outputModes:['text']};
const solution={solutionId:'K04-composition',requirements:[requirement]};
const step=(taskClass='summary',difficulty='simple')=>({taskClass,difficulty,minObservedSuccessRate:0.8,
 minSamples:10,maxAttempts:2,maxLatencyMs:null,maxMemoryMiB:null});
const profile=(providerId,modelPin,cost,memory=512)=>({providerId,modelPin,runtimeVersion:'1.0',memoryMiB:memory,
 computeUsdPerAttempt:cost,costBasis:cost===null?'UNKNOWN':'ESTIMATED'});
const profiles=[profile('small',SMALL,0.002,420),profile('large',LARGE,0.005,1200)];
const evidence=(providerId,modelPin,taskClass,difficulty,passed,attempts=20,os='Windows 11')=>({
 providerId,modelPin,taskClass,difficulty,operatingSystem:os,runtimeVersion:'1.0',
 passed,attempts,proofRef:'test:synthetic-observation'});
const env={operatingSystem:'Windows 11'};
const choose=(opts={})=>recommendModelForStep({solution,requirementId:'compose',step:step(),
 available:models,profiles,qualityEvidence:[],environment:env,...opts});
const goodSimple=[evidence('small',SMALL,'summary','simple',19),evidence('large',LARGE,'summary','simple',20)];
const complex=[evidence('small',SMALL,'reasoning','complex',5),evidence('large',LARGE,'reasoning','complex',19)];
const selectedName=r=>r.selected?.providerId??null;
test('simple step selects sufficient small model, not largest',()=>{
 const r=choose({qualityEvidence:goodSimple});
 assert.equal(r.version,STEP_MODEL_RECOMMENDATION_VERSION);
 assert.equal(selectedName(r),'small'); assert.equal(r.decision,'RECOMMENDED_NOT_AUTHORIZED');
 assert.equal(r.selected.quality.status,'MEETS_OBSERVED_FLOOR');
 assert.equal(r.selected.estimates.hostComputeCostBasis,'ESTIMATED');
 assert.equal(r.hostAuthorityGranted,false); assert.equal(r.proofOfInvoke,null);
 assert.equal(r.executionState,'NOT_INVOKED');
});
test('complex reasoning uses stronger observed model and excludes cheap insufficient model',()=>{
 const r=choose({step:step('reasoning','complex'),qualityEvidence:complex});
 assert.equal(selectedName(r),'large');assert.ok(r.excluded.some(x=>x.providerId==='small'&&x.reason==='BELOW_OBSERVED_QUALITY_FLOOR'));
 assert.equal(r.selected.quality.observedRate,0.95);
});
test('low cost loses to observed unmet quality floor',()=>{
 const r=choose({qualityEvidence:[evidence('small',SMALL,'summary','simple',9),...goodSimple.slice(1)]});
 assert.equal(selectedName(r),'large');assert.equal(r.excluded[0].reason,'BELOW_OBSERVED_QUALITY_FLOOR');
});
test('missing, insufficient and different-OS observations are UNKNOWN, never invented',()=>{
 for(const q of [[],[evidence('small',SMALL,'summary','simple',4,5)],[evidence('small',SMALL,'summary','simple',19,20,'Ubuntu 24.04')]]){
  const r=choose({qualityEvidence:q});assert.equal(r.decision,'QUALITY_UNKNOWN');assert.equal(selectedName(r),null);
  assert.equal(r.alternatives.find(x=>x.providerId==='small').quality.status,'UNKNOWN');
  assert.equal(r.alternatives.find(x=>x.providerId==='small').estimates.expectedAttempts,null);
  assert.equal(r.alternatives.find(x=>x.providerId==='small').estimates.estimatedTotalUsd,null);
 }
});
test('explicit user pin always persists, but unknown quality remains unverified',()=>{
 const known=choose({qualityEvidence:goodSimple,userModelPin:LARGE});
 assert.equal(selectedName(known),'large');assert.equal(known.decision,'RECOMMENDED_NOT_AUTHORIZED');
 const unknown=choose({userModelPin:SMALL});
 assert.equal(selectedName(unknown),'small');assert.equal(unknown.decision,'PINNED_UNVERIFIED_NOT_AUTHORIZED');
 assert.ok(unknown.selected.uncertainty.includes('QUALITY_UNKNOWN'));
 const bad=choose({qualityEvidence:complex,step:step('reasoning','complex'),userModelPin:SMALL});
 assert.equal(selectedName(bad),null);assert.equal(bad.decision,'PINNED_MODEL_NOT_QUALIFIED');
});
test('unavailable provider and changed exact pin fail; approved alternative is only suggestion',()=>{
 const unavailable=models.map((m,i)=>i?m:{...m,availability:'unavailable',unavailableReason:'NO_HOST_BINDING'});
 const r=choose({available:unavailable,qualityEvidence:goodSimple});
 assert.equal(selectedName(r),'large');assert.ok(r.excluded.some(x=>x.providerId==='small'));
 const changed=models.map((m,i)=>i?m:{...m,capabilities:[{...m.capabilities[0],modelPin:OTHER}]});
 const c=choose({available:changed,qualityEvidence:goodSimple});
 assert.equal(selectedName(c),'large');assert.ok(c.alternatives.every(x=>x.providerId!=='small')||c.excluded.some(x=>x.providerId==='small'));
 const pinned=choose({available:changed,userModelPin:SMALL,qualityEvidence:goodSimple,allowPinnedAlternatives:true});
 assert.equal(selectedName(pinned),null);assert.equal(pinned.hostAuthorityGranted,false);
});
test('resource/latency thresholds and unknown resources force refusal',()=>{
 const limited=choose({step:{...step(),maxMemoryMiB:600},qualityEvidence:goodSimple});
 assert.equal(selectedName(limited),'small');assert.ok(limited.excluded.some(x=>x.providerId==='large'&&x.reason==='RESOURCE_LIMIT'));
 const noMemory=choose({step:{...step(),maxMemoryMiB:600},profiles:[{...profiles[0],memoryMiB:null},profiles[1]],qualityEvidence:goodSimple});
 assert.equal(selectedName(noMemory),null);assert.ok(noMemory.excluded.some(x=>x.reason==='RESOURCE_UNKNOWN'));
 const timing=choose({step:{...step(),maxLatencyMs:80},qualityEvidence:goodSimple});
 assert.equal(selectedName(timing),'small');assert.ok(timing.excluded.some(x=>x.reason==='LATENCY_LIMIT'));
});
test('estimated retries cost includes success observations and never pretends measurement',()=>{
 const r=choose({qualityEvidence:[evidence('small',SMALL,'summary','simple',16),evidence('large',LARGE,'summary','simple',20)]});
 const a=r.alternatives.find(x=>x.providerId==='small')??r.selected;
 assert.equal(a.estimates.expectedAttempts,1.2);assert.equal(a.estimates.estimatedTotalUsd,0.0036);
 assert.equal(a.estimates.costKind,'PROJECTED_NOT_MEASURED_TASK_COST');
 assert.ok(a.uncertainty.includes('COMPUTE_PRICE_ESTIMATED_NOT_MEASURED'));
});
test('unknown compute cost remains null and quality can still be observed',()=>{
 const r=choose({qualityEvidence:goodSimple,profiles:[{...profiles[0],computeUsdPerAttempt:null,costBasis:'UNKNOWN'},profiles[1]]});
 const a=r.alternatives.find(x=>x.providerId==='small');
 assert.equal(a.estimates.estimatedTotalUsd,null);
 assert.ok(a.uncertainty.includes('HOST_COMPUTE_COST_UNKNOWN'));
});
test('external router overhead greater than estimated savings produces SKIP_EXTRA_ROUTER',()=>{
 const r=choose({qualityEvidence:goodSimple,externalRouter:{
 directProviderId:'large',additionalFeeUsd:0.02,additionalLatencyMs:40}});
 assert.equal(r.externalRouting.advice,'SKIP_EXTRA_ROUTER');
 assert.equal(selectedName(r),'small');
 const uncertain=choose({qualityEvidence:[],externalRouter:{
 directProviderId:'large',additionalFeeUsd:0.02,additionalLatencyMs:40}});
 assert.equal(uncertain.externalRouting.advice,'BENEFIT_NOT_PROVEN');
});
test('escalation only proposes a new model following exact verified failure',()=>{
 const r=choose({step:step('reasoning','complex'),qualityEvidence:complex,previousFailure:{
 providerId:'small',modelPin:SMALL,taskClass:'reasoning',difficulty:'complex',operatingSystem:'Windows 11',runtimeVersion:'1.0',proofRef:'test:failed-step',verified:true}});
 assert.equal(selectedName(r),'large');
 assert.equal(r.escalation.status,'STRONGER_MODEL_PROPOSED_NOT_EXECUTED');
 assert.equal(r.hostAuthorityGranted,false);
});
test('baseline resolveRequirements remains unchanged without recommendation and negative trials',()=>{
 const r=resolveRequirements(solution,models);
 assert.equal(r.selected[0].providerId,'small');
 const r2=resolveRequirements(solution,models);
 assert.deepEqual(r,r2);
});
test('invalid evidence, profile and failure parameters are rejected explicitly',()=>{
 assert.throws(()=>choose({qualityEvidence:[evidence('small',SMALL,'summary','simple',21)]}),/INVALID_MODEL_RECOMMENDATION/);
 assert.throws(()=>choose({profiles:[profiles[0],profiles[0]]}),/INVALID_MODEL_RECOMMENDATION/);
 assert.throws(()=>choose({previousFailure:{providerId:'small',modelPin:SMALL,taskClass:'summary',difficulty:'simple',proofRef:'x',verified:false}}),/INVALID_MODEL_RECOMMENDATION/);
 assert.throws(()=>choose({step:{...step(),minObservedSuccessRate:2}}),/INVALID_MODEL_RECOMMENDATION/);
});
test('repeatable selection benchmark compares baseline and new logic without claims of measured model savings',()=>{
 const n=1500, q=goodSimple;
 const t0=performance.now();for(let i=0;i<n;i++)resolveRequirements(solution,models);
 const before=performance.now()-t0;
 const t1=performance.now();for(let i=0;i<n;i++)choose({qualityEvidence:q});
 const after=performance.now()-t1;
 const outcome=choose({qualityEvidence:q});
 process.stdout.write(JSON.stringify({kind:'K02_MODEL_SELECTION_COMPARISON',
   calls:n,baselineSelection:'small',intelligentSelection:selectedName(outcome),
   baselineMs:Number(before.toFixed(2)),intelligentMs:Number(after.toFixed(2)),
   syntheticEstimatedPriceUsd:outcome.selected.estimates.estimatedTotalUsd,
   accuracy:'NOT_MEASURED',modelExecution:'NOT_TESTED'})+'\n');
 assert.equal(selectedName(outcome),'small');
});

test('stale failure from different OS or runtime version cannot disqualify or escalate a model',()=>{
  for(const change of [{operatingSystem:'Ubuntu 24.04'},{runtimeVersion:'0.9'}]){
    const r=choose({step:step('reasoning','complex'),qualityEvidence:complex,previousFailure:{
      providerId:'small',modelPin:SMALL,taskClass:'reasoning',difficulty:'complex',
      operatingSystem:'Windows 11',runtimeVersion:'1.0',proofRef:'test:stale-failure',verified:true,
      ...change,
    }});
    assert.equal(selectedName(r),'large');
    assert.equal(r.escalation,null);
  }
});
test('external classifier cost in latency can negate any price saving',()=>{
  const r=choose({qualityEvidence:goodSimple,externalRouter:{
    directProviderId:'large',additionalFeeUsd:0,additionalLatencyMs:200}});
  assert.equal(r.externalRouting.advice,'SKIP_EXTRA_ROUTER');
  assert.ok(r.externalRouting.estimatedLatencySavedBeforeOverheadMs<200);
});
test('positive vendor compatibility is not confused with model-quality evidence',()=>{
  const r=choose({qualityEvidence:[]});
  assert.equal(r.decision,'QUALITY_UNKNOWN');
  assert.equal(r.hostAuthorityGranted,false);
  assert.equal(r.executionState,'NOT_INVOKED');
});
