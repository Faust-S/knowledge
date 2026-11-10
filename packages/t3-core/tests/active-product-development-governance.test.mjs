import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const governancePath=fileURLToPath(new URL('../../product/ACTIVE_PRODUCT_DEVELOPMENT_GOVERNANCE_2026-09-18.json',import.meta.url));
const criticalPathSource=fileURLToPath(new URL('../../product/tools/k035-c3-critical-path-status.mjs',import.meta.url));
const packagePath=fileURLToPath(new URL('../package.json',import.meta.url));
const runnerPath=fileURLToPath(new URL('../scripts/run-current-core-tests.mjs',import.meta.url));

test('active product governance permanently keeps archival recovery non-blocking',()=>{
  const governance=JSON.parse(readFileSync(governancePath,'utf8'));
  assert.equal(governance.status,'ACTIVE');
  assert.equal(governance.archival_handling.active_search,false);
  assert.equal(governance.archival_handling.unresolved_historical_identity,'RECORD_AS_ARCHIVAL_DEBT_NON_BLOCKING');
  assert.ok(governance.prohibitions.includes('DO_NOT_ELEVATE_HISTORICAL_OR_ARCHIVAL_RECOVERY_TO_ACTIVE_PRODUCT_BLOCKER'));
  assert.ok(governance.prohibitions.includes('DO_NOT_EMIT_HISTORICAL_RECOVERY_AS_NEXT_REQUIRED_ACTION_FROM_ACTIVE_CRITICAL_PATH_TOOLS'));
  assert.equal(governance.authority_boundaries.common_result_acceptance_writes,'FORBIDDEN');
});

test('active C3 critical-path source cannot regress to historical baseline recovery actions',()=>{
  const source=readFileSync(criticalPathSource,'utf8');
  for(const forbidden of [
    'BLOCKED_SUCCESSOR_BASELINE',
    'RECOVER_EXACT_SPLIT7',
    'RECOVER_BASELINE',
    'PREDECESSOR_1_0_0_REQUIRED_INPUTS',
    'k035-baseline10-split7',
  ]){
    assert.equal(source.includes(forbidden),false,`active critical path regressed to forbidden historical token: ${forbidden}`);
  }
  assert.ok(source.includes('READY_CURRENT_C3_PRODUCT_QUALIFICATION'));
  assert.ok(source.includes('READY_CURRENT_ACCEPTANCE_REBASELINE'));
});

test('current npm core suite discovers all active tests without archival policy exclusions',()=>{
  const pkg=JSON.parse(readFileSync(packagePath,'utf8'));
  assert.equal(pkg.scripts.test,'node scripts/run-current-core-tests.mjs');
  assert.equal(pkg.scripts['test:core'],pkg.scripts.test);
  assert.equal(pkg.scripts['test:archival'],undefined);
  const runner=readFileSync(runnerPath,'utf8');
  assert.ok(runner.includes("entry.name.endsWith('.test.mjs')"));
  assert.ok(runner.includes("['--test',...names]"));
  assert.equal(runner.includes('classifyCoreTests'),false);
});
