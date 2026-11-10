import type { ObjectRecord } from '../../../../kernel-client/contracts/runtime-1.2.0';

export const RICH_WORKSPACE_WINDOW_SIZE: 12;

export interface RichWorkspaceWindow<T> {
  readonly items: readonly T[];
  readonly offset: number;
  readonly size: number;
  readonly total: number;
  readonly start: number;
  readonly end: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
}

export function buildRichWorkspaceWindow<T>(
  items: readonly T[],
  requestedOffset: number,
  requestedSize?: number,
): RichWorkspaceWindow<T>;

export interface RichWorkspaceQueue {
  readonly id: string;
  readonly schemaId: string;
  readonly objectIds: readonly string[];
  readonly objectCount: number;
  readonly readOnly: true;
  readonly groupingAuthority: 'DERIVED_LOGICAL_ONLY';
}

export function buildRichWorkspaceQueues(input: {
  workspaceId: string;
  objects: readonly ObjectRecord[];
}): readonly RichWorkspaceQueue[];

export type RichWorkspaceComparePreview =
  | {
      readonly status: 'INCOMPLETE_SELECTION' | 'SELECTION_NOT_IN_CANONICAL_SET';
      readonly requiredSelectionCount: 2;
      readonly selectedCount: number;
      readonly items: readonly [];
    }
  | {
      readonly status: 'READY';
      readonly requiredSelectionCount: 2;
      readonly selectedCount: 2;
      readonly items: readonly {
        readonly objectId: string;
        readonly schemaId: string;
        readonly workspaceId: string;
        readonly revision: number;
      }[];
    };

export function buildRichWorkspaceComparePreview(input: {
  workspaceId: string;
  objects: readonly ObjectRecord[];
  selectedObjectIds: readonly string[];
}): RichWorkspaceComparePreview;

export const RICH_WORKSPACE_RECEIPTS_BOUNDARY: Readonly<{
  status: 'UNAVAILABLE_NO_GLOBAL_RECEIPT_INDEX';
  failClosed: true;
  globalReceiptIndexAvailable: false;
  reason: 'GLOBAL_RECEIPT_SUPPORT_NOT_DECLARED_BY_CURRENT_CANONICAL_RUNTIME';
}>;
