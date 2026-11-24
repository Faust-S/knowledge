import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {sha256Canonical} from '../modules/activity-base-anonymizer/engine.mjs';
import {reviewD05SimPyComparison} from '../modules/activity-base-anonymizer/d05-simpy-review.mjs';
import {buildSimPyRequest} from './activity_d05_simpy_fixture.mjs';
const enc=v=>new TextEncoder().encode(JSON.stringify(v)+'\n');
const hash=v=>createHash('sha256').update(v).digest('hex');
async function fixture(){
 const req=buildSimPyRequest(),bytes=enc(req);
 const rows=(recipient)=>{
  const elapsed=recipient?480:540,wait=recipient?120:180;
  const byKey={laser:{busy:360,queue:recipient?0:180},bend:{busy:240,queue:recipient?120:0},qc:{busy:120,queue:0}};
  const spec=recipient?req.recipient:req.baseline;
  return {model_order_count:2,on_time_model_orders:recipient?2:1,elapsed_minutes:elapsed,sum_turnaround_minutes:360+elapsed,
   max_turnaround_minutes:elapsed,sum_queue_minutes:wait,resource_cost_minor:61200,other_cost_minor:600,declared_total_cost_minor:61800,
   orders:[360,elapsed].map((t,i)=>({model_order:i+1,arrival_minutes:0,completion_minutes:t,turnaround_minutes:t})),
   operations:spec.operations.map(o=>({operation_id:o.operation_id,service_minutes:byKey[o.resource_key].busy,
    buffer_minutes:0,queue_minutes:byKey[o.resource_key].queue})),
   resources:spec.resources.map(r=>({key:r.key,capacity:r.capacity,busy_minutes:byKey[r.key].busy,queue_minutes:byKey[r.key].queue,
    uses:2,capacity_minutes:elapsed*r.capacity,cost_minor:byKey[r.key].busy*r.rate_minor_per_minute}))};
 };
 const raw={status:'LOCAL_D05_MODEL_COMPARISON',engine:'SimPy',version:'4.1.2',input_sha256:hash(bytes),
  technology_sha256:await sha256Canonical(req.candidate.technology),time_basis:'CONTINUOUS_OPERATION_MINUTES',currency:req.currency,
  buffer_policy:req.buffer_policy,deadline_after_minutes:req.deadline_after_minutes,quality_checks_count:req.candidate.technology.quality_checks.length,
  candidate_status:req.candidate.status,source_authority:'UNVERIFIED_LOCAL_SCENARIO',evidence:'MODEL_NOT_EXECUTION',domain_validation:'NOT_PERFORMED',
  limitations:['CONTINUOUS_TIME_NO_SHIFT_CALENDAR','INPUTS_ASSUMED_AVAILABLE','NO_STOCHASTIC_VARIATION_OR_FAILURES',
   'NO_PHYSICAL_QUALITY_OUTCOMES','NO_SLACK_OR_OVERALL_RESERVE_SCHEDULING','DECLARED_COSTS_NOT_FULL_ECONOMICS'],
  baseline:rows(false),recipient:rows(true),anonymity:'NOT_ESTABLISHED',export_allowed:false,iwxa_package:null};
 return {req,bytes,raw};
}
test('read exact candidate-bound model comparison, not execution',async()=>{
 const {req,bytes,raw}=await fixture(),before=JSON.stringify(req.candidate);
 const r=await reviewD05SimPyComparison(req.candidate,bytes,raw);
 assert.equal(r.recipient.elapsed_minutes,480);assert.equal(r.baseline.elapsed_minutes,540);
 assert.equal(r.evidence,'MODEL_NOT_EXECUTION');assert.equal(r.export_allowed,false);
 assert.equal(JSON.stringify(req.candidate),before);
});
test('reject stale technology and different request bytes',async()=>{
 const {req,bytes,raw}=await fixture(),changed=structuredClone(req.candidate);
 changed.technology.terms.purpose='Other';
 await assert.rejects(()=>reviewD05SimPyComparison(changed,bytes,raw),{code:'SIMPY_TECHNOLOGY_CHANGED'});
 await assert.rejects(()=>reviewD05SimPyComparison(req.candidate,new TextEncoder().encode(new TextDecoder().decode(bytes)+' '),raw),{code:'SIMPY_REQUEST_CHANGED'});
});
test('reject changed order completion, cost and resource totals',async()=>{
 const {req,bytes,raw}=await fixture();
 for(const [patch,code] of [
  [{...raw.baseline,sum_turnaround_minutes:999},'SIMPY_RESULT_TIME_ACCOUNTING'],
  [{...raw.baseline,declared_total_cost_minor:1},'SIMPY_RESULT_COST_ACCOUNTING'],
  [{...raw.baseline,resources:raw.baseline.resources.map((r,i)=>i? r:{...r,busy_minutes:1})},'SIMPY_RESULT_RESOURCE_ACCOUNTING'],
  [{...raw.baseline,operations:raw.baseline.operations.slice(1)},'SIMPY_RESULT_COVERAGE']]){
  await assert.rejects(()=>reviewD05SimPyComparison(req.candidate,bytes,{...raw,baseline:patch}),{code});
 }
});
test('reject model promoted to physical execution or export',async()=>{
 const {req,bytes,raw}=await fixture();
 for(const patch of [{evidence:'PHYSICAL_EXECUTION'},{export_allowed:true},{quality_checks_count:0}])
  await assert.rejects(()=>reviewD05SimPyComparison(req.candidate,bytes,{...raw,...patch}),{code:'SIMPY_RESULT_PROFILE'});
});
test('verify actual upstream SimPy result and D05 technology source fixture',{skip:!process.env.IWXA_ACTIVITY_SIMPY_UPSTREAM},async()=>{
 const root=process.env.IWXA_ACTIVITY_SIMPY_UPSTREAM,bytes=readFileSync(join(root,'request.json'));
 const raw=JSON.parse(readFileSync(join(root,'result.json'),'utf8')),req=buildSimPyRequest();
 const r=await reviewD05SimPyComparison(req.candidate,bytes,raw);
 assert.equal(r.baseline.elapsed_minutes,540);assert.equal(r.recipient.elapsed_minutes,480);
 assert.equal(r.baseline.on_time_model_orders,1);assert.equal(r.recipient.on_time_model_orders,2);
 assert.equal(r.baseline.declared_total_cost_minor,r.recipient.declared_total_cost_minor);
 assert.equal(r.quality_checks_count,1);
});
