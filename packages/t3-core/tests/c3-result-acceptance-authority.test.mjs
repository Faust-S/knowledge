import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeAcceptance,
  normalizeResult,
} from '../src/modules/base/features/project-process/project-process.mjs';
import {
  RESULT_ACCEPTANCE_AUTHORITY,
  commonResultAcceptanceWriteAuthority,
} from '../src/modules/base/features/project-process/result-acceptance-authority.mjs';
import {
  domainResultAuthorityReadiness,
} from '../src/modules/base/features/project-process/domain-result-authority-registry.mjs';

const WORKSPACE = 'workspace-1';
const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const CANONICAL_SOURCE_ROOT = path.resolve(TEST_ROOT, '..');
const CANONICAL_SOURCE_STATE = JSON.parse(readFileSync(
  path.join(CANONICAL_SOURCE_ROOT, 'CANONICAL_SOURCE_STATE.json'),
  'utf8',
));
const CURRENT_RESULT_PROJECTION_FIELDS = Object.freeze([
  'schema','sourceTruth','objectKind','workspaceId','resultId','projectId',
  'workId','runId','caseId','resultType','value','evidenceRefs','effectiveAt',
]);

function resultFixture(overrides = {}) {
  return {
    workspaceId: WORKSPACE,
    resultId: 'result-1',
    projectId: 'project-1',
    workId: 'work-1',
    resultType: 'artifact',
    value: { qualified: true },
    evidenceRefs: ['evidence:result-1'],
    ...overrides,
  };
}

function acceptanceFixture(overrides = {}) {
  return {
    workspaceId: WORKSPACE,
    acceptanceId: 'acceptance-1',
    projectId: 'project-1',
    resultId: 'result-1',
    criteria: [
      { criterionId: 'evidenced', required: true, satisfied: true, evidenceRefs: [] },
    ],
    ...overrides,
  };
}

test('C3 current authority state is derived only from current canonical state and runtime authority code', () => {
  assert.equal(CANONICAL_SOURCE_STATE.schema, 'IWXA_T2_CANONICAL_SOURCE_STATE_V7');
  assert.equal(
    CANONICAL_SOURCE_STATE.convergence.c3_project_process_result_acceptance,
    'MATERIALIZED_COMMON_PROJECTION_DOMAIN_AUTHORITY_SPLIT',
  );
  assert.equal(
    CANONICAL_SOURCE_STATE.convergence.c3_result_core_projection,
    'MATERIALIZED_DOMAIN_NATIVE_REFERENCE_READ_ONLY',
  );
  assert.equal(
    CANONICAL_SOURCE_STATE.convergence.c3_state,
    'T25_FUNCTIONALITY_IMPLEMENTED_PRODUCTION_ACTIVATION_DEFERRED_TO_LATE_EXACT_EVIDENCE_OWNER_D4_GATE',
  );
  assert.equal(
    CANONICAL_SOURCE_STATE.authority_boundaries.result_lifecycle,
    'DOMAIN_NATIVE_LIFECYCLE_NOT_COMMON_GENERIC_AUTHORITY',
  );
  assert.equal(
    CANONICAL_SOURCE_STATE.authority_boundaries.acceptance_generic,
    'DERIVED_NON_SOURCE_TRUTH_DOMAIN_CRITERIA_REFERENCE_ONLY',
  );
  assert.equal(
    CANONICAL_SOURCE_STATE.authority_boundaries.result_acceptance_source_truth,
    'DOMAIN_BOUND_RESULT_PRODUCER_PLUS_CANONICAL_AUTHORITY_CORE_REQUIRED',
  );
  assert.equal(
    CANONICAL_SOURCE_STATE.authority_boundaries.common_project_process_result_acceptance_writes,
    'FORBIDDEN',
  );

  assert.equal(RESULT_ACCEPTANCE_AUTHORITY.sourceTruthRule.ownership, 'DOMAIN_BOUND');
  assert.equal(
    RESULT_ACCEPTANCE_AUTHORITY.sourceTruthRule.resultProducerSeparatedFromCanonicalAuthorityCore,
    true,
  );
  assert.deepEqual(commonResultAcceptanceWriteAuthority(), {
    result: false,
    acceptance: false,
    ownerId: 'iwxa.project-process.owner',
    reason: 'RESULT_AND_ACCEPTANCE_SOURCE_TRUTH_ARE_DOMAIN_BOUND',
  });
  assert.equal(domainResultAuthorityReadiness('D02').sourceTruthBindingAllowed, true);
  assert.equal(domainResultAuthorityReadiness('D01').status, 'OWNER_DECISION_REQUIRED');
  assert.equal(domainResultAuthorityReadiness('D10').status, 'AUTHORITY_BOUND_PRODUCT_LOGIC');
  assert.equal(domainResultAuthorityReadiness('D10').sourceTruthBindingAllowed, true);
  assert.equal(domainResultAuthorityReadiness('D12').status, 'NATIVE_RESULT_USE_CASE_NOT_PROVEN');
});

test('C3 common Result projection remains non-source-truth because source authority is domain-bound', () => {
  const result = normalizeResult(resultFixture({ sourceTruth: true }));
  assert.equal(result.sourceTruth, false);
});

test('C3 Result projection is locked to the current canonical field set', () => {
  const result = normalizeResult(resultFixture({
    status: 'ACCEPTED',
    lifecycleState: 'FINAL',
    accepted: true,
    rejected: false,
    authority: 'caller-supplied',
    ownerRef: 'caller-supplied',
    acceptanceState: 'ACCEPTED',
    sourceTruth: true,
  }));
  assert.deepEqual(Object.keys(result).sort(), [...CURRENT_RESULT_PROJECTION_FIELDS].sort());
  assert.equal(result.sourceTruth, false);
});

test('C3 common Result projection does not invent a generic lifecycle over domain-native authority', () => {
  const result = normalizeResult(resultFixture({
    status: 'ACCEPTED',
    lifecycleState: 'FINAL',
    accepted: true,
    rejected: false,
  }));
  for (const field of ['status', 'lifecycleState', 'accepted', 'rejected']) {
    assert.equal(Object.hasOwn(result, field), false, `${field} must remain outside common Result projection`);
  }
});

test('C3 generic Acceptance evaluation is explicitly derived and not source truth', () => {
  const acceptance = normalizeAcceptance(acceptanceFixture());
  assert.equal(acceptance.sourceTruth, false);
  assert.equal(acceptance.derived, true);
  assert.equal(acceptance.acceptanceState, 'PENDING_EVIDENCE');
  assert.deepEqual(acceptance.missingEvidenceCriterionIds, ['evidenced']);
});

test('C3 caller cannot promote generic Acceptance to source truth', () => {
  const acceptance = normalizeAcceptance(acceptanceFixture({
    sourceTruth: true,
    derived: false,
  }));
  assert.equal(acceptance.sourceTruth, false);
  assert.equal(acceptance.derived, true);
});
