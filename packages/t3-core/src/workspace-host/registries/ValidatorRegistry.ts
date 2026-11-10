/**
 * ValidatorRegistry (PROMPT 17 §5).
 *
 * Exact schema scope: (schemaId, schemaVersionRange). Validation MUST
 * NOT modify its input — this contract is documented on the caller side;
 * the registry itself only stores and dispatches.
 */

import semver from "semver";
import type { ValidatorContribution } from "@/workspace-contract";
import {
  RegistryBase,
  type RegistryDiagnostic,
  type RegistryEntry,
  type RegistryEntryInput,
} from "./RegistryBase";

export class ValidatorRegistry extends RegistryBase<ValidatorContribution> {
  constructor() {
    super("validators");
  }

  protected override additionalValidate(
    entry: RegistryEntryInput<ValidatorContribution>,
  ): RegistryDiagnostic[] {
    const diags: RegistryDiagnostic[] = [];
    const c = entry.contribution;
    if (c.kind !== "validator") {
      diags.push({
        code: "invalid-contribution",
        message: `validators: "${entry.contributionId}" kind is "${c.kind}", expected "validator".`,
        contributionId: entry.contributionId,
        ownerModuleId: entry.ownerModuleId,
        group: "validators",
      });
    }
    if (typeof c.loader !== "function") {
      diags.push({
        code: "invalid-contribution",
        message: `validators: "${entry.contributionId}" loader must be a function.`,
        contributionId: entry.contributionId,
        ownerModuleId: entry.ownerModuleId,
        group: "validators",
      });
    }
    if (semver.validRange(c.schemaVersionRange) === null) {
      diags.push({
        code: "invalid-contribution",
        message: `validators: "${entry.contributionId}" invalid semver range "${c.schemaVersionRange}".`,
        contributionId: entry.contributionId,
        ownerModuleId: entry.ownerModuleId,
        group: "validators",
      });
    }
    return diags;
  }

  /**
   * All validators that claim `(schemaId, schemaVersion)`. Callers pass a
   * concrete version and receive every entry whose range accepts it.
   */
  findFor(
    schemaId: string,
    schemaVersion: string,
  ): readonly RegistryEntry<ValidatorContribution>[] {
    if (semver.valid(schemaVersion) === null) return [];
    return Object.freeze(
      this.snapshot().filter(
        (e) =>
          e.contribution.schemaId === schemaId &&
          semver.satisfies(schemaVersion, e.contribution.schemaVersionRange, {
            includePrerelease: true,
          }),
      ),
    );
  }
}
