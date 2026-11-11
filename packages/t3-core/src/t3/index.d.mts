import type { KernelFacade, CurrentWorkspaceFacade } from "../workspace-contract";

export interface T3SignedActivityAccess {
  currentContext(): unknown;
  actionFor(operation: string): string | Promise<string>;
  operationDigest(input: unknown): string | Promise<string>;
  authorize(request: unknown): unknown | Promise<unknown>;
  verifyDecisionBinding(request: unknown, decision: unknown): boolean | Promise<boolean>;
}
export interface T3ActivityReadOptions {
  bindings: {
    objects: { schema_id: string; schema_version: string; semantic_kind: string;
      links?: { field: string; relation: string; many?: boolean }[] }[];
    events: { event_type: string; semantic_kind: string }[];
    relations?: { kind: string; relation: string }[];
  };
  workspace_id?: string;
  max_objects?: number;
  max_events?: number;
}
export interface T3ActivityProjection {
  workspace_id: string;
  nodes: unknown[];
  events: unknown[];
  relations: unknown[];
  unresolved: unknown[];
  unmapped: { object_ids: string[]; event_ids: string[]; relation_ids: string[] };
}
export function readActivityFromWorkspaceContext(
  context: { kernel: KernelFacade; currentWorkspace: Pick<CurrentWorkspaceFacade, "get" | "subscribe"> },
  options: T3ActivityReadOptions & { signedAccess?: T3SignedActivityAccess | null },
): Promise<T3ActivityProjection>;

/** The existing signed D1 binding for the original selected T2 Kernel.
 * All requested methods remain implemented by the inherited Runtime 1.3.0. */
export function createSubjectKernelBinding(input: {
  kernel: KernelFacade;
  access: T3SignedActivityAccess;
  clock?: () => number;
}): Pick<KernelFacade,
  "createWorkspace" | "getWorkspace" | "getObject" | "listObjects" |
  "putObject" | "deleteObject" | "putRelation" | "deleteRelation" |
  "listAssets" | "getAsset" | "putAsset" | "deleteAsset" |
  "listEventsSince" | "softDeleteWorkspace" | "restoreWorkspace" |
  "exportPreview" | "exportPackage" | "confirmExport" |
  "importPreview" | "importCommit" | "importCancel" |
  "purgePreview" | "purgeCommit" | "purgeCancel" | "commitObjectGraph">;

/** D5 explicit local-model suggestion. The original selected ModuleContext.kernel
 * performs every write/readback; a model draft never becomes accepted evidence. */
export interface T3LocalInferenceDraftInput {
  expected_workspace_id: string;
  model_id: string;
  engine: string;
  output: string;
}
export interface T3LocalInferenceDraftReceipt {
  workspace_id: string;
  object_id: string;
  revision: number;
  event_id: string;
  status: "DRAFT_UNTRUSTED";
  readback: true;
}
export function saveLocalInferenceDraft(
  context: { kernel: KernelFacade; currentWorkspace: Pick<CurrentWorkspaceFacade, "get" | "subscribe"> },
  input: T3LocalInferenceDraftInput,
): Promise<T3LocalInferenceDraftReceipt>;
export function listLocalInferenceDrafts(
  context: { kernel: KernelFacade; currentWorkspace: Pick<CurrentWorkspaceFacade, "get" | "subscribe"> },
  input: { expected_workspace_id: string },
): Promise<Array<{ workspace_id: string; object_id: string; revision: number;
  status: string; model_id: string; text: string }>>;

/** Add this declared schema to the ORIGINAL service passport before saving.
 * Declaring it does not grant any permission to use the schema. */
export const LOCAL_INFERENCE_DRAFT_SCHEMA: "iwxa.local-inference.draft";
export const LOCAL_INFERENCE_DRAFT_DECLARATION: {
  readonly schema_version: "1.0.0";
  readonly preserve_unknown: false;
  readonly json_schema: Record<string, unknown>;
  readonly embedded: Record<string, never>;
};
