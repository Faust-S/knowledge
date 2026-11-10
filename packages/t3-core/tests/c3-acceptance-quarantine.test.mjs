import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAcceptance,
  ProjectProcessSemanticError,
} from '../src/modules/base/features/project-process/project-process.mjs';

function acceptanceInput(overrides = {}) {
  return {
    workspaceId: 'workspace-c3-quarantine',
    acceptanceId: 'acceptance-c3-quarantine',
    projectId: 'project-c3-quarantine',
    resultId: 'result-c3-quarantine',
    criteria: [{
      criterionId: 'criterion-required',
      required: true,
      satisfied: true,
      evidenceRefs: ['evidence-1'],
    }],
    ...overrides,
  };
}

test('C3 generic Acceptance forbids scalar acceptanceScore', () => {
  assert.throws(
    () => normalizeAcceptance(acceptanceInput({ acceptanceScore: 1 })),
    (error) => {
      assert.equal(error instanceof ProjectProcessSemanticError, true);
      assert.equal(error.code, 'FORBIDDEN_ACCEPTANCE_SCORE');
      return true;
    },
  );
});

test('C3 generic Acceptance remains derived non-source-truth and caller cannot promote its state', () => {
  const acceptance = normalizeAcceptance(acceptanceInput({
    sourceTruth: true,
    derived: false,
    acceptanceState: 'ACCEPTED',
    criteria: [{
      criterionId: 'criterion-required',
      required: true,
      satisfied: false,
      evidenceRefs: [],
    }],
  }));

  assert.equal(acceptance.sourceTruth, false);
  assert.equal(acceptance.derived, true);
  assert.equal(acceptance.acceptanceState, 'REJECTED_REQUIRED_CRITERIA');
  assert.deepEqual(acceptance.failedRequiredCriterionIds, ['criterion-required']);
  assert.equal(Object.prototype.hasOwnProperty.call(acceptance, 'acceptanceScore'), false);
});
