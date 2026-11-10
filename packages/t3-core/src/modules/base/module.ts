/**
 * iwxa.workspace.base — canonical Workspace base module (PROMPT 18 §2, §6).
 *
 * Activation contract:
 *   - Never touches IndexedDB.
 *   - Never touches window.IWXA.
 *   - Never invokes Runtime operations during `activate()` — only
 *     `ctx.kernel.hasOperation()` is consulted to hide contributions
 *     whose exact operations are not granted.
 *   - Never subscribes to global events without cleanup.
 *   - Never imports AppShell.
 *   - Never mutates domain navigation.
 *
 * Contributions:
 *   - 6 routes (`base.home`, `base.workspaces`, `base.workspace`,
 *     `base.object`, `base.activity`, `base.diagnostics`). Packages
 *     ownership moved to `iwxa.workspace.exchange` in PROMPT 21.
 *   - 4 navigation items (Обзор, Рабочие области, Активность,
 *     Диагностика) via terminology keys + opaque RouteRefs. The
 *     "Перенос данных" nav entry is now contributed by exchange.
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
import { buildBaseRouteContributions } from "./routes";
import { buildBaseNavigationContributions } from "./navigation";
import { buildBaseCommandContributions } from "./commands";
import { buildBaseViewerContributions } from "./viewers";
import { catalogRefreshService } from "./services/catalog-refresh-service";

const manifest = manifestJson as WorkspaceModuleManifest;

export const baseModule = defineWorkspaceModule({
  manifest,
  activate(ctx: WorkspaceModuleContext): WorkspaceModuleActivationResult {
    catalogRefreshService.activate();
    const has = (op: OperationId): boolean => ctx.kernel.hasOperation(op);
    return {
      contributions: {
        routes: [...buildBaseRouteContributions(has)],
        viewers: [...buildBaseViewerContributions()],
        navigation: [...buildBaseNavigationContributions(has)],
        commands: [...buildBaseCommandContributions()],
      },
    };
  },

  deactivate() {
    catalogRefreshService.dispose();
  },
});

export { MODULE_ID };
export default baseModule;
