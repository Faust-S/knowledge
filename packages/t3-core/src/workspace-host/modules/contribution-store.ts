/**
 * ContributionStore (PROMPT 13 §7).
 *
 * Owns every contribution surfaced by activated modules, keyed by
 * (group, id) with a strict owner association. Activation is
 * ALL-OR-NOTHING: a batch that contains ANY invalid or duplicate id
 * (either inside itself or against previously-registered contributions)
 * is rejected in full and NOTHING is written.
 *
 * Modules never receive a mutable handle to the store — the AppShell
 * queries it through `listByGroup` / `findById`; module activate() only
 * *returns* contributions and the registry passes them here.
 */

import {
  CONTRIBUTION_GROUPS,
  type AnyContribution,
  type ContributionGroup,
} from "@/workspace-contract";
import { registryDiagnostic, type RegistryDiagnostic } from "./module-diagnostics";

interface OwnedEntry {
  moduleId: string;
  group: ContributionGroup;
  contributionId: string;
  contribution: AnyContribution;
}

function snapshotContribution(contribution: AnyContribution): AnyContribution {
  const copy: Record<string, unknown> = {
    ...contribution,
    requiredOperations: Object.freeze([...(contribution.requiredOperations ?? [])]),
    requiredCapabilitiesAll: contribution.requiredCapabilitiesAll === undefined
      ? undefined
      : Object.freeze([...contribution.requiredCapabilitiesAll]),
    requiredCapabilitiesAny: contribution.requiredCapabilitiesAny === undefined
      ? undefined
      : Object.freeze([...contribution.requiredCapabilitiesAny]),
  };
  if ("routeRef" in contribution && contribution.routeRef) {
    copy.routeRef = Object.freeze({ id: contribution.routeRef.id });
  }
  return Object.freeze(copy) as unknown as AnyContribution;
}

export interface AddContributionsResult {
  ok: boolean;
  diagnostics: readonly RegistryDiagnostic[];
}

export class ContributionStore {
  private readonly buckets: Map<ContributionGroup, Map<string, OwnedEntry>> =
    new Map();
  private readonly ownerIndex: Map<string, OwnedEntry[]> = new Map();

  constructor() {
    for (const g of CONTRIBUTION_GROUPS) this.buckets.set(g, new Map());
  }

  /**
   * Atomically register every contribution that belongs to `moduleId`.
   * Rejects the whole batch on the first violation so no half-populated
   * state is ever visible.
   */
  addModuleContributions(
    moduleId: string,
    contributions: readonly { group: ContributionGroup; contribution: AnyContribution }[],
  ): AddContributionsResult {
    const diagnostics: RegistryDiagnostic[] = [];
    const batchSeen = new Map<string, true>(); // `${group}:${id}` within batch

    for (const { group, contribution } of contributions) {
      if (!CONTRIBUTION_GROUPS.includes(group)) {
        diagnostics.push(
          registryDiagnostic(
            "contribution-invalid",
            `Неизвестная группа контрибуций "${group}".`,
            { moduleId, details: { group } },
          ),
        );
        continue;
      }
      if (!contribution || typeof contribution !== "object") {
        diagnostics.push(
          registryDiagnostic(
            "contribution-invalid",
            `Модуль "${moduleId}" вернул контрибуцию, не являющуюся объектом.`,
            { moduleId, details: { group } },
          ),
        );
        continue;
      }
      const id = (contribution as { id?: unknown }).id;
      if (typeof id !== "string" || id.length === 0) {
        diagnostics.push(
          registryDiagnostic(
            "contribution-invalid",
            `Контрибуция группы "${group}" модуля "${moduleId}" не имеет id.`,
            { moduleId, details: { group } },
          ),
        );
        continue;
      }
      if (contribution.moduleId !== moduleId) {
        diagnostics.push(
          registryDiagnostic(
            "contribution-invalid",
            `Контрибуция "${id}" объявляет владельца "${contribution.moduleId}", ожидается "${moduleId}".`,
            { moduleId, details: { group, id, declaredOwner: contribution.moduleId } },
          ),
        );
        continue;
      }
      const key = `${group}:${id}`;
      if (batchSeen.has(key)) {
        diagnostics.push(
          registryDiagnostic(
            "duplicate-contribution-id",
            `Модуль "${moduleId}" вернул дубликат контрибуции "${id}" в группе "${group}".`,
            { moduleId, details: { group, id } },
          ),
        );
        continue;
      }
      batchSeen.set(key, true);

      const existing = this.buckets.get(group)!.get(id);
      if (existing) {
        diagnostics.push(
          registryDiagnostic(
            "duplicate-contribution-id",
            `Контрибуция "${id}" в группе "${group}" уже зарегистрирована модулем "${existing.moduleId}".`,
            { moduleId, details: { group, id, previousOwner: existing.moduleId } },
          ),
        );
      }
    }

    if (diagnostics.length > 0) {
      return { ok: false, diagnostics };
    }

    // Commit — batch is clean.
    const owned: OwnedEntry[] = [];
    for (const { group, contribution } of contributions) {
      const frozenContribution = snapshotContribution(contribution);
      const entry: OwnedEntry = {
        moduleId,
        group,
        contributionId: frozenContribution.id,
        contribution: frozenContribution,
      };
      this.buckets.get(group)!.set(entry.contributionId, entry);
      owned.push(entry);
    }
    const prev = this.ownerIndex.get(moduleId) ?? [];
    this.ownerIndex.set(moduleId, [...prev, ...owned]);
    return { ok: true, diagnostics: [] };
  }

  /** Remove every contribution owned by `moduleId`. Idempotent. */
  removeModuleContributions(moduleId: string): readonly OwnedEntry[] {
    const owned = this.ownerIndex.get(moduleId) ?? [];
    for (const entry of owned) {
      const bucket = this.buckets.get(entry.group);
      if (bucket && bucket.get(entry.contributionId)?.moduleId === moduleId) {
        bucket.delete(entry.contributionId);
      }
    }
    this.ownerIndex.delete(moduleId);
    return owned;
  }

  listByGroup(group: ContributionGroup): readonly AnyContribution[] {
    const bucket = this.buckets.get(group);
    if (!bucket) return [];
    return [...bucket.values()].map((e) => e.contribution);
  }

  findById(
    group: ContributionGroup,
    id: string,
  ): { moduleId: string; contribution: AnyContribution } | null {
    const bucket = this.buckets.get(group);
    if (!bucket) return null;
    const entry = bucket.get(id);
    if (!entry) return null;
    return { moduleId: entry.moduleId, contribution: entry.contribution };
  }

  /** Ids owned by a module, in insertion order. Diagnostic helper. */
  contributionIdsFor(moduleId: string): readonly string[] {
    const owned = this.ownerIndex.get(moduleId) ?? [];
    return owned.map((e) => e.contributionId);
  }

  /** Total contribution count across every group. Test helper. */
  size(): number {
    let n = 0;
    for (const bucket of this.buckets.values()) n += bucket.size;
    return n;
  }
}
