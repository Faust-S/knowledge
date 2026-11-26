export type WorkspaceMethodActor = 'human' | 'agent' | 'program';

export interface WorkspaceMethodMaterial {
  readonly object_id: string;
  readonly revision: number;
}

export interface WorkspaceMethodStep {
  id: string;
  name: string;
  actor: WorkspaceMethodActor;
  instruction: string;
  dependsOn: string[];
  materialIds: string[];
}

export interface WorkspaceMethodDraft {
  templateId: string;
  templateRevision: string;
  projectId: string;
  name: string;
  objective: string;
  domainApplicability: string[];
  materials: readonly WorkspaceMethodMaterial[];
  steps: WorkspaceMethodStep[];
}

export interface WorkspaceMethodPreview {
  readonly schema: 'IWXA_T2_PROJECT_TEMPLATE_PREVIEW_V1';
  readonly workspaceId: string;
  readonly templateId: string;
  readonly templateRevision: string;
  readonly persisted: false;
  readonly sourceTruth: false;
  readonly schemaMutation: false;
  readonly projectedProject: Readonly<{
    workspaceId: string;
    projectId: string;
    name: string;
    status: 'planned';
    domainApplicability: readonly string[];
    templateRef: Readonly<{templateId: string; templateRevision: string}>;
  }>;
  readonly projectedWork: readonly Readonly<{
    workspaceId: string;
    projectId: string;
    workId: string;
    name: string;
    status: 'planned';
    dependencies: readonly Readonly<{predecessorWorkId: string; relation: 'finish-to-start'; lagNanoseconds: '0'}>[];
    schedule: Readonly<Record<string, never>>;
  }>[];
  readonly parameters: Readonly<{
    objective: string;
    materialRefs: readonly WorkspaceMethodMaterial[];
    stepIntents: readonly Readonly<{
      stepId: string; workId: string; intendedActor: WorkspaceMethodActor;
      instruction: string; materialRefs: readonly WorkspaceMethodMaterial[];
    }>[];
  }>;
}

export const WORKSPACE_METHOD_MAX_STEPS: 64;
export function createWorkspaceMethodDraft(options?: { allocate?: (prefix: string) => string }): WorkspaceMethodDraft;
export function captureWorkspaceMethodMaterials(input: {
  workspaceId: string; objects: readonly unknown[]; selectedObjectIds: readonly string[];
}): readonly WorkspaceMethodMaterial[];
export function prepareWorkspaceMethodPreview(input: {
  workspaceId: string; objects: readonly unknown[]; draft: WorkspaceMethodDraft;
}): Readonly<{ preview: WorkspaceMethodPreview; waves: readonly (readonly string[])[] }>;
export function reuseWorkspaceMethodPreview(input: {
  workspaceId: string; preview: unknown; allocate?: (prefix: string) => string;
}): WorkspaceMethodDraft;
