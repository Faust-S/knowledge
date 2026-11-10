/**
 * Lifecycle module command contributions (PROMPT 24 §5, rewired in PROMPT 29 §§2, 5, 7-11).
 *
 * Six commands dispatched by the Host through the CommandsFacade:
 *   - `lifecycle.soft-delete-workspace`  → t1.softDeleteWorkspace
 *   - `lifecycle.restore-workspace`      → t1.restoreWorkspace
 *   - `lifecycle.purge-preview`          → t1.purgePreview
 *   - `lifecycle.purge-commit`           → t1.purgeCommit
 *   - `lifecycle.purge-cancel`           → t1.purgeCancel
 *   - `lifecycle.trash.refresh`          → notifies module-local subscribers
 *
 * Handlers pull the KernelFacade off the OWNER module's context that
 * the Host provides to `run(ctx, args)`. They never see raw
 * KernelSession. Runtime receipts are returned verbatim (§2, §11).
 *
 * Cross-module fanout (base catalog + local trash) happens by
 * INVOKING commands via `ctx.commands.invoke()` — no global buses
 * (§5).
 */
import type {
  CommandContribution,
  WorkspaceModuleContext,
} from "@/workspace-contract";
import type { OperationId } from "@/kernel-client";
import type {
  PurgePreview,
  PurgePreviewInput,
  PurgeCommitInput,
  PurgeReceipt,
  SoftDeleteWorkspaceReceipt,
  RestoreWorkspaceReceipt,
} from "@/kernel-client/contracts/runtime-1.3.0";
import { MODULE_ID } from "./module-id";
import { trashRefreshService } from "./services/trash-refresh-service";

/** Argument shapes each command accepts. */
export interface SoftDeleteWorkspaceArgs { workspaceId: string }
export interface RestoreWorkspaceArgs { workspaceId: string }
export interface PurgePreviewArgs {
  workspaceId: string;
  acknowledgeNoBackup?: boolean;
}
export interface PurgeCommitArgs {
  workspaceId: string;
  purgeToken: string;
  confirmation: string;
}
export interface PurgeCancelArgs { purgeToken: string }

type Handler<TArgs, TResult> = {
  run(ctx: WorkspaceModuleContext, args?: unknown): Promise<TResult>;
  /** Exposed for tests only — not used by the Host dispatcher. */
  readonly __args?: TArgs;
};

function requireStringField(args: unknown, field: string): string {
  if (!args || typeof args !== "object") {
    throw new Error(`missing arguments (expected { ${field} })`);
  }
  const v = (args as Record<string, unknown>)[field];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`argument "${field}" must be a non-empty string`);
  }
  return v;
}

function requireReceiptTimestamp(receipt: unknown, expectedWorkspaceId: string, field: "deleted_at" | "restored_at"): void {
  if (!receipt || typeof receipt !== "object") throw new Error("LIFECYCLE_RECEIPT_INVALID");
  const record = receipt as Record<string, unknown>;
  if (record.workspace_id !== expectedWorkspaceId) throw new Error("LIFECYCLE_RECEIPT_IDENTITY_MISMATCH");
  if (typeof record[field] !== "string" || !Number.isFinite(Date.parse(record[field] as string))) {
    throw new Error("LIFECYCLE_RECEIPT_INVALID");
  }
}

function requirePurgePreview(preview: PurgePreview, expectedWorkspaceId: string, expectedAck: boolean): void {
  if (!preview || preview.workspace_id !== expectedWorkspaceId) throw new Error("PURGE_PREVIEW_IDENTITY_MISMATCH");
  if (typeof preview.purge_token !== "string" || preview.purge_token.length === 0) throw new Error("PURGE_PREVIEW_INVALID");
  if (typeof preview.challenge !== "string" || preview.challenge.length === 0) throw new Error("PURGE_PREVIEW_INVALID");
  if (typeof preview.expires_at !== "string" || !Number.isFinite(Date.parse(preview.expires_at))) throw new Error("PURGE_PREVIEW_INVALID");
  if (Boolean(preview.acknowledge_no_backup) !== expectedAck) throw new Error("PURGE_PREVIEW_ACK_MISMATCH");
}

function requirePurgeReceipt(receipt: PurgeReceipt, expectedWorkspaceId: string): void {
  if (!receipt || receipt.workspace_id !== expectedWorkspaceId) throw new Error("PURGE_RECEIPT_IDENTITY_MISMATCH");
  const removed = receipt.removed;
  if (!removed || Object.values(removed).some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error("PURGE_RECEIPT_INVALID");
  }
}

/**
 * Best-effort invoke of the base module's catalog-refresh command.
 * Absent grants or an inactive base module MUST NOT fail a mutation
 * receipt — the fanout is advisory.
 */
async function invokeCatalogRefresh(
  ctx: WorkspaceModuleContext,
  reason: string,
): Promise<void> {
  if (!ctx.commands || typeof ctx.commands.has !== "function") return;
  if (!ctx.commands.has("workspace.catalog.refresh")) return;
  try {
    await ctx.commands.invoke("workspace.catalog.refresh", { reason });
  } catch { /* advisory */ }
}

async function invokeTrashRefresh(
  ctx: WorkspaceModuleContext,
  reason: string,
): Promise<void> {
  if (!ctx.commands || typeof ctx.commands.has !== "function") return;
  if (!ctx.commands.has("lifecycle.trash.refresh")) return;
  try {
    await ctx.commands.invoke("lifecycle.trash.refresh", { reason });
  } catch { /* advisory */ }
}


export const softDeleteWorkspaceHandler: Handler<
  SoftDeleteWorkspaceArgs,
  SoftDeleteWorkspaceReceipt
> = {
  async run(ctx, args) {
    const workspaceId = requireStringField(args, "workspaceId");
    const receipt = await ctx.kernel.softDeleteWorkspace(workspaceId);
    requireReceiptTimestamp(receipt, workspaceId, "deleted_at");
    // §13 — if the deleted workspace was the current focus, release
    // it. Only the base module can actually mutate its store, so
    // the release goes through the base-owned command.
    await invokeCatalogRefresh(ctx, "workspace.soft-deleted");
    await invokeTrashRefresh(ctx, "soft-delete.committed");
    return receipt;
  },
};

export const restoreWorkspaceHandler: Handler<
  RestoreWorkspaceArgs,
  RestoreWorkspaceReceipt
> = {
  async run(ctx, args) {
    const workspaceId = requireStringField(args, "workspaceId");
    const receipt = await ctx.kernel.restoreWorkspace(workspaceId);
    requireReceiptTimestamp(receipt, workspaceId, "restored_at");
    await invokeCatalogRefresh(ctx, "workspace.restored");
    await invokeTrashRefresh(ctx, "restore.committed");
    return receipt;
  },
};

export const purgePreviewHandler: Handler<PurgePreviewArgs, PurgePreview> = {
  async run(ctx, args) {
    const workspaceId = requireStringField(args, "workspaceId");
    const ack = !!(args as Record<string, unknown>).acknowledgeNoBackup;
    const input: PurgePreviewInput = {
      workspace_id: workspaceId,
      acknowledge_no_backup: ack,
    };
    const preview = await ctx.kernel.purgePreview(input);
    requirePurgePreview(preview, workspaceId, ack);
    return preview;
  },
};

export const purgeCommitHandler: Handler<PurgeCommitArgs, PurgeReceipt> = {
  async run(ctx, args) {
    const workspaceId = requireStringField(args, "workspaceId");
    const purge_token = requireStringField(args, "purgeToken");
    const confirmation = requireStringField(args, "confirmation");
    const input: PurgeCommitInput = { purge_token, confirmation };
    const receipt = await ctx.kernel.purgeCommit(input);
    requirePurgeReceipt(receipt, workspaceId);
    await invokeCatalogRefresh(ctx, "workspace.purged");
    await invokeTrashRefresh(ctx, "purge.committed");
    return receipt;
  },
};

export const purgeCancelHandler: Handler<PurgeCancelArgs, boolean> = {
  async run(ctx, args) {
    const purge_token = requireStringField(args, "purgeToken");
    const cancelled = await ctx.kernel.purgeCancel(purge_token);
    if (cancelled !== true) throw new Error("PURGE_CANCEL_NOT_CONFIRMED");
    return true;
  },
};

/**
 * `lifecycle.trash.refresh` — module-local fanout command. Handlers
 * that mutate trash invoke this to notify subscribers (currently the
 * `LifecycleTrashRoute`). Requires no Runtime operations.
 */
const trashRefreshHandler = {
  run(_ctx: unknown, args?: unknown): { notified: true; reason: string } {
    const reason = (args && typeof args === "object" && typeof (args as { reason?: unknown }).reason === "string")
      ? (args as { reason: string }).reason
      : "unspecified";
    trashRefreshService.notify(reason);
    return { notified: true, reason };
  },
};

interface CommandSpec {
  id: string;
  labelKey: string;
  requiredOperations: readonly OperationId[];
  handler: { run(ctx: unknown, args?: unknown): unknown };
}

const SPECS: readonly CommandSpec[] = Object.freeze([
  {
    id: "lifecycle.soft-delete-workspace",
    labelKey: "lifecycle.command.soft-delete",
    requiredOperations: ["t1.softDeleteWorkspace"],
    handler: softDeleteWorkspaceHandler as unknown as { run(ctx: unknown, args?: unknown): unknown },
  },
  {
    id: "lifecycle.restore-workspace",
    labelKey: "lifecycle.command.restore",
    requiredOperations: ["t1.restoreWorkspace"],
    handler: restoreWorkspaceHandler as unknown as { run(ctx: unknown, args?: unknown): unknown },
  },
  {
    id: "lifecycle.purge-preview",
    labelKey: "lifecycle.command.purge-preview",
    requiredOperations: ["t1.purgePreview"],
    handler: purgePreviewHandler as unknown as { run(ctx: unknown, args?: unknown): unknown },
  },
  {
    id: "lifecycle.purge-commit",
    labelKey: "lifecycle.command.purge-commit",
    requiredOperations: ["t1.purgeCommit"],
    handler: purgeCommitHandler as unknown as { run(ctx: unknown, args?: unknown): unknown },
  },
  {
    id: "lifecycle.purge-cancel",
    labelKey: "lifecycle.command.purge-cancel",
    requiredOperations: ["t1.purgeCancel"],
    handler: purgeCancelHandler as unknown as { run(ctx: unknown, args?: unknown): unknown },
  },
  {
    id: "lifecycle.trash.refresh",
    labelKey: "lifecycle.command.trash.refresh",
    requiredOperations: [],
    handler: trashRefreshHandler,
  },
]);


export const LIFECYCLE_COMMAND_INVENTORY = SPECS;

export function buildLifecycleCommandContributions(
  hasOperation: (op: OperationId) => boolean,
): readonly CommandContribution[] {
  const out: CommandContribution[] = [];
  for (const spec of SPECS) {
    if (spec.requiredOperations.some((op) => !hasOperation(op))) continue;
    const handler = spec.handler;
    out.push({
      kind: "command",
      id: spec.id,
      moduleId: MODULE_ID,
      requiredOperations: spec.requiredOperations,
      labelKey: spec.labelKey,
      loader: async () => handler,
    });
  }
  return Object.freeze(out);
}
