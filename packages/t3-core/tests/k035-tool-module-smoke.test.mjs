import test from 'node:test';
import assert from 'node:assert/strict';

const MODULES=Object.freeze([
  '../../product/tools/k035-c3-critical-path-status.mjs',
  '../../product/tools/k035-product-graph-successor.mjs',
  '../../product/tools/k035-r11-preacceptance-closure.mjs',
  '../../product/tools/c3-current-product-qualification-receipt.mjs',
  '../../product/tools/k035-current-subject-acceptance-evidence.mjs',
  '../../product/tools/k035-current-subject-acceptance-lock.mjs',
  '../../product/tools/k035-current-subject-d4.mjs',
  '../../product/tools/c3-project-process-activation-binding-plan.mjs',
]);

test('all current K035/C3 product tool modules import without syntax or export initialization failure',async()=>{
  const loaded=await Promise.all(MODULES.map((path)=>import(path)));
  assert.equal(loaded.length,MODULES.length);
  for(let i=0;i<loaded.length;i++){
    assert.ok(loaded[i]&&typeof loaded[i]==='object',MODULES[i]);
    assert.ok(Object.keys(loaded[i]).length>0,`${MODULES[i]} exports nothing`);
  }
});

test('active tool smoke contains no archival baseline/recovery modules',()=>{
  for(const path of MODULES){
    for(const forbidden of [
      'successor-baseline',
      'independent-verification',
      'predecessor-graph-recovery',
      'runtime-owner-review-package',
      'post-acceptance-stage-d-subject',
      'post-acceptance-stage-d-evidence',
    ]) assert.equal(path.includes(forbidden),false,`archival tool leaked into active smoke: ${path}`);
  }
});
