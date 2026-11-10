export const WORKSPACE_PERSISTED_VIEW_CONFLICT_PHASES = Object.freeze({
  refreshRequired: 'REFRESH_REQUIRED',
  reviewRequired: 'REVIEW_REQUIRED',
  reviewed: 'REVIEWED',
});

const REVISION_CONFLICT_CODES = new Set(['CONFLICT', 'REVISION_CONFLICT']);

function errorCode(error, seen = new Set()) {
  if (!error || typeof error !== 'object' || seen.has(error)) return null;
  seen.add(error);
  const code = typeof error.code === 'string' ? error.code : null;
  if (code && REVISION_CONFLICT_CODES.has(code)) return code;
  return errorCode(error.cause, seen) ?? code;
}

function requirePositiveRevision(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return value;
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

export function classifyWorkspacePersistedViewMutationError(error) {
  const code = errorCode(error);
  if (code && REVISION_CONFLICT_CODES.has(code)) {
    return Object.freeze({
      kind: 'REVISION_CONFLICT',
      code,
      refreshRequired: true,
      automaticRetryAllowed: false,
    });
  }
  return Object.freeze({
    kind: 'MUTATION_ERROR',
    code,
    refreshRequired: false,
    automaticRetryAllowed: false,
  });
}

export function beginWorkspacePersistedViewConflictReview({ error, viewId, attemptedRevision }) {
  const classification = classifyWorkspacePersistedViewMutationError(error);
  if (classification.kind !== 'REVISION_CONFLICT') return null;
  return Object.freeze({
    kind: classification.kind,
    phase: WORKSPACE_PERSISTED_VIEW_CONFLICT_PHASES.refreshRequired,
    viewId: requireText(viewId, 'viewId'),
    attemptedRevision: requirePositiveRevision(attemptedRevision, 'attemptedRevision'),
    refreshedRevision: null,
    automaticRetryAllowed: false,
    explicitReviewRequired: true,
  });
}

export function refreshWorkspacePersistedViewConflictReview(state, freshView) {
  if (!state || state.kind !== 'REVISION_CONFLICT' || state.phase !== WORKSPACE_PERSISTED_VIEW_CONFLICT_PHASES.refreshRequired) {
    throw new Error('VIEW_STATE_CONFLICT_REFRESH_NOT_ALLOWED');
  }
  const freshViewId = requireText(freshView?.viewId, 'freshView.viewId');
  if (freshViewId !== state.viewId) throw new Error('VIEW_STATE_CONFLICT_VIEW_MISMATCH');
  const refreshedRevision = requirePositiveRevision(
    freshView?.revision ?? freshView?.baseRevision,
    'freshView.revision',
  );
  return Object.freeze({
    ...state,
    phase: WORKSPACE_PERSISTED_VIEW_CONFLICT_PHASES.reviewRequired,
    refreshedRevision,
    automaticRetryAllowed: false,
    explicitReviewRequired: true,
  });
}

export function reviewWorkspacePersistedViewConflict(state, reviewedRevision) {
  if (!state || state.kind !== 'REVISION_CONFLICT' || state.phase !== WORKSPACE_PERSISTED_VIEW_CONFLICT_PHASES.reviewRequired) {
    throw new Error('VIEW_STATE_CONFLICT_REVIEW_NOT_ALLOWED');
  }
  const revision = requirePositiveRevision(reviewedRevision, 'reviewedRevision');
  if (revision !== state.refreshedRevision) throw new Error('VIEW_STATE_CONFLICT_REVIEW_REVISION_MISMATCH');
  return Object.freeze({
    ...state,
    phase: WORKSPACE_PERSISTED_VIEW_CONFLICT_PHASES.reviewed,
    reviewedRevision: revision,
    automaticRetryAllowed: false,
    explicitReviewRequired: false,
    nextBaseRevision: revision,
    requiresExplicitMutation: true,
  });
}
