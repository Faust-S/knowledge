const OWNER_ID = 'iwxa.project-process.owner';

const BINDINGS = Object.freeze({
  project: Object.freeze({
    family: 'iwxa.project',
    schema: 'IWXA_T2_PROJECT_V1',
    idField: 'projectId',
  }),
  work: Object.freeze({
    family: 'iwxa.work',
    schema: 'IWXA_T2_WORK_V1',
    idField: 'workId',
  }),
  processDefinition: Object.freeze({
    family: 'iwxa.process.definition',
    schema: 'IWXA_T2_PROCESS_DEFINITION_V1',
    idField: 'definitionId',
  }),
  processRun: Object.freeze({
    family: 'iwxa.process.run',
    schema: 'IWXA_T2_PROCESS_RUN_V1',
    idField: 'runId',
  }),
  case: Object.freeze({
    family: 'iwxa.process.case',
    schema: 'IWXA_T2_PROCESS_CASE_V1',
    idField: 'caseId',
  }),
  decision: Object.freeze({
    family: 'iwxa.process.decision',
    schema: 'IWXA_T2_PROCESS_DECISION_V1',
    idField: 'decisionId',
  }),
  activity: Object.freeze({
    family: 'iwxa.process.activity',
    schema: 'IWXA_T2_PROCESS_ACTIVITY_V1',
    idField: 'activityId',
  }),
  event: Object.freeze({
    family: 'iwxa.process.event',
    schema: 'IWXA_T2_PROCESS_EVENT_V1',
    idField: 'eventId',
  }),
});

export class ProjectProcessSourceContractError extends Error {
  constructor(message, code = 'PROJECT_PROCESS_SOURCE_CONTRACT_ERROR') {
    super(message);
    this.name = 'ProjectProcessSourceContractError';
    this.code = code;
  }
}

export const PROJECT_PROCESS_SOURCE_CONTRACT = Object.freeze({
  status: 'OWNER_ADOPTED_GATED_IMPLEMENTATION_MATERIALIZED',
  ownerId: OWNER_ID,
  logicalAreaId: 'work.project_process',
  writesAuthorized: false,
  activationGates: Object.freeze({
    ownerAdoption: 'PASS',
    producerSchemaConformance: 'MATERIALIZED_PENDING_QUALIFICATION',
    scopedBridgeD1: 'MATERIALIZED_PREVIEW_PENDING_QUALIFICATION',
    migrationRecovery: 'MATERIALIZED_PENDING_QUALIFICATION',
    sameWorkspaceHistory: 'MATERIALIZED_PENDING_QUALIFICATION',
    d4ExactRelease: 'PENDING',
  }),
  bindings: BINDINGS,
  excludedFamilies: Object.freeze({
    result: Object.freeze({
      family: 'iwxa.result',
      reason: 'RESULT_SOURCE_TRUTH_AND_LIFECYCLE_AUTHORITY_REQUIRED',
    }),
    acceptance: Object.freeze({
      family: 'iwxa.acceptance',
      reason: 'GENERIC_ACCEPTANCE_SOURCE_TRUTH_AUTHORITY_REQUIRED',
    }),
  }),
});

export function projectProcessSourceBinding(kind) {
  const binding=BINDINGS[kind];
  if(!binding){
    if(kind === 'result' || kind === 'acceptance'){
      throw new ProjectProcessSourceContractError(
        `${kind} is outside the approved source-family owner adoption scope`,
        'PROJECT_PROCESS_FAMILY_OUTSIDE_APPROVED_SCOPE',
      );
    }
    throw new ProjectProcessSourceContractError(
      `unsupported Project/Process source kind ${String(kind)}`,
      'UNKNOWN_PROJECT_PROCESS_SOURCE_KIND',
    );
  }
  return binding;
}

function requireText(value,label){
  if(typeof value !== 'string' || value.trim() === ''){
    throw new ProjectProcessSourceContractError(
      `${label} must be a non-empty string`,
      'PROJECT_PROCESS_SOURCE_SCHEMA_MISMATCH',
    );
  }
  return value.trim();
}

export function assertProjectProcessSourceRecord(kind, record, { ownerId = OWNER_ID } = {}) {
  const binding=projectProcessSourceBinding(kind);
  if(ownerId !== OWNER_ID){
    throw new ProjectProcessSourceContractError(
      `owner ${String(ownerId)} does not own ${binding.family}`,
      'PROJECT_PROCESS_SOURCE_OWNER_MISMATCH',
    );
  }
  if(!record || typeof record !== 'object' || Array.isArray(record)){
    throw new ProjectProcessSourceContractError(
      'normalized source record must be an object',
      'PROJECT_PROCESS_SOURCE_SCHEMA_MISMATCH',
    );
  }
  if(record.schema !== binding.schema || record.objectKind !== kind){
    throw new ProjectProcessSourceContractError(
      `normalized ${kind} record does not match ${binding.schema}`,
      'PROJECT_PROCESS_SOURCE_SCHEMA_MISMATCH',
    );
  }
  if(record.sourceTruth !== true){
    throw new ProjectProcessSourceContractError(
      `${kind} source-family record must remain source truth`,
      'PROJECT_PROCESS_SOURCE_TRUTH_REQUIRED',
    );
  }
  const objectId=requireText(record[binding.idField], binding.idField);
  const workspaceId=requireText(record.workspaceId, 'workspaceId');
  return Object.freeze({
    ownerId: OWNER_ID,
    kind,
    family: binding.family,
    schema: binding.schema,
    idField: binding.idField,
    objectId,
    workspaceId,
    commands: Object.freeze({
      create: `${kind}.create`,
      revise: `${kind}.revise`,
      release: `${kind}.release`,
    }),
  });
}
