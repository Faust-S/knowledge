// Validate accounting and exact input identity of a local original SimPy
// result. No scheduling engine, simulation replay, approval or Exchange.
import {ActivityHold,sha256Canonical} from './engine.mjs';
const MAX=8*1024*1024,VERSION='4.1.2',PROFILE='ACTIVITY_D05_SIMPY_COMPARISON_V1';
const LIMITATIONS=['CONTINUOUS_TIME_NO_SHIFT_CALENDAR','INPUTS_ASSUMED_AVAILABLE',
 'NO_STOCHASTIC_VARIATION_OR_FAILURES','NO_PHYSICAL_QUALITY_OUTCOMES',
 'NO_SLACK_OR_OVERALL_RESERVE_SCHEDULING','DECLARED_COSTS_NOT_FULL_ECONOMICS'];
const need=(x,code)=>{if(!x)throw new ActivityHold(code);};
const exact=(x,k)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===k.split(' ').length&&k.split(' ').every(p=>Object.hasOwn(x,p));
const int=(x,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(x);
const sum=a=>a.reduce((s,v)=>s+v,0);
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const safe=x=>{need(int(x),'SIMPY_ACCOUNTING_RANGE');return x;};
async function digest(bytes){
 need(globalThis.crypto?.subtle,'LOCAL_DIGEST_UNAVAILABLE');
 return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function candidateProfile(c){
 need(c?.export_allowed===false&&c.anonymity==='NOT_ESTABLISHED'&&c.disclosure_review==='NOT_PERFORMED'&&
  c.domain_validation==='NOT_PERFORMED'&&c.iwxa_package===null&&
  ['LOCAL_CANDIDATE_FOR_DISCLOSURE_REVIEW','LOCAL_CANDIDATE_NEEDS_REVIEW_INPUT'].includes(c.status)&&
  exact(c.technology,'terms route_parameters operations quality_checks')&&Array.isArray(c.technology.operations)&&
  c.technology.operations.length>=1&&c.technology.operations.length<=128&&Array.isArray(c.technology.quality_checks)&&
  c.technology.quality_checks.length<=2048,'SIMPY_CANDIDATE_PROFILE');
 const ids=c.technology.operations.map(o=>o.operation_id);
 need(ids.every(id)&&new Set(ids).size===ids.length,'SIMPY_CANDIDATE_STRUCTURE');
 return ids;
}
function decimal(text){
 need(typeof text==='string'&&/^[0-9]{1,9}(?:[.,][0-9]{1,6})?$/.test(text),'SIMPY_REQUEST_PROFILE');
 const [whole,part='']=text.replace(',','.').split('.');
 return BigInt(whole)*1000000n+BigInt(part.padEnd(6,'0'));
}
function minutes(value,unit,day){
 const v=decimal(value),mult=unit==='hours'?60n*1000000n:unit==='calendar-days'?1440n*1000000n:
   unit==='work-days'?60n*day:0n;
 need(mult>0n,'SIMPY_REQUEST_PROFILE');
 const n=v*mult,den=1000000000000n;
 need(n%den===0n&&n/den<=1000000n,'SIMPY_REQUEST_PROFILE');
 return Number(n/den);
}
function requestProfile(req,candidate,ids){
 need(exact(req,'profile candidate arrival_minutes deadline_after_minutes buffer_policy currency baseline recipient')&&req.profile===PROFILE&&
  req.candidate?.status===candidate.status&&Array.isArray(req.arrival_minutes)&&req.arrival_minutes.length>=1&&req.arrival_minutes.length<=200&&
  req.arrival_minutes.every((v,i)=>int(v,0,1000000)&&(i===0||req.arrival_minutes[i-1]<=v))&&
  int(req.deadline_after_minutes,1,100000000)&&['RELEASE_RESOURCE_DURING_BUFFER','HOLD_RESOURCE_DURING_BUFFER'].includes(req.buffer_policy)&&
  typeof req.currency==='string'&&/^[A-Z]{3}$/.test(req.currency),'SIMPY_REQUEST_PROFILE');
 candidateProfile(req.candidate);
 for(const s of [req.baseline,req.recipient]){
  need(exact(s,'hours_per_day resources operations other_cost_minor_per_order')&&Array.isArray(s.resources)&&s.resources.length<=128&&
   Array.isArray(s.operations)&&s.operations.length===ids.length&&int(s.other_cost_minor_per_order,0,1000000000),
   'SIMPY_REQUEST_PROFILE');
 }
}
function scenarioReview(req,spec,raw,ids){
 const n=req.arrival_minutes.length;
 need(exact(raw,'model_order_count on_time_model_orders elapsed_minutes sum_turnaround_minutes max_turnaround_minutes sum_queue_minutes resource_cost_minor other_cost_minor declared_total_cost_minor orders operations resources')&&
  raw.model_order_count===n&&Array.isArray(raw.orders)&&raw.orders.length===n&&Array.isArray(raw.operations)&&raw.operations.length===ids.length&&
  Array.isArray(raw.resources)&&raw.resources.length===spec.resources.length,'SIMPY_RESULT_COVERAGE');
 const orders=raw.orders.map((o,i)=>{
  need(exact(o,'model_order arrival_minutes completion_minutes turnaround_minutes')&&o.model_order===i+1&&
   o.arrival_minutes===req.arrival_minutes[i]&&int(o.completion_minutes,o.arrival_minutes)&&
   o.turnaround_minutes===o.completion_minutes-o.arrival_minutes,'SIMPY_RESULT_ORDER');
  return {...o};
 });
 const times=orders.map(o=>o.turnaround_minutes),elapsed=Math.max(...orders.map(o=>o.completion_minutes))-req.arrival_minutes[0];
 need(int(raw.elapsed_minutes)&&raw.elapsed_minutes===elapsed&&int(raw.sum_turnaround_minutes)&&raw.sum_turnaround_minutes===safe(sum(times))&&
  raw.max_turnaround_minutes===Math.max(...times)&&raw.on_time_model_orders===times.filter(t=>t<=req.deadline_after_minutes).length,
  'SIMPY_RESULT_TIME_ACCOUNTING');
 const day=decimal(spec.hours_per_day);
 need(day>0n&&day<=24000000n,'SIMPY_REQUEST_PROFILE');
 const resources=new Map(),planned=new Map();
 for(const s of spec.resources){
  need(exact(s,'key capacity rate_minor_per_minute')&&id(s.key)&&!resources.has(s.key)&&int(s.capacity,1,64)&&int(s.rate_minor_per_minute,0,1000000),'SIMPY_REQUEST_PROFILE');
  resources.set(s.key,{...s,busy:0,queue:0,uses:0});
 }
 for(const o of spec.operations){
  need(exact(o,'operation_id duration unit setup_hours buffer_hours resource_key')&&ids.includes(o.operation_id)&&!planned.has(o.operation_id)&&
   ['hours','work-days','calendar-days'].includes(o.unit)&&(o.resource_key===null||resources.has(o.resource_key)),'SIMPY_REQUEST_PROFILE');
  const service=minutes(o.duration,o.unit,day)+minutes(o.setup_hours,'hours',day),buffer=minutes(o.buffer_hours,'hours',day);
  planned.set(o.operation_id,{service,buffer,resource:o.resource_key});
 }
 const seen=new Set();
 const operations=raw.operations.map(o=>{
  need(exact(o,'operation_id service_minutes buffer_minutes queue_minutes')&&planned.has(o.operation_id)&&!seen.has(o.operation_id)&&int(o.queue_minutes),'SIMPY_RESULT_OPERATION');
  seen.add(o.operation_id);
  const p=planned.get(o.operation_id);
  need(o.service_minutes===safe(p.service*n)&&o.buffer_minutes===safe(p.buffer*n),'SIMPY_RESULT_OPERATION');
  if(p.resource===null)need(o.queue_minutes===0,'SIMPY_RESULT_OPERATION');
  else{
   const r=resources.get(p.resource);
   r.busy=safe(r.busy+n*(p.service+(req.buffer_policy==='HOLD_RESOURCE_DURING_BUFFER'?p.buffer:0)));
   r.queue=safe(r.queue+o.queue_minutes);r.uses+=n;
  }
  return {...o};
 });
 const seenResources=new Set();
 const rows=raw.resources.map(o=>{
  need(exact(o,'key capacity busy_minutes queue_minutes uses capacity_minutes cost_minor')&&resources.has(o.key)&&!seenResources.has(o.key),'SIMPY_RESULT_RESOURCE');
  seenResources.add(o.key);
  const p=resources.get(o.key);
  need(o.capacity===p.capacity&&o.busy_minutes===p.busy&&o.queue_minutes===p.queue&&o.uses===p.uses&&
   o.capacity_minutes===safe(elapsed*p.capacity)&&o.busy_minutes<=o.capacity_minutes&&o.cost_minor===safe(p.busy*p.rate_minor_per_minute),
   'SIMPY_RESULT_RESOURCE_ACCOUNTING');
  return {...o};
 });
 const queue=safe(sum(operations.map(o=>o.queue_minutes))),cost=safe(sum(rows.map(o=>o.cost_minor))),other=safe(spec.other_cost_minor_per_order*n);
 need(raw.sum_queue_minutes===queue&&raw.resource_cost_minor===cost&&raw.other_cost_minor===other&&
  raw.declared_total_cost_minor===safe(cost+other),'SIMPY_RESULT_COST_ACCOUNTING');
 return {model_order_count:n,on_time_model_orders:raw.on_time_model_orders,elapsed_minutes:elapsed,
  sum_turnaround_minutes:raw.sum_turnaround_minutes,max_turnaround_minutes:raw.max_turnaround_minutes,sum_queue_minutes:queue,
  resource_cost_minor:cost,other_cost_minor:other,declared_total_cost_minor:cost+other,orders,operations,resources:rows};
}
export async function reviewD05SimPyComparison(candidate,requestBytes,raw){
 const ids=candidateProfile(candidate);
 need(requestBytes instanceof Uint8Array&&requestBytes.byteLength>0&&requestBytes.byteLength<=MAX,'SIMPY_INPUT_LIMIT');
 const bytes=requestBytes.slice();let req;
 try{req=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new ActivityHold('SIMPY_JSON_INVALID');}
 requestProfile(req,candidate,ids);
 need(exact(raw,'status engine version input_sha256 technology_sha256 time_basis currency buffer_policy deadline_after_minutes quality_checks_count candidate_status source_authority evidence domain_validation limitations baseline recipient anonymity export_allowed iwxa_package')&&
  raw.status==='LOCAL_D05_MODEL_COMPARISON'&&raw.engine==='SimPy'&&raw.version===VERSION&&
  hex(raw.input_sha256)&&hex(raw.technology_sha256)&&raw.time_basis==='CONTINUOUS_OPERATION_MINUTES'&&
  raw.currency===req.currency&&raw.buffer_policy===req.buffer_policy&&raw.deadline_after_minutes===req.deadline_after_minutes&&
  raw.candidate_status===candidate.status&&raw.quality_checks_count===candidate.technology.quality_checks.length&&
  raw.source_authority==='UNVERIFIED_LOCAL_SCENARIO'&&raw.evidence==='MODEL_NOT_EXECUTION'&&raw.domain_validation==='NOT_PERFORMED'&&
  JSON.stringify(raw.limitations)===JSON.stringify(LIMITATIONS)&&raw.anonymity==='NOT_ESTABLISHED'&&raw.export_allowed===false&&raw.iwxa_package===null,
  'SIMPY_RESULT_PROFILE');
 const fingerprint=await sha256Canonical(candidate.technology);
 need(await sha256Canonical(req.candidate.technology)===fingerprint&&raw.technology_sha256===fingerprint,'SIMPY_TECHNOLOGY_CHANGED');
 need(await digest(bytes)===raw.input_sha256,'SIMPY_REQUEST_CHANGED');
 const baseline=scenarioReview(req,req.baseline,raw.baseline,ids),recipient=scenarioReview(req,req.recipient,raw.recipient,ids);
 return {status:'LOCAL_D05_MODEL_COMPARISON_REVIEW',engine:'SimPy',version:VERSION,currency:req.currency,
  time_basis:raw.time_basis,buffer_policy:req.buffer_policy,deadline_after_minutes:req.deadline_after_minutes,
  quality_checks_count:raw.quality_checks_count,candidate_status:candidate.status,limitations:[...LIMITATIONS],
  baseline,recipient,source_match:'EXACT_REQUEST_AND_TECHNOLOGY_DIGEST',
  source_authority:'UNVERIFIED_LOCAL_SCENARIO_AND_TOOL_OUTPUT',evidence:'MODEL_NOT_EXECUTION',
  domain_validation:'NOT_PERFORMED',anonymity:'NOT_ESTABLISHED',export_allowed:false,iwxa_package:null};
}
