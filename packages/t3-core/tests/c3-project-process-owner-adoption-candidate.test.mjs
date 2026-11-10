import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCanonicalAdapter, OwnerWriteGateway } from '../src/persistence/canonical-persistence.mjs';
import {
  PROJECT_PROCESS_OWNER,
  PROJECT_PROCESS_OWNER_ADOPTION_CANDIDATE,
  PROJECT_PROCESS_WRITE_BOUNDARY,
  registerProjectProcessOwner,
} from '../src/modules/base/owners/project-process.mjs';

const SOURCE_KINDS = [
  'project',
  'work',
  'processDefinition',
  'processRun',
  'case',
  'decision',
  'activity',
  'event',
];

test('C3 owner adoption candidate binds only source families and stays non-authoritative', () => {
  assert.equal(PROJECT_PROCESS_OWNER_ADOPTION_CANDIDATE.status, 'APPROVED_BY_OWNER_RECEIPT');
  assert.equal(PROJECT_PROCESS_OWNER_ADOPTION_CANDIDATE.authorityBound, true);
  assert.equal(PROJECT_PROCESS_OWNER_ADOPTION_CANDIDATE.writesAuthorized, false);
  assert.equal(PROJECT_PROCESS_OWNER_ADOPTION_CANDIDATE.ownerId, 'iwxa.project-process.owner');
  assert.equal(PROJECT_PROCESS_OWNER_ADOPTION_CANDIDATE.logicalAreaId, 'work.project_process');

  for (const kind of SOURCE_KINDS) {
    const binding = PROJECT_PROCESS_OWNER_ADOPTION_CANDIDATE.kinds[kind];
    assert.equal(binding.adoptionStatus, 'OWNER_ADOPTED_ACTIVATION_PENDING');
    assert.equal(binding.candidateOwnerId, 'iwxa.project-process.owner');
    assert.equal(binding.candidateHeadKind, 'source');
    assert.deepEqual(binding.candidateCommands, [
      `${kind}.create`,
      `${kind}.revise`,
      `${kind}.release`,
    ]);
  }

  assert.deepEqual(PROJECT_PROCESS_OWNER_ADOPTION_CANDIDATE.kinds.result.candidateCommands, []);
  assert.equal(
    PROJECT_PROCESS_OWNER_ADOPTION_CANDIDATE.kinds.result.adoptionStatus,
    'BLOCKED_RESULT_SOURCE_TRUTH_AND_LIFECYCLE_AUTHORITY_REQUIRED',
  );
  assert.deepEqual(PROJECT_PROCESS_OWNER_ADOPTION_CANDIDATE.kinds.acceptance.candidateCommands, []);
  assert.equal(
    PROJECT_PROCESS_OWNER_ADOPTION_CANDIDATE.kinds.acceptance.adoptionStatus,
    'BLOCKED_ACCEPTANCE_SOURCE_TRUTH_AUTHORITY_REQUIRED',
  );
});

test('approved C3 owner still cannot register or persist before activation closure', () => {
  const gateway = new OwnerWriteGateway({ adapter: new MemoryCanonicalAdapter() });

  assert.equal(PROJECT_PROCESS_WRITE_BOUNDARY.status, 'OWNER_ADOPTED_ACTIVATION_PENDING');
  assert.equal(PROJECT_PROCESS_WRITE_BOUNDARY.authorityBound, true);
  assert.equal(PROJECT_PROCESS_WRITE_BOUNDARY.writesAuthorized, false);
  assert.equal(PROJECT_PROCESS_WRITE_BOUNDARY.resultAndAcceptanceExcludedFromCandidateWrites, true);
  assert.deepEqual(PROJECT_PROCESS_WRITE_BOUNDARY.candidateWritableKinds, SOURCE_KINDS);

  assert.throws(
    () => registerProjectProcessOwner(gateway),
    (error) => error?.code === 'PROJECT_PROCESS_SOURCE_WRITE_ACTIVATION_PENDING',
  );

  for (const binding of Object.values(PROJECT_PROCESS_OWNER_ADOPTION_CANDIDATE.kinds)) {
    assert.equal(gateway.owners.registration(binding.family), null);
  }
  assert.equal(PROJECT_PROCESS_OWNER.ownerId, 'iwxa.project-process.owner');
  assert.equal(PROJECT_PROCESS_OWNER.writesAuthorized, false);
});
