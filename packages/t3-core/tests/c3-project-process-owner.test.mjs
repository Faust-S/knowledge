import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCanonicalAdapter, OwnerWriteGateway } from '../src/persistence/canonical-persistence.mjs';
import {
  ProjectProcessSemanticError,
  deriveProcessConformance,
  evaluateTemporalDependencies,
  normalizeAcceptance,
  normalizeProcessDefinition,
  normalizeProcessRun,
  normalizeWork,
  previewProjectTemplate,
} from '../src/modules/base/features/project-process/project-process.mjs';
import {
  PROJECT_PROCESS_OWNER,
  PROJECT_PROCESS_WRITE_BOUNDARY,
  ProjectProcessOwner,
  ProjectProcessOwnerError,
  isProjectProcessRecord,
  registerProjectProcessOwner,
} from '../src/modules/base/owners/project-process.mjs';

const WORKSPACE = 'workspace-1';

function project(overrides = {}) {
  return {
    workspaceId: WORKSPACE,
    projectId: 'project-1',
    name: 'Canonical rollout',
    domainApplicability: ['shared', 'operations'],
    ...overrides,
  };
}

function work(overrides = {}) {
  return {
    workspaceId: WORKSPACE,
    workId: 'work-1',
    projectId: 'project-1',
    name: 'Qualify runtime',
    dependencies: [],
    ...overrides,
  };
}

function definition(overrides = {}) {
  return {
    workspaceId: WORKSPACE,
    definitionId: 'definition-1',
    versionId: 'v1',
    name: 'Qualification flow',
    domainApplicability: ['shared'],
    activityIds: ['inspect', 'qualify'],
    ...overrides,
  };
}

function run(overrides = {}) {
  return {
    workspaceId: WORKSPACE,
    runId: 'run-1',
    definitionId: 'definition-1',
    projectId: 'project-1',
    workId: 'work-1',
    status: 'running',
    startedAt: '2026-09-15T10:00:00Z',
    ...overrides,
  };
}

test('C3 project template remains a non-persistent preview and cannot mutate schemas', () => {
  const preview = previewProjectTemplate({
    workspaceId: WORKSPACE,
    template: {
      templateId: 'tpl-1',
      templateRevision: 'r7',
      project: { name: 'Generated project' },
      work: [{ name: 'Generated work' }],
    },
    parameters: { region: 'US' },
  });
  assert.equal(preview.persisted, false);
  assert.equal(preview.sourceTruth, false);
  assert.equal(preview.schemaMutation, false);
  assert.equal(preview.templateId, 'tpl-1');
});

test('C3 Work has explicit scheduling/dependencies and temporal dependency reasoning fails closed when evidence is missing', () => {
  const normalized = normalizeWork(work({
    workId: 'work-2',
    dependencies: [{ predecessorWorkId: 'work-1', relation: 'finish-to-start', lagNanoseconds: 1_000_000_000n }],
    schedule: { plannedStart: '2026-09-15T11:00:00Z', plannedFinish: '2026-09-15T12:00:00Z' },
  }));
  assert.equal(normalized.dependencies[0].relation, 'finish-to-start');

  const allowed = evaluateTemporalDependencies({
    work: normalized,
    predecessorIntervals: { 'work-1': { finishedAt: '2026-09-15T10:59:59Z' } },
    successorInterval: { startedAt: '2026-09-15T11:00:00Z' },
  });
  assert.equal(allowed.derived, true);
  assert.equal(allowed.sourceTruth, false);
  assert.equal(allowed.satisfied, true);

  const unresolved = evaluateTemporalDependencies({ work: normalized, predecessorIntervals: {}, successorInterval: {} });
  assert.equal(unresolved.satisfied, false);
  assert.equal(unresolved.checks[0].unresolved, true);
});

test('C3 ProcessDefinition is distinct from ProcessRun and simulation never becomes operational truth', () => {
  const processDefinition = normalizeProcessDefinition(definition());
  const operational = normalizeProcessRun(run());
  const simulation = normalizeProcessRun(run({ runId: 'sim-1', mode: 'simulation' }));
  assert.equal(processDefinition.objectKind, 'processDefinition');
  assert.equal(operational.objectKind, 'processRun');
  assert.equal(operational.operationalTruth, true);
  assert.equal(simulation.operationalTruth, false);
});

test('C3 provisional Acceptance read semantics stay criteria + evidence and never become scalar scoring', () => {
  const accepted = normalizeAcceptance({
    workspaceId: WORKSPACE,
    acceptanceId: 'accept-1',
    projectId: 'project-1',
    resultId: 'result-1',
    criteria: [
      { criterionId: 'correct', required: true, satisfied: true, evidenceRefs: ['evidence:1'] },
      { criterionId: 'fast', required: false, satisfied: false, evidenceRefs: [] },
    ],
  });
  assert.equal(accepted.acceptanceState, 'ACCEPTED');
  assert.equal(Object.hasOwn(accepted, 'acceptanceScore'), false);

  const failed = normalizeAcceptance({
    workspaceId: WORKSPACE,
    acceptanceId: 'accept-2',
    projectId: 'project-1',
    resultId: 'result-1',
    criteria: [{ criterionId: 'correct', required: true, satisfied: false, evidenceRefs: [] }],
  });
  assert.equal(failed.acceptanceState, 'REJECTED_REQUIRED_CRITERIA');

  const pending = normalizeAcceptance({
    workspaceId: WORKSPACE,
    acceptanceId: 'accept-3',
    projectId: 'project-1',
    resultId: 'result-1',
    criteria: [{ criterionId: 'correct', required: true, satisfied: true, evidenceRefs: [] }],
  });
  assert.equal(pending.acceptanceState, 'PENDING_EVIDENCE');

  assert.throws(
    () => normalizeAcceptance({
      workspaceId: WORKSPACE,
      acceptanceId: 'accept-score',
      projectId: 'project-1',
      resultId: 'result-1',
      acceptanceScore: 0.98,
      criteria: [{ criterionId: 'correct', required: true, satisfied: true, evidenceRefs: ['evidence:1'] }],
    }),
    (error) => error instanceof ProjectProcessSemanticError && error.code === 'FORBIDDEN_ACCEPTANCE_SCORE',
  );
});

test('C3 process conformance is derived projection, never source truth', () => {
  const processDefinition = normalizeProcessDefinition(definition());
  const match = deriveProcessConformance({ definition: processDefinition, observedActivityIds: ['inspect', 'qualify'] });
  assert.equal(match.conformant, true);
  assert.equal(match.derived, true);
  assert.equal(match.sourceTruth, false);

  const drift = deriveProcessConformance({ definition: processDefinition, observedActivityIds: ['qualify', 'inspect', 'extra'] });
  assert.equal(drift.conformant, false);
  assert.deepEqual(drift.unexpectedActivityIds, ['extra']);
  assert.equal(drift.orderConformant, false);
});

test('C3 Project/Process owner is adopted but write activation remains fail closed', () => {
  assert.equal(PROJECT_PROCESS_WRITE_BOUNDARY.status, 'OWNER_ADOPTED_ACTIVATION_PENDING');
  assert.equal(PROJECT_PROCESS_WRITE_BOUNDARY.authorityBound, true);
  assert.equal(PROJECT_PROCESS_WRITE_BOUNDARY.writesAuthorized, false);
  assert.equal(PROJECT_PROCESS_WRITE_BOUNDARY.readModelAvailable, true);
  assert.equal(PROJECT_PROCESS_WRITE_BOUNDARY.ownerModuleFound, true);
  assert.equal(PROJECT_PROCESS_WRITE_BOUNDARY.ownerCommandFound, true);
  assert.equal(PROJECT_PROCESS_WRITE_BOUNDARY.schemaProducerBindingFound, true);
  assert.equal(PROJECT_PROCESS_OWNER.ownerId, 'iwxa.project-process.owner');
  assert.equal(PROJECT_PROCESS_OWNER.writesAuthorized, false);
  assert.equal(PROJECT_PROCESS_OWNER.kinds.project.commands.length, 3);
  assert.equal(PROJECT_PROCESS_OWNER.kinds.result.commands.length, 0);
  assert.equal(PROJECT_PROCESS_OWNER.kinds.acceptance.commands.length, 0);
});

test('C3 adopted owner registration stays closed until exact activation receipt is bound', () => {
  const gateway = new OwnerWriteGateway({ adapter: new MemoryCanonicalAdapter() });
  assert.throws(
    () => registerProjectProcessOwner(gateway),
    (error) => error instanceof ProjectProcessOwnerError && error.code === 'PROJECT_PROCESS_SOURCE_WRITE_ACTIVATION_PENDING',
  );
  for (const kind of Object.values(PROJECT_PROCESS_OWNER.kinds)) {
    assert.equal(gateway.owners.registration(kind.family), null);
  }
});

test('C3 business owner construction fails before activation receipt can authorize persistence', () => {
  const gateway = new OwnerWriteGateway({ adapter: new MemoryCanonicalAdapter() });
  assert.throws(
    () => new ProjectProcessOwner({ gateway }),
    (error) => error instanceof ProjectProcessOwnerError && error.code === 'PROJECT_PROCESS_SOURCE_WRITE_ACTIVATION_PENDING',
  );
  assert.equal(isProjectProcessRecord({ family: 'iwxa.project', ownerId: 'iwxa.project-process.owner' }), true);
  assert.equal(isProjectProcessRecord({ family: 'iwxa.result', ownerId: 'iwxa.project-process.owner' }), false);
});
