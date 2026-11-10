import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  validateFactory2AcceptanceResult,
  validateFactory2DeterministicPackagePlan,
  Factory2FinalizationError,
} from '../src/factory2/distribution/finalization-control.mjs';

const product=(name)=>JSON.parse(readFileSync(new URL('../../product/'+name,import.meta.url),'utf8'));

test('Factory 2 acceptance result stays fail-closed before verification and final seals',()=>{
  const x=validateFactory2AcceptanceResult(product('FACTORY2_ACCEPTANCE_RESULT_2026-09-24.json'));
  assert.equal(x.factoryAcceptanceGranted,false);
  assert.equal(x.allPrerequisitesSatisfied,false);
});
test('Factory 2 acceptance cannot be claimed by flipping one flag',()=>{
  const x=product('FACTORY2_ACCEPTANCE_RESULT_2026-09-24.json');
  x.factoryAcceptanceGranted=true;
  assert.throws(()=>validateFactory2AcceptanceResult(x),(e)=>e instanceof Factory2FinalizationError&&e.code==='FACTORY2_FALSE_ACCEPTANCE_CLAIM');
});
test('Factory 2 deterministic package plan fixes order, metadata and unsafe path policy',()=>{
  const x=validateFactory2DeterministicPackagePlan(product('FACTORY2_DETERMINISTIC_PACKAGE_PLAN_2026-09-24.json'));
  assert.equal(x.entryOrder,'RELATIVE_POSIX_STRING_ASCENDING');
  assert.equal(x.compressionPolicy,'ZIP_STORED');
  assert.equal(x.pathPolicy.parentTraversalForbidden,true);
});
