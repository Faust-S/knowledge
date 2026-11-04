import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintContextRequest } from '../request-binding.mjs';
const query={taskId:'task:budget',terms:['lead'],allowedSources:['doc:a'],maxTokens:20};
test('increasing and decreasing context budget invalidate prior selection',()=>{
  const initial=fingerprintContextRequest(query);
  assert.notEqual(initial,fingerprintContextRequest({...query,maxTokens:50}));
  assert.notEqual(initial,fingerprintContextRequest({...query,maxTokens:10}));
});
test('budget with re-ordered terms and sources remains stable',()=>{
  const before=fingerprintContextRequest({...query,terms:['lead','TIME'],allowedSources:['doc:a','doc:b']});
  const after=fingerprintContextRequest({...query,terms:['time','LEAD','time'],allowedSources:['doc:b','doc:a','doc:a']});
  assert.equal(before,after);
});
test('invalid maxTokens rejected before hashing',()=>{
  for(const invalid of [-1,1.3,Infinity,Number.MAX_SAFE_INTEGER+1,undefined])
    assert.throws(()=>fingerprintContextRequest({...query,maxTokens:invalid}),/invalid context request identity/);
});
