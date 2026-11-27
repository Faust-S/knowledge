import { CanonicalInstant, ExactDuration } from '../../../../foundation/time.mjs';

const DEPENDENCY_TYPES = new Set(['finish-to-start', 'start-to-start', 'finish-to-finish', 'start-to-finish']);
const RUN_MODES = new Set(['operational', 'simulation']);

export class ProjectProcessSemanticError extends Error {
  constructor(message, code = 'PROJECT_PROCESS_SEMANTIC_ERROR') {
    super(message);
    this.name = 'ProjectProcessSemanticError';
    this.code = code;
  }
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ProjectProcessSemanticError(`${label} must be a non-empty string`, 'INVALID_PROJECT_PROCESS_FIELD');
  }
  return value.trim();
}

function optionalText(value, label) {
  return value == null ? null : requireText(value, label);
}

function textArray(values, label, { nonEmpty = false } = {}) {
  if (!Array.isArray(values) || (nonEmpty && values.length === 0)) {
    throw new ProjectProcessSemanticError(`${label} must be ${nonEmpty ? 'a non-empty ' : 'an '}array`, 'INVALID_PROJECT_PROCESS_FIELD');
  }
  return values.map((value) => requireText(value, label));
}

function uniqueTexts(values, label, { nonEmpty = false } = {}) {
  if (!Array.isArray(values) || (nonEmpty && values.length === 0)) {
    throw new ProjectProcessSemanticError(`${label} must be ${nonEmpty ? 'a non-empty ' : 'an '}array`, 'INVALID_PROJECT_PROCESS_FIELD');
  }
  const normalized = textArray(values, label, { nonEmpty });
  if (new Set(normalized).size !== normalized.length) {
    throw new ProjectProcessSemanticError(`${label} must not contain duplicates`, 'DUPLICATE_PROJECT_PROCESS_REF');
  }
  return Object.freeze(normalized);
}

function asInstant(value, label, { nullable = false } = {}) {
  if (value == null && nullable) return null;
  try {
    return value instanceof CanonicalInstant ? value : CanonicalInstant.parse(value);
  } catch {
    throw new ProjectProcessSemanticError(`${label} must be a canonical instant`, 'INVALID_PROJECT_PROCESS_TIME');
  }
}

function freezePlain(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezePlain));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freezePlain(item)])));
  }
  return value;
}

function base(kind, workspaceId) {
  return {
    sourceTruth: true,
    objectKind: kind,
    workspaceId: requireText(workspaceId, 'workspaceId'),
  };
}

function normalizeDomainApplicability(values) {
  return uniqueTexts(values, 'domainApplicability', { nonEmpty: true });
}

function normalizeTemplateRef(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object') {
    throw new ProjectProcessSemanticError('templateRef must be an object', 'INVALID_PROJECT_TEMPLATE_REF');
  }
  return Object.freeze({
    templateId: requireText(value.templateId, 'templateRef.templateId'),
    templateRevision: requireText(value.templateRevision, 'templateRef.templateRevision'),
  });
}

function normalizeSchedule(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProjectProcessSemanticError('schedule must be an object', 'INVALID_PROJECT_PROCESS_SCHEDULE');
  }
  const plannedStart = asInstant(value.plannedStart, 'schedule.plannedStart', { nullable: true });
  const plannedFinish = asInstant(value.plannedFinish, 'schedule.plannedFinish', { nullable: true });
  if (plannedStart && plannedFinish && plannedStart.compare(plannedFinish) > 0) {
    throw new ProjectProcessSemanticError('plannedStart must not be after plannedFinish', 'INVALID_PROJECT_PROCESS_SCHEDULE');
  }
  return Object.freeze({ plannedStart, plannedFinish });
}

function normalizeDependencies(values = []) {
  if (!Array.isArray(values)) {
    throw new ProjectProcessSemanticError('dependencies must be an array', 'INVALID_PROJECT_PROCESS_DEPENDENCY');
  }
  const keys = new Set();
  return Object.freeze(values.map((value) => {
    if (!value || typeof value !== 'object') {
      throw new ProjectProcessSemanticError('dependency must be an object', 'INVALID_PROJECT_PROCESS_DEPENDENCY');
    }
    const predecessorWorkId = requireText(value.predecessorWorkId, 'dependency.predecessorWorkId');
    const relation = value.relation ?? 'finish-to-start';
    if (!DEPENDENCY_TYPES.has(relation)) {
      throw new ProjectProcessSemanticError(`unsupported dependency relation ${String(relation)}`, 'INVALID_PROJECT_PROCESS_DEPENDENCY');
    }
    let lagNanoseconds;
    try {
      lagNanoseconds = value.lagNanoseconds == null ? 0n : BigInt(value.lagNanoseconds);
    } catch {
      throw new ProjectProcessSemanticError('dependency.lagNanoseconds must be an integer', 'INVALID_PROJECT_PROCESS_DEPENDENCY');
    }
    const key = JSON.stringify([predecessorWorkId, relation]);
    if (keys.has(key)) {
      throw new ProjectProcessSemanticError(`duplicate dependency ${predecessorWorkId}/${relation}`, 'DUPLICATE_PROJECT_PROCESS_REF');
    }
    keys.add(key);
    return Object.freeze({ predecessorWorkId, relation, lagNanoseconds });
  }));
}

function normalizeIntervalFields({ startedAt, finishedAt }, prefix) {
  const start = asInstant(startedAt, `${prefix}.startedAt`, { nullable: true });
  const finish = asInstant(finishedAt, `${prefix}.finishedAt`, { nullable: true });
  if (start && finish && start.compare(finish) > 0) {
    throw new ProjectProcessSemanticError(`${prefix}.startedAt must not be after finishedAt`, 'INVALID_PROJECT_PROCESS_TIME');
  }
  return Object.freeze({ startedAt: start, finishedAt: finish });
}

// Optional method planning content extends the existing Project/Work source
// records. It is not an assignment, execution permission, result or grant.
// Keep legacy normalized records byte-shape compatible when it is absent.
const METHOD_STAGE_ID = /^[A-Za-z0-9_-]{1,63}$/u;
const METHOD_OBJECT_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const METHOD_ACTORS = new Set(['human', 'agent', 'program']);

function methodError(field) {
  throw new ProjectProcessSemanticError(`invalid methodology ${field}`, 'INVALID_PROJECT_PROCESS_METHODOLOGY');
}

function methodRecord(value, keys, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype
      || Reflect.ownKeys(value).length !== keys.length
      || keys.some(key => !Object.hasOwn(value,key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value'))) {
    methodError(field);
  }
}

function methodText(value, max, field, required=true) {
  if (typeof value !== 'string' || value.length > max
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)
      || (required && !value.trim())) methodError(field);
  return value.trim();
}

function methodDenseArray(value, maximum, field, minimum=0) {
  if (!Array.isArray(value) || value.length > maximum || value.length < minimum
      || Object.keys(value).length !== value.length
      || Array.from({length:value.length},(_,i)=>i).some(i=>!Object.hasOwn(value,i))) methodError(field);
  return value;
}

function methodMaterialRefs(values) {
  const ids = new Set();
  return Object.freeze(methodDenseArray(values,256,'materialRefs').map(ref => {
    methodRecord(ref,['object_id','revision'],'materialRef');
    if (typeof ref.object_id !== 'string' || !METHOD_OBJECT_ID.test(ref.object_id)
        || ref.object_id.startsWith('saved-view:') || !Number.isSafeInteger(ref.revision)
        || ref.revision < 1 || ids.has(ref.object_id)) methodError('materialRef');
    ids.add(ref.object_id);
    return Object.freeze({object_id:ref.object_id,revision:ref.revision});
  }));
}

// Immutable first-Project plan, not current Work state or a new Store.
function methodCreationRecordId(value) {
  if(typeof value!=='string' || !value || value.length>512 || value!==value.trim()
      || /[\u0000-\u001f]/u.test(value)) methodError('creation recordId');
  return value;
}

// Optional immutable origin of an independently created alternative. This
// references original source revisions, never a current-head alias or grant.
function normalizeMethodAlternativeOrigin(value,projectId){
  methodRecord(value,['version','workspaceId','projectId','projectRef','workRefs'],'alternative origin');
  if(value.version!==1||typeof value.workspaceId!=='string'||!value.workspaceId||value.workspaceId.length>128
      ||value.workspaceId.trim()!==value.workspaceId||/[\u0000-\u001f]/u.test(value.workspaceId)
      ||!METHOD_STAGE_ID.test(value.projectId)||value.projectId===projectId)methodError('alternative origin scope');
  const workspace=encodeURIComponent(value.workspaceId),originProject=value.projectId;
  const ids=new Set(),records=new Set();
  const normalizeRef=(ref,kind)=>{
    methodRecord(ref,['family','objectId','recordId','revision'],'alternative origin ref');
    const prefix=kind+':'+workspace+':'+originProject;
    const correctObject=kind==='project'?ref.objectId===prefix
      :typeof ref.objectId==='string'&&ref.objectId.startsWith(prefix+'.')&&METHOD_STAGE_ID.test(ref.objectId.slice(prefix.length+1));
    const recordId=methodCreationRecordId(ref.recordId);
    if(ref.family!=='iwxa.'+kind||!correctObject||!Number.isSafeInteger(ref.revision)||ref.revision<1
        ||ids.has(ref.objectId)||records.has(recordId))methodError('alternative origin identity');
    ids.add(ref.objectId);records.add(recordId);
    return Object.freeze({family:ref.family,objectId:ref.objectId,recordId,revision:ref.revision});
  };
  const projectRef=normalizeRef(value.projectRef,'project');
  const workRefs=methodDenseArray(value.workRefs,64,'alternative origin works',1).map(ref=>normalizeRef(ref,'work'));
  workRefs.sort((a,b)=>a.objectId<b.objectId?-1:a.objectId>b.objectId?1:0);
  return Object.freeze({version:1,workspaceId:value.workspaceId,projectId:originProject,projectRef,workRefs:Object.freeze(workRefs)});
}

function normalizeMethodCreation(value,projectId){
  const keys=['version','projectRecordId','steps'];
  if(value&&Object.hasOwn(value,'origin'))keys.push('origin');
  methodRecord(value,keys,'creation');
  if(value.version!==1) methodError('creation version');
  const projectRecordId=methodCreationRecordId(value.projectRecordId);
  const prefix=projectId+'.';
  const validId=id=>typeof id==='string' && id.startsWith(prefix) && METHOD_STAGE_ID.test(id.slice(prefix.length));
  const ids=new Set(),recordIds=new Set([projectRecordId]);
  const steps=methodDenseArray(value.steps,64,'creation steps',1).map(step=>{
    methodRecord(step,['workId','recordId','name','intendedActor','instruction','materialRefs','predecessorWorkIds'],'creation step');
    const recordId=methodCreationRecordId(step.recordId);
    if(!validId(step.workId) || ids.has(step.workId) || recordIds.has(recordId)
       || !METHOD_ACTORS.has(step.intendedActor)) methodError('creation step identity');
    ids.add(step.workId);recordIds.add(recordId);
    const predecessors=methodDenseArray(step.predecessorWorkIds,63,'creation predecessors');
    if(new Set(predecessors).size!==predecessors.length || predecessors.some(id=>!validId(id)||id===step.workId)) methodError('creation predecessors');
    return Object.freeze({workId:step.workId,recordId,name:methodText(step.name,240,'creation name'),
      intendedActor:step.intendedActor,instruction:methodText(step.instruction,8000,'creation instruction',false),
      materialRefs:methodMaterialRefs(step.materialRefs),predecessorWorkIds:Object.freeze([...predecessors])});
  });
  const pending=new Map(steps.map(step=>[step.workId,step])),visited=new Set();
  for(const step of steps) if(step.predecessorWorkIds.some(id=>!ids.has(id))) methodError('creation predecessor missing');
  while(pending.size){
    let progress=false;
    for(const [id,step] of pending) if(step.predecessorWorkIds.every(dep=>visited.has(dep))){
      pending.delete(id);visited.add(id);progress=true;
    }
    if(!progress) methodError('creation dependency cycle');
  }
  return Object.freeze({version:1,projectRecordId,steps:Object.freeze(steps),
    ...(Object.hasOwn(value,'origin')?{origin:normalizeMethodAlternativeOrigin(value.origin,projectId)}:{})});
}

function normalizeProjectMethodology(value, projectId, templateRef) {
  const keys=['version','objective','materialRefs','workIds'];
  if(value && Object.hasOwn(value,'creation')) keys.push('creation');
  methodRecord(value,keys,'project');
  if (value.version !== 1 || !METHOD_STAGE_ID.test(projectId) || !templateRef) methodError('project version or identity');
  const prefix = projectId + '.';
  const workIds = methodDenseArray(value.workIds,64,'workIds',1).map(workId => {
    if (typeof workId !== 'string' || !workId.startsWith(prefix)
        || !METHOD_STAGE_ID.test(workId.slice(prefix.length))) methodError('workId');
    return workId;
  });
  if (new Set(workIds).size !== workIds.length) methodError('duplicate workId');
  return Object.freeze({version:1,objective:methodText(value.objective,4000,'objective'),
    materialRefs:methodMaterialRefs(value.materialRefs),workIds:Object.freeze(workIds),
    ...(Object.hasOwn(value,'creation')?{creation:normalizeMethodCreation(value.creation,projectId)}:{})});
}

function normalizeWorkMethodology(value, projectId, workId, dependencies) {
  methodRecord(value,['version','stepId','intendedActor','instruction','materialRefs'],'work');
  if (value.version !== 1 || !METHOD_STAGE_ID.test(projectId)
      || typeof value.stepId !== 'string' || !METHOD_STAGE_ID.test(value.stepId)
      || workId !== projectId + '.' + value.stepId || !METHOD_ACTORS.has(value.intendedActor)) methodError('work identity or actor');
  const prefix = projectId + '.';
  if (dependencies.length > 63 || dependencies.some(dep=>dep.predecessorWorkId === workId
      || !dep.predecessorWorkId.startsWith(prefix) || !METHOD_STAGE_ID.test(dep.predecessorWorkId.slice(prefix.length))
      || dep.relation !== 'finish-to-start' || dep.lagNanoseconds !== 0n)) methodError('work dependency');
  return Object.freeze({version:1,stepId:value.stepId,intendedActor:value.intendedActor,
    instruction:methodText(value.instruction,8000,'instruction',false),materialRefs:methodMaterialRefs(value.materialRefs)});
}

/** Check planning scope and the exact declared material revisions of a Work
 * against its Project. Catalog access/existence is an independent owner/Host
 * check; these stored intentions do not grant or prove material access. */
export function assertProjectMethodologyWork(project, work) {
  if (!project?.methodology || !work?.methodology || project.workspaceId !== work.workspaceId
      || project.projectId !== work.projectId || !project.methodology.workIds.includes(work.workId)) methodError('work outside method');
  const pins = new Map(project.methodology.materialRefs.map(ref=>[ref.object_id,ref.revision]));
  if (work.methodology.materialRefs.some(ref=>pins.get(ref.object_id)!==ref.revision)
      || work.dependencies.some(dep=>!project.methodology.workIds.includes(dep.predecessorWorkId))) methodError('work binding');
  return true;
}

// Initial Project binding. Later revisions may retain the historical plan.
export function assertProjectMethodologyCreation(project,recordId){
  const creation=project.methodology?.creation;
  if(!creation)return true;
  const {workIds,materialRefs}=project.methodology;
  const pins=new Map(materialRefs.map(ref=>[ref.object_id,ref.revision]));
  if(creation.origin&&creation.origin.workspaceId!==project.workspaceId)methodError('alternative origin workspace');
  if(project.status!=='planned'||creation.projectRecordId!==recordId||creation.steps.length!==workIds.length
      || creation.steps.some((step,i)=>step.workId!==workIds[i]
        || step.materialRefs.some(ref=>pins.get(ref.object_id)!==ref.revision))) methodError('creation Project binding');
  return true;
}

export function assertProjectMethodologyCreationWork(project,work,recordId){
  const creation=project.methodology?.creation;
  if(!creation)return true;
  assertProjectMethodologyWork(project,work);
  const step=creation.steps.find(item=>item.workId===work.workId),refs=work.methodology.materialRefs;
  if(!step||step.recordId!==recordId||step.name!==work.name||work.status!=='planned'
      || work.schedule.plannedStart!==null||work.schedule.plannedFinish!==null
      || step.intendedActor!==work.methodology.intendedActor||step.instruction!==work.methodology.instruction
      || refs.length!==step.materialRefs.length
      || refs.some((ref,i)=>ref.object_id!==step.materialRefs[i].object_id||ref.revision!==step.materialRefs[i].revision)
      || work.dependencies.length!==step.predecessorWorkIds.length
      || work.dependencies.some((dep,i)=>dep.predecessorWorkId!==step.predecessorWorkIds[i])) methodError('creation Work binding');
  return true;
}

export function normalizeProject(input) {
  const projectId = requireText(input.projectId, 'projectId');
  const templateRef = normalizeTemplateRef(input.templateRef);
  const methodology = Object.hasOwn(input,'methodology')
    ? normalizeProjectMethodology(input.methodology,projectId,templateRef) : undefined;
  return Object.freeze({
    schema: 'IWXA_T2_PROJECT_V1',
    ...base('project', input.workspaceId),
    projectId,
    name: requireText(input.name, 'name'),
    status: requireText(input.status ?? 'planned', 'status'),
    domainApplicability: normalizeDomainApplicability(input.domainApplicability),
    templateRef,
    ...(methodology ? {methodology} : {}),
  });
}

export function normalizeWork(input) {
  const projectId = requireText(input.projectId, 'projectId');
  const workId = requireText(input.workId, 'workId');
  const dependencies = normalizeDependencies(input.dependencies ?? []);
  const methodology = Object.hasOwn(input,'methodology')
    ? normalizeWorkMethodology(input.methodology,projectId,workId,dependencies) : undefined;
  return Object.freeze({
    schema: 'IWXA_T2_WORK_V1',
    ...base('work', input.workspaceId),
    workId,
    projectId,
    name: requireText(input.name, 'name'),
    status: requireText(input.status ?? 'planned', 'status'),
    dependencies,
    schedule: normalizeSchedule(input.schedule ?? {}),
    ...(methodology ? {methodology} : {}),
  });
}

export function normalizeProcessDefinition(input) {
  return Object.freeze({
    schema: 'IWXA_T2_PROCESS_DEFINITION_V1',
    ...base('processDefinition', input.workspaceId),
    definitionId: requireText(input.definitionId, 'definitionId'),
    versionId: requireText(input.versionId, 'versionId'),
    name: requireText(input.name, 'name'),
    domainApplicability: normalizeDomainApplicability(input.domainApplicability),
    activityIds: uniqueTexts(input.activityIds ?? [], 'activityIds'),
  });
}

export function normalizeProcessRun(input) {
  const mode = input.mode ?? 'operational';
  if (!RUN_MODES.has(mode)) {
    throw new ProjectProcessSemanticError('mode must be operational or simulation', 'INVALID_PROCESS_RUN_MODE');
  }
  const interval = normalizeIntervalFields(input, 'processRun');
  return Object.freeze({
    schema: 'IWXA_T2_PROCESS_RUN_V1',
    ...base('processRun', input.workspaceId),
    runId: requireText(input.runId, 'runId'),
    definitionId: requireText(input.definitionId, 'definitionId'),
    projectId: requireText(input.projectId, 'projectId'),
    workId: optionalText(input.workId, 'workId'),
    mode,
    operationalTruth: mode === 'operational',
    status: requireText(input.status ?? 'planned', 'status'),
    ...interval,
  });
}

export function normalizeCase(input) {
  return Object.freeze({
    schema: 'IWXA_T2_PROCESS_CASE_V1',
    ...base('case', input.workspaceId),
    caseId: requireText(input.caseId, 'caseId'),
    projectId: requireText(input.projectId, 'projectId'),
    runId: requireText(input.runId, 'runId'),
    status: requireText(input.status ?? 'open', 'status'),
    subjectRef: optionalText(input.subjectRef, 'subjectRef'),
  });
}

export function normalizeDecision(input) {
  return Object.freeze({
    schema: 'IWXA_T2_PROCESS_DECISION_V1',
    ...base('decision', input.workspaceId),
    decisionId: requireText(input.decisionId, 'decisionId'),
    runId: requireText(input.runId, 'runId'),
    caseId: requireText(input.caseId, 'caseId'),
    decisionType: requireText(input.decisionType, 'decisionType'),
    outcome: freezePlain(input.outcome ?? null),
    evidenceRefs: uniqueTexts(input.evidenceRefs ?? [], 'evidenceRefs', { nonEmpty: true }),
    decidedAt: asInstant(input.decidedAt, 'decidedAt'),
  });
}

export function normalizeActivity(input) {
  const interval = normalizeIntervalFields(input, 'activity');
  return Object.freeze({
    schema: 'IWXA_T2_PROCESS_ACTIVITY_V1',
    ...base('activity', input.workspaceId),
    activityId: requireText(input.activityId, 'activityId'),
    runId: requireText(input.runId, 'runId'),
    caseId: optionalText(input.caseId, 'caseId'),
    definitionActivityId: requireText(input.definitionActivityId, 'definitionActivityId'),
    status: requireText(input.status ?? 'planned', 'status'),
    ...interval,
  });
}

export function normalizeEvent(input) {
  return Object.freeze({
    schema: 'IWXA_T2_PROCESS_EVENT_V1',
    ...base('event', input.workspaceId),
    eventId: requireText(input.eventId, 'eventId'),
    runId: requireText(input.runId, 'runId'),
    caseId: optionalText(input.caseId, 'caseId'),
    activityId: optionalText(input.activityId, 'activityId'),
    eventType: requireText(input.eventType, 'eventType'),
    occurredAt: asInstant(input.occurredAt, 'occurredAt'),
    evidenceRefs: uniqueTexts(input.evidenceRefs ?? [], 'evidenceRefs', { nonEmpty: true }),
  });
}

export function normalizeResult(input) {
  const workId = optionalText(input.workId, 'workId');
  const runId = optionalText(input.runId, 'runId');
  const caseId = optionalText(input.caseId, 'caseId');
  if (!workId && !runId && !caseId) {
    throw new ProjectProcessSemanticError('result must reference Work, ProcessRun, or Case', 'MISSING_RESULT_ORIGIN');
  }
  return Object.freeze({
    schema: 'IWXA_T2_RESULT_V1',
    ...base('result', input.workspaceId),
    sourceTruth: false,
    resultId: requireText(input.resultId, 'resultId'),
    projectId: requireText(input.projectId, 'projectId'),
    workId,
    runId,
    caseId,
    resultType: requireText(input.resultType, 'resultType'),
    value: freezePlain(input.value ?? null),
    evidenceRefs: uniqueTexts(input.evidenceRefs ?? [], 'evidenceRefs', { nonEmpty: true }),
    effectiveAt: asInstant(input.effectiveAt, 'effectiveAt', { nullable: true }),
  });
}

function normalizeCriterion(value) {
  if (!value || typeof value !== 'object') {
    throw new ProjectProcessSemanticError('acceptance criterion must be an object', 'INVALID_ACCEPTANCE_CRITERION');
  }
  if (typeof value.satisfied !== 'boolean') {
    throw new ProjectProcessSemanticError('criterion.satisfied must be boolean', 'INVALID_ACCEPTANCE_CRITERION');
  }
  return Object.freeze({
    criterionId: requireText(value.criterionId, 'criterion.criterionId'),
    required: value.required !== false,
    satisfied: value.satisfied,
    evidenceRefs: uniqueTexts(value.evidenceRefs ?? [], 'criterion.evidenceRefs'),
  });
}

export function normalizeAcceptance(input) {
  if (Object.prototype.hasOwnProperty.call(input, 'acceptanceScore')) {
    throw new ProjectProcessSemanticError('scalar acceptanceScore is forbidden; acceptance is criteria + evidence', 'FORBIDDEN_ACCEPTANCE_SCORE');
  }
  if (!Array.isArray(input.criteria) || input.criteria.length === 0) {
    throw new ProjectProcessSemanticError('criteria must be a non-empty array', 'MISSING_ACCEPTANCE_CRITERIA');
  }
  const criteria = Object.freeze(input.criteria.map(normalizeCriterion));
  const ids = criteria.map((criterion) => criterion.criterionId);
  if (new Set(ids).size !== ids.length) {
    throw new ProjectProcessSemanticError('criterionId values must be unique', 'DUPLICATE_ACCEPTANCE_CRITERION');
  }
  const failedRequiredCriterionIds = Object.freeze(criteria
    .filter((criterion) => criterion.required && !criterion.satisfied)
    .map((criterion) => criterion.criterionId));
  const missingEvidenceCriterionIds = Object.freeze(criteria
    .filter((criterion) => criterion.satisfied && criterion.evidenceRefs.length === 0)
    .map((criterion) => criterion.criterionId));
  const acceptanceState = failedRequiredCriterionIds.length > 0
    ? 'REJECTED_REQUIRED_CRITERIA'
    : missingEvidenceCriterionIds.length > 0
      ? 'PENDING_EVIDENCE'
      : 'ACCEPTED';

  return Object.freeze({
    schema: 'IWXA_T2_ACCEPTANCE_V1',
    ...base('acceptance', input.workspaceId),
    sourceTruth: false,
    derived: true,
    acceptanceId: requireText(input.acceptanceId, 'acceptanceId'),
    projectId: requireText(input.projectId, 'projectId'),
    resultId: requireText(input.resultId, 'resultId'),
    criteria,
    acceptanceState,
    failedRequiredCriterionIds,
    missingEvidenceCriterionIds,
    note: input.note == null ? null : String(input.note),
  });
}

export const PROJECT_PROCESS_NORMALIZERS = Object.freeze({
  project: normalizeProject,
  work: normalizeWork,
  processDefinition: normalizeProcessDefinition,
  processRun: normalizeProcessRun,
  case: normalizeCase,
  decision: normalizeDecision,
  activity: normalizeActivity,
  event: normalizeEvent,
  result: normalizeResult,
  acceptance: normalizeAcceptance,
});

export function previewProjectTemplate({ workspaceId, template, parameters = {} }) {
  if (!template || typeof template !== 'object') {
    throw new ProjectProcessSemanticError('template must be an object', 'INVALID_PROJECT_TEMPLATE');
  }
  return Object.freeze({
    schema: 'IWXA_T2_PROJECT_TEMPLATE_PREVIEW_V1',
    workspaceId: requireText(workspaceId, 'workspaceId'),
    templateId: requireText(template.templateId, 'template.templateId'),
    templateRevision: requireText(template.templateRevision, 'template.templateRevision'),
    persisted: false,
    sourceTruth: false,
    schemaMutation: false,
    projectedProject: freezePlain(template.project ?? {}),
    projectedWork: freezePlain(template.work ?? []),
    parameters: freezePlain(parameters),
  });
}

function intervalPoint(interval, point, label) {
  if (!interval || typeof interval !== 'object') return null;
  return asInstant(interval[point], `${label}.${point}`, { nullable: true });
}

export function evaluateTemporalDependencies({ work, predecessorIntervals = {}, successorInterval = {} }) {
  if (!work || !Array.isArray(work.dependencies)) {
    throw new ProjectProcessSemanticError('normalized work with dependencies is required', 'INVALID_TEMPORAL_DEPENDENCY_INPUT');
  }
  const successorStart = intervalPoint(successorInterval, 'startedAt', 'successorInterval');
  const successorFinish = intervalPoint(successorInterval, 'finishedAt', 'successorInterval');
  const checks = work.dependencies.map((dependency) => {
    const predecessor = predecessorIntervals[dependency.predecessorWorkId] ?? null;
    const predecessorStart = intervalPoint(predecessor, 'startedAt', `predecessorIntervals.${dependency.predecessorWorkId}`);
    const predecessorFinish = intervalPoint(predecessor, 'finishedAt', `predecessorIntervals.${dependency.predecessorWorkId}`);
    let before;
    let after;
    if (dependency.relation === 'finish-to-start') { before = predecessorFinish; after = successorStart; }
    if (dependency.relation === 'start-to-start') { before = predecessorStart; after = successorStart; }
    if (dependency.relation === 'finish-to-finish') { before = predecessorFinish; after = successorFinish; }
    if (dependency.relation === 'start-to-finish') { before = predecessorStart; after = successorFinish; }
    const requiredAfter = before == null ? null : before.add(new ExactDuration(dependency.lagNanoseconds));
    const satisfied = requiredAfter != null && after != null && requiredAfter.compare(after) <= 0;
    return Object.freeze({
      predecessorWorkId: dependency.predecessorWorkId,
      relation: dependency.relation,
      lagNanoseconds: dependency.lagNanoseconds,
      satisfied,
      unresolved: requiredAfter == null || after == null,
    });
  });
  return Object.freeze({
    schema: 'IWXA_T2_TEMPORAL_DEPENDENCY_EVALUATION_V1',
    derived: true,
    sourceTruth: false,
    workId: work.workId,
    satisfied: checks.every((check) => check.satisfied),
    checks: Object.freeze(checks),
  });
}

export function deriveProcessConformance({ definition, observedActivityIds = [] }) {
  if (!definition || definition.objectKind !== 'processDefinition') {
    throw new ProjectProcessSemanticError('normalized ProcessDefinition is required', 'INVALID_PROCESS_CONFORMANCE_INPUT');
  }
  const observed = Object.freeze(textArray(observedActivityIds, 'observedActivityIds'));
  const expected = definition.activityIds;
  const expectedSet = new Set(expected);
  const observedSet = new Set(observed);
  const missingActivityIds = Object.freeze(expected.filter((id) => !observedSet.has(id)));
  const unexpectedActivityIds = Object.freeze(observed.filter((id) => !expectedSet.has(id)));
  const orderConformant = expected.length === observed.length && expected.every((id, index) => observed[index] === id);
  return Object.freeze({
    schema: 'IWXA_T2_PROCESS_CONFORMANCE_V1',
    derived: true,
    sourceTruth: false,
    definitionId: definition.definitionId,
    versionId: definition.versionId,
    conformant: missingActivityIds.length === 0 && unexpectedActivityIds.length === 0 && orderConformant,
    missingActivityIds,
    unexpectedActivityIds,
    orderConformant,
  });
}
