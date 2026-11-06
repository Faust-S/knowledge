// Cross-Lab K05: compare K02's real selector with 3 fixed strategies.
// All provider outcomes and price figures in this script are SYNTHETIC.
// No LLM invocation, no Router implementation, no claims of measured savings.
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';

const K02_SHA='96aeccc0b12e81c8cab629bd06d69effac4a06e4';
const K02_PATH='modules/k02-interoperability/model-step-selection.mjs';
const REPORT_SCHEMA='IWXA_K05_K02_STRATEGY_COMPARISON/0.1';
const kinds=new Set(['exact_extraction','cited_summary','conflicting_revisions','multi_step',
  'source_code_check','missing_evidence','hard_source_limit','stable_fact']);
const modelPin=(name,digest)=>({name,digest});
const SMALL=modelPin('k05-synthetic-light','a'.repeat(64));
const STRONG=modelPin('k05-synthetic-strong','b'.repeat(64));
const json=v=>JSON.stringify(v);
function fail(reason){throw Error('K05_MODEL_ROUTING_HOLD:'+reason);}
function checkModelSource(root){
  const code=readFileSync(join(root,K02_PATH));
  const prefix=Buffer.from('blob '+code.length+'\0','utf8');
  const hash=createHash('sha1').update(prefix).update(code).digest('hex');
  if(hash!==K02_SHA)fail('K02_SOURCE_PIN_CHANGED');
}
// Predeclared synthetic outcomes. These do not come from trained models.
// UNKNOWN source tasks use "abstain" only as a synthetic expected answer,
// not as proof of model ability to abstain correctly.
const SIMULATED={
  'K05-MR-01':{small:{passes:true,attempts:1},strong:{passes:true,attempts:1}},
  'K05-MR-02':{small:{passes:false,attempts:2},strong:{passes:true,attempts:1}},
  'K05-MR-03':{small:{passes:false,attempts:2},strong:{passes:true,attempts:1}},
  'K05-MR-04':{small:{passes:false,attempts:2},strong:{passes:true,attempts:1}},
  'K05-MR-05':{small:{passes:false,attempts:2},strong:{passes:true,attempts:1}},
  'K05-MR-06':{small:{passes:false,attempts:2},strong:{passes:false,attempts:2}},
  'K05-MR-07':{small:{passes:false,attempts:2},strong:{passes:true,attempts:1}},
  'K05-MR-08':{small:{passes:true,attempts:1},strong:{passes:true,attempts:1}},
};
const syntheticCalibration = {
  simple: {small:19,strong:20},
  moderate: {small:13,strong:20},
  complex: {small:5,strong:19},
};
const perAttemptUsd={small:0.003,strong:0.015};
const postedLatencyMs={small:60,strong:130};
function sourceCorpus(data){
 if(!data||data.schema!=='IWXA_K05_K02_SOURCE_CASES/0.1'
    ||data.status!=='VERIFIED_SOURCE_CASES_NO_MODEL_EXECUTION'
    ||data.case_count!==8||!Array.isArray(data.cases)||data.cases.length!==8
    ||data.source_suite_verified!==true || data.model_quality!=='NOT_MEASURED'
    ||data.human_gold!=='NOT_MEASURED'
    ||data.inference_cost_usd!==null || data.inference_latency_ms!==null
    ||data.router_cost_usd!==null || data.task_f1!==null)
    fail('SOURCE_CORPUS_INVALID');
 const expected=Object.keys(SIMULATED);
 if(json(data.case_ids)!==json(expected))fail('SOURCE_CORPUS_CASE_DRIFT');
 for(let i=0;i<data.cases.length;i++){
  const t=data.cases[i];
  if(t.case_id!==expected[i] || !kinds.has(t.task_class)
     || !['simple','moderate','complex'].includes(t.difficulty)
     || t.quality_gold!==null || t.model_responses!==null
     || t.inference_cost_usd!==null || t.inference_latency_ms!==null
     || t.route_selector!=='NOT_SELECTED_BY_K05'
     || !Array.isArray(t.source_observations)||t.source_observations.length===0
     || t.source_observations.some(o=>!o.version || !(o.git_blob_sha || o.source_ref)))
     fail('CASE_INVALID_OR_UNVERIFIED');
 }
 return data.cases;
}
function makeK02(){
 const schema={type:'object',properties:{prompt:{type:'string'}},
   required:['prompt'],additionalProperties:false};
 const output={type:'object',properties:{text:{type:'string'}},
   required:['text'],additionalProperties:false};
 const models=[
  ['small',SMALL,0.001,60],['strong',STRONG,0.01,130],
 ];
 return {
  models:models.map(([providerId,modelPin,fee,latency])=>({
   contractVersion:'IWXA.K02.INTEROP/0.1.0', providerId,
   availability:'available',
   capabilities:[{kind:'model',capabilityId:'text.generate',supported:true,
     inputSchema:schema,outputSchema:output,effectClass:'MODEL_INFERENCE',
     inputModes:['text'],outputModes:['text'],modelPin,
     providerFeeUsd:fee,latencyMsP50:latency}],
  })),
  requirement:{requirementId:'generate',kind:'model',capabilityId:'text.generate',
   inputSchema:schema,outputSchema:output,effectClass:'MODEL_INFERENCE',
   inputModes:['text'],outputModes:['text'],required:true},
  profiles:[
   {providerId:'small',modelPin:SMALL,runtimeVersion:'synthetic-1',
     memoryMiB:320,computeUsdPerAttempt:0.002,costBasis:'ESTIMATED'},
   {providerId:'strong',modelPin:STRONG,runtimeVersion:'synthetic-1',
     memoryMiB:1200,computeUsdPerAttempt:0.005,costBasis:'ESTIMATED'},
  ],
 };
}
function modeledQuality(t){
 // A controlled synthetic calibration table, NOT actual inference.
 // Deliberately omit exact-match evidence on "missing_evidence":
 // real K02 must return QUALITY_UNKNOWN rather than fabricate quality.
 if(t.task_class==='missing_evidence')return [];
 return ['small','strong'].map(providerId=>({
  providerId,modelPin:providerId==='small'?SMALL:STRONG,
  taskClass:t.task_class,difficulty:t.difficulty,
  operatingSystem:'SyntheticOS',runtimeVersion:'synthetic-1',
  passed:syntheticCalibration[t.difficulty][providerId],attempts:20,
  proofRef:'synthetic:calibration-only-NOT_REAL_MODEL_DATA',
 }));
}
function outcomes(strategy,cases,resolveRequirements,recommendModelForStep){
 const opts=makeK02();let countCalls=0,routerRuntimeNs=0;
 const rows=[];
 for(const t of cases){
  let provider=null,decision=null;
  if(strategy==='fixed-strong'){provider='strong';decision='FIXED_STRONG';}
  else if(strategy==='fixed-light'){provider='small';decision='FIXED_LIGHT';}
  else if(strategy==='cost-first'){
   const st=performance.now();
   const r=resolveRequirements({solutionId:'K05-synthetic',requirements:[opts.requirement]},opts.models);
   routerRuntimeNs+=Math.round((performance.now()-st)*1e6);
   countCalls++;
   if(r.status!=='SUPPORTED')fail('OWNER_COST_FIRST_NOT_SUPPORTED');
   provider=r.selected[0]?.providerId??null;decision=r.status;
  }else if(strategy==='quality-aware'){
   const st=performance.now();
   const r=recommendModelForStep({
    solution:{solutionId:'K05-synthetic',requirements:[opts.requirement]},
    requirementId:'generate',
    step:{taskClass:t.task_class,difficulty:t.difficulty,
      minObservedSuccessRate:0.8,minSamples:10,maxAttempts:2,
      maxLatencyMs:null,maxMemoryMiB:null},
    available:opts.models,profiles:opts.profiles,
    qualityEvidence:modeledQuality(t),
    environment:{operatingSystem:'SyntheticOS'},
   });
   routerRuntimeNs+=Math.round((performance.now()-st)*1e6);
   countCalls++;
   if(r.hostAuthorityGranted!==false || r.executionState!=='NOT_INVOKED')
    fail('K02_EXECUTION_AUTHORITY_LEAK');
   provider=r.selected?.providerId??null;decision=r.decision;
  }else fail('STRATEGY_UNKNOWN');
  if(provider!==null && !['small','strong'].includes(provider))
   fail('UNEXPECTED_SELECTED_PROVIDER');
  const synthetic=provider===null?null:SIMULATED[t.case_id][provider];
  rows.push({
   case_id:t.case_id,providerId:provider,decision,
   synthetic_label_only:synthetic?.passes??null,
   synthetic_attempts:synthetic?.attempts??null,
   synthetic_projected_fee_usd:synthetic?
       Number((perAttemptUsd[provider]*synthetic.attempts).toFixed(6)):null,
   provider_p50_latency_ms:provider?postedLatencyMs[provider]:null,
   real_inference_verified:false,real_model_response:null,
   actual_cost_usd:null,actual_latency_ms:null,
  });
 }
 return {
  strategy, rows,
  synthetic_outcomes:{
   known_pass:rows.filter(r=>r.synthetic_label_only===true).length,
   known_fail:rows.filter(r=>r.synthetic_label_only===false).length,
   abstained:rows.filter(r=>r.providerId===null).length,
   projected_cost_usd:Number(rows.reduce((x,r)=>x+(r.synthetic_projected_fee_usd??0),0).toFixed(6)),
   projected_cost_basis:'SIMULATED_TRIALS_NOT_VENDOR_PRICES',
  },
  selector_calls:countCalls,
  selector_wall_ms_single_process:Number((routerRuntimeNs/1e6).toFixed(6)),
  selector_wall_time_environment:'CI_PROCESS_ONLY_NOT_MODEL_LATENCY',
  router_billed_cost_usd:null,
 };
}
export async function compare(corpus,ownerRoot){
 const cases=sourceCorpus(corpus);
 checkModelSource(ownerRoot);
 // Dynamic import from owner checkout. No K02 code vendored into Cross-Lab.
 const base=join(ownerRoot,'modules/k02-interoperability');
 const {resolveRequirements,CONTRACT_VERSION}=await import(pathToFileURL(join(base,'index.mjs')).href);
 const {recommendModelForStep,STEP_MODEL_RECOMMENDATION_VERSION}=await import(
  pathToFileURL(join(base,'model-step-selection.mjs')).href);
 if(STEP_MODEL_RECOMMENDATION_VERSION!=='IWXA.K02.STEP_MODEL_RECOMMENDATION/0.1.0')
  fail('K02_RECOMMENDATION_CONTRACT_CHANGED');
 if(CONTRACT_VERSION!=='IWXA.K02.INTEROP/0.1.0')fail('K02_INTEROP_CONTRACT_CHANGED');
 const strategies=['fixed-strong','fixed-light','cost-first','quality-aware'];
 const evidence=strategies.map(strategy=>outcomes(
  strategy,cases,(...args)=>resolveRequirements(...args),
  (...args)=>recommendModelForStep(...args)));
 return {
  schema:REPORT_SCHEMA,
  status:'SYNTHETIC_ROUTING_DIAGNOSTIC_ONLY_NO_MEASURED_MODEL_QUALITY',
  owner_k02_source_commit:corpus.k02_commit,
  owner_k02_git_blob_sha:K02_SHA,
  owner_k02_contract:STEP_MODEL_RECOMMENDATION_VERSION,
  source_corpus_schema:corpus.schema,
  source_corpus_cases:cases.length,
  strategies:evidence,
  limitations:{
   real_model_invocations:0,
   model_outputs_observed:0,
   model_quality:'NOT_MEASURED',
   actual_provider_cost_usd:null,
   actual_inference_latency_ms:null,
   real_retries:null,
   real_router_fee_usd:null,
   endpoint_or_os_quality_generalization:false,
   synthetic_calibration_is_not_independent_gold:true,
   provider_p50_and_attempts_are_simulated:true,
   no_router_comparison_win_established:true,
  },
 };
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
 const args=process.argv.slice(2);
 const get=k=>{const i=args.indexOf(k);if(i<0||!args[i+1])fail('ARGUMENT_'+k);return args[i+1];};
 const corpus=JSON.parse(readFileSync(get('--corpus'),'utf8'));
 const root=resolve(get('--k02-owner-root'));
 const file=get('--out');
 if(existsSync(file))fail('OUTPUT_EXISTS');
 const result=await compare(corpus,root);
 writeFileSync(file,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({
  schema:result.schema,case_count:result.source_corpus_cases,
  comparisons:result.strategies.map(r=>({
   strategy:r.strategy,synthetic:r.synthetic_outcomes,
   selector_wall_ms:r.selector_wall_ms_single_process,
  })),
  real_inference:result.limitations.real_model_invocations,
  quality:result.limitations.model_quality,
 }));
}
