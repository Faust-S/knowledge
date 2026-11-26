export declare const WORKSPACE_VIEW_STATE_COMMANDS: Readonly<{
  save: 'workspace.view-state.save';
  delete: 'workspace.view-state.delete';
}>;

export interface WorkspaceViewObjectRef {
  readonly object_id: string;
  readonly revision: number;
}

export interface WorkspaceViewPresentation {
  readonly version: 1;
  readonly mode: 'browse' | 'queues' | 'compare' | 'receipts';
  readonly selected: readonly WorkspaceViewObjectRef[];
  readonly detail: WorkspaceViewObjectRef | null;
}

export interface WorkspaceViewRestoration {
  readonly mode: WorkspaceViewPresentation['mode'];
  readonly selectedObjectIds: readonly string[];
  readonly detailObjectId: string | null;
  readonly changedCount: number;
  readonly unavailableCount: number;
}

export interface WorkspacePersistedView {
  readonly objectId: string;
  readonly revision: number;
  readonly viewId: string;
  readonly title: string;
  readonly name: string;
  readonly profileId: string;
  readonly logicalAreaId: string | null;
  readonly query: string;
  readonly baseRevision: number;
  readonly persisted: true;
  readonly presentation?: WorkspaceViewPresentation;
  readonly source: 'WORKSPACE_VIEW_STATE_OWNER';
}

export interface WorkspaceCommandsFacadeLike {
  has(commandId: string): boolean;
}

export declare function workspaceViewStateCommandAvailability(
  commandsFacade?: WorkspaceCommandsFacadeLike | null,
): Readonly<{ save: boolean; delete: boolean }>;

export declare function buildPersistedWorkspaceSavedViewId(input: {
  workspaceId: string;
  profileId: string;
  name: string;
}): string;

export interface WorkspaceSavedViewEdit {
  readonly viewId: string;
  readonly baseRevision: number;
}

export interface WorkspaceSavedViewSaveTarget extends WorkspaceSavedViewEdit {
  readonly action: 'CREATE' | 'UPDATE' | 'ALREADY_SAVED';
  readonly name: string;
}

export declare function prepareWorkspacePersistedViewSave(input: {
  workspaceId: string;
  profileId: string;
  name: string;
  logicalAreaId: string | null;
  query: string;
  objects: readonly unknown[];
  edit?: WorkspaceSavedViewEdit | null;
  pendingCreateId?: string | null;
  presentation?: WorkspaceViewPresentation | null;
  allocateId?: () => string;
}): Readonly<WorkspaceSavedViewSaveTarget>;

export declare function workspaceSavedViewDataMatches(actual: unknown, expected: unknown): boolean;

export declare function parseWorkspaceViewPresentation(value: unknown): WorkspaceViewPresentation | null;

export declare function workspaceViewPresentationMatches(actual: unknown, expected: unknown): boolean;

export declare function captureWorkspaceViewPresentation(input: {
  workspaceId: string;
  objects: readonly unknown[];
  mode: WorkspaceViewPresentation['mode'];
  selectedObjectIds: readonly string[];
  detailObjectId: string | null;
}): WorkspaceViewPresentation | null;

export declare function restoreWorkspaceViewPresentation(input: {
  workspaceId: string;
  objects: readonly unknown[];
  presentation?: WorkspaceViewPresentation | null;
}): WorkspaceViewRestoration;

export declare function projectWorkspacePersistedViews(input: {
  workspaceId: string;
  profileId: string;
  objects: readonly unknown[];
}): Readonly<{
  views: readonly WorkspacePersistedView[];
  rejected: number;
}>;
