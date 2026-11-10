/**
 * LegacyImporterRegistry (PROMPT 17 §5).
 *
 * Detection is bounded (single call, no retries). Importer NEVER sees
 * IndexedDB or any raw storage handle. The Host does NOT write the
 * result directly into the Runtime — that is the caller's policy.
 */

import type { LegacyImporterContribution } from "@/workspace-contract";
import {
  RegistryBase,
  type RegistryDiagnostic,
  type RegistryEntry,
  type RegistryEntryInput,
} from "./RegistryBase";

export type LegacyDetectErrorCode = "detect-failed" | "detect-timeout";

export class LegacyDetectError extends Error {
  constructor(
    public readonly code: LegacyDetectErrorCode,
    public readonly contributionId: string,
    message: string,
  ) {
    super(message);
    this.name = "LegacyDetectError";
  }
}

export class LegacyImporterRegistry extends RegistryBase<LegacyImporterContribution> {
  constructor() {
    super("legacy_importers");
  }

  protected override additionalValidate(
    entry: RegistryEntryInput<LegacyImporterContribution>,
  ): RegistryDiagnostic[] {
    const diags: RegistryDiagnostic[] = [];
    const c = entry.contribution;
    if (c.kind !== "legacy_importer") {
      diags.push({
        code: "invalid-contribution",
        message: `legacy_importers: "${entry.contributionId}" kind is "${c.kind}", expected "legacy_importer".`,
        contributionId: entry.contributionId,
        ownerModuleId: entry.ownerModuleId,
        group: "legacy_importers",
      });
    }
    if (typeof c.loader !== "function") {
      diags.push({
        code: "invalid-contribution",
        message: `legacy_importers: "${entry.contributionId}" loader must be a function.`,
        contributionId: entry.contributionId,
        ownerModuleId: entry.ownerModuleId,
        group: "legacy_importers",
      });
    }
    if (typeof c.formatId !== "string" || c.formatId.length === 0) {
      diags.push({
        code: "missing-required-field",
        message: `legacy_importers: "${entry.contributionId}" missing formatId.`,
        contributionId: entry.contributionId,
        ownerModuleId: entry.ownerModuleId,
        group: "legacy_importers",
      });
    }
    return diags;
  }

  /**
   * Ordered list of importers claiming `formatId`. Detection call itself
   * is left to the caller — the registry just exposes the entries.
   */
  candidatesFor(
    formatId: string,
  ): readonly RegistryEntry<LegacyImporterContribution>[] {
    return Object.freeze(
      this.snapshot().filter((e) => e.contribution.formatId === formatId),
    );
  }
}
