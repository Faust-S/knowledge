import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeActivity,
  normalizeCase,
  normalizeDecision,
  normalizeEvent,
  normalizeProcessDefinition,
  normalizeProcessRun,
  normalizeProject,
  normalizeWork,
} from '../src/modules/base/features/project-process/project-process.mjs';
import {
  PROJECT_PROCESS_SOURCE_CONTRACT,
  ProjectProcessSourceContractError,
  assertProjectProcessSourceRecord,
  projectProcessSourceBinding,
} from '../src/modules/base/owners/project-process-source-contract.mjs';

const fixtures = {
  project: () => normalizeProject({
    workspaceId:'ws-1', projectId:'p-1', name:'Project', domainApplicability:['shared'],
  }),
  work: () => normalizeWork({
    workspaceId:'ws-1', workId:'w-1', projectId:'p-1', name:'Work',
  }),
  processDefinition: () => normalizeProcessDefinition({
    workspaceId:'ws-1', definitionId:'pd-1', versionId:'v1', name:'Definition',
    domainApplicability:['shared'], activityIds:['a-def-1'],
  }),
  processRun: () => normalizeProcessRun({
    workspaceId:'ws-1', runId:'pr-1', definitionId:'pd-1', projectId:'p-1',
  }),
  case: () => normalizeCase({
    workspaceId:'ws-1', caseId:'c-1', projectId:'p-1', runId:'pr-1',
  }),
  decision: () => normalizeDecision({
    workspaceId:'ws-1', decisionId:'d-1', runId:'pr-1', caseId:'c-1',
    decisionType:'gate', outcome:{pass:true}, evidenceRefs:['e-1'],
    decidedAt:'2026-09-18T00:00:00Z',
  }),
  activity: () => normalizeActivity({
    workspaceId:'ws-1', activityId:'a-1', runId:'pr-1',
    definitionActivityId:'a-def-1',
  }),
  event: () => normalizeEvent({
    workspaceId:'ws-1', eventId:'ev-1', runId:'pr-1',
    eventType:'observed', occurredAt:'2026-09-18T00:00:00Z',
    evidenceRefs:['e-1'],
  }),
};

test('approved C3 source contract covers exactly eight owner-scoped source families', () => {
  assert.equal(PROJECT_PROCESS_SOURCE_CONTRACT.ownerId, 'iwxa.project-process.owner');
  assert.equal(PROJECT_PROCESS_SOURCE_CONTRACT.writesAuthorized, false);
  assert.equal(PROJECT_PROCESS_SOURCE_CONTRACT.activationGates.ownerAdoption, 'PASS');
  assert.equal(
    PROJECT_PROCESS_SOURCE_CONTRACT.activationGates.producerSchemaConformance,
    'MATERIALIZED_PENDING_QUALIFICATION',
  );
  assert.deepEqual(Object.keys(PROJECT_PROCESS_SOURCE_CONTRACT.bindings), Object.keys(fixtures));
});

test('every approved family is bound to its canonical normalized schema and command namespace', () => {
  for(const [kind,makeRecord] of Object.entries(fixtures)){
    const binding=projectProcessSourceBinding(kind);
    const asserted=assertProjectProcessSourceRecord(kind, makeRecord());
    assert.equal(asserted.kind, kind);
    assert.equal(asserted.family, binding.family);
    assert.equal(asserted.schema, binding.schema);
    assert.equal(asserted.ownerId, 'iwxa.project-process.owner');
    assert.deepEqual(asserted.commands, {
      create:`${kind}.create`,
      revise:`${kind}.revise`,
      release:`${kind}.release`,
    });
  }
});

test('Result and Acceptance stay outside the approved writable source-family contract', () => {
  for(const kind of ['result','acceptance']){
    assert.throws(
      () => projectProcessSourceBinding(kind),
      (error) => error instanceof ProjectProcessSourceContractError
        && error.code === 'PROJECT_PROCESS_FAMILY_OUTSIDE_APPROVED_SCOPE',
    );
  }
});

test('source contract rejects owner, schema and source-truth drift fail closed', () => {
  const project=fixtures.project();
  assert.throws(
    () => assertProjectProcessSourceRecord('project', project, {ownerId:'workspace'}),
    (error) => error?.code === 'PROJECT_PROCESS_SOURCE_OWNER_MISMATCH',
  );
  assert.throws(
    () => assertProjectProcessSourceRecord('project', {...project, schema:'WRONG'}),
    (error) => error?.code === 'PROJECT_PROCESS_SOURCE_SCHEMA_MISMATCH',
  );
  assert.throws(
    () => assertProjectProcessSourceRecord('project', {...project, sourceTruth:false}),
    (error) => error?.code === 'PROJECT_PROCESS_SOURCE_TRUTH_REQUIRED',
  );
});
