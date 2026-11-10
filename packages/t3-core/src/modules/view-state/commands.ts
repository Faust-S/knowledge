import type {
  CommandContribution,
  WorkspaceModuleContext,
} from "@/workspace-contract";
import type { CommitResult, OperationId } from "@/kernel-client/contracts/runtime-1.3.0";
import { isSafeOpaqueId } from "@/shell/routing";
import { MODULE_ID } from "./module-id";
import {
  WORKSPACE_SAVED_VIEW_SCHEMA_ID,
  WORKSPACE_SAVED_VIEW_SCHEMA_VERSION,
  savedViewObjectId,
  validateWorkspaceSavedViewData,
  type WorkspaceSavedViewData,
} from "./schema";

export const SAVE_WORKSPACE_VIEW_COMMAND_ID = "workspace.view-state.save" as const;
export const DELETE_WORKSPACE_VIEW_COMMAND_ID = "workspace.view-state.delete" as const;

export interface SaveWorkspaceViewArgs {
  workspaceId: string;
  viewId: string;
  name: string;
  profileId: string;
  logicalAreaId: string | null;
  query: string;
  baseRevision?: number;
}

export interface DeleteWorkspaceViewArgs {
  workspaceId: string;
  viewId: string;
  baseRevision: number;
}

function requireObject(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("VIEW_STATE_INVALID_ARGS");
  }
  return args as Record<string, unknown>;
}

function requireSafeId(value: unknown, field: string): string {
  if (typeof value !== "string" || !isSafeOpaqueId(value)) {
    throw new Error(`VIEW_STATE_INVALID_${field.toUpperCase()}`);
  }
  return value;
}

function optionalRevision(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error("VIEW_STATE_INVALID_BASE_REVISION");
  }
  return value as number;
}

function requiredRevision(value: unknown): number {
  const revision = optionalRevision(value);
  if (revision === undefined) throw new Error("VIEW_STATE_BASE_REVISION_REQUIRED");
  return revision;
}

function requireCommitReceipt(
  receipt: CommitResult,
  expected: {
    workspaceId: string;
    objectId: string;
    baseRevision: number;
    schemaId?: string;
    schemaVersion?: string;
    viewId?: string;
  },
): void {
  if (!receipt || typeof receipt !== "object" || typeof receipt.deduplicated !== "boolean") {
    throw new Error("VIEW_STATE_COMMIT_RECEIPT_INVALID");
  }
  const object = receipt.object;
  if (!object || typeof object !== "object") {
    throw new Error("VIEW_STATE_COMMIT_RECEIPT_INVALID");
  }
  if (object.workspace_id !== expected.workspaceId || object.object_id !== expected.objectId) {
    throw new Error("VIEW_STATE_COMMIT_RECEIPT_IDENTITY_MISMATCH");
  }
  if (!Number.isInteger(object.revision) || object.revision !== expected.baseRevision + 1) {
    throw new Error("VIEW_STATE_COMMIT_RECEIPT_REVISION_MISMATCH");
  }
  if (expected.schemaId !== undefined && object.schema_id !== expected.schemaId) {
    throw new Error("VIEW_STATE_COMMIT_RECEIPT_SCHEMA_MISMATCH");
  }
  if (expected.schemaVersion !== undefined && object.schema_version !== expected.schemaVersion) {
    throw new Error("VIEW_STATE_COMMIT_RECEIPT_SCHEMA_MISMATCH");
  }
  if (expected.viewId !== undefined) {
    const data = object.data as Partial<WorkspaceSavedViewData> | null;
    if (!data || data.view_id !== expected.viewId || data.version !== 1) {
      throw new Error("VIEW_STATE_COMMIT_RECEIPT_DATA_MISMATCH");
    }
  }
}

export async function saveWorkspaceView(
  ctx: WorkspaceModuleContext,
  args: unknown,
): Promise<CommitResult<WorkspaceSavedViewData>> {
  const raw = requireObject(args);
  const workspaceId = requireSafeId(raw.workspaceId, "workspace_id");
  const viewId = requireSafeId(raw.viewId, "view_id");
  const data: WorkspaceSavedViewData = {
    version: 1,
    view_id: viewId,
    name: typeof raw.name === "string" ? raw.name.trim() : "",
    profile_id: typeof raw.profileId === "string" ? raw.profileId : "",
    logical_area_id:
      raw.logicalAreaId === null
        ? null
        : typeof raw.logicalAreaId === "string"
          ? raw.logicalAreaId
          : "",
    query: typeof raw.query === "string" ? raw.query : "",
  };
  const validation = validateWorkspaceSavedViewData(data);
  if (!validation.ok) {
    throw new Error(`VIEW_STATE_SCHEMA_INVALID:${JSON.stringify(validation.issues ?? [])}`);
  }
  const objectId = savedViewObjectId(viewId);
  const baseRevision = requiredRevision(raw.baseRevision);
  const receipt = await ctx.kernel.putObject({
    workspace_id: workspaceId,
    object_id: objectId,
    schema_id: WORKSPACE_SAVED_VIEW_SCHEMA_ID,
    schema_version: WORKSPACE_SAVED_VIEW_SCHEMA_VERSION,
    data,
    extensions: { owner_module: MODULE_ID },
    base_revision: baseRevision,
    event: {
      event_type: "workspace.saved-view.saved",
      payload: { view_id: viewId },
    },
  }) as CommitResult<WorkspaceSavedViewData>;
  requireCommitReceipt(receipt, {
    workspaceId,
    objectId,
    baseRevision,
    schemaId: WORKSPACE_SAVED_VIEW_SCHEMA_ID,
    schemaVersion: WORKSPACE_SAVED_VIEW_SCHEMA_VERSION,
    viewId,
  });
  return receipt;
}

export async function deleteWorkspaceView(
  ctx: WorkspaceModuleContext,
  args: unknown,
): Promise<CommitResult> {
  const raw = requireObject(args);
  const workspaceId = requireSafeId(raw.workspaceId, "workspace_id");
  const viewId = requireSafeId(raw.viewId, "view_id");
  const baseRevision = requiredRevision(raw.baseRevision);
  const objectId = savedViewObjectId(viewId);
  const receipt = await ctx.kernel.deleteObject({
    workspace_id: workspaceId,
    object_id: objectId,
    base_revision: baseRevision,
    event: {
      event_type: "workspace.saved-view.deleted",
      payload: { view_id: viewId },
    },
  });
  requireCommitReceipt(receipt, { workspaceId, objectId, baseRevision });
  return receipt;
}

interface CommandSpec {
  id: string;
  labelKey: string;
  requiredOperations: readonly OperationId[];
  run: (ctx: WorkspaceModuleContext, args: unknown) => Promise<unknown>;
}

const SPECS: readonly CommandSpec[] = Object.freeze([
  {
    id: SAVE_WORKSPACE_VIEW_COMMAND_ID,
    labelKey: "view-state.command.save",
    requiredOperations: ["t1.putObject"],
    run: saveWorkspaceView,
  },
  {
    id: DELETE_WORKSPACE_VIEW_COMMAND_ID,
    labelKey: "view-state.command.delete",
    requiredOperations: ["t1.deleteObject"],
    run: deleteWorkspaceView,
  },
]);

export const VIEW_STATE_COMMAND_INVENTORY = SPECS;

export function buildViewStateCommandContributions(
  hasOperation: (op: OperationId) => boolean,
): readonly CommandContribution[] {
  return Object.freeze(
    SPECS.filter((spec) => spec.requiredOperations.every(hasOperation)).map((spec) => ({
      kind: "command" as const,
      id: spec.id,
      moduleId: MODULE_ID,
      requiredOperations: spec.requiredOperations,
      labelKey: spec.labelKey,
      loader: async () => ({
        run(ctx: unknown, args?: unknown) {
          return spec.run(ctx as WorkspaceModuleContext, args);
        },
      }),
    })),
  );
}
