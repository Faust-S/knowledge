import { useWorkspaceModuleRuntime } from "../../../workspace-host/rendering/ModuleRenderContext";
import { OverviewView } from "../features/overview/OverviewView";
import { BaseRouteFrame } from "./route-shell";
import { useBaseCatalog, makeBaseNavigation } from "./base-runtime";
import type { WorkspaceProfileDefinition } from "../../../profiles/definition";
import type { WorkspaceProfileId } from "../../../config/workspace-profiles";

export default function BaseOverviewRoute() {
  const { context, profileFallback } = useWorkspaceModuleRuntime();
  const kernel = context.kernel;
  const nav = makeBaseNavigation(context.router);
  const catalog = useBaseCatalog(kernel);
  return (
    <BaseRouteFrame title="Обзор" kernelReady={!!kernel}>
      <OverviewView
        catalog={catalog}
        kernel={kernel}
        activeProfileId={context.profile.id as WorkspaceProfileId}
        profileDefinition={context.profile.definition as WorkspaceProfileDefinition}
        profileFallback={profileFallback}
        onOpenWorkspace={nav.openWorkspace}
        onOpenWorkspacesList={nav.openWorkspacesList}
        onOpenImport={nav.openImport}
        onOpenExport={nav.openExport}
      />
    </BaseRouteFrame>
  );
}
