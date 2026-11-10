/** Types for the retained metadata-only Workspace view-state boundary. */
export const WORKSPACE_VIEW_STATE_FAMILY: 'iwxa.workspace.internal.saved-view';
export function workspaceSavedViewObjectId(viewId: string): string;
export function isWorkspaceViewStateObjectRecord(record: unknown): boolean;
export function isWorkspaceBusinessObjectRecord(record: unknown): boolean;
