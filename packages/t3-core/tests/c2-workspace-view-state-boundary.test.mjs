import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WORKSPACE_VIEW_STATE_FAMILY,
  isWorkspaceBusinessObjectRecord,
  isWorkspaceViewStateObjectRecord,
} from '../src/modules/base/features/workspace/workspace-view-state-boundary.mjs';

test('P3 internal saved-view family is identified in runtime and persistence record shapes', () => {
  assert.equal(WORKSPACE_VIEW_STATE_FAMILY, 'iwxa.workspace.internal.saved-view');
  assert.equal(isWorkspaceViewStateObjectRecord({ schema_id: WORKSPACE_VIEW_STATE_FAMILY }), true);
  assert.equal(isWorkspaceViewStateObjectRecord({ schemaId: WORKSPACE_VIEW_STATE_FAMILY }), true);
  assert.equal(isWorkspaceViewStateObjectRecord({ family: WORKSPACE_VIEW_STATE_FAMILY }), true);
  assert.equal(isWorkspaceViewStateObjectRecord({ schema_id: 'learning.note' }), false);
});

test('P3 internal saved views are excluded from the business-object classification', () => {
  assert.equal(isWorkspaceBusinessObjectRecord({ schema_id: 'learning.note' }), true);
  assert.equal(isWorkspaceBusinessObjectRecord({ schema_id: WORKSPACE_VIEW_STATE_FAMILY }), false);
  assert.equal(isWorkspaceBusinessObjectRecord(null), false);
});
