import {
  ProjectProcessSourceOwner,
  ProjectProcessSourceOwnerError,
  isProjectProcessSourceRecord,
  registerProjectProcessSourceOwner,
} from './project-process-source-owner.mjs';

const PROVISIONAL_OWNER_ID = 'iwxa.project-process.owner';
const CANDIDATE_SCHEMA_VERSION = '1.0.0';
const OWNER_ADOPTION_CANDIDATE_EVIDENCE = 't2/current/final-successor/product/C3_PROJECT_PROCESS_OWNER_ADOPTION_CANDIDATE_2026-09-18.json';
const OWNER_APPROVAL_RECEIPT = 't2/current/final-successor/product/approved/C3_PROJECT_PROCESS_OWNER_APPROVAL_RECEIPT_2026-09-18.json';
const GATED_OWNER_IMPLEMENTATION_EVIDENCE = 't2/current/final-successor/product/C3_PROJECT_PROCESS_GATED_OWNER_IMPLEMENTATION_2026-09-18.json';
const BOUNDARY_EVIDENCE = 't2/current/final-successor/product/OWNER_COMMAND_BOUNDARY_EVIDENCE_2026-09-13.json';
const RECOVERY_EVIDENCE = 't2/current/final-successor/product/C3_PROJECT_PROCESS_WRITE_AUTHORITY_RECOVERY_2026-09-17.json';
const AUTHORITY_REBASELINE_EVIDENCE = 't2/current/final-successor/product/C3_T25_020_AUTHORITY_REBASELINE_2026-09-18.json';

const OWNER_ADOPTION_SOURCE_KINDS = new Set([
  'project',
  'work',
  'processDefinition',
  'processRun',
  'case',
  'decision',
  'activity',
  'event',
]);

const SPECS = Object.freeze({
  project: Object.freeze({ family: 'iwxa.project', idField: 'projectId' }),
  work: Object.freeze({ family: 'iwxa.work', idField: 'workId' }),
  processDefinition: Object.freeze({ family: 'iwxa.process.definition', idField: 'definitionId' }),
  processRun: Object.freeze({ family: 'iwxa.process.run', idField: 'runId' }),
  case: Object.freeze({ family: 'iwxa.process.case', idField: 'caseId' }),
  decision: Object.freeze({ family: 'iwxa.process.decision', idField: 'decisionId' }),
  activity: Object.freeze({ family: 'iwxa.process.activity', idField: 'activityId' }),
  event: Object.freeze({ family: 'iwxa.process.event', idField: 'eventId' }),
  result: Object.freeze({ family: 'iwxa.result', idField: 'resultId' }),
  acceptance: Object.freeze({ family: 'iwxa.acceptance', idField: 'acceptanceId' }),
});

export class ProjectProcessOwnerError extends Error {
  constructor(message, code = 'PROJECT_PROCESS_OWNER_ERROR') {
    super(message);
    this.name = 'ProjectProcessOwnerError';
    this.code = code;
  }
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`);
  return value.trim();
}

function specFor(kind) {
  const spec = SPECS[kind];
  if (!spec) throw new ProjectProcessOwnerError(`unsupported project/process kind ${String(kind)}`, 'UNKNOWN_PROJECT_PROCESS_KIND');
  return spec;
}

function candidateCommandsFor(kind) {
  if (!OWNER_ADOPTION_SOURCE_KINDS.has(kind)) return Object.freeze([]);
  return Object.freeze([`${kind}.create`, `${kind}.revise`, `${kind}.release`]);
}

export const PROJECT_PROCESS_OWNER_ADOPTION_CANDIDATE = Object.freeze({
  status: 'APPROVED_BY_OWNER_RECEIPT',
  authorityBound: true,
  writesAuthorized: false,
  ownerId: PROVISIONAL_OWNER_ID,
  schemaVersion: CANDIDATE_SCHEMA_VERSION,
  headKind: 'source',
  logicalAreaId: 'work.project_process',
  sourceBaseline: 'T2.5 0.20.0',
  sourceFamily: 'Project/Process 0.8-0.9',
  capabilities: Object.freeze(['T25-CAP-013', 'T25-CAP-014', 'T25-CAP-015']),
  requirements: Object.freeze([
    'REQ-T25-020-006',
    'REQ-T25-020-007',
    'REQ-T25-020-016',
    'REQ-T25-020-018',
    'REQ-T25-020-029',
  ]),
  evidence: OWNER_ADOPTION_CANDIDATE_EVIDENCE,
  approvalReceipt: OWNER_APPROVAL_RECEIPT,
  kinds: Object.freeze(Object.fromEntries(Object.entries(SPECS).map(([kind, spec]) => [
    kind,
    Object.freeze({
      ...spec,
      candidateOwnerId: PROVISIONAL_OWNER_ID,
      candidateHeadKind: OWNER_ADOPTION_SOURCE_KINDS.has(kind) ? 'source' : null,
      candidateCommands: candidateCommandsFor(kind),
      adoptionStatus: OWNER_ADOPTION_SOURCE_KINDS.has(kind)
        ? 'OWNER_ADOPTED_ACTIVATION_PENDING'
        : kind === 'result'
          ? 'BLOCKED_RESULT_SOURCE_TRUTH_AND_LIFECYCLE_AUTHORITY_REQUIRED'
          : 'BLOCKED_ACCEPTANCE_SOURCE_TRUTH_AUTHORITY_REQUIRED',
    }),
  ]))),
});

function writeActivationPending() {
  return new ProjectProcessOwnerError(
    'Project/Process source owner is adopted, but writes remain disabled until qualification and exact D4 closure',
    'PROJECT_PROCESS_SOURCE_WRITE_ACTIVATION_PENDING',
  );
}

export const PROJECT_PROCESS_WRITE_BOUNDARY = Object.freeze({
  status: 'OWNER_ADOPTED_ACTIVATION_PENDING',
  blocker: 'PROJECT_PROCESS_SOURCE_WRITE_ACTIVATION_PENDING',
  authorityBound: true,
  writesAuthorized: false,
  readModelAvailable: true,
  ownerModuleFound: true,
  authoritativeOwnerModuleFound: true,
  gatedOwnerImplementationFound: true,
  ownerCommandFound: true,
  schemaProducerBindingFound: true,
  ownerId: PROVISIONAL_OWNER_ID,
  evidence: BOUNDARY_EVIDENCE,
  recoveryEvidence: RECOVERY_EVIDENCE,
  authorityRebaselineEvidence: AUTHORITY_REBASELINE_EVIDENCE,
  ownerAdoptionCandidateEvidence: OWNER_ADOPTION_CANDIDATE_EVIDENCE,
  ownerApprovalReceipt: OWNER_APPROVAL_RECEIPT,
  gatedOwnerImplementationEvidence: GATED_OWNER_IMPLEMENTATION_EVIDENCE,
  candidateWritableKinds: Object.freeze([...OWNER_ADOPTION_SOURCE_KINDS]),
  resultAndAcceptanceExcludedFromCandidateWrites: true,
  activationReceiptBound: false,
});

export const PROJECT_PROCESS_OWNER = Object.freeze({
  ownerId: PROVISIONAL_OWNER_ID,
  provisionalOwnerId: PROVISIONAL_OWNER_ID,
  schemaVersion: CANDIDATE_SCHEMA_VERSION,
  headKind: 'source',
  authorityBound: true,
  writesAuthorized: false,
  status: 'OWNER_ADOPTED_ACTIVATION_PENDING',
  blocker: 'PROJECT_PROCESS_SOURCE_WRITE_ACTIVATION_PENDING',
  evidence: BOUNDARY_EVIDENCE,
  recoveryEvidence: RECOVERY_EVIDENCE,
  authorityRebaselineEvidence: AUTHORITY_REBASELINE_EVIDENCE,
  ownerAdoptionCandidateEvidence: OWNER_ADOPTION_CANDIDATE_EVIDENCE,
  ownerApprovalReceipt: OWNER_APPROVAL_RECEIPT,
  gatedOwnerImplementationEvidence: GATED_OWNER_IMPLEMENTATION_EVIDENCE,
  adoptionCandidate: PROJECT_PROCESS_OWNER_ADOPTION_CANDIDATE,
  kinds: Object.freeze(Object.fromEntries(Object.entries(SPECS).map(([kind, spec]) => {
    const adopted=OWNER_ADOPTION_SOURCE_KINDS.has(kind);
    return [kind,Object.freeze({
      ...spec,
      commands: adopted ? candidateCommandsFor(kind) : Object.freeze([]),
      headKind: adopted ? 'source' : null,
      authorityBound: adopted,
      writesAuthorized: false,
      status: adopted
        ? 'OWNER_ADOPTED_ACTIVATION_PENDING'
        : kind === 'result'
          ? 'BLOCKED_RESULT_SOURCE_TRUTH_AND_LIFECYCLE_AUTHORITY_REQUIRED'
          : 'BLOCKED_ACCEPTANCE_SOURCE_TRUTH_AUTHORITY_REQUIRED',
    })];
  }))),
});

export function projectProcessObjectId(kind, workspaceId, objectId) {
  specFor(kind);
  return `${kind}:${encodeURIComponent(requireText(workspaceId, 'workspaceId'))}:${encodeURIComponent(requireText(objectId, 'objectId'))}`;
}

export function registerProjectProcessOwner(gateway, options = {}) {
  try {
    return registerProjectProcessSourceOwner(gateway, options);
  } catch (error) {
    if (error instanceof ProjectProcessSourceOwnerError && error.code === 'PROJECT_PROCESS_SOURCE_WRITE_ACTIVATION_PENDING') {
      throw writeActivationPending();
    }
    throw error;
  }
}

export class ProjectProcessOwner extends ProjectProcessSourceOwner {
  constructor(options) {
    try {
      super(options);
    } catch (error) {
      if (error instanceof ProjectProcessSourceOwnerError
        && error.code === 'PROJECT_PROCESS_SOURCE_WRITE_ACTIVATION_PENDING') {
        throw writeActivationPending();
      }
      throw error;
    }
  }
}

export function isProjectProcessRecord(record) {
  return isProjectProcessSourceRecord(record);
}
