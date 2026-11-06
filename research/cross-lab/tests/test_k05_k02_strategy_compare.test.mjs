import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compare} from '../k05_k02_strategy_compare.mjs';

const corpusPath=process.env.K05_K02_CASES_PATH;
const ownerRoot=process.env.K05_K02_OWNER_ROOT;
function fixture() {
  assert.ok(corpusPath && ownerRoot, 'CI must supply pinned source corpus and K02 owner');
  return JSON.parse(readFileSync(corpusPath,'utf8'));
}

test('actual pinned K02 implementations compare four alternatives without executing models',async()=>{
  const result=await compare(fixture(),ownerRoot);
  assert.equal(result.schema,'IWXA_K05_K02_STRATEGY_COMPARISON/0.1');
  assert.equal(result.source_corpus_cases,8);
  assert.deepEqual(result.strategies.map(x=>x.strategy),
    ['fixed-strong','fixed-light','cost-first','quality-aware']);
  assert.deepEqual(result.strategies.map(x=>x.rows.length),[8,8,8,8]);
  assert.deepEqual(result.strategies.map(x=>x.synthetic_outcomes.known_pass),[7,2,2,7]);
  assert.deepEqual(result.strategies.map(x=>x.synthetic_outcomes.known_fail),[1,6,6,0]);
  assert.deepEqual(result.strategies.map(x=>x.synthetic_outcomes.abstained),[0,0,0,1]);
  assert.equal(result.limitations.real_model_invocations,0);
  assert.equal(result.limitations.model_quality,'NOT_MEASURED');
  assert.equal(result.limitations.actual_provider_cost_usd,null);
  assert.equal(result.limitations.actual_inference_latency_ms,null);
  assert.equal(result.limitations.real_retries,null);
  assert.equal(result.limitations.no_router_comparison_win_established,true);
  assert.ok(result.strategies.every(s=>s.rows.every(r=>
    r.actual_cost_usd===null && r.actual_latency_ms===null
    && r.real_model_response===null && !r.real_inference_verified)));
});

test('light is enough for two synthetic cases; complex cases exclude insufficient light',async()=>{
  const result=await compare(fixture(),ownerRoot);
  const q=result.strategies[3].rows;
  assert.equal(q.find(x=>x.case_id==='K05-MR-01').providerId,'small');
  assert.equal(q.find(x=>x.case_id==='K05-MR-08').providerId,'small');
  for(const id of ['K05-MR-02','K05-MR-03','K05-MR-04','K05-MR-05','K05-MR-07'])
    assert.equal(q.find(x=>x.case_id===id).providerId,'strong');
  const unknown=q.find(x=>x.case_id==='K05-MR-06');
  assert.equal(unknown.providerId,null);
  assert.equal(unknown.decision,'QUALITY_UNKNOWN');
  assert.equal(unknown.synthetic_label_only,null);
});

test('cost-first matches cheap fixed strategy and does not establish inference savings',async()=>{
  const result=await compare(fixture(),ownerRoot);
  const cheap=result.strategies[1],cost=result.strategies[2];
  assert.deepEqual(cheap.rows.map(x=>x.providerId),cost.rows.map(x=>x.providerId));
  assert.equal(cheap.synthetic_outcomes.projected_cost_usd,
               cost.synthetic_outcomes.projected_cost_usd);
  assert.equal(cost.selector_calls,8);
  assert.equal(result.strategies[3].selector_calls,8);
  assert.equal(result.strategies[0].selector_calls,0);
  assert.ok(result.strategies[3].selector_wall_ms_single_process>=0);
  assert.equal(result.strategies[3].router_billed_cost_usd,null);
});

test('tampered corpus, unknown quality gold and source observations fail closed',async()=>{
  const original=fixture();
  for(const mutation of [
    obj=>{obj.model_quality='PASS';},
    obj=>{obj.cases[0].quality_gold=true;},
    obj=>{obj.cases[0].source_observations=[];},
    obj=>{obj.cases[2].inference_cost_usd=0.001;},
    obj=>{obj.case_ids.reverse();},
    obj=>{obj.cases[0].route_selector='quality-aware';},
  ]) {
    const changed=structuredClone(original);mutation(changed);
    await assert.rejects(compare(changed,ownerRoot),/K05_MODEL_ROUTING_HOLD/);
  }
});

test('mutated owner K02 Git source or inaccessible owner checkout is not silently accepted',async()=>{
  await assert.rejects(compare(fixture(),'/not/a/real/checkout'),/ENOENT/);
});
