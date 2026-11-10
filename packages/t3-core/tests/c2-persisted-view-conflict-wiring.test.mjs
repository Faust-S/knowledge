import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyWorkspacePersistedViewMutationError,
} from '../src/modules/base/features/workspace/workspace-persisted-view-conflict.mjs';

test('persisted-view conflict classifier follows wrapped command cause chain',()=>{
  const conflict=Object.assign(new Error('kernel conflict'),{code:'REVISION_CONFLICT'});
  const wrapped=Object.assign(new Error('handler threw'),{code:'handler-threw',cause:conflict});
  const classification=classifyWorkspacePersistedViewMutationError(wrapped);
  assert.deepEqual(classification,{
    kind:'REVISION_CONFLICT',
    code:'REVISION_CONFLICT',
    refreshRequired:true,
    automaticRetryAllowed:false,
  });
});

test('persisted-view classifier handles cyclic causes without looping',()=>{
  const error={code:'handler-threw'};
  error.cause=error;
  const classification=classifyWorkspacePersistedViewMutationError(error);
  assert.equal(classification.kind,'MUTATION_ERROR');
  assert.equal(classification.automaticRetryAllowed,false);
});
