/**
 * DashboardRegistry (PROMPT 17 §5).
 *
 * Lazy dashboard-card contributions. Host wraps each render in an error
 * boundary and drives refresh cycles.
 */

import type { DashboardCardContribution } from "@/workspace-contract";
import type { OperationId } from "@/kernel-client";
import {
  RegistryBase,
  type RegistryDiagnostic,
  type RegistryEntry,
  type RegistryEntryInput,
} from "./RegistryBase";

export class DashboardRegistry extends RegistryBase<DashboardCardContribution> {
  constructor() {
    super("dashboard_cards");
  }

  visibleEntries(
    grantedOperations: readonly OperationId[],
    activeCapabilities: readonly string[] = [],
  ): readonly RegistryEntry<DashboardCardContribution>[] {
    const granted = new Set<string>(grantedOperations as readonly string[]);
    const active = new Set<string>(activeCapabilities);
    return Object.freeze(this.snapshot().filter((entry) =>
      entry.requiredOperations.every((operation) => granted.has(operation)) &&
      entry.requiredCapabilitiesAll.every((capability) => active.has(capability)) &&
      (entry.requiredCapabilitiesAny.length === 0 ||
        entry.requiredCapabilitiesAny.some((capability) => active.has(capability))),
    ));
  }

  protected override additionalValidate(
    entry: RegistryEntryInput<DashboardCardContribution>,
  ): RegistryDiagnostic[] {
    const diags: RegistryDiagnostic[] = [];
    const c = entry.contribution;
    if (c.kind !== "dashboard_card") {
      diags.push({
        code: "invalid-contribution",
        message: `dashboard_cards: "${entry.contributionId}" kind is "${c.kind}", expected "dashboard_card".`,
        contributionId: entry.contributionId,
        ownerModuleId: entry.ownerModuleId,
        group: "dashboard_cards",
      });
    }
    if (typeof c.loader !== "function") {
      diags.push({
        code: "invalid-contribution",
        message: `dashboard_cards: "${entry.contributionId}" loader must be a function.`,
        contributionId: entry.contributionId,
        ownerModuleId: entry.ownerModuleId,
        group: "dashboard_cards",
      });
    }
    return diags;
  }
}
