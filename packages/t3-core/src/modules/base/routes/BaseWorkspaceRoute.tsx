import { useWorkspaceModuleRuntime } from "../../../workspace-host/rendering/ModuleRenderContext";
import { WorkspaceView } from "../features/workspace/WorkspaceView";
import { useWorkspaceHostRuntimeHandle } from "../../../workspace-host/runtime/WorkspaceHostRuntimeProvider";
import { BaseRouteFrame } from "./route-shell";
import { makeBaseNavigation } from "./base-runtime";

export default function BaseWorkspaceRoute() {
  const { context, params } = useWorkspaceModuleRuntime();
  const rt=useWorkspaceHostRuntimeHandle();
  const workspaceId = params.workspaceId ?? "";
  const kernel = context.kernel;
  const nav = makeBaseNavigation(context.router);
  return (
    <BaseRouteFrame
      title={workspaceId ? `Рабочая область · ${workspaceId}` : "Рабочая область"}
      kernelReady={!!kernel}
    >
      {kernel && workspaceId && (
        <WorkspaceView
          kernel={kernel}
          viewerRegistry={rt?.hub.viewers} grantedOperations={rt?.grantedOperations} activeCapabilities={rt?.activeCapabilities}
          commands={context.commands}
          workspaceId={workspaceId}
          currentShellServiceId={kernel.sessionInfo.service_id}
          onOpenObject={nav.openObject}
          onExportThis={nav.exportWorkspace}
          onBack={nav.openWorkspacesList}
        />
      )}
    </BaseRouteFrame>
  );
}
