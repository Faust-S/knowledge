import { defineWorkspaceModule } from "@/workspace-contract";
import type { WorkspaceModuleContext, WorkspaceModuleManifest } from "@/workspace-contract";
import manifestJson from "./manifest.json";

const MODULE_ID = "iwxa.t3.local-inference";
const PANEL_ID = "iwxa.t3.local-inference.panel";
export default defineWorkspaceModule({
  manifest: manifestJson as WorkspaceModuleManifest,
  activate(context: WorkspaceModuleContext) {
    return {
      contributions: {
        commands: [{
          kind: "command" as const,
          id: "iwxa.t3.local-inference.open",
          moduleId: MODULE_ID,
          requiredOperations: ["t1.getWorkspace" as const],
          labelKey: "Локальная модель",
          loader: async () => ({
            async run(ctx: unknown) {
              const owner = ctx as WorkspaceModuleContext;
              // The Host panel can start the model without a workspace;
              // the existing original Kernel still requires an explicit
              // selected workspace before any draft can be saved.
              owner.panels.open(PANEL_ID);
              return { opened: true, workspaceSelected:
                Boolean(owner.currentWorkspace.get()?.workspace_id) };
            },
          }),
        }],
        panels: [{
          kind: "panel" as const,
          id: PANEL_ID,
          moduleId: MODULE_ID,
          requiredOperations: ["t1.getWorkspace" as const],
          slot: "inspector" as const,
          loader: () => import("./LocalInferencePanel"),
        }],
        dashboard_cards: [{
          kind: "dashboard_card" as const,
          id: "iwxa.t3.local-inference.launcher",
          moduleId: MODULE_ID,
          requiredOperations: ["t1.getWorkspace" as const],
          size: "small" as const,
          loader: () => import("./LocalInferenceLauncher"),
        }],
      },
    };
  },
});
