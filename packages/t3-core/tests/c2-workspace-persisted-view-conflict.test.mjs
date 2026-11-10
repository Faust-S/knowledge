import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WORKSPACE_PERSISTED_VIEW_CONFLICT_PHASES,
  beginWorkspacePersistedViewConflictReview,
  classifyWorkspacePersistedViewMutationError,
  refreshWorkspacePersistedViewConflictReview,
  reviewWorkspacePersistedViewConflict,
} from '../src/modules/base/features/workspace/workspace-persisted-view-conflict.mjs';

test('P3.2 classifies only exact revision conflict codes as refresh-required', () => {
  for (const code of ['CONFLICT', 'REVISION_CONFLICT']) {
    assert.deepEqual(classifyWorkspacePersistedViewMutationError({ code }), {
      kind: 'REVISION_CONFLICT',
      code,
      refreshRequired: true,
      automaticRetryAllowed: false,
    });
  }
  assert.deepEqual(classifyWorkspacePersistedViewMutationError({ code: 'FORBIDDEN' }), {
    kind: 'MUTATION_ERROR',
    code: 'FORBIDDEN',
    refreshRequired: false,
    automaticRetryAllowed: false,
  });
  assert.equal(beginWorkspacePersistedViewConflictReview({ error: { code: 'FORBIDDEN' }, viewId: 'v1', attemptedRevision: 1 }), null);
});

test('P3.2 requires fresh read and exact explicit revision review before another mutation', () => {
  const conflict = beginWorkspacePersistedViewConflictReview({
    error: { code: 'REVISION_CONFLICT' },
    viewId: 'v1',
    attemptedRevision: 1,
  });
  assert.equal(conflict.phase, WORKSPACE_PERSISTED_VIEW_CONFLICT_PHASES.refreshRequired);
  assert.equal(conflict.automaticRetryAllowed, false);
  assert.equal(conflict.refreshedRevision, null);
  assert.throws(() => reviewWorkspacePersistedViewConflict(conflict, 2), /REVIEW_NOT_ALLOWED/);

  const refreshed = refreshWorkspacePersistedViewConflictReview(conflict, { viewId: 'v1', revision: 2 });
  assert.equal(refreshed.phase, WORKSPACE_PERSISTED_VIEW_CONFLICT_PHASES.reviewRequired);
  assert.equal(refreshed.refreshedRevision, 2);
  assert.equal(refreshed.automaticRetryAllowed, false);
  assert.throws(() => reviewWorkspacePersistedViewConflict(refreshed, 1), /REVIEW_REVISION_MISMATCH/);

  const reviewed = reviewWorkspacePersistedViewConflict(refreshed, 2);
  assert.equal(reviewed.phase, WORKSPACE_PERSISTED_VIEW_CONFLICT_PHASES.reviewed);
  assert.equal(reviewed.nextBaseRevision, 2);
  assert.equal(reviewed.requiresExplicitMutation, true);
  assert.equal(reviewed.automaticRetryAllowed, false);
});

test('P3.2 refuses refresh for a different persisted view', () => {
  const conflict = beginWorkspacePersistedViewConflictReview({ error: { code: 'CONFLICT' }, viewId: 'v1', attemptedRevision: 3 });
  assert.throws(
    () => refreshWorkspacePersistedViewConflictReview(conflict, { viewId: 'v2', revision: 4 }),
    /VIEW_MISMATCH/,
  );
});
