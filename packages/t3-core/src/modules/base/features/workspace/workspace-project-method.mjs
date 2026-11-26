/**
 * Presentation adapter for the original Project/Process template preview.
 * A method draft is transient user input, not a source record, Task, Graph
 * or new persistence owner. Only the existing owner may materialize it.
 */
import { normalizeProject, normalizeWork, previewProjectTemplate } from '../project-process/project-process.mjs';
import { captureWorkspaceViewPresentation, restoreWorkspaceViewPresentation } from './workspace-persisted-view-state.mjs';

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

/** Prepare the existing, non-authoritative template preview. Inputs are
 * checked by original Project/Work normalizers before being projected.
 * No calls to storage, owner mutation, program invocation or task creation.
 */
export function prepareWorkspaceMethodPreview({ workspaceId, objects, draft }) {
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
  const materialView = { version: 1, mode: 'browse', selected: draft.materials, detail: null };
  const admitted = restoreWorkspaceViewPresentation({ workspaceId, objects, presentation: materialView });
  if (admitted.changedCount || admitted.unavailableCount) fail('METHOD_MATERIAL_REVIEW_REQUIRED', 'Material revisions require review');
  const pins = captureWorkspaceMethodMaterials({ workspaceId, objects, selectedObjectIds: admitted.selectedObjectIds });
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
