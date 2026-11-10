/**
 * iwxa.workspace.exchange — package import/export module (PROMPT 21 §2, §5).
 *
 * Activation contract mirrors base: never touches IndexedDB / window.IWXA
 * / Runtime operations during `activate()`, never subscribes to global
 * events without cleanup, never imports AppShell or the base module.
 * Contributes:
 *   - 1 route (`exchange.home`) gated by T2 preview/import operations.
 *   - 1 navigation entry (`exchange.nav.home`).
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
import { buildExchangeRouteContributions } from "./routes";
import { buildExchangeNavigationContributions } from "./navigation";

const manifest = manifestJson as WorkspaceModuleManifest;

export const exchangeModule = defineWorkspaceModule({
  manifest,
  activate(ctx: WorkspaceModuleContext): WorkspaceModuleActivationResult {
    const has = (op: OperationId): boolean => ctx.kernel.hasOperation(op);
    return {
      contributions: {
        routes: [...buildExchangeRouteContributions(has)],
        navigation: [...buildExchangeNavigationContributions(has)],
      },
    };
  },
  deactivate() {
    // Exchange module owns no long-lived subscriptions.
  },
});

export { MODULE_ID };
export default exchangeModule;
