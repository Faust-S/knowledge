/**
 * RegistryBase — shared behaviour for every Host contribution registry
 * (PROMPT 17 §2).
 *
 * Guarantees:
 *   - Every entry carries `{ contributionId, ownerModuleId,
 *     requiredOperations, contribution }`.
 *   - Duplicate contribution ids are refused by group.
 *   - `registerMany` is atomic — a single failure rejects the whole
 *     batch and NOTHING is written.
 *   - Owner-cleanup removes every entry a module owns.
 *   - Snapshots are frozen; the internal Map is never handed out.
 *   - No loader is invoked at registration time.
 */

import type { OperationId } from "@/kernel-client";

export interface RegistryEntryInput<T> {
  contributionId: string;
  ownerModuleId: string;
  requiredOperations: readonly OperationId[];
  requiredCapabilitiesAll?: readonly string[];
  requiredCapabilitiesAny?: readonly string[];
  contribution: T;
}

export interface RegistryEntry<T> {
  readonly contributionId: string;
  readonly ownerModuleId: string;
  readonly requiredOperations: readonly OperationId[];
  readonly requiredCapabilitiesAll: readonly string[];
  readonly requiredCapabilitiesAny: readonly string[];
  readonly contribution: T;
}

export type RegistryDiagnosticCode =
  | "duplicate-contribution-id"
  | "owner-mismatch"
  | "invalid-contribution"
  | "missing-required-field"
  | "capability-not-granted";

export interface RegistryDiagnostic {
  code: RegistryDiagnosticCode;
  message: string;
  contributionId?: string;
  ownerModuleId?: string;
  group: string;
}

export interface RegisterResult {
  ok: boolean;
  diagnostics: readonly RegistryDiagnostic[];
}

/**
 * `owner` is optional. When set, every entry in the batch must declare
 * `ownerModuleId === owner`. When omitted the store trusts the caller.
 * Group name is a string label used only in diagnostics.
 */
export abstract class RegistryBase<TContribution> {
  protected readonly byId = new Map<string, RegistryEntry<TContribution>>();
  protected readonly byOwner = new Map<string, Set<string>>();

  constructor(public readonly group: string) {}

  size(): number {
    return this.byId.size;
  }

  has(contributionId: string): boolean {
    return this.byId.has(contributionId);
  }

  get(contributionId: string): RegistryEntry<TContribution> | null {
    return this.byId.get(contributionId) ?? null;
  }

  /** Immutable snapshot in insertion order. */
  snapshot(): readonly RegistryEntry<TContribution>[] {
    return Object.freeze([...this.byId.values()]);
  }

  contributionIdsOf(ownerModuleId: string): readonly string[] {
    const s = this.byOwner.get(ownerModuleId);
    return s ? Object.freeze([...s]) : Object.freeze([] as string[]);
  }

  /**
   * Validate a batch without committing. `owner` scopes ownership check.
   * Subclasses may override `additionalValidate()` for extra rules.
   */
  validateBatch(
    owner: string,
    entries: readonly RegistryEntryInput<TContribution>[],
  ): RegistryDiagnostic[] {
    const diags: RegistryDiagnostic[] = [];
    const seen = new Set<string>();
    for (const raw of entries) {
      if (!raw || typeof raw !== "object") {
        diags.push({
          code: "invalid-contribution",
          message: `${this.group}: entry is not an object.`,
          group: this.group,
        });
        continue;
      }
      const { contributionId, ownerModuleId, requiredOperations, contribution } = raw;
      const requiredCapabilitiesAll = raw.requiredCapabilitiesAll ?? [];
      const requiredCapabilitiesAny = raw.requiredCapabilitiesAny ?? [];
      if (typeof contributionId !== "string" || contributionId.length === 0) {
        diags.push({
          code: "missing-required-field",
          message: `${this.group}: contributionId is required.`,
          group: this.group,
        });
        continue;
      }
      if (ownerModuleId !== owner) {
        diags.push({
          code: "owner-mismatch",
          message: `${this.group}: contribution "${contributionId}" declares owner "${ownerModuleId}" but batch owner is "${owner}".`,
          contributionId,
          ownerModuleId,
          group: this.group,
        });
        continue;
      }
      if (!Array.isArray(requiredOperations)) {
        diags.push({
          code: "missing-required-field",
          message: `${this.group}: contribution "${contributionId}" missing requiredOperations array.`,
          contributionId,
          ownerModuleId,
          group: this.group,
        });
        continue;
      }
      if (!Array.isArray(requiredCapabilitiesAll) || !Array.isArray(requiredCapabilitiesAny) ||
          [...requiredCapabilitiesAll, ...requiredCapabilitiesAny].some((cap) => typeof cap !== "string" || cap.length < 3)) {
        diags.push({
          code: "missing-required-field",
          message: `${this.group}: contribution "${contributionId}" has invalid capability requirement arrays.`,
          contributionId, ownerModuleId, group: this.group,
        });
        continue;
      }
      if (contribution === undefined || contribution === null) {
        diags.push({
          code: "invalid-contribution",
          message: `${this.group}: contribution "${contributionId}" has no payload.`,
          contributionId,
          ownerModuleId,
          group: this.group,
        });
        continue;
      }
      if (seen.has(contributionId)) {
        diags.push({
          code: "duplicate-contribution-id",
          message: `${this.group}: batch contains duplicate id "${contributionId}".`,
          contributionId,
          ownerModuleId,
          group: this.group,
        });
        continue;
      }
      if (this.byId.has(contributionId)) {
        diags.push({
          code: "duplicate-contribution-id",
          message: `${this.group}: contribution "${contributionId}" is already registered.`,
          contributionId,
          ownerModuleId,
          group: this.group,
        });
        continue;
      }
      seen.add(contributionId);
      const extra = this.additionalValidate(raw);
      if (extra.length > 0) diags.push(...extra);
    }
    return diags;
  }

  /** Override to add group-specific validation. Default: no extra rules. */
  protected additionalValidate(
    _entry: RegistryEntryInput<TContribution>,
  ): RegistryDiagnostic[] {
    return [];
  }

  /**
   * Atomic bulk registration. On any diagnostic the batch is rejected
   * and nothing is written.
   */
  registerMany(
    owner: string,
    entries: readonly RegistryEntryInput<TContribution>[],
  ): RegisterResult {
    const diagnostics = this.validateBatch(owner, entries);
    if (diagnostics.length > 0) {
      return { ok: false, diagnostics: Object.freeze(diagnostics) };
    }
    for (const raw of entries) {
      const entry: RegistryEntry<TContribution> = Object.freeze({
        contributionId: raw.contributionId,
        ownerModuleId: raw.ownerModuleId,
        requiredOperations: Object.freeze([...raw.requiredOperations]),
        requiredCapabilitiesAll: Object.freeze([...(raw.requiredCapabilitiesAll ?? [])]),
        requiredCapabilitiesAny: Object.freeze([...(raw.requiredCapabilitiesAny ?? [])]),
        contribution: raw.contribution,
      });
      this.byId.set(entry.contributionId, entry);
      let owned = this.byOwner.get(owner);
      if (!owned) {
        owned = new Set();
        this.byOwner.set(owner, owned);
      }
      owned.add(entry.contributionId);
    }
    return { ok: true, diagnostics: [] };
  }

  removeOwner(ownerModuleId: string): readonly string[] {
    const owned = this.byOwner.get(ownerModuleId);
    if (!owned) return [];
    const removed = [...owned];
    for (const id of owned) this.byId.delete(id);
    this.byOwner.delete(ownerModuleId);
    return Object.freeze(removed);
  }

  clear(): void {
    this.byId.clear();
    this.byOwner.clear();
  }
}
