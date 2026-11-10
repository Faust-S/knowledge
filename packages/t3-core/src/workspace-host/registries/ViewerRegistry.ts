/**
 * ViewerRegistry (PROMPT 17 §4).
 *
 * Resolution key: (profileId, schemaId, schemaVersionRange, surface).
 *
 * Rules:
 *   - Exact profile match wins over the "generic" fallback.
 *   - SemVer matching uses the `semver` library — no ad-hoc parser.
 *   - Duplicate identical scope (same 4-tuple) is rejected.
 *   - Loaders are lazy and awaited only by the Host inside its own
 *     error boundary. Loader errors are isolated per viewer.
 *   - Unknown viewer → `resolve()` returns null.
 */

import semver from "semver";
import type { OperationId } from "@/kernel-client";
import type { ViewerContribution, ViewerSurface } from "@/workspace-contract";
import {
  RegistryBase,
  type RegistryDiagnostic,
  type RegistryEntry,
  type RegistryEntryInput,
} from "./RegistryBase";

export const GENERIC_PROFILE_ID = "generic";

export interface ViewerResolveQuery {
  profileId: string;
  schemaId: string;
  schemaVersion: string;
  surface: ViewerSurface;
}

export interface ViewerResolution {
  entry: RegistryEntry<ViewerContribution>;
  /** True when the resolved viewer came from the "generic" fallback. */
  isFallback: boolean;
  /** Lazy component loader — Host wraps in error boundary. */
  load: ViewerContribution["loader"];
}

function scopeKey(c: ViewerContribution): string {
  return `${c.profileId}|${c.schemaId}|${c.schemaVersionRange}|${c.surface}`;
}

export class ViewerRegistry extends RegistryBase<ViewerContribution> {
  private readonly scopeIndex = new Map<string, string>();

  constructor() {
    super("viewers");
  }

  protected override additionalValidate(
    entry: RegistryEntryInput<ViewerContribution>,
  ): RegistryDiagnostic[] {
    const diags: RegistryDiagnostic[] = [];
    const c = entry.contribution;
    if (c.kind !== "viewer") {
      diags.push({
        code: "invalid-contribution",
        message: `viewers: "${entry.contributionId}" kind is "${c.kind}", expected "viewer".`,
        contributionId: entry.contributionId,
        ownerModuleId: entry.ownerModuleId,
        group: "viewers",
      });
      return diags;
    }
    if (typeof c.loader !== "function") {
      diags.push({
        code: "invalid-contribution",
        message: `viewers: "${entry.contributionId}" loader must be a function.`,
        contributionId: entry.contributionId,
        ownerModuleId: entry.ownerModuleId,
        group: "viewers",
      });
    }
    if (semver.validRange(c.schemaVersionRange) === null) {
      diags.push({
        code: "invalid-contribution",
        message: `viewers: "${entry.contributionId}" has invalid semver range "${c.schemaVersionRange}".`,
        contributionId: entry.contributionId,
        ownerModuleId: entry.ownerModuleId,
        group: "viewers",
      });
    }
    const key = scopeKey(c);
    if (this.scopeIndex.has(key)) {
      diags.push({
        code: "duplicate-contribution-id",
        message: `viewers: scope (${key}) already registered by "${this.scopeIndex.get(key)}".`,
        contributionId: entry.contributionId,
        ownerModuleId: entry.ownerModuleId,
        group: "viewers",
      });
    }
    return diags;
  }

  override registerMany(
    owner: string,
    entries: readonly RegistryEntryInput<ViewerContribution>[],
  ) {
    // Per-batch scope collision check (super.additionalValidate cannot
    // see sibling entries in the same batch).
    const seen = new Map<string, string>();
    const extra = [];
    for (const raw of entries) {
      if (!raw?.contribution || raw.contribution.kind !== "viewer") continue;
      const k = scopeKey(raw.contribution);
      const prior = seen.get(k);
      if (prior) {
        extra.push({
          code: "duplicate-contribution-id" as const,
          message: `viewers: batch contains two entries for scope (${k}): "${prior}" and "${raw.contributionId}".`,
          contributionId: raw.contributionId,
          ownerModuleId: raw.ownerModuleId,
          group: "viewers",
        });
      } else {
        seen.set(k, raw.contributionId);
      }
    }
    if (extra.length > 0) {
      return { ok: false, diagnostics: Object.freeze(extra) };
    }
    const result = super.registerMany(owner, entries);
    if (result.ok) {
      for (const raw of entries) {
        this.scopeIndex.set(scopeKey(raw.contribution), raw.contributionId);
      }
    }
    return result;
  }

  override removeOwner(ownerModuleId: string): readonly string[] {
    const ids = super.removeOwner(ownerModuleId);
    for (const id of ids) {
      for (const [key, cid] of this.scopeIndex) {
        if (cid === id) this.scopeIndex.delete(key);
      }
    }
    return ids;
  }

  override clear(): void {
    super.clear();
    this.scopeIndex.clear();
  }

  /**
   * Best-viewer resolution. Exact profile wins over "generic".
   * Profile names never impose automatic display restrictions.
   */
  resolve(
    query: ViewerResolveQuery,
    grantedOperations: readonly OperationId[] = [],
    activeCapabilities: readonly string[] = [],
  ): ViewerResolution | null {
    const granted = new Set<string>(grantedOperations as readonly string[]);
    const active = new Set<string>(activeCapabilities);
    if (semver.valid(query.schemaVersion) === null) return null;

    const exact = this.pickBest(
      query,
      (c) => c.profileId === query.profileId,
      granted,
      active,
    );
    if (exact) return { entry: exact, isFallback: false, load: exact.contribution.loader };

    const fallback = this.pickBest(
      query,
      (c) => c.profileId === GENERIC_PROFILE_ID,
      granted,
      active,
    );
    if (fallback) {
      return { entry: fallback, isFallback: true, load: fallback.contribution.loader };
    }
    return null;
  }

  /** Boolean form for the ViewsFacade — no loader escape. */
  canResolve(
    query: ViewerResolveQuery,
    grantedOperations: readonly OperationId[] = [],
    activeCapabilities: readonly string[] = [],
  ): boolean {
    return this.resolve(query, grantedOperations, activeCapabilities) !== null;
  }

  private pickBest(
    query: ViewerResolveQuery,
    profileFilter: (c: ViewerContribution) => boolean,
    granted: ReadonlySet<string>,
    active: ReadonlySet<string>,
  ): RegistryEntry<ViewerContribution> | null {
    const candidates = this.snapshot().filter((e) => {
      const c = e.contribution;
      if (c.surface !== query.surface) return false;
      if (c.schemaId !== query.schemaId) return false;
      if (!profileFilter(c)) return false;
      if (!e.requiredOperations.every((operation) => granted.has(operation))) return false;
      if (!e.requiredCapabilitiesAll.every((capability) => active.has(capability))) return false;
      if (e.requiredCapabilitiesAny.length > 0 &&
          !e.requiredCapabilitiesAny.some((capability) => active.has(capability))) return false;
      return semver.satisfies(query.schemaVersion, c.schemaVersionRange, {
        includePrerelease: true,
      });
    });
    if (candidates.length === 0) return null;
    // Stable pick: narrowest range first (shortest range string is a
    // reasonable heuristic without a full range-comparator), then id.
    candidates.sort((a, b) => {
      const ra = a.contribution.schemaVersionRange.length;
      const rb = b.contribution.schemaVersionRange.length;
      if (ra !== rb) return ra - rb;
      return a.contributionId.localeCompare(b.contributionId);
    });
    return candidates[0]!;
  }
}
