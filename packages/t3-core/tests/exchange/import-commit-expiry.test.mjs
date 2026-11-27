import test from 'node:test';
import assert from 'node:assert/strict';
import {INITIAL_IMPORT_STATE,importReducer} from '../../src/modules/exchange/features/state/import-machine.ts';

const handle={preview_token:'preview-one',package_digest:'package-one',semantic_digest:'semantic-one',expires_at:'2026-11-25T00:00:00Z',allowed_modes:['selective'],preview:{workspaces:[{workspace_id:'w'}],objects:[]}};
const preview=importReducer(importReducer(INITIAL_IMPORT_STATE,{type:'preview-started'}),{type:'preview-succeeded',handle});
const committing=importReducer(importReducer(preview,{type:'validate-plan'}),{type:'commit-started'});
const receipt={package_digest:handle.package_digest,semantic_digest:handle.semantic_digest,mode:'selective',conflict_policy:'fail',import_id:'i',applied:{workspaces:1}};

test('late UI expiry cannot erase an admitted original commit or its receipt',()=>{
  assert.equal(committing.status,'committing');
  const after=importReducer(committing,{type:'expire'});
  assert.equal(after,committing);
  const done=importReducer(after,{type:'commit-succeeded',receipt});
  assert.equal(done.status,'committed');assert.equal(done.receipt,receipt);
});
test('late cancellation cannot erase an admitted original commit',()=>{
  for(const reason of ['explicit','new-file','unmount','session-change'])
    assert.equal(importReducer(committing,{type:'cancel',reason}),committing);
});
test('explicit original Kernel commit expiry remains terminal',()=>{
  const after=importReducer(committing,{type:'commit-expired'});
  assert.equal(after.status,'expired');assert.equal(after.handle,null);assert.equal(after.receipt,null);
  assert.equal(importReducer(preview,{type:'commit-expired'}),preview);
});
test('retryable lock refusal returns to the same preview which may now expire',()=>{
  const retry=importReducer(committing,{type:'commit-retryable',error:'locked'});
  assert.equal(retry.status,'preview-ready');assert.equal(retry.handle,handle);
  assert.equal(importReducer(retry,{type:'expire'}).status,'expired');
});
test('unclassified commit outcome still cannot be cancelled or replayed',()=>{
  const unknown=importReducer(committing,{type:'commit-failed',error:'lost acknowledgement'});
  assert.equal(unknown.status,'unconfirmed');assert.equal(unknown.handle,null);
  assert.equal(importReducer(unknown,{type:'cancel',reason:'explicit'}),unknown);
  assert.equal(importReducer(unknown,{type:'commit-started'}),unknown);
});
test('another file event cannot replace an admitted original commit',()=>{
  assert.equal(importReducer(committing,{type:'preview-started'}),committing);
});
