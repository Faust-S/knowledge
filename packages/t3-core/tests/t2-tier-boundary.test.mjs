import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';

const state=JSON.parse(readFileSync(new URL('../CANONICAL_SOURCE_STATE.json',import.meta.url),'utf8'));

test('T2 product boundary contains no active AI tier',()=>{
  assert.equal(existsSync(new URL('../src/modules/base/features/neural/',import.meta.url)),false);
  assert.equal(existsSync(new URL('../src/modules/base/services/neural-task-control-plane.ts',import.meta.url)),false);
  assert.equal(state.product_boundary?.role,'CANONICAL_WORKSPACE_DOMAIN_FOUNDATION');
  assert.equal(state.product_boundary?.active_ai_tier,false);
});

test('T2 boundary remains self-contained and current-product scoped',()=>{
  assert.equal(state.product_boundary?.kernel_target,'0.3.5');
  assert.equal(state.product_boundary?.historical_recovery_required,false);
  assert.equal(state.product_boundary?.production_deploy,false);
  assert.equal(state.product_boundary?.qualification_status,'REQUIRES_FRESH_EXACT_HEAD_NONWINDOWS_QUALIFICATION');
  const serialized=JSON.stringify(state.product_boundary);
  assert.equal(serialized.includes('Faust-S/T4'),false);
  assert.equal(serialized.includes('T4'),false);
  assert.equal(serialized.includes('T5'),false);
  assert.equal(serialized.includes('preservation'),false);
  assert.equal(serialized.includes('migration'),false);
});
