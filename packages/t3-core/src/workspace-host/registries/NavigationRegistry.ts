/**
 * NavigationRegistry (PROMPT 17 §3).
 *
 * Stores module navigation contributions only. Domain navigation lives
 * in `domain-shell.json` and is NOT managed here.
 *
 * Rules:
 *   - uses opaque RouteRef (no raw path);
 *   - hidden until owner module is activated (implicit — only registered
 *     entries are surfaced);
 *   - `visibleEntries()` filters by granted operations;
 *   - sort order: placement (primary → utility), then `order`, then id.
 */

import type { NavigationContribution } from "@/workspace-contract";
import type { OperationId } from "@/kernel-client";
import {
  RegistryBase,
  type RegistryDiagnostic,
  type RegistryEntry,
  type RegistryEntryInput,
} from "./RegistryBase";

const PLACEMENT_ORDER: Record<NavigationContribution["placement"], number> = {
  primary: 0,
  utility: 1,
};

export class NavigationRegistry extends RegistryBase<NavigationContribution> {
  constructor() {
    super("navigation");
  }

  protected override additionalValidate(
    entry: RegistryEntryInput<NavigationContribution>,
  ): RegistryDiagnostic[] {
    const diags: RegistryDiagnostic[] = [];
    const c = entry.contribution;
    if (c.kind !== "navigation") {
      diags.push({
        code: "invalid-contribution",
        message: `navigation: contribution "${entry.contributionId}" has kind "${c.kind}", expected "navigation".`,
        contributionId: entry.contributionId,
        ownerModuleId: entry.ownerModuleId,
        group: "navigation",
      });
    }
    if (!c.routeRef || typeof c.routeRef.id !== "string") {
      diags.push({
        code: "invalid-contribution",
        message: `navigation: contribution "${entry.contributionId}" missing opaque routeRef.`,
        contributionId: entry.contributionId,
        ownerModuleId: entry.ownerModuleId,
        group: "navigation",
      });
    }
    if (typeof (c as { path?: unknown }).path === "string") {
      diags.push({
        code: "invalid-contribution",
        message: `navigation: contribution "${entry.contributionId}" carries raw "path" — forbidden.`,
        contributionId: entry.contributionId,
        ownerModuleId: entry.ownerModuleId,
        group: "navigation",
      });
    }
    return diags;
  }

  /**
   * Entries visible to the current session — filtered by granted
   * operations and sorted by placement, order, id.
   */
  visibleEntries(
    grantedOperations: readonly OperationId[],
    activeCapabilities: readonly string[] = [],
    isRouteActive: (routeRef: NavigationContribution["routeRef"]) => boolean = () => true,
  ): readonly RegistryEntry<NavigationContribution>[] {
    const granted = new Set<string>(grantedOperations as readonly string[]);
    const active = new Set<string>(activeCapabilities);
    const kept = this.snapshot().filter((e) =>
      e.requiredOperations.every((op) => granted.has(op)) &&
      e.requiredCapabilitiesAll.every((capability) => active.has(capability)) &&
      (e.requiredCapabilitiesAny.length === 0 || e.requiredCapabilitiesAny.some((capability) => active.has(capability))) &&
      isRouteActive(e.contribution.routeRef),
    );
    const sorted = [...kept].sort((a, b) => {
      const pa = PLACEMENT_ORDER[a.contribution.placement] ?? 99;
      const pb = PLACEMENT_ORDER[b.contribution.placement] ?? 99;
      if (pa !== pb) return pa - pb;
      const oa = a.contribution.order ?? 0;
      const ob = b.contribution.order ?? 0;
      if (oa !== ob) return oa - ob;
      return a.contributionId.localeCompare(b.contributionId);
    });
    return Object.freeze(sorted);
  }
}
