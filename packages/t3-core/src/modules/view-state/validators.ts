import type { ValidatorContribution } from "@/workspace-contract";
import { MODULE_ID } from "./module-id";
import {
  WORKSPACE_SAVED_VIEW_SCHEMA_ID,
  validateWorkspaceSavedViewData,
} from "./schema";

export const VIEW_STATE_VALIDATOR_ID = "view-state.saved-view.schema" as const;

export function buildViewStateValidatorContributions(): readonly ValidatorContribution[] {
  return Object.freeze([
    {
      kind: "validator",
      id: VIEW_STATE_VALIDATOR_ID,
      moduleId: MODULE_ID,
      requiredOperations: [],
      schemaId: WORKSPACE_SAVED_VIEW_SCHEMA_ID,
      schemaVersionRange: "^1.0.0",
      loader: async () => ({ validate: validateWorkspaceSavedViewData }),
    },
  ]);
}
