import { createHash } from 'node:crypto';
import {
  PROJECT_PROCESS_NORMALIZERS,
} from '../features/project-process/project-process.mjs';
import {
  MemoryCanonicalAdapter,
  OwnerWriteGateway,
} from '../../../persistence/canonical-persistence.mjs';
import {
  PROJECT_PROCESS_SOURCE_CONTRACT,
  assertProjectProcessSourceRecord,
  projectProcessSourceBinding,
} from './project-process-source-contract.mjs';

const OWNER_ID = 'iwxa.project-process.owner';
const SOURCE_KINDS = Object.freeze([
  'project',
  'work',
  'processDefinition',
  'processRun',
  'case',
  'decision',
  'activity',
  'event',
]);

export const PROJECT_PROCESS_SOURCE_ACTIVATION = Object.freeze({
  status: 'QUALIFICATION_AND_D4_PENDING',
  writesAuthorized: false,
  expectedActivationReceiptSha256: null,
  expectedActivationGateSha256: null,
  qualificationHarnessPersistent: false,
  sourceKinds: SOURCE_KINDS,
  commonResultAcceptanceWrites: 'FORBIDDEN',
});

export class ProjectProcessSourceOwnerError extends Error {
  constructor(message, code = 'PROJECT_PROCESS_SOURCE_OWNER_ERROR') {
    super(message);
    this.name = 'ProjectProcessSourceOwnerError';
    this.code = code;
  }
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ProjectProcessSourceOwnerError(
      `${label} must be a non-empty string`,
      'INVALID_PROJECT_PROCESS_SOURCE_OWNER_FIELD',
    );
  }
  return value.trim();
}

function exactSourceKinds(value) {
  return Array.isArray(value)
    && value.length === SOURCE_KINDS.length
    && SOURCE_KINDS.every((kind,index) => value[index] === kind);
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const keys=Object.keys(value).sort();
  return `{${keys.map((key)=>`${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function requireSha256(value,label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new ProjectProcessSourceOwnerError(
      `${label} must be a lowercase SHA-256 digest`,
      'INVALID_PROJECT_PROCESS_SOURCE_ACTIVATION_RECEIPT_SHA256',
    );
  }
  return value;
}

export function assertProjectProcessSourceActivationConfiguration(
  config = PROJECT_PROCESS_SOURCE_ACTIVATION,
) {
  if (!config || typeof config !== 'object') {
    throw new ProjectProcessSourceOwnerError(
      'Project/Process source activation configuration is required',
      'PROJECT_PROCESS_SOURCE_ACTIVATION_CONFIG_REQUIRED',
    );
  }
  if (!exactSourceKinds(config.sourceKinds)) {
    throw new ProjectProcessSourceOwnerError(
      'Project/Process source activation must remain limited to the eight approved source kinds',
      'PROJECT_PROCESS_SOURCE_ACTIVATION_SCOPE_INVALID',
    );
  }
  if (config.commonResultAcceptanceWrites !== 'FORBIDDEN') {
    throw new ProjectProcessSourceOwnerError(
      'Common Result/Acceptance writes must remain forbidden',
      'PROJECT_PROCESS_SOURCE_COMMON_RESULT_ACCEPTANCE_WRITES_FORBIDDEN',
    );
  }
  if (config.qualificationHarnessPersistent !== false) {
    throw new ProjectProcessSourceOwnerError(
      'Qualification harness must never become persistent activation',
      'PROJECT_PROCESS_SOURCE_QUALIFICATION_HARNESS_PERSISTENCE_FORBIDDEN',
    );
  }
  if (config.writesAuthorized === false) {
    if (config.status !== 'QUALIFICATION_AND_D4_PENDING'
      || config.expectedActivationReceiptSha256 !== null
      || config.expectedActivationGateSha256 !== null) {
      throw new ProjectProcessSourceOwnerError(
        'Pending Project/Process activation must not carry an activation receipt SHA',
        'PROJECT_PROCESS_SOURCE_PENDING_ACTIVATION_CONFIG_INVALID',
      );
    }
    return true;
  }
  if (config.writesAuthorized === true) {
    if (config.status !== 'ACTIVATED_EXACT_RECEIPT_BOUND'
      || typeof config.expectedActivationReceiptSha256 !== 'string'
      || !/^[0-9a-f]{64}$/.test(config.expectedActivationReceiptSha256)
      || typeof config.expectedActivationGateSha256 !== 'string'
      || !/^[0-9a-f]{64}$/.test(config.expectedActivationGateSha256)) {
      throw new ProjectProcessSourceOwnerError(
        'Activated Project/Process source writes require exact lowercase activation receipt and activation gate SHA-256 identities',
        'PROJECT_PROCESS_SOURCE_ACTIVE_ACTIVATION_CONFIG_INVALID',
      );
    }
    return true;
  }
  throw new ProjectProcessSourceOwnerError(
    'writesAuthorized must be an explicit boolean',
    'PROJECT_PROCESS_SOURCE_ACTIVATION_BOOLEAN_REQUIRED',
  );
}

function commandsFor(kind) {
  projectProcessSourceBinding(kind);
  return Object.freeze({
    create: `${kind}.create`,
    revise: `${kind}.revise`,
    release: `${kind}.release`,
  });
}

export function assertProjectProcessSourceActivationReceipt(
  activationReceipt,
  config = PROJECT_PROCESS_SOURCE_ACTIVATION,
) {
  assertProjectProcessSourceActivationConfiguration(config);
  if (!config.writesAuthorized || config.expectedActivationReceiptSha256 == null) {
    throw new ProjectProcessSourceOwnerError(
      'Project/Process source owner is adopted but write activation remains pending qualification and exact D4 closure',
      'PROJECT_PROCESS_SOURCE_WRITE_ACTIVATION_PENDING',
    );
  }
  if (!activationReceipt || typeof activationReceipt !== 'object') {
    throw new ProjectProcessSourceOwnerError(
      'full current Project/Process activation receipt is required',
      'PROJECT_PROCESS_SOURCE_ACTIVATION_RECEIPT_REQUIRED',
    );
  }
  if (activationReceipt.schema !== 'IWXA_T2_C3_PROJECT_PROCESS_CURRENT_ACTIVATION_RECEIPT_V1'
    || activationReceipt.status !== 'AUTHORIZED_FOR_EXACT_OWNER_GATE_BINDING'
    || activationReceipt.historicalRecoveryRequired !== false
    || activationReceipt.ownerId !== OWNER_ID) {
    throw new ProjectProcessSourceOwnerError(
      'Project/Process activation receipt identity is invalid',
      'PROJECT_PROCESS_SOURCE_ACTIVATION_RECEIPT_INVALID',
    );
  }
  if (!exactSourceKinds(activationReceipt.sourceFamilies)) {
    throw new ProjectProcessSourceOwnerError(
      'Project/Process activation receipt source scope must be exactly the eight approved kinds',
      'PROJECT_PROCESS_SOURCE_ACTIVATION_RECEIPT_SCOPE_INVALID',
    );
  }
  if (activationReceipt.bindingEffect?.writesAuthorizedNow !== false
    || activationReceipt.bindingEffect?.qualificationHarnessPersistent !== false
    || activationReceipt.bindingEffect?.commonResultAcceptanceWrites !== 'FORBIDDEN') {
    throw new ProjectProcessSourceOwnerError(
      'Project/Process activation receipt must preserve pre-binding non-effects',
      'PROJECT_PROCESS_SOURCE_ACTIVATION_RECEIPT_EFFECT_INVALID',
    );
  }
  for (const [field,label] of [
    ['ownerAdoptionApprovalSha256','owner adoption approval'],
    ['d4PreflightSha256','D4 preflight'],
    ['d4SubjectSha256','D4 subject'],
    ['productGraphSha256','Product Graph'],
    ['kernelSourceSha256','Kernel source'],
    ['workspaceSha256','Workspace'],
    ['c3QualificationReceiptSha256','current C3 qualification'],
    ['r11ClosureSha256','R11 closure'],
    ['runtimeAcceptanceReceiptSha256','runtime acceptance'],
    ['d4EvidenceSha256','D4 evidence'],
    ['releaseZipSha256','release ZIP'],
  ]) requireSha256(activationReceipt[field],label);

  const declaredReceiptSha256=requireSha256(activationReceipt.receiptSha256,'activation receipt');
  const body={...activationReceipt};
  delete body.receiptSha256;
  const recomputedReceiptSha256=createHash('sha256').update(stableJson(body)).digest('hex');
  if (declaredReceiptSha256 !== recomputedReceiptSha256) {
    throw new ProjectProcessSourceOwnerError(
      'Project/Process activation receipt self-hash mismatch',
      'PROJECT_PROCESS_SOURCE_ACTIVATION_RECEIPT_SELF_HASH_MISMATCH',
    );
  }
  if (declaredReceiptSha256 !== config.expectedActivationReceiptSha256) {
    throw new ProjectProcessSourceOwnerError(
      'Project/Process activation receipt does not match the exact canonical binding',
      'PROJECT_PROCESS_SOURCE_ACTIVATION_RECEIPT_MISMATCH',
    );
  }
  return declaredReceiptSha256;
}

function registerApprovedFamilies(gateway) {
  if (!gateway || typeof gateway.registerOwner !== 'function' || !gateway.owners) {
    throw new TypeError('OwnerWriteGateway-compatible gateway is required');
  }
  const registrations={};
  for(const kind of SOURCE_KINDS){
    const binding=projectProcessSourceBinding(kind);
    const commands=commandsFor(kind);
    const commandList=[commands.create,commands.revise,commands.release];
    const existing=gateway.owners.registration(binding.family);
    if(existing){
      const compatible=existing.ownerId === OWNER_ID
        && existing.headKind === 'source'
        && existing.commands.length === commandList.length
        && commandList.every((command) => existing.commands.includes(command));
      if(!compatible){
        throw new ProjectProcessSourceOwnerError(
          `incompatible owner registration for ${binding.family}`,
          'INCOMPATIBLE_PROJECT_PROCESS_SOURCE_OWNER',
        );
      }
      registrations[kind]=existing;
      continue;
    }
    registrations[kind]=gateway.registerOwner({
      family:binding.family,
      ownerId:OWNER_ID,
      commands:commandList,
      headKind:'source',
    });
  }
  return Object.freeze(registrations);
}

function relationSpecs(kind, payload) {
  const relations=[];
  const add=(relation,targetKind,targetId) => {
    if(targetId != null){
      relations.push(Object.freeze({relation,targetKind,targetId}));
    }
  };
  if(kind === 'work') add('project','project',payload.projectId);
  if(kind === 'processRun'){
    add('definition','processDefinition',payload.definitionId);
    add('project','project',payload.projectId);
    add('work','work',payload.workId);
  }
  if(kind === 'case'){
    add('project','project',payload.projectId);
    add('run','processRun',payload.runId);
  }
  if(kind === 'decision'){
    add('run','processRun',payload.runId);
    add('case','case',payload.caseId);
  }
  if(kind === 'activity'){
    add('run','processRun',payload.runId);
    add('case','case',payload.caseId);
  }
  if(kind === 'event'){
    add('run','processRun',payload.runId);
    add('case','case',payload.caseId);
    add('activity','activity',payload.activityId);
  }
  return Object.freeze(relations);
}

function normalizeSource(kind, input) {
  projectProcessSourceBinding(kind);
  const normalizer=PROJECT_PROCESS_NORMALIZERS[kind];
  if(typeof normalizer !== 'function'){
    throw new ProjectProcessSourceOwnerError(
      `no source normalizer for ${kind}`,
      'UNKNOWN_PROJECT_PROCESS_SOURCE_KIND',
    );
  }
  const payload=normalizer(input);
  assertProjectProcessSourceRecord(kind,payload,{ownerId:OWNER_ID});
  return payload;
}

class ProjectProcessSourceOwnerCore {
  #gateway;

  constructor(gateway) {
    this.#gateway=gateway;
  }

  async create(kind,{recordId,knowledgeAt,...input}) {
    const payload=normalizeSource(kind,input);
    const binding=projectProcessSourceBinding(kind);
    const commands=commandsFor(kind);
    const refs=await this.#resolveRefs(kind,payload);
    return this.#gateway.execute({
      ownerId:OWNER_ID,
      commandId:commands.create,
      family:binding.family,
      objectId:projectProcessSourceObjectId(kind,payload.workspaceId,payload[binding.idField]),
      recordId:requireText(recordId,'recordId'),
      expectedRevisionId:null,
      knowledgeAt,
      payload,
      refs,
      operation:'upsert',
    });
  }

  async revise(kind,{recordId,baseRevisionId,knowledgeAt,...input}) {
    const payload=normalizeSource(kind,input);
    const binding=projectProcessSourceBinding(kind);
    const commands=commandsFor(kind);
    const refs=await this.#resolveRefs(kind,payload);
    return this.#gateway.execute({
      ownerId:OWNER_ID,
      commandId:commands.revise,
      family:binding.family,
      objectId:projectProcessSourceObjectId(kind,payload.workspaceId,payload[binding.idField]),
      recordId:requireText(recordId,'recordId'),
      expectedRevisionId:requireText(baseRevisionId,'baseRevisionId'),
      knowledgeAt,
      payload,
      refs,
      operation:'upsert',
    });
  }

  async release(kind,{workspaceId,objectId,recordId,baseRevisionId,knowledgeAt}) {
    const binding=projectProcessSourceBinding(kind);
    const commands=commandsFor(kind);
    return this.#gateway.execute({
      ownerId:OWNER_ID,
      commandId:commands.release,
      family:binding.family,
      objectId:projectProcessSourceObjectId(kind,workspaceId,objectId),
      recordId:requireText(recordId,'recordId'),
      expectedRevisionId:requireText(baseRevisionId,'baseRevisionId'),
      knowledgeAt,
      payload:null,
      refs:Object.freeze({workspaceId:requireText(workspaceId,'workspaceId')}),
      operation:'tombstone',
    });
  }

  async load(kind,workspaceId,objectId) {
    const binding=projectProcessSourceBinding(kind);
    const canonicalObjectId=projectProcessSourceObjectId(kind,workspaceId,objectId);
    const head=await this.#gateway.head(binding.family,canonicalObjectId);
    if(!head) return null;
    const record=await this.#gateway.record(head.recordId);
    if(!record || record.operation === 'tombstone') return null;
    return Object.freeze({
      objectId:canonicalObjectId,
      baseRevisionId:record.recordId,
      revision:record.revision,
      knowledgeAt:record.knowledgeAt,
      value:record.payload,
      refs:record.refs,
    });
  }

  async history(kind,workspaceId,objectId) {
    const binding=projectProcessSourceBinding(kind);
    return this.#gateway.history(
      binding.family,
      projectProcessSourceObjectId(kind,workspaceId,objectId),
    );
  }

  async audit() {
    return this.#gateway.audit();
  }

  async #resolveRefs(kind,payload) {
    const canonicalHeads={};
    for(const relation of relationSpecs(kind,payload)){
      const targetBinding=projectProcessSourceBinding(relation.targetKind);
      const objectId=projectProcessSourceObjectId(
        relation.targetKind,
        payload.workspaceId,
        relation.targetId,
      );
      const head=await this.#gateway.head(targetBinding.family,objectId);
      if(!head || head.headKind !== 'source' || head.ownerId !== OWNER_ID){
        throw new ProjectProcessSourceOwnerError(
          `missing owner-scoped source head for ${relation.relation}: ${relation.targetKind}/${relation.targetId}`,
          'MISSING_PROJECT_PROCESS_RELATION_HEAD',
        );
      }
      canonicalHeads[relation.relation]=Object.freeze({
        family:targetBinding.family,
        objectId,
        recordId:head.recordId,
      });
    }
    return Object.freeze({
      workspaceId:payload.workspaceId,
      canonicalHeads:Object.freeze(canonicalHeads),
    });
  }
}

export function projectProcessSourceObjectId(kind,workspaceId,objectId) {
  projectProcessSourceBinding(kind);
  return `${kind}:${encodeURIComponent(requireText(workspaceId,'workspaceId'))}:${encodeURIComponent(requireText(objectId,'objectId'))}`;
}

export function projectProcessSourceActivationGateStatus({
  activationReceipt,
  config = PROJECT_PROCESS_SOURCE_ACTIVATION,
} = {}) {
  const activationReceiptSha256=assertProjectProcessSourceActivationReceipt(activationReceipt,config);
  const gate={
    schema:'IWXA_T2_C3_PROJECT_PROCESS_SOURCE_ACTIVATION_GATE_V1',
    status:'ACTIVATED_EXACT_RECEIPT_BOUND',
    writesAuthorized:true,
    expectedActivationReceiptSha256:activationReceiptSha256,
    qualificationHarnessPersistent:false,
    sourceKinds:SOURCE_KINDS,
    commonResultAcceptanceWrites:'FORBIDDEN',
  };
  const gateSha256=createHash('sha256').update(stableJson(gate)).digest('hex');
  if (gateSha256 !== config.expectedActivationGateSha256) {
    throw new ProjectProcessSourceOwnerError(
      'Project/Process activation gate does not match the exact canonical gate binding',
      'PROJECT_PROCESS_SOURCE_ACTIVATION_GATE_MISMATCH',
    );
  }
  return Object.freeze({...gate,gateSha256});
}

export function registerProjectProcessSourceOwner(gateway,{activationReceipt}={}) {
  projectProcessSourceActivationGateStatus({activationReceipt});
  return registerApprovedFamilies(gateway);
}

export class ProjectProcessSourceOwner {
  #core;

  constructor({gateway,activationReceipt}) {
    registerProjectProcessSourceOwner(gateway,{activationReceipt});
    this.#core=new ProjectProcessSourceOwnerCore(gateway);
  }

  async create(kind,input) { return this.#core.create(kind,input); }
  async revise(kind,input) { return this.#core.revise(kind,input); }
  async release(kind,input) { return this.#core.release(kind,input); }
  async load(kind,workspaceId,objectId) { return this.#core.load(kind,workspaceId,objectId); }
  async history(kind,workspaceId,objectId) { return this.#core.history(kind,workspaceId,objectId); }
  async audit() { return this.#core.audit(); }
}

export async function createProjectProcessSourceOwnerQualificationHarness({
  gateway = new OwnerWriteGateway({adapter:new MemoryCanonicalAdapter()}),
} = {}) {
  registerApprovedFamilies(gateway);
  await gateway.initialize();
  const owner=new ProjectProcessSourceOwnerCore(gateway);
  return Object.freeze({
    qualificationOnly:true,
    persistent:false,
    owner,
  });
}

export async function createProjectProcessSourceOwnerPostBindingQualificationHarness({
  activationReceipt,
  config,
} = {}) {
  const gate=projectProcessSourceActivationGateStatus({activationReceipt,config});
  const gateway=new OwnerWriteGateway({adapter:new MemoryCanonicalAdapter()});
  registerApprovedFamilies(gateway);
  await gateway.initialize();
  const owner=new ProjectProcessSourceOwnerCore(gateway);
  return Object.freeze({
    qualificationOnly:true,
    postBindingSimulation:true,
    persistent:false,
    gate,
    owner,
  });
}

export function isProjectProcessSourceRecord(record) {
  if(!record || record.ownerId !== OWNER_ID) return false;
  return Object.values(PROJECT_PROCESS_SOURCE_CONTRACT.bindings)
    .some((binding) => binding.family === record.family);
}
