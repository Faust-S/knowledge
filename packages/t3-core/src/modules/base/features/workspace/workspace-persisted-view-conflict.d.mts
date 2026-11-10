export type WorkspacePersistedViewMutationErrorClassification =
  | Readonly<{
      kind: 'REVISION_CONFLICT';
      code: 'CONFLICT' | 'REVISION_CONFLICT';
      refreshRequired: true;
      automaticRetryAllowed: false;
    }>
  | Readonly<{
      kind: 'MUTATION_ERROR';
      code: string | null;
      refreshRequired: false;
      automaticRetryAllowed: false;
    }>;

export declare function classifyWorkspacePersistedViewMutationError(
  error: unknown,
): WorkspacePersistedViewMutationErrorClassification;
