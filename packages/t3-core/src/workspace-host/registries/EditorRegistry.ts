/**
 * EditorRegistry (PROMPT 17 §5).
 *
 * Editors are registered but MUST NOT be activated by the current
 * read-only UI. The registry exposes registration / lookup only.
 */

import semver from "semver";
import type { EditorContribution } from "@/workspace-contract";
import {
  RegistryBase,
  type RegistryDiagnostic,
  type RegistryEntryInput,
} from "./RegistryBase";

export class EditorRegistry extends RegistryBase<EditorContribution> {
  constructor() {
    super("editors");
  }

  protected override additionalValidate(
    entry: RegistryEntryInput<EditorContribution>,
  ): RegistryDiagnostic[] {
    const diags: RegistryDiagnostic[] = [];
    const c = entry.contribution;
    if (c.kind !== "editor") {
      diags.push({
        code: "invalid-contribution",
        message: `editors: "${entry.contributionId}" kind is "${c.kind}", expected "editor".`,
        contributionId: entry.contributionId,
        ownerModuleId: entry.ownerModuleId,
        group: "editors",
      });
    }
    if (typeof c.loader !== "function") {
      diags.push({
        code: "invalid-contribution",
        message: `editors: "${entry.contributionId}" loader must be a function.`,
        contributionId: entry.contributionId,
        ownerModuleId: entry.ownerModuleId,
        group: "editors",
      });
    }
    if (semver.validRange(c.schemaVersionRange) === null) {
      diags.push({
        code: "invalid-contribution",
        message: `editors: "${entry.contributionId}" invalid semver range "${c.schemaVersionRange}".`,
        contributionId: entry.contributionId,
        ownerModuleId: entry.ownerModuleId,
        group: "editors",
      });
    }
    return diags;
  }
}
