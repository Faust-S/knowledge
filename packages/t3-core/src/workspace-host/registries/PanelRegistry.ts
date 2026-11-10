/**
 * PanelRegistry (PROMPT 17 §5).
 *
 * Owns panel contributions. Components are lazy loaders — Host wraps
 * every mount in its own error boundary. Owner cleanup drops all panels
 * a module registered.
 */

import type { PanelContribution } from "@/workspace-contract";
import {
  RegistryBase,
  type RegistryDiagnostic,
  type RegistryEntryInput,
} from "./RegistryBase";

export class PanelRegistry extends RegistryBase<PanelContribution> {
  constructor() {
    super("panels");
  }

  protected override additionalValidate(
    entry: RegistryEntryInput<PanelContribution>,
  ): RegistryDiagnostic[] {
    const diags: RegistryDiagnostic[] = [];
    const c = entry.contribution;
    if (c.kind !== "panel") {
      diags.push({
        code: "invalid-contribution",
        message: `panels: "${entry.contributionId}" kind is "${c.kind}", expected "panel".`,
        contributionId: entry.contributionId,
        ownerModuleId: entry.ownerModuleId,
        group: "panels",
      });
    }
    if (typeof c.loader !== "function") {
      diags.push({
        code: "invalid-contribution",
        message: `panels: "${entry.contributionId}" loader must be a function.`,
        contributionId: entry.contributionId,
        ownerModuleId: entry.ownerModuleId,
        group: "panels",
      });
    }
    return diags;
  }
}
