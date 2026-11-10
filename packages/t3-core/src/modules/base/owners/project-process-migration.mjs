import { projectProcessSourceBinding } from './project-process-source-contract.mjs';

export class ProjectProcessMigrationError extends Error {
  constructor(message, code = 'PROJECT_PROCESS_MIGRATION_ERROR') {
    super(message);
    this.name = 'ProjectProcessMigrationError';
    this.code = code;
  }
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ProjectProcessMigrationError(
      `${label} must be a non-empty string`,
      'INVALID_PROJECT_PROCESS_MIGRATION_FIELD',
    );
  }
  return value.trim();
}

function normalizeObjects(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new ProjectProcessMigrationError(
      'objects must be a non-empty array',
      'INVALID_PROJECT_PROCESS_MIGRATION_FIELD',
    );
  }
  const keys=new Set();
  return Object.freeze(values.map((value,index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ProjectProcessMigrationError(
        `objects[${index}] must be an object`,
        'INVALID_PROJECT_PROCESS_MIGRATION_FIELD',
      );
    }
    const kind=requireText(value.kind, `objects[${index}].kind`);
    const binding=projectProcessSourceBinding(kind);
    const sourceRecordId=requireText(value.sourceRecordId, `objects[${index}].sourceRecordId`);
    const targetObjectId=requireText(value.targetObjectId, `objects[${index}].targetObjectId`);
    const key=`${binding.family}/${targetObjectId}`;
    if(keys.has(key)){
      throw new ProjectProcessMigrationError(
        `duplicate migration target ${key}`,
        'DUPLICATE_PROJECT_PROCESS_MIGRATION_TARGET',
      );
    }
    keys.add(key);
    return Object.freeze({
      kind,
      family:binding.family,
      schema:binding.schema,
      sourceRecordId,
      targetObjectId,
    });
  }));
}

export function createProjectProcessMigrationPreview(input) {
  const bridge=input?.bridgePreview;
  if(!bridge || bridge.schema !== 'IWXA_T2_C3_PROJECT_PROCESS_BRIDGE_PREVIEW_V1'
    || bridge.d1State !== 'SPEC_CONTROLLED_PREVIEW'
    || bridge.runtimeChange !== false
    || bridge.persisted !== false){
    throw new ProjectProcessMigrationError(
      'controlled non-runtime-changing Bridge/D1 preview is required',
      'PROJECT_PROCESS_BRIDGE_D1_REQUIRED',
    );
  }

  const objects=normalizeObjects(input?.objects);
  const bridgeFamilies=new Set(bridge.expectedAffectedSet);
  for(const item of objects){
    if(!bridgeFamilies.has(item.family)){
      throw new ProjectProcessMigrationError(
        `${item.family} is outside Bridge expected affected set`,
        'PROJECT_PROCESS_MIGRATION_OUTSIDE_BRIDGE_SCOPE',
      );
    }
  }

  return Object.freeze({
    schema:'IWXA_T2_C3_PROJECT_PROCESS_MIGRATION_PREVIEW_V1',
    state:'PREVIEW_READY',
    migrationId:requireText(input?.migrationId, 'migrationId'),
    workspaceId:requireText(input?.workspaceId, 'workspaceId'),
    bridgeId:bridge.bridgeId,
    predecessorSnapshotRef:requireText(input?.predecessorSnapshotRef, 'predecessorSnapshotRef'),
    objects,
    runtimeChange:false,
    persisted:false,
    predecessorPreserved:true,
    predecessorArchiveAllowed:false,
    commitAuthorized:false,
    recoveryProven:false,
  });
}

export function planProjectProcessMigrationCommit(preview, input) {
  if(!preview || preview.schema !== 'IWXA_T2_C3_PROJECT_PROCESS_MIGRATION_PREVIEW_V1'
    || preview.state !== 'PREVIEW_READY'
    || preview.predecessorPreserved !== true){
    throw new ProjectProcessMigrationError(
      'valid PREVIEW_READY migration is required',
      'PROJECT_PROCESS_MIGRATION_PREVIEW_REQUIRED',
    );
  }
  return Object.freeze({
    schema:'IWXA_T2_C3_PROJECT_PROCESS_MIGRATION_COMMIT_PLAN_V1',
    state:'COMMIT_PLANNED_NOT_EXECUTED',
    migrationId:preview.migrationId,
    commitId:requireText(input?.commitId, 'commitId'),
    workspaceId:preview.workspaceId,
    bridgeId:preview.bridgeId,
    predecessorSnapshotRef:preview.predecessorSnapshotRef,
    objects:preview.objects,
    runtimeChange:false,
    persisted:false,
    predecessorPreserved:true,
    predecessorArchiveAllowed:false,
    commitAuthorized:false,
    recoveryProven:false,
  });
}

export function recordProjectProcessMigrationCommit(plan, input) {
  if(!plan || plan.schema !== 'IWXA_T2_C3_PROJECT_PROCESS_MIGRATION_COMMIT_PLAN_V1'
    || plan.state !== 'COMMIT_PLANNED_NOT_EXECUTED'){
    throw new ProjectProcessMigrationError(
      'valid commit plan is required',
      'PROJECT_PROCESS_MIGRATION_COMMIT_PLAN_REQUIRED',
    );
  }
  const committedRecordRefs=input?.committedRecordRefs;
  if(!Array.isArray(committedRecordRefs) || committedRecordRefs.length !== plan.objects.length){
    throw new ProjectProcessMigrationError(
      'committedRecordRefs must match the preview object count',
      'PROJECT_PROCESS_MIGRATION_COMMIT_RECEIPT_MISMATCH',
    );
  }
  return Object.freeze({
    schema:'IWXA_T2_C3_PROJECT_PROCESS_MIGRATION_COMMIT_RECEIPT_V1',
    state:'COMMITTED_RECOVERY_REQUIRED',
    migrationId:plan.migrationId,
    commitId:plan.commitId,
    workspaceId:plan.workspaceId,
    bridgeId:plan.bridgeId,
    predecessorSnapshotRef:plan.predecessorSnapshotRef,
    commitReceiptRef:requireText(input?.commitReceiptRef, 'commitReceiptRef'),
    committedRecordRefs:Object.freeze(
      committedRecordRefs.map((value,index) => requireText(value, `committedRecordRefs[${index}]`)),
    ),
    predecessorPreserved:true,
    predecessorArchiveAllowed:false,
    recoveryProven:false,
  });
}

export function recordProjectProcessMigrationRecovery(commitReceipt, input) {
  if(!commitReceipt || commitReceipt.schema !== 'IWXA_T2_C3_PROJECT_PROCESS_MIGRATION_COMMIT_RECEIPT_V1'
    || commitReceipt.state !== 'COMMITTED_RECOVERY_REQUIRED'
    || commitReceipt.predecessorArchiveAllowed !== false){
    throw new ProjectProcessMigrationError(
      'committed migration awaiting recovery is required',
      'PROJECT_PROCESS_MIGRATION_COMMIT_REQUIRED',
    );
  }
  const rollbackPolicy=requireText(input?.rollbackPolicy, 'rollbackPolicy');
  if(rollbackPolicy !== 'rollback' && rollbackPolicy !== 'forward-fix'){
    throw new ProjectProcessMigrationError(
      'rollbackPolicy must be rollback or forward-fix',
      'INVALID_PROJECT_PROCESS_ROLLBACK_POLICY',
    );
  }
  return Object.freeze({
    schema:'IWXA_T2_C3_PROJECT_PROCESS_MIGRATION_RECOVERY_RECEIPT_V1',
    state:'RECOVERY_PROVEN',
    migrationId:commitReceipt.migrationId,
    commitId:commitReceipt.commitId,
    workspaceId:commitReceipt.workspaceId,
    bridgeId:commitReceipt.bridgeId,
    predecessorSnapshotRef:commitReceipt.predecessorSnapshotRef,
    commitReceiptRef:commitReceipt.commitReceiptRef,
    recoveryProofRef:requireText(input?.recoveryProofRef, 'recoveryProofRef'),
    rollbackPolicy,
    predecessorPreserved:true,
    predecessorArchiveAllowed:true,
    recoveryProven:true,
  });
}
