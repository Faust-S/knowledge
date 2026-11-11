import { useState } from "react";
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
  const [localModelError, setLocalModelError] = useState("");
  const canOpenLocalModel = context.commands.has("iwxa.t3.local-inference.open");
  return (
    <BaseRouteFrame
      title={workspaceId ? `Рабочая область · ${workspaceId}` : "Рабочая область"}
      kernelReady={!!kernel}
    >
      {kernel && workspaceId && canOpenLocalModel && (
        <div className="p-3 border border-slate-700 rounded mb-3" data-testid="t3-local-inference-entry">
          <button type="button" className="px-3 py-2 min-h-[44px] rounded border border-slate-600 text-sm"
            onClick={() => { setLocalModelError(""); void context.commands.invoke("iwxa.t3.local-inference.open").catch((error: unknown) => {
              setLocalModelError(error instanceof Error ? error.message : "Локальная модель недоступна.");
            }); }}>
            Открыть локальную модель для этой рабочей области
          </button>
          {localModelError && <p role="alert" className="mt-2 text-sm text-rose-300">{localModelError}</p>}
        </div>
      )}
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
