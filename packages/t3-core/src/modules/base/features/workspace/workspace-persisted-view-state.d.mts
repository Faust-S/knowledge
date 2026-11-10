export declare const WORKSPACE_VIEW_STATE_COMMANDS: Readonly<{
  save: 'workspace.view-state.save';
  delete: 'workspace.view-state.delete';
}>;

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

export declare function projectWorkspacePersistedViews(input: {
  workspaceId: string;
  profileId: string;
  objects: readonly unknown[];
}): Readonly<{
  views: readonly WorkspacePersistedView[];
  rejected: number;
}>;
