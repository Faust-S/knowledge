/**
 * Base module command contributions.
 *
 * Neural commands are owner-command surfaces only. Provider registries,
 * endpoints and credentials remain Host/runtime-owned and are never added
 * to WorkspaceModuleContext.
 */
import type {
  CommandContribution,
  WorkspaceModuleContext,
} from "@/workspace-contract";
import { MODULE_ID } from "./module-id";
import { catalogRefreshService } from "./services/catalog-refresh-service";

export const CATALOG_REFRESH_COMMAND_ID = "workspace.catalog.refresh" as const;
export const WORKSPACE_FOCUS_SELECT_COMMAND_ID = "workspace.focus.select" as const;

export interface CatalogRefreshReceipt {
  readonly notified: true;
  readonly reason: string;
  readonly releasedCurrentWorkspaceId?: string;
}

async function reconcileCurrentWorkspace(
  ctx: WorkspaceModuleContext,
): Promise<string | undefined> {
  const cw = ctx.currentWorkspace;
  const kernel = ctx.kernel;
  if (!cw || !kernel) return undefined;
  if (!kernel.hasOperation("t1.getWorkspace")) return undefined;
  const focused = cw.get();
  if (!focused) return undefined;
  const id = focused.workspace_id;
  let latest: { deleted_at?: string | null } | null = null;
  try {
    latest = (await kernel.getWorkspace(id)) as {
      deleted_at?: string | null;
    } | null;
  } catch {
    return undefined;
  }
  const gone = latest === null || latest.deleted_at != null;
  if (!gone) return undefined;
  try {
    cw.release();
  } catch {
    // Owner-gated no-op elsewhere.
  }
  return id;
}

export function buildBaseCommandContributions(): readonly CommandContribution[] {
  const catalogRefresh: CommandContribution = {
    kind: "command",
    id: CATALOG_REFRESH_COMMAND_ID,
    moduleId: MODULE_ID,
    requiredOperations: [],
    labelKey: "base.command.catalog.refresh",
    loader: async () => ({
      async run(ctx: unknown, args?: unknown): Promise<CatalogRefreshReceipt> {
        const reason =
          args &&
          typeof args === "object" &&
          typeof (args as { reason?: unknown }).reason === "string"
            ? (args as { reason: string }).reason
            : "unspecified";
        catalogRefreshService.notify(reason);
        const modCtx = ctx as WorkspaceModuleContext | undefined;
        let released: string | undefined;
        if (modCtx) {
          released = await reconcileCurrentWorkspace(modCtx);
        }
        return released
          ? { notified: true, reason, releasedCurrentWorkspaceId: released }
          : { notified: true, reason };
      },
    }),
  };

  // A domain module cannot claim the current Workspace directly: the Host
  // owner-gates CurrentWorkspaceFacade.claim to iwxa.workspace.base.
  // Route selection through the existing owner-scoped CommandRegistry.
  // This command only changes Host focus, never creates a Workspace or grant.
  const focusSelect: CommandContribution = {
    kind: "command",
    id: WORKSPACE_FOCUS_SELECT_COMMAND_ID,
    moduleId: MODULE_ID,
    requiredOperations: ["t1.getWorkspace"],
    labelKey: "base.command.workspace.focus.select",
    loader: async () => ({
      async run(context: unknown, args?: unknown): Promise<{
        workspace_id: string;
        profile: string;
      }> {
        const ctx = context as WorkspaceModuleContext;
        const input = args && typeof args === "object" && !Array.isArray(args)
          ? args as Record<string, unknown> : null;
        const workspaceId = input?.workspace_id;
        if (typeof workspaceId !== "string" ||
            workspaceId.length === 0 || workspaceId.length > 256 ||
            workspaceId !== workspaceId.trim() ||
            /[\u0000-\u001f\u007f]/u.test(workspaceId)) {
          throw new Error("T2_WORKSPACE_FOCUS_ID_INVALID");
        }
        if (!ctx.kernel.hasOperation("t1.getWorkspace")) {
          throw new Error("T2_WORKSPACE_FOCUS_READ_DENIED");
        }
        const record = await ctx.kernel.getWorkspace(workspaceId);
        if (!record || record.deleted_at != null ||
            record.workspace_id !== workspaceId ||
            record.profile !== ctx.profile.id) {
          throw new Error("T2_WORKSPACE_FOCUS_NOT_AVAILABLE");
        }
        ctx.currentWorkspace.claim(record);
        if (ctx.currentWorkspace.get()?.workspace_id !== workspaceId) {
          throw new Error("T2_WORKSPACE_FOCUS_NOT_CONFIRMED");
        }
        return { workspace_id: record.workspace_id, profile: record.profile };
      },
    }),
  };

  return Object.freeze([catalogRefresh, focusSelect]);
}
