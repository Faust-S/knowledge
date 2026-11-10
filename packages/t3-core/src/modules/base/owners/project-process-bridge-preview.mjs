import {
  PROJECT_PROCESS_SOURCE_CONTRACT,
  projectProcessSourceBinding,
} from './project-process-source-contract.mjs';

export class ProjectProcessBridgePreviewError extends Error {
  constructor(message, code = 'PROJECT_PROCESS_BRIDGE_PREVIEW_ERROR') {
    super(message);
    this.name = 'ProjectProcessBridgePreviewError';
    this.code = code;
  }
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ProjectProcessBridgePreviewError(
      `${label} must be a non-empty string`,
      'INVALID_PROJECT_PROCESS_BRIDGE_FIELD',
    );
  }
  return value.trim();
}

function requireStringArray(values, label, { nonEmpty = false } = {}) {
  if (!Array.isArray(values) || (nonEmpty && values.length === 0)) {
    throw new ProjectProcessBridgePreviewError(
      `${label} must be ${nonEmpty ? 'a non-empty ' : 'an '}array`,
      'INVALID_PROJECT_PROCESS_BRIDGE_FIELD',
    );
  }
  const normalized = values.map((value) => requireText(value, label));
  if (new Set(normalized).size !== normalized.length) {
    throw new ProjectProcessBridgePreviewError(
      `${label} must not contain duplicates`,
      'INVALID_PROJECT_PROCESS_BRIDGE_FIELD',
    );
  }
  return Object.freeze(normalized);
}

function normalizeAffectedKinds(kinds) {
  const normalized=requireStringArray(kinds, 'affectedKinds', { nonEmpty:true });
  for(const kind of normalized) projectProcessSourceBinding(kind);
  return normalized;
}

export function buildProjectProcessBridgePreview(input) {
  const affectedKinds=normalizeAffectedKinds(input?.affectedKinds);
  const semanticSourceIds=requireStringArray(input?.semanticSourceIds, 'semanticSourceIds', { nonEmpty:true });
  const boundedRequirements=requireStringArray(input?.boundedRequirements, 'boundedRequirements', { nonEmpty:true });
  const conflicts=requireStringArray(input?.conflicts ?? [], 'conflicts');
  const openQuestions=requireStringArray(input?.openQuestions ?? [], 'openQuestions');

  const bindings=Object.freeze(affectedKinds.map((kind) => {
    const binding=projectProcessSourceBinding(kind);
    return Object.freeze({
      kind,
      family:binding.family,
      schema:binding.schema,
      idField:binding.idField,
      ownerId:PROJECT_PROCESS_SOURCE_CONTRACT.ownerId,
    });
  }));

  return Object.freeze({
    schema:'IWXA_T2_C3_PROJECT_PROCESS_BRIDGE_PREVIEW_V1',
    bridgeId:requireText(input?.bridgeId, 'bridgeId'),
    logicalAreaId:'work.project_process',
    runtimeChange:false,
    persisted:false,
    sourceTruth:false,
    d1State:'SPEC_CONTROLLED_PREVIEW',
    ownerId:PROJECT_PROCESS_SOURCE_CONTRACT.ownerId,
    affectedKinds,
    bindings,
    semanticSourceIds,
    changeSpecRef:requireText(input?.changeSpecRef, 'changeSpecRef'),
    behavioralSpecRef:requireText(input?.behavioralSpecRef, 'behavioralSpecRef'),
    strongContractRef:requireText(input?.strongContractRef, 'strongContractRef'),
    harnessOracleRef:requireText(input?.harnessOracleRef, 'harnessOracleRef'),
    boundedRequirements,
    conflicts,
    openQuestions,
    adoptionTopologyDeltaRef:requireText(input?.adoptionTopologyDeltaRef, 'adoptionTopologyDeltaRef'),
    sourceBaselineEligibility:Boolean(input?.sourceBaselineEligibility),
    expectedAffectedSet:Object.freeze(bindings.map((binding) => binding.family)),
  });
}
