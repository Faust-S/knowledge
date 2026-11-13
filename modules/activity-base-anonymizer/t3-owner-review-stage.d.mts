export const T3_ACTIVITY_OWNER_REVIEW_SCHEMA: string;
export const T3_ACTIVITY_OWNER_REVIEW_DECLARATION: Record<string,unknown>;
export function stageSelectedT3ActivityReview(input: {
  sourceContext: unknown;
  sourceSignedAccess: unknown;
  targetContext: unknown;
  targetSignedAccess: unknown;
  bindings: unknown;
  readActivityFromWorkspaceContext: Function;
  createSubjectKernelBinding: Function;
  explicitSave: boolean;
}): Promise<{
  workspace_id: string; object_id: string; revision: 1;
  event_id: string; status: 'OWNER_REVIEW_DRAFT';
  source_review_status: 'HOLD' | 'STRUCTURE_PRESERVED_REVIEW_REQUIRED';
  readback: true; export_allowed: false;
}>;
