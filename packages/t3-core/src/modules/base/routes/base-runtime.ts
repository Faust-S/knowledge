/**
 * useBaseCatalog — module-owned catalog hook. Subscribes to the
 * module-local `catalogRefreshService` (PROMPT 29 §5-§6); other
 * modules signal a refresh by invoking the base-owned command
 * `workspace.catalog.refresh` via `ctx.commands.invoke`.
 *
 * Also exposes a small router-based navigation helper so route
 * wrappers can perform cross-base navigation through
 * `ctx.router.navigate(hostRouteRefs.*)` without duplicating the ref
 * plumbing in every file.
 */
import { useEffect } from "react";
import type { KernelFacade, RouterFacade } from "@/workspace-contract";
import {
  useWorkspaceCatalog,
  type WorkspaceCatalogController,
} from "../features/workspaces/useWorkspaceCatalog";
import { catalogRefreshService } from "../services/catalog-refresh-service";
import { hostRouteRefs } from "../../../workspace-host/router";

export function useBaseCatalog(kernel: KernelFacade | null): WorkspaceCatalogController {
  const catalog = useWorkspaceCatalog({ kernel });
  useEffect(() => {
    return catalogRefreshService.subscribe(() => {
      void catalog.refresh();
    });
  }, [catalog]);
  return catalog;
}


export interface BaseNavigation {
  openOverview: () => void;
  openWorkspacesList: () => void;
  openWorkspace: (id: string) => void;
  openObject: (workspaceId: string, objectId: string) => void;
  openExchange: () => void;
  openImport: () => void;
  openExport: () => void;
  exportWorkspace: (id: string) => void;
}

export function makeBaseNavigation(router: RouterFacade): BaseNavigation {
  const goExchange = () => {
    try { router.navigate(hostRouteRefs.exchange.home); } catch { /* ignore */ }
  };
  return {
    openOverview: () => router.navigate(hostRouteRefs.base.home),
    openWorkspacesList: () => router.navigate(hostRouteRefs.base.workspaces),
    openWorkspace: (id: string) =>
      router.navigate(hostRouteRefs.base.workspace, { workspaceId: id }),
    openObject: (workspaceId: string, objectId: string) =>
      router.navigate(hostRouteRefs.base.object, { workspaceId, objectId }),
    openExchange: goExchange,
    openImport: goExchange,
    openExport: goExchange,
    // Scope-specific export UI (per-workspace Export button) is a
    // follow-up: exchange currently has no scope URL parameter.
    exportWorkspace: (_id: string) => { void _id; goExchange(); },
  };
}
