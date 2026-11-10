/**
 * MigrationRegistry (PROMPT 17 §5).
 *
 * Deterministic path planning between two schema versions. Cycles are
 * refused at planning time. The registry NEVER runs a migration on its
 * own — a Host-level policy has to invoke it explicitly.
 */

import semver from "semver";
import type { MigrationContribution } from "@/workspace-contract";
import {
  RegistryBase,
  type RegistryDiagnostic,
  type RegistryEntry,
  type RegistryEntryInput,
} from "./RegistryBase";

export type MigrationPathErrorCode =
  | "no-path"
  | "cycle-detected"
  | "invalid-version";

export class MigrationPathError extends Error {
  constructor(
    public readonly code: MigrationPathErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MigrationPathError";
  }
}

export class MigrationRegistry extends RegistryBase<MigrationContribution> {
  constructor() {
    super("migrations");
  }

  protected override additionalValidate(
    entry: RegistryEntryInput<MigrationContribution>,
  ): RegistryDiagnostic[] {
    const diags: RegistryDiagnostic[] = [];
    const c = entry.contribution;
    if (c.kind !== "migration") {
      diags.push({
        code: "invalid-contribution",
        message: `migrations: "${entry.contributionId}" kind is "${c.kind}", expected "migration".`,
        contributionId: entry.contributionId,
        ownerModuleId: entry.ownerModuleId,
        group: "migrations",
      });
    }
    if (typeof c.loader !== "function") {
      diags.push({
        code: "invalid-contribution",
        message: `migrations: "${entry.contributionId}" loader must be a function.`,
        contributionId: entry.contributionId,
        ownerModuleId: entry.ownerModuleId,
        group: "migrations",
      });
    }
    if (semver.valid(c.fromVersion) === null || semver.valid(c.toVersion) === null) {
      diags.push({
        code: "invalid-contribution",
        message: `migrations: "${entry.contributionId}" fromVersion/toVersion must be exact semver.`,
        contributionId: entry.contributionId,
        ownerModuleId: entry.ownerModuleId,
        group: "migrations",
      });
    } else if (semver.eq(c.fromVersion, c.toVersion)) {
      diags.push({
        code: "invalid-contribution",
        message: `migrations: "${entry.contributionId}" fromVersion equals toVersion — no-op migration is forbidden.`,
        contributionId: entry.contributionId,
        ownerModuleId: entry.ownerModuleId,
        group: "migrations",
      });
    }
    return diags;
  }

  /**
   * Plan a deterministic sequence of migrations to go from `from` to
   * `to` for a given `schemaId`. Refuses cycles.
   */
  planPath(
    schemaId: string,
    from: string,
    to: string,
  ): readonly RegistryEntry<MigrationContribution>[] {
    if (semver.valid(from) === null || semver.valid(to) === null) {
      throw new MigrationPathError(
        "invalid-version",
        `planPath: from/to must be exact semver ("${from}" → "${to}").`,
      );
    }
    if (semver.eq(from, to)) return [];
    const applicable = this.snapshot().filter(
      (e) => e.contribution.schemaId === schemaId,
    );
    // BFS on (version) with cycle guard.
    const queue: { version: string; path: RegistryEntry<MigrationContribution>[] }[] =
      [{ version: from, path: [] }];
    const visited = new Set<string>([from]);
    while (queue.length > 0) {
      const { version, path } = queue.shift()!;
      if (semver.eq(version, to)) return Object.freeze(path);
      const next = applicable
        .filter((e) => semver.eq(e.contribution.fromVersion, version))
        .sort((a, b) => a.contributionId.localeCompare(b.contributionId));
      for (const step of next) {
        const nv = step.contribution.toVersion;
        if (visited.has(nv)) {
          if (semver.eq(nv, to)) return Object.freeze([...path, step]);
          throw new MigrationPathError(
            "cycle-detected",
            `planPath: cycle detected at version "${nv}" for schema "${schemaId}".`,
          );
        }
        visited.add(nv);
        queue.push({ version: nv, path: [...path, step] });
      }
    }
    throw new MigrationPathError(
      "no-path",
      `planPath: no migration path for "${schemaId}" from ${from} → ${to}.`,
    );
  }
}
