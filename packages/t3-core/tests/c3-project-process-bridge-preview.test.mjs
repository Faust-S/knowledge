import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ProjectProcessBridgePreviewError,
  buildProjectProcessBridgePreview,
} from '../src/modules/base/owners/project-process-bridge-preview.mjs';

function valid(overrides={}) {
  return {
    bridgeId:'c3-project-process-d1',
    affectedKinds:['project','work','processDefinition','processRun'],
    semanticSourceIds:['T2.5:0.20.0','Project/Process:0.8-0.9'],
    changeSpecRef:'change-spec:c3-project-process',
    behavioralSpecRef:'behavioral-spec:c3-project-process',
    strongContractRef:'strong-contract:c3-project-process',
    harnessOracleRef:'harness:c3-project-process',
    boundedRequirements:['REQ-T25-020-006','REQ-T25-020-007','REQ-T25-020-016'],
    adoptionTopologyDeltaRef:'adoption-topology:c3-project-process',
    sourceBaselineEligibility:true,
    conflicts:[],
    openQuestions:[],
    ...overrides,
  };
}

test('C3 scoped Bridge/D1 preview is explicitly non-persistent and non-runtime-changing', () => {
  const preview=buildProjectProcessBridgePreview(valid());
  assert.equal(preview.schema,'IWXA_T2_C3_PROJECT_PROCESS_BRIDGE_PREVIEW_V1');
  assert.equal(preview.runtimeChange,false);
  assert.equal(preview.persisted,false);
  assert.equal(preview.sourceTruth,false);
  assert.equal(preview.d1State,'SPEC_CONTROLLED_PREVIEW');
  assert.equal(preview.ownerId,'iwxa.project-process.owner');
  assert.deepEqual(preview.expectedAffectedSet,[
    'iwxa.project',
    'iwxa.work',
    'iwxa.process.definition',
    'iwxa.process.run',
  ]);
});

test('C3 Bridge preview rejects Result and Acceptance because they are outside adopted source scope', () => {
  for(const kind of ['result','acceptance']){
    assert.throws(
      () => buildProjectProcessBridgePreview(valid({affectedKinds:['project',kind]})),
      (error) => error?.code === 'PROJECT_PROCESS_FAMILY_OUTSIDE_APPROVED_SCOPE',
    );
  }
});

test('C3 Bridge preview requires exact bounded D1 inputs and fails closed on duplicates', () => {
  assert.throws(
    () => buildProjectProcessBridgePreview(valid({semanticSourceIds:[]})),
    (error) => error instanceof ProjectProcessBridgePreviewError
      && error.code === 'INVALID_PROJECT_PROCESS_BRIDGE_FIELD',
  );
  assert.throws(
    () => buildProjectProcessBridgePreview(valid({affectedKinds:['project','project']})),
    (error) => error instanceof ProjectProcessBridgePreviewError
      && error.code === 'INVALID_PROJECT_PROCESS_BRIDGE_FIELD',
  );
});
