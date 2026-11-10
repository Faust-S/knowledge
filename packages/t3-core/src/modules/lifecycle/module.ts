/**
 * iwxa.workspace.lifecycle — Workspace lifecycle module (PROMPT 24).
 *
 * Owns Workspace trash: soft-delete, restore, and the 2-phase purge
 * flow (preview → challenge → commit / cancel) built on T1 Runtime
 * Contract operations. Never touches IndexedDB, `window.IWXA`, or the
 * kernel outside `ctx.kernel.*`. Never subscribes to global events.
 * Never imports AppShell or the base/exchange modules.
 *
 * Contributions:
 *   - 2 routes: `lifecycle.home`, `lifecycle.trash`
 *   - 1 navigation entry (`lifecycle.nav.trash`, utility placement)
 *   - 5 commands: soft-delete, restore, purge-preview, purge-commit,
 *     purge-cancel
 */
import { defineWorkspaceModule } from "@/workspace-contract";
import type {
  WorkspaceModuleActivationResult,
  WorkspaceModuleContext,
  WorkspaceModuleManifest,
} from "@/workspace-contract";
import type { OperationId } from "@/kernel-client";
import manifestJson from "./manifest.json";
import { MODULE_ID } from "./module-id";
import { buildLifecycleRouteContributions } from "./routes";
import { buildLifecycleNavigationContributions } from "./navigation";
import { buildLifecycleCommandContributions } from "./commands";
import { trashRefreshService } from "./services/trash-refresh-service";

const manifest = manifestJson as WorkspaceModuleManifest;

export const lifecycleModule = defineWorkspaceModule({
  manifest,
  activate(ctx: WorkspaceModuleContext): WorkspaceModuleActivationResult {
    trashRefreshService.activate();
    const has = (op: OperationId): boolean => ctx.kernel.hasOperation(op);
    return {
      contributions: {
        routes: [...buildLifecycleRouteContributions(has)],
        navigation: [...buildLifecycleNavigationContributions(has)],
        commands: [...buildLifecycleCommandContributions(has)],
      },
    };
  },
  deactivate() {
    trashRefreshService.dispose();
  },
});

export { MODULE_ID };
export default lifecycleModule;
