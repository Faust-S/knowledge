import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const matrix=JSON.parse(readFileSync(new URL('../../product/T25_TO_T2_CAPABILITY_CLOSURE_MATRIX_2026-09-20.json',import.meta.url),'utf8'));

test('T2.5 closure matrix covers all 44 capabilities exactly once with no unknown disposition',()=>{
 assert.equal(matrix.rows.length,44);
 assert.equal(new Set(matrix.rows.map(row=>row.capabilityId)).size,44);
 assert.deepEqual(matrix.rows.map(row=>row.capabilityId),Array.from({length:44},(_,i)=>'T25-CAP-'+String(i+1).padStart(3,'0')));
 assert.equal(matrix.rows.some(row=>/UNKNOWN/.test(row.disposition)||row.disposition==='MISSING'),false);
 assert.equal(matrix.policy.historicalRecoveryRequired,false);
 assert.equal(matrix.policy.noSpeculativeSemantics,true);
 assert.deepEqual(matrix.summary.counts,{
  MATERIALIZED:34,
  MATERIALIZED_SCOPED:5,
  OWNER_DECISION_REQUIRED:2,
  AUTHORITY_BOUNDARY_NOT_IMPLEMENTATION_GAP:3,
 });
});

test('scoped adoption, owner decisions and authority boundaries remain explicit instead of becoming invented writes',()=>{
 const byId=new Map(matrix.rows.map(row=>[row.capabilityId,row]));
 for(const id of ['T25-CAP-016','T25-CAP-017']) assert.equal(byId.get(id)?.disposition,'OWNER_DECISION_REQUIRED');
 for(const id of ['T25-CAP-026','T25-CAP-027']) assert.equal(byId.get(id)?.disposition,'MATERIALIZED_SCOPED');
 for(const id of ['T25-CAP-018','T25-CAP-033','T25-CAP-035']) assert.equal(byId.get(id)?.disposition,'AUTHORITY_BOUNDARY_NOT_IMPLEMENTATION_GAP');
 for(const id of ['T25-CAP-016','T25-CAP-017']) assert.match(byId.get(id)?.remainingAction??'',/^OWNER_DECIDE_/);
 assert.match(byId.get('T25-CAP-027')?.remainingAction??'',/EVIDENCE/);
});

test('each capability row carries current source, tests, authority and a concrete remaining action',()=>{
 for(const row of matrix.rows){
  assert.ok(Array.isArray(row.sourcePaths)&&row.sourcePaths.length>0,row.capabilityId+' sourcePaths');
  assert.ok(Array.isArray(row.testPaths)&&row.testPaths.length>0,row.capabilityId+' testPaths');
  assert.ok(Array.isArray(row.authorityRefs)&&row.authorityRefs.length>0,row.capabilityId+' authorityRefs');
  assert.equal(typeof row.remainingAction,'string');
  assert.ok(row.remainingAction.length>0,row.capabilityId+' remainingAction');
 }
});
