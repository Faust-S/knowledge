import { defineWorkspaceModule } from "@/workspace-contract";
import type {
  WorkspaceModuleActivationResult,
  WorkspaceModuleContext,
  WorkspaceModuleManifest,
} from "@/workspace-contract";
import type { OperationId } from "@/kernel-client";
import manifestJson from "./manifest.json";
import { buildViewStateCommandContributions } from "./commands";
import { buildViewStateValidatorContributions } from "./validators";

const manifest = manifestJson as WorkspaceModuleManifest;

export const viewStateModule = defineWorkspaceModule({
  manifest,
  activate(ctx: WorkspaceModuleContext): WorkspaceModuleActivationResult {
    const has = (operation: OperationId) => ctx.kernel.hasOperation(operation);
    return {
      contributions: {
        commands: [...buildViewStateCommandContributions(has)],
        validators: [...buildViewStateValidatorContributions()],
      },
    };
  },
});

export default viewStateModule;
