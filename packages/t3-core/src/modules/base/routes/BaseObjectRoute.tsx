import { useWorkspaceModuleRuntime } from "../../../workspace-host/rendering/ModuleRenderContext";
import { ObjectView } from "../features/object/ObjectView";
import { useWorkspaceHostRuntimeHandle } from "../../../workspace-host/runtime/WorkspaceHostRuntimeProvider";
import { BaseRouteFrame } from "./route-shell";
import { makeBaseNavigation } from "./base-runtime";

export default function BaseObjectRoute() {
  const { context, params } = useWorkspaceModuleRuntime();
  const rt=useWorkspaceHostRuntimeHandle();
  const workspaceId = params.workspaceId ?? "";
  const objectId = params.objectId ?? "";
  const kernel = context.kernel;
  const nav = makeBaseNavigation(context.router);
  return (
    <BaseRouteFrame
      title={objectId ? `Объект · ${objectId}` : "Объект"}
      kernelReady={!!kernel}
    >
      {kernel && workspaceId && objectId && (
        <ObjectView
          kernel={kernel}
          viewerRegistry={rt?.hub.viewers} grantedOperations={rt?.grantedOperations} activeCapabilities={rt?.activeCapabilities}
          workspaceId={workspaceId}
          objectId={objectId}
          onBack={() => nav.openWorkspace(workspaceId)}
          onOpenObject={nav.openObject}
        />
      )}
    </BaseRouteFrame>
  );
}
