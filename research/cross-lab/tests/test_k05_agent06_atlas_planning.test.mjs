import test from 'node:test';
import assert from 'node:assert/strict';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {
  projectAtlasPlanningFromOriginalOwner, summarizeAtlasPlannedChange,
} from '../k05_agent06_atlas_planning.mjs';

const originalRoot = process.env.K05_ATLAS_OWNER_ROOT;
assert.ok(originalRoot, 'Public original Atlas owner checkout required');
const atlas = await import(pathToFileURL(join(resolve(originalRoot),'src/planning.mjs')).href);
const {scheduleProject,scheduleChangeSummary} = atlas;

const source = () => ({
  id:'private-like-case-id-not-for-telemetry',
  startDate:'2026-11-01',
  items:[
    {id:'internal-a',title:'Sensitive hypothetical work A',state:'done',estimateDays:2},
    {id:'internal-b',title:'Sensitive hypothetical work B',state:'done',estimateDays:3},
  ],
  dependencies:[{from:'internal-a',to:'internal-b'}],
});

test('K05 calculates actual Atlas owner plan deltas, never factual runtime',()=>{
  const before=source(), after=structuredClone(before);
  after.items[0].estimateDays=4;
  const frozen=JSON.stringify(before), edited=JSON.stringify(after);
  const r=projectAtlasPlanningFromOriginalOwner(
    scheduleProject,scheduleChangeSummary,before,after);
  assert.equal(r.status,'PLAN_ONLY_NOT_EXECUTION');
  assert.equal(r.before_planned_calendar_days,5);
  assert.equal(r.after_planned_calendar_days,7);
  assert.equal(r.planned_delta_calendar_days,2);
  assert.equal(r.planned_moved_works,2);
  assert.equal(r.observed_process_cycle_ms,null);
  assert.equal(r.observed_actual_cost_minor,null);
  assert.equal(r.actual_roi_percent,null);
  assert.equal(r.actual_roi_status,'NOT_MEASURABLE');
  assert.equal(r.accepted_business_result,'NOT_VERIFIED');
  assert.equal(r.forecasts_used_for_roi,false);
  assert.equal(JSON.stringify(before),frozen);
  assert.equal(JSON.stringify(after),edited);
  const text=JSON.stringify(r);
  for(const secret of ['internal-a','Sensitive hypothetical','private-like-case-id'])
    assert.equal(text.includes(secret),false);
});

test('Atlas done state and user-entered actual-time-like keys remain PLAN ONLY',()=>{
  const before=source(), after=structuredClone(before);
  after.items[0].state='done';
  after.items[0].observedElapsedMs=100;
  after.items[0].actualCostMinor=777;
  const r=projectAtlasPlanningFromOriginalOwner(
    scheduleProject,scheduleChangeSummary,before,after);
  assert.equal(r.planned_delta_calendar_days,0);
  assert.equal(r.observed_process_cycle_ms,null);
  assert.equal(r.observed_human_active_ms,null);
  assert.equal(r.observed_actual_cost_minor,null);
  assert.equal(r.source_event_provenance,'NOT_VERIFIED');
});

test('Atlas missing date does not become observed process time',()=>{
  const before=source(),after=structuredClone(before);
  before.startDate=null;
  after.startDate=null;
  after.items[1].estimateDays=2;
  const result=projectAtlasPlanningFromOriginalOwner(
    scheduleProject,scheduleChangeSummary,before,after);
  assert.equal(result.planned_delta_calendar_days,-1);
  assert.equal(result.observed_process_cycle_ms,null);
  assert.equal(result.accepted_business_result,'NOT_VERIFIED');
});

test('Forged Atlas owner projection or inconsistent affected totals are rejected',()=>{
  const b=scheduleProject(source());
  const a=scheduleProject(source());
  const diff=scheduleChangeSummary(b,a);
  for(const [corrupt,expected] of [
    [{...b,warning:'Recorded true actual cost'},'OWNER_PLANNING_SEMANTICS_REQUIRED'],
    [{...b,workItems:999},'PLAN_COVERAGE_INVALID'],
    [{...b,durationDays:-1},'PLAN_COVERAGE_INVALID'],
  ]){
    assert.throws(()=>summarizeAtlasPlannedChange(corrupt,a,diff),
      error=>error?.code==='K05_ATLAS_'+expected);
  }
  assert.throws(()=>summarizeAtlasPlannedChange(b,a,{...diff,affectedTotal:0,movedTotal:1}),
    /K05_ATLAS_PLAN_COMPARISON_INCONSISTENT/);
});

test('Original owner required; no optional second scheduler',()=>{
  assert.throws(()=>projectAtlasPlanningFromOriginalOwner(
    null,scheduleChangeSummary,source(),source()),
    /K05_ATLAS_ORIGINAL_ATLAS_OWNER_REQUIRED/);
});

test('Baseline is unchanged after schedule owner handles invalid work',()=>{
  const p=source(),before=JSON.stringify(p);
  p.items[0].estimateDays=-42;
  assert.throws(()=>projectAtlasPlanningFromOriginalOwner(
    scheduleProject,scheduleChangeSummary,p,source()),/Invalid estimateDays/);
  p.items[0].estimateDays=2;
  assert.equal(JSON.stringify(p),before);
});
