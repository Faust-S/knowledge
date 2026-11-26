/**
 * Presentation adapter for the original Project/Process template preview.
 * A method draft is transient user input, not a source record, Task, Graph
 * or new persistence owner. Only the existing owner may materialize it.
 */
import { normalizeProject, normalizeWork, assertProjectMethodologyWork, previewProjectTemplate } from '../project-process/project-process.mjs';
import { captureWorkspaceViewPresentation, restoreWorkspaceViewPresentation, parseWorkspaceViewPresentation, projectWorkspaceCanvasMaterials } from './workspace-persisted-view-state.mjs';

export const WORKSPACE_METHOD_MAX_STEPS = 64;
const SAFE_ID = /^[A-Za-z0-9_-]{1,63}$/u;
const ACTORS = new Set(['human', 'agent', 'program']);

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function text(value, field, max, required = true) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)
      || (required && !value.trim())) fail('METHOD_FIELD_INVALID', field);
  return value.trim();
}

function id(value, field) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) fail('METHOD_ID_INVALID', field);
  return value;
}

function unique(values, field, max) {
  if (!Array.isArray(values) || values.length > max || new Set(values).size !== values.length) {
    fail('METHOD_SELECTION_INVALID', field);
  }
  return values;
}

function methodId(prefix) {
  const crypto = globalThis.crypto;
  if (typeof crypto?.getRandomValues !== 'function') fail('METHOD_ID_UNAVAILABLE', 'WebCrypto is unavailable');
  return prefix + Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
}

export function createWorkspaceMethodDraft({ allocate = methodId } = {}) {
  return {
    templateId: id(allocate('method-'), 'templateId'),
    templateRevision: 'draft',
    projectId: id(allocate('project-'), 'projectId'),
    name: '',
    objective: '',
    domainApplicability: ['generic'],
    materials: [],
    steps: [{ id: 'step-1', name: '', actor: 'human', instruction: '', dependsOn: [], materialIds: [] }],
  };
}

export function captureWorkspaceMethodMaterials({ workspaceId, objects, selectedObjectIds }) {
  const view = captureWorkspaceViewPresentation({ workspaceId, objects, mode: 'browse',
    selectedObjectIds, detailObjectId: null });
  return view?.selected ?? Object.freeze([]);
}

/** Dependency layers are a structural preview of a manually designed method,
 * NOT a schedule, readiness decision, executable graph or execution authority.
 * This initial authoring surface supports only finish-to-start prerequisites.
 */
function dependencyLayers(steps) {
  const remaining = new Map(steps.map(step => [step.id, step.dependsOn.length]));
  const outgoing = new Map(steps.map(step => [step.id, []]));
  for (const step of steps) for (const before of step.dependsOn) outgoing.get(before).push(step.id);
  let frontier = steps.filter(step => remaining.get(step.id) === 0).map(step => step.id);
  const waves = [];
  let count = 0;
  while (frontier.length) {
    waves.push(Object.freeze(frontier));
    count += frontier.length;
    const next = new Set();
    for (const before of frontier) for (const after of outgoing.get(before)) {
      remaining.set(after, remaining.get(after) - 1);
      if (remaining.get(after) === 0) next.add(after);
    }
    frontier = steps.filter(step => next.has(step.id)).map(step => step.id);
  }
  if (count !== steps.length) fail('METHOD_DEPENDENCY_CYCLE', 'The method has cyclic prerequisites');
  return Object.freeze(waves);
}

// Structural validation is independent from current material availability.
// A changed source must not prevent explaining which declared stages depend on it.
function normalizeMethodStructure({ workspaceId, draft }) {
  if (typeof workspaceId !== 'string' || !workspaceId || workspaceId !== workspaceId.trim()) fail('METHOD_FIELD_INVALID', 'workspaceId');
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) fail('METHOD_FIELD_INVALID', 'draft');
  const templateId = id(draft.templateId, 'templateId');
  const templateRevision = text(draft.templateRevision, 'templateRevision', 120);
  const projectId = id(draft.projectId, 'projectId');
  const name = text(draft.name, 'name', 240);
  const objective = text(draft.objective, 'objective', 4000);
  const domainApplicability = unique(draft.domainApplicability, 'domainApplicability', 32)
    .map(value => text(value, 'domainApplicability', 120));
  const project = { workspaceId, projectId, name, status: 'planned', domainApplicability,
    templateRef: { templateId, templateRevision } };
  normalizeProject(project);
  const materialView = parseWorkspaceViewPresentation({ version: 1, mode: 'browse', selected: draft.materials, detail: null });
  if (!materialView) fail('METHOD_SELECTION_INVALID', 'materials');
  const pins = materialView.selected;
  const pinById = new Map(pins.map(pin => [pin.object_id, pin]));
  if (!Array.isArray(draft.steps) || !draft.steps.length || draft.steps.length > WORKSPACE_METHOD_MAX_STEPS) {
    fail('METHOD_STEP_LIMIT', 'A method needs between 1 and 64 stages');
  }
  const steps = draft.steps.map(step => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) fail('METHOD_FIELD_INVALID', 'step');
    const stepId = id(step.id, 'step.id');
    if (!ACTORS.has(step.actor)) fail('METHOD_ACTOR_INVALID', stepId);
    const dependsOn = unique(step.dependsOn, 'dependsOn', WORKSPACE_METHOD_MAX_STEPS).map(value => id(value, 'dependsOn'));
    const materialIds = unique(step.materialIds, 'materialIds', 256);
    if (materialIds.some(value => !pinById.has(value))) fail('METHOD_MATERIAL_UNBOUND', stepId);
    return { id: stepId, name: text(step.name, 'step.name', 240), actor: step.actor,
      instruction: text(step.instruction, 'step.instruction', 8000, false), dependsOn, materialIds };
  });
  const stepIds = new Set(steps.map(step => step.id));
  if (stepIds.size !== steps.length) fail('METHOD_DUPLICATE_STEP', 'Duplicate stage identity');
  for (const step of steps) {
    if (step.dependsOn.some(before => before === step.id || !stepIds.has(before))) {
      fail('METHOD_DEPENDENCY_INVALID', step.id);
    }
  }
  const waves = dependencyLayers(steps);
  const workIdFor = stepId => projectId + '.' + stepId;
  const work = steps.map(step => ({
    workspaceId, projectId, workId: workIdFor(step.id), name: step.name, status: 'planned',
    dependencies: step.dependsOn.map(before => ({ predecessorWorkId: workIdFor(before),
      relation: 'finish-to-start', lagNanoseconds: '0' })),
    schedule: {},
  }));
  for (const item of work) normalizeWork(item);
  return { templateId, templateRevision, project, work, objective, pins, pinById, steps, waves, workIdFor, materialView };
}

/** Current revision information comes from the original admitted catalog.
 * Only references are returned, never the data payload or authorization.
 */
export function inspectWorkspaceMethodMaterials({ workspaceId, objects, materials }) {
  const parsed = parseWorkspaceViewPresentation({ version: 1, mode: 'browse', selected: materials, detail: null });
  if (!parsed) fail('METHOD_SELECTION_INVALID', 'materials');
  const current = projectWorkspaceCanvasMaterials({ workspaceId, objects,
    selectedObjectIds: parsed.selected.map(pin => pin.object_id) });
  if (current.status !== 'READY') fail('METHOD_SELECTION_INVALID', 'materials');
  const byId = new Map(current.items.map(record => [record.object_id, record]));
  return Object.freeze(parsed.selected.map(pin => {
    const record = byId.get(pin.object_id);
    return Object.freeze({ object_id: pin.object_id, revision: pin.revision,
      currentRevision: record?.revision ?? null,
      state: !record ? 'UNAVAILABLE' : record.revision === pin.revision ? 'CURRENT' : 'CHANGED' });
  }));
}

/** Explain the impact of changed declared inputs. This is not a proof of
 * result reuse, readiness, completion or execution authority. */
export function analyseWorkspaceMethodMaterialImpact({ workspaceId, objects, draft }) {
  const { steps, waves, pins } = normalizeMethodStructure({ workspaceId, draft });
  const materials = inspectWorkspaceMethodMaterials({ workspaceId, objects, materials: pins });
  const issues = new Set(materials.filter(item => item.state !== 'CURRENT').map(item => item.object_id));
  const assigned = new Set(steps.flatMap(step => step.materialIds));
  const byId = new Map(steps.map(step => [step.id, step]));
  const affected = new Set(), findings = new Map();
  for (const wave of waves) for (const stepId of wave) {
    const step = byId.get(stepId);
    const materialIds = step.materialIds.filter(value => issues.has(value));
    const predecessorIds = step.dependsOn.filter(value => affected.has(value));
    const state = materialIds.length ? 'MATERIAL_REVIEW_REQUIRED'
      : predecessorIds.length ? 'DEPENDENCY_REVIEW_REQUIRED' : 'NO_DECLARED_MATERIAL_CHANGE';
    if (state !== 'NO_DECLARED_MATERIAL_CHANGE') affected.add(stepId);
    findings.set(stepId, Object.freeze({ stepId, state,
      materialIds: Object.freeze(materialIds), predecessorIds: Object.freeze(predecessorIds) }));
  }
  return Object.freeze({ materials, steps: Object.freeze(steps.map(step => findings.get(step.id))),
    unassignedIssues: Object.freeze([...issues].filter(value => !assigned.has(value))),
    requiresReview: issues.size > 0, executionAuthority: false, resultReuseProven: false });
}

/** Prepare the existing, non-authoritative template preview. Inputs are
 * checked by original Project/Work normalizers before being projected.
 * No calls to storage, owner mutation, program invocation or task creation.
 */
export function prepareWorkspaceMethodPreview({ workspaceId, objects, draft }) {
  const { templateId, templateRevision, project, work, objective, pins, pinById, steps, waves, workIdFor, materialView }
    = normalizeMethodStructure({ workspaceId, draft });
  const admitted = restoreWorkspaceViewPresentation({ workspaceId, objects, presentation: materialView });
  if (admitted.changedCount || admitted.unavailableCount) fail('METHOD_MATERIAL_REVIEW_REQUIRED', 'Material revisions require review');
  const preview = previewProjectTemplate({
    workspaceId, template: { templateId, templateRevision, project, work },
    parameters: {
      objective, materialRefs: pins,
      stepIntents: steps.map(step => ({
        stepId: step.id, workId: workIdFor(step.id), intendedActor: step.actor,
        instruction: step.instruction, materialRefs: step.materialIds.map(value => pinById.get(value)),
      })),
    },
  });
  return Object.freeze({ preview, waves });
}

/** Reuse the structure of this author's existing ProjectTemplatePreview.
 * Material and project bindings are deliberately not transferred. The
 * destination is chosen by the caller, never by a preview's workspaceId.
 * Only whitelisted planning fields are copied; no owner writes/imports.
 */
export function reuseWorkspaceMethodPreview({ workspaceId, preview, allocate = methodId }) {
  if (!preview || preview.schema !== 'IWXA_T2_PROJECT_TEMPLATE_PREVIEW_V1'
      || typeof preview.workspaceId !== 'string' || !preview.workspaceId || preview.workspaceId !== preview.workspaceId.trim()
      || preview.persisted !== false || preview.sourceTruth !== false || preview.schemaMutation !== false) {
    fail('METHOD_PREVIEW_INVALID', 'Expected the original non-persisted project template preview');
  }
  const project = preview.projectedProject;
  const work = preview.projectedWork;
  const intents = preview.parameters?.stepIntents;
  if (!project || project.workspaceId !== preview.workspaceId || !Array.isArray(work) || !Array.isArray(intents)
      || work.length < 1 || work.length > WORKSPACE_METHOD_MAX_STEPS || intents.length !== work.length
      || project.templateRef?.templateId !== preview.templateId || project.templateRef?.templateRevision !== preview.templateRevision
      || !Array.isArray(project.domainApplicability)) {
    fail('METHOD_PREVIEW_INVALID', 'The preview is not a compatible method structure');
  }
  const previousProjectId = id(project.projectId, 'projectId');
  const byWork = new Map();
  for (const intent of intents) {
    const stepId = id(intent?.stepId, 'stepId');
    if (intent.workId !== previousProjectId + '.' + stepId || byWork.has(intent.workId)) fail('METHOD_PREVIEW_INVALID', 'Invalid stage identity');
    byWork.set(intent.workId, intent);
  }
  const steps = work.map(item => {
    const intent = byWork.get(item?.workId);
    if (!intent || item.projectId !== previousProjectId || item.workspaceId !== preview.workspaceId
        || item.status !== 'planned' || !Array.isArray(item.dependencies) || item.dependencies.length > WORKSPACE_METHOD_MAX_STEPS
        || !item.schedule || typeof item.schedule !== 'object' || Array.isArray(item.schedule) || Object.keys(item.schedule).length !== 0) {
      fail('METHOD_PREVIEW_INVALID', 'Invalid projected Work');
    }
    return {
      id: intent.stepId, name: item.name, actor: intent.intendedActor, instruction: intent.instruction,
      dependsOn: item.dependencies.map(dep => {
        const before = byWork.get(dep?.predecessorWorkId);
        if (!before || dep.relation !== 'finish-to-start' || dep.lagNanoseconds !== '0') fail('METHOD_PREVIEW_INVALID', 'Unsupported dependency');
        return before.stepId;
      }),
      materialIds: [],
    };
  });
  if (project.status !== 'planned') fail('METHOD_PREVIEW_INVALID', 'Only a planned project may be reused');
  const nextId = id(allocate('project-'), 'projectId');
  if (nextId === previousProjectId) fail('METHOD_ID_INVALID', 'Reused project needs a distinct identity');
  const draft = { templateId: preview.templateId, templateRevision: preview.templateRevision,
    projectId: nextId, name: project.name, objective: preview.parameters?.objective,
    domainApplicability: [...(project.domainApplicability ?? [])], materials: [], steps };
  // Revalidate all copied structure through the same original owner model.
  prepareWorkspaceMethodPreview({ workspaceId, objects: [], draft });
  return draft;
}

/** Prepare the lossless input for the existing Project/Work owners.
 * No write is performed. Each Work must be written only through its
 * original owner, in prerequisite order; the owner activation gate remains.
 * Material refs are planning intentions in the selected workspace, not a
 * claim of canonical-head binding or current access at execution time.
 */
export function prepareWorkspaceMethodSourceInputs({ workspaceId, objects, draft }) {
  const structure = normalizeMethodStructure({workspaceId,draft});
  const admitted = restoreWorkspaceViewPresentation({workspaceId,objects,presentation:structure.materialView});
  if(admitted.changedCount || admitted.unavailableCount) fail('METHOD_MATERIAL_REVIEW_REQUIRED','Material revisions require review');
  const {project,work,steps,pins,pinById,waves,workIdFor,objective}=structure;
  const projectInput=Object.freeze({...project,domainApplicability:Object.freeze([...project.domainApplicability]),
    templateRef:Object.freeze({...project.templateRef}),
    methodology:Object.freeze({version:1,objective,materialRefs:pins,workIds:Object.freeze(work.map(item=>item.workId))})});
  const normalizedProject=normalizeProject(projectInput);
  const workInputs=Object.freeze(work.map((item,index)=>{
    const step=steps[index];
    const input=Object.freeze({...item,dependencies:Object.freeze(item.dependencies.map(dep=>Object.freeze({...dep}))),
      schedule:Object.freeze({}),
      methodology:Object.freeze({version:1,stepId:step.id,intendedActor:step.actor,instruction:step.instruction,
        materialRefs:Object.freeze(step.materialIds.map(value=>pinById.get(value)))})});
    assertProjectMethodologyWork(normalizedProject,normalizeWork(input));
    return input;
  }));
  return Object.freeze({projectInput,workInputs,
    writeOrder:Object.freeze(waves.flatMap(wave=>wave.map(workIdFor))),writeAuthorized:false,executionAuthority:false});
}

/** Reconstruct the editable planning draft from original normalized payloads.
 * This function does not establish source provenance; the caller must use
 * the existing owner and verify exact record references. Historical material
 * pins remain unchanged, so missing/current revisions can be reviewed later.
 * Active work or nonempty schedules are not flattened into a draft.
 */
export function reconstructWorkspaceMethodDraft({workspaceId,project,works}) {
  if(!project || project.schema!=='IWXA_T2_PROJECT_V1' || project.objectKind!=='project'
      || project.sourceTruth!==true || project.workspaceId!==workspaceId || project.status!=='planned'
      || !project.methodology || !Array.isArray(works) || works.length>WORKSPACE_METHOD_MAX_STEPS) {
    fail('METHOD_SOURCE_INCOMPATIBLE','Expected planned original Project/Work payloads');
  }
  const p=normalizeProject(project);
  const byId=new Map();
  for(const value of works){
    if(!value || value.schema!=='IWXA_T2_WORK_V1' || value.objectKind!=='work' || value.sourceTruth!==true
        || value.workspaceId!==workspaceId || value.projectId!==p.projectId || value.status!=='planned'
        || !value.methodology || !value.schedule
        || value.schedule.plannedStart!==null || value.schedule.plannedFinish!==null) {
      fail('METHOD_SOURCE_INCOMPATIBLE','Work cannot be reopened as an unscheduled method draft');
    }
    const item=normalizeWork(value);
    assertProjectMethodologyWork(p,item);
    if(byId.has(item.workId)) fail('METHOD_SOURCE_INCOMPLETE','Duplicate Work');
    byId.set(item.workId,item);
  }
  if(byId.size!==p.methodology.workIds.length || p.methodology.workIds.some(workId=>!byId.has(workId))){
    fail('METHOD_SOURCE_INCOMPLETE','The complete declared method is required');
  }
  const steps=p.methodology.workIds.map(workId=>{
    const item=byId.get(workId);
    return {id:item.methodology.stepId,name:item.name,actor:item.methodology.intendedActor,
      instruction:item.methodology.instruction,materialIds:item.methodology.materialRefs.map(ref=>ref.object_id),
      dependsOn:item.dependencies.map(dep=>byId.get(dep.predecessorWorkId).methodology.stepId)};
  });
  const draft={templateId:p.templateRef.templateId,templateRevision:p.templateRef.templateRevision,projectId:p.projectId,
    name:p.name,objective:p.methodology.objective,domainApplicability:[...p.domainApplicability],
    materials:p.methodology.materialRefs,steps};
  // Reuse the existing structural validation (including cycle detection).
  // Do not use present-day material availability to change an original pin.
  normalizeMethodStructure({workspaceId,draft});
  return draft;
}
