import { projectProcessSourceBinding } from './project-process-source-contract.mjs';
import { normalizeProject } from '../features/project-process/project-process.mjs';

export class ProjectProcessHistoryError extends Error {
  constructor(message, code = 'PROJECT_PROCESS_HISTORY_ERROR') {
    super(message);
    this.name = 'ProjectProcessHistoryError';
    this.code = code;
  }
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ProjectProcessHistoryError(
      `${label} must be a non-empty string`,
      'INVALID_PROJECT_PROCESS_HISTORY_FIELD',
    );
  }
  return value.trim();
}

function recordKey(record) {
  return `${record.family}/${record.objectId}`;
}

export function qualifyProjectProcessSameWorkspaceHistory({
  workspaceId,
  records,
  requireReferencedHeads = true,
}) {
  const expectedWorkspaceId=requireText(workspaceId,'workspaceId');
  if(!Array.isArray(records) || records.length === 0){
    throw new ProjectProcessHistoryError(
      'records must be a non-empty array',
      'INVALID_PROJECT_PROCESS_HISTORY_FIELD',
    );
  }

  const byObject=new Map();
  const recordIds=new Set();
  const recordsById=new Map();

  for(const [index,record] of records.entries()){
    if(!record || typeof record !== 'object' || Array.isArray(record)){
      throw new ProjectProcessHistoryError(
        `records[${index}] must be an object`,
        'INVALID_PROJECT_PROCESS_HISTORY_FIELD',
      );
    }
    const family=requireText(record.family,`records[${index}].family`);
    requireText(record.objectId,`records[${index}].objectId`);
    const recordId=requireText(record.recordId,`records[${index}].recordId`);
    if(recordIds.has(recordId)){
      throw new ProjectProcessHistoryError(
        `duplicate recordId ${recordId}`,
        'DUPLICATE_PROJECT_PROCESS_HISTORY_RECORD',
      );
    }
    recordIds.add(recordId);
    recordsById.set(recordId,record);

    const kind=Object.keys({
      project:1,work:1,processDefinition:1,processRun:1,case:1,decision:1,activity:1,event:1,
    }).find((candidate) => projectProcessSourceBinding(candidate).family === family);
    if(!kind){
      throw new ProjectProcessHistoryError(
        `family ${family} is outside approved Project/Process source scope`,
        'PROJECT_PROCESS_HISTORY_FAMILY_OUTSIDE_SCOPE',
      );
    }
    const binding=projectProcessSourceBinding(kind);
    if(record.ownerId !== 'iwxa.project-process.owner' || record.headKind !== 'source'){
      throw new ProjectProcessHistoryError(
        `record ${recordId} is not an owner-scoped source revision`,
        'PROJECT_PROCESS_HISTORY_OWNER_MISMATCH',
      );
    }
    if(record.refs?.workspaceId !== expectedWorkspaceId){
      throw new ProjectProcessHistoryError(
        `record ${recordId} crosses Workspace identity`,
        'PROJECT_PROCESS_HISTORY_WORKSPACE_MISMATCH',
      );
    }
    if(record.operation === 'tombstone'){
      if(record.payload !== null){
        throw new ProjectProcessHistoryError(
          `tombstone ${recordId} must have null payload`,
          'PROJECT_PROCESS_HISTORY_SCHEMA_MISMATCH',
        );
      }
    } else if(record.payload?.workspaceId !== expectedWorkspaceId){
      throw new ProjectProcessHistoryError(
        `record ${recordId} payload crosses Workspace identity`,
        'PROJECT_PROCESS_HISTORY_WORKSPACE_MISMATCH',
      );
    } else if(record.payload?.schema !== binding.schema || record.payload?.objectKind !== kind){
      throw new ProjectProcessHistoryError(
        `record ${recordId} violates producer/schema binding`,
        'PROJECT_PROCESS_HISTORY_SCHEMA_MISMATCH',
      );
    }
    const key=recordKey(record);
    const list=byObject.get(key) ?? [];
    list.push(record);
    byObject.set(key,list);
  }

  for(const [key,list] of byObject.entries()){
    list.sort((left,right) => left.revision-right.revision);
    let previous=null;
    for(const record of list){
      if(!Number.isInteger(record.revision) || record.revision < 1){
        throw new ProjectProcessHistoryError(
          `invalid revision for ${record.recordId}`,
          'PROJECT_PROCESS_HISTORY_REVISION_MISMATCH',
        );
      }
      if(previous === null){
        if(record.revision !== 1 || record.previousRevisionId !== null){
          throw new ProjectProcessHistoryError(
            `history ${key} does not start at revision 1`,
            'PROJECT_PROCESS_HISTORY_REVISION_MISMATCH',
          );
        }
      } else if(record.revision !== previous.revision + 1 || record.previousRevisionId !== previous.recordId){
        throw new ProjectProcessHistoryError(
          `history ${key} is not contiguous`,
          'PROJECT_PROCESS_HISTORY_REVISION_MISMATCH',
        );
      }
      previous=record;
    }
  }

  if(requireReferencedHeads){
    for(const record of records){
      // A complete owner-history set must include exact immutable origin
      // revisions as well as the ordinary current-head dependency closure.
      // Explicit historical prefix reads intentionally do not claim closure
      // over all other objects; origin readback is an addressed operation.
      const origin=record.payload?.objectKind==='project'&&record.payload.methodology?.creation?.origin
        ?normalizeProject(record.payload).methodology.creation.origin:null;
      if(origin&&origin.workspaceId!==expectedWorkspaceId){
        throw new ProjectProcessHistoryError('alternative origin crosses Workspace identity','PROJECT_PROCESS_HISTORY_WORKSPACE_MISMATCH');
      }
      const refs=Object.values(record.refs?.canonicalHeads??{}).map(ref=>({ref,origin:false}));
      if(origin)refs.push(...[origin.projectRef,...origin.workRefs].map(ref=>({ref,origin:true})));
      for(const entry of refs){
        const ref=entry.ref;
        const refRecordId=requireText(ref?.recordId,'canonicalHeads.recordId');
        const target=recordsById.get(refRecordId);
        if(!target){
          throw new ProjectProcessHistoryError(
            `referenced source head ${refRecordId} is absent from qualified history set`,
            'PROJECT_PROCESS_HISTORY_REFERENCED_HEAD_MISSING',
          );
        }
        if(ref.family!==target.family || ref.objectId!==target.objectId
            || (entry.origin&&ref.revision!==target.revision)
            || target.operation==='tombstone' || target.payload?.sourceTruth!==true){
          throw new ProjectProcessHistoryError(
            `referenced revision ${refRecordId} does not match a live source identity`,
            'PROJECT_PROCESS_HISTORY_REFERENCED_HEAD_MISMATCH',
          );
        }
      }
    }
  }

  return Object.freeze({
    schema:'IWXA_T2_C3_PROJECT_PROCESS_SAME_WORKSPACE_HISTORY_QUALIFICATION_V1',
    status:'PASS',
    sourceTruth:false,
    workspaceId:expectedWorkspaceId,
    ownerId:'iwxa.project-process.owner',
    recordCount:records.length,
    objectCount:byObject.size,
    families:Object.freeze([...new Set(records.map((record) => record.family))].sort()),
    referencedHeadsClosed:requireReferencedHeads,
  });
}
