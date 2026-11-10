import { useWorkspaceModuleRuntime } from "../../../workspace-host/rendering/ModuleRenderContext";
import { WorkspacesView } from "../features/workspaces/WorkspacesView";
import { BaseRouteFrame } from "./route-shell";
import { useBaseCatalog, makeBaseNavigation } from "./base-runtime";
import type { WorkspaceProfileDefinition } from "../../../profiles/definition";
import type { WorkspaceProfileId } from "../../../config/workspace-profiles";

export default function BaseWorkspacesRoute() {
  const { context, profileFallback } = useWorkspaceModuleRuntime();
  const kernel = context.kernel;
  const nav = makeBaseNavigation(context.router);
  const catalog = useBaseCatalog(kernel);
  return (
    <BaseRouteFrame title="Рабочие области" kernelReady={!!kernel}>
      <WorkspacesView
        catalog={catalog}
        kernel={kernel}
        commands={context.commands}
        activeProfileId={context.profile.id as WorkspaceProfileId}
        profileDefinition={context.profile.definition as WorkspaceProfileDefinition}
        profileFallback={profileFallback}
        onOpenWorkspace={nav.openWorkspace}
        onExportWorkspace={nav.exportWorkspace}
        onOpenImport={nav.openImport}
      />
    </BaseRouteFrame>
  );
}
