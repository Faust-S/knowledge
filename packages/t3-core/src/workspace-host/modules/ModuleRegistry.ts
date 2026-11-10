/**
 * ModuleRegistry — PROMPT 13 + PROMPT 15.
 *
 * PROMPT 15 hardening:
 *   §1 transitive dependency-failure propagation (in dependency-graph);
 *   §2 runtime dependency-status gate before activation;
 *   §3 activation order + reverse deactivation, removeModule cascade check;
 *   §4 rollback (best-effort deactivate) when post-activate validation
 *      or store rejection fails;
 *   §5 rollback when activate() throws;
 *   §6 branded definition required (defineWorkspaceModule);
 *   §7 immutable, allow-listed module context;
 *   §8 severity-aware module-reported diagnostics;
 *   §9 stable state after an unexpected start() error;
 *   §10 provisional `pending` status while start() is in flight.
 */

import { ContributionStore } from "./contribution-store";
import { analyzeDependencies } from "./dependency-graph";
import { preflight } from "./module-resolution";
import { loadAndActivate } from "./module-loader";
import {
  registryDiagnostic,
  toErrorDetails,
  type RegistryDiagnostic,
} from "./module-diagnostics";
import type {
  ModuleContextProvider,
  ModuleDeclaration,
  ModuleLoaderTable,
  ModuleStatusRecord,
  ModuleRuntimeStatus,
  RegistryStartInput,
} from "./module-types";
import {
  ALLOWED_MODULE_CONTEXT_KEYS,
  FORBIDDEN_MODULE_CONTEXT_KEYS,
  type WorkspaceModuleContext,
  type WorkspaceModuleDefinition,
} from "@/workspace-contract";

interface InternalRecord {
  declaration: ModuleDeclaration | null;
  moduleId: string;
  status: ModuleRuntimeStatus;
  declaredState: ModuleStatusRecord["declaredState"];
  diagnostics: RegistryDiagnostic[];
  definition: WorkspaceModuleDefinition | null;
}

export class ModuleRegistry {
  private readonly store = new ContributionStore();
  private readonly records = new Map<string, InternalRecord>();
  /** PROMPT 15 §3 — modules recorded in order of full activation. */
  private activationOrder: string[] = [];
  /** Reverse-dep index for the active declaration set. */
  private dependents = new Map<string, Set<string>>();
  private started = false;
  /** PROMPT 17 §11 — hub reference retained during the active session. */
  private hub: RegistryStartInput["hub"] = undefined;

  get contributions(): ContributionStore {
    return this.store;
  }

  isStarted(): boolean {
    return this.started;
  }

  /** PROMPT 15 §3 — public read of the activation sequence. */
  getActivationOrder(): readonly string[] {
    return [...this.activationOrder];
  }

  async start(input: RegistryStartInput): Promise<readonly ModuleStatusRecord[]> {
    if (this.started) {
      throw new Error("ModuleRegistry.start() called twice without stop().");
    }
    this.started = true;

    try {
      return await this.startImpl(input);
    } catch (err) {
      // PROMPT 15 §9 — unexpected error while starting: roll everything
      // back so the registry is not left in `started = true` limbo.
      await this.rollbackAll();
      this.started = false;
      throw err;
    }
  }

  private async startImpl(
    input: RegistryStartInput,
  ): Promise<readonly ModuleStatusRecord[]> {
    const { declarations, loaderTable, runtime, contextProvider, hub } = input;
    this.hub = hub;

    // --- Seed records with the provisional `pending` state (§10) ---------
    const seen = new Set<string>();
    for (const decl of declarations) {
      if (seen.has(decl.moduleId)) continue;
      seen.add(decl.moduleId);
      this.records.set(decl.moduleId, {
        moduleId: decl.moduleId,
        declaration: decl,
        declaredState: decl.state,
        status: mapDeclaredStateToStatus(decl.state),
        diagnostics: [],
        definition: null,
      });
    }

    // Reverse-dep index over active declarations.
    this.dependents = new Map();
    for (const [id, rec] of this.records) {
      if (!rec.declaration || rec.declaration.state !== "active") continue;
      if (!this.dependents.has(id)) this.dependents.set(id, new Set());
      for (const dep of rec.declaration.dependencies) {
        if (!this.dependents.has(dep)) this.dependents.set(dep, new Set());
        this.dependents.get(dep)!.add(id);
      }
    }

    // --- Dependency graph ------------------------------------------------
    const graph = analyzeDependencies(declarations);
    for (const id of graph.failed) {
      const rec = this.records.get(id);
      if (!rec) continue;
      const diags = graph.perModule.get(id) ?? [];
      rec.diagnostics.push(...diags);
      if (diags.some((d) => d.code === "duplicate-module-id")) {
        rec.status = "duplicate-module-id";
      } else {
        rec.status = "dependency-error";
      }
    }

    const loaderIds = new Set<string>(Object.keys(loaderTable));

    // --- Iterate in topological order ------------------------------------
    for (const moduleId of graph.order) {
      const rec = this.records.get(moduleId);
      if (!rec || !rec.declaration) continue;
      if (rec.status !== "pending") continue;

      // PROMPT 15 §2 — runtime dep status gate.
      const depFailure = this.checkDependencyRuntimeStatus(rec.declaration);
      if (depFailure) {
        rec.status = "dependency-error";
        rec.diagnostics.push(depFailure);
        continue;
      }

      const depDiags = graph.perModule.get(moduleId) ?? [];
      const pf = preflight({
        declaration: rec.declaration,
        runtime,
        loaderIds,
        dependencyFailed: graph.failed.has(moduleId),
        dependencyDiagnostics: depDiags,
      });
      if (!pf.ok) {
        rec.status = pf.status;
        rec.diagnostics.push(...pf.diagnostics);
        continue;
      }

      // PROMPT 15 §7 — build + validate immutable context BEFORE load.
      let rawContext: WorkspaceModuleContext;
      try {
        rawContext = contextProvider.createContext(moduleId);
      } catch (err) {
        rec.status = "context-invalid";
        rec.diagnostics.push(
          registryDiagnostic(
            "context-invalid",
            `Не удалось построить контекст модуля "${moduleId}".`,
            { moduleId, details: toErrorDetails(err) },
          ),
        );
        continue;
      }

      let frozenContext: WorkspaceModuleContext;
      try {
        frozenContext = buildImmutableContext(rawContext);
      } catch (err) {
        rec.status = "context-invalid";
        rec.diagnostics.push(
          registryDiagnostic(
            "context-invalid",
            `Контекст модуля "${moduleId}" нарушает инварианты Workspace Contract.`,
            { moduleId, details: toErrorDetails(err) },
          ),
        );
        continue;
      }

      const result = await loadAndActivate({
        declaration: rec.declaration,
        loaderTable,
        runtime,
        context: frozenContext,
      });

      if (!result.ok) {
        rec.status = result.status;
        rec.diagnostics.push(...result.diagnostics);
        if (result.definition) rec.definition = result.definition;
        // PROMPT 15 §4/§5 — best-effort rollback if activate() ran.
        if (result.activateInvoked && result.definition) {
          const rollbackDiag = await bestEffortDeactivate(
            moduleId,
            result.definition,
          );
          if (rollbackDiag) rec.diagnostics.push(rollbackDiag);
          this.store.removeModuleContributions(moduleId);
        this.hub?.removeModule(moduleId);
        }
        continue;
      }

      rec.definition = result.definition;
      rec.diagnostics.push(...result.diagnostics);

      // PROMPT 15 §4 — store rejection triggers rollback.
      const add = this.store.addModuleContributions(
        moduleId,
        result.ownedContributions,
      );
      if (!add.ok) {
        rec.status = "contribution-invalid";
        rec.diagnostics.push(...add.diagnostics);
        this.store.removeModuleContributions(moduleId);
        this.hub?.removeModule(moduleId);
        const rollbackDiag = await bestEffortDeactivate(
          moduleId,
          result.definition,
        );
        if (rollbackDiag) rec.diagnostics.push(rollbackDiag);
        continue;
      }

      // PROMPT 17 §11 — mirror into HostContributionHub if wired.
      if (hub) {
        const grouped: Record<string, unknown[]> = {};
        for (const { group, contribution } of result.ownedContributions) {
          (grouped[group] ??= []).push(contribution);
        }
        const hubRes = hub.registerModule(moduleId, grouped as Record<string, readonly unknown[]>);
        if (!hubRes.ok) {
          rec.status = "contribution-invalid";
          for (const d of hubRes.diagnostics) {
            rec.diagnostics.push(
              registryDiagnostic(
                "contribution-invalid",
                `HostContributionHub отказал в регистрации модуля "${moduleId}": ${d.message}`,
                { moduleId, details: { hubCode: d.code } },
              ),
            );
          }
          this.store.removeModuleContributions(moduleId);
        this.hub?.removeModule(moduleId);
          const rollbackDiag = await bestEffortDeactivate(moduleId, result.definition);
          if (rollbackDiag) rec.diagnostics.push(rollbackDiag);
          continue;
        }
      }

      rec.status = "activated";
      this.activationOrder.push(moduleId);
    }

    // Any leftover `pending` records mean the module was excluded from
    // the topological order without a status having been set. Mark as
    // dependency-error so it never leaks to the snapshot as `pending`.
    for (const rec of this.records.values()) {
      if (rec.status !== "pending") continue;
      if (rec.declaredState !== "active") continue;
      rec.status = "dependency-error";
      const diags = graph.perModule.get(rec.moduleId) ?? [];
      rec.diagnostics.push(...diags);
    }

    return this.snapshot();
  }

  /**
   * PROMPT 15 §2 — runtime dep gate. Every declared dependency must be
   * `activated` at the moment we attempt to activate this module.
   */
  private checkDependencyRuntimeStatus(
    decl: ModuleDeclaration,
  ): RegistryDiagnostic | null {
    for (const dep of decl.dependencies) {
      const depRec = this.records.get(dep);
      if (!depRec) {
        return registryDiagnostic(
          "dependency-unavailable",
          `Зависимость "${dep}" модуля "${decl.moduleId}" отсутствует в реестре.`,
          { moduleId: decl.moduleId, details: { dependency: dep } },
        );
      }
      if (depRec.status !== "activated") {
        return registryDiagnostic(
          "dependency-unavailable",
          `Зависимость "${dep}" модуля "${decl.moduleId}" находится в состоянии "${depRec.status}", а не "activated".`,
          {
            moduleId: decl.moduleId,
            details: {
              dependency: dep,
              dependencyStatus: depRec.status,
            },
          },
        );
      }
    }
    return null;
  }

  /**
   * PROMPT 15 §9 — internal all-out rollback used by the start() safety
   * net. Deactivates already-activated modules in reverse order.
   */
  private async rollbackAll(): Promise<void> {
    const order = [...this.activationOrder].reverse();
    for (const id of order) {
      const rec = this.records.get(id);
      if (!rec || !rec.definition) continue;
      await bestEffortDeactivate(id, rec.definition).catch(() => null);
      this.store.removeModuleContributions(id);
        this.hub?.removeModule(id);
    }
    this.records.clear();
    this.activationOrder = [];
    this.dependents = new Map();
  }

  /**
   * PROMPT 15 §3 — stop in reverse activation order so dependents shut
   * down before the dependencies they consume.
   */
  async stop(): Promise<readonly RegistryDiagnostic[]> {
    if (!this.started) return [];
    const diagnostics: RegistryDiagnostic[] = [];

    const order = [...this.activationOrder].reverse();
    for (const moduleId of order) {
      const rec = this.records.get(moduleId);
      if (!rec) continue;
      const def = rec.definition;
      if (rec.status === "activated" && def && typeof def.deactivate === "function") {
        try {
          await def.deactivate();
        } catch (err) {
          rec.status = "deactivation-error";
          const d = registryDiagnostic(
            "deactivation-error",
            `deactivate() модуля "${moduleId}" завершился ошибкой.`,
            { moduleId, details: toErrorDetails(err) },
          );
          rec.diagnostics.push(d);
          diagnostics.push(d);
        }
      }
      this.store.removeModuleContributions(moduleId);
        this.hub?.removeModule(moduleId);
    }

    // Also drop any records/contributions for non-activated entries.
    for (const [moduleId] of this.records) {
      this.store.removeModuleContributions(moduleId);
        this.hub?.removeModule(moduleId);
    }

    this.records.clear();
    this.activationOrder = [];
    this.dependents = new Map();
    this.started = false;
    this.hub = undefined;
    return diagnostics;
  }

  /**
   * PROMPT 15 §3 — public remove refuses to drop a dependency that still
   * has active dependents unless `internalCascade` is set.
   */
  async removeModule(
    moduleId: string,
    options: { internalCascade?: boolean } = {},
  ): Promise<readonly RegistryDiagnostic[]> {
    const rec = this.records.get(moduleId);
    if (!rec) return [];

    if (!options.internalCascade) {
      const active = this.activeDependentsOf(moduleId);
      if (active.length > 0) {
        return [
          registryDiagnostic(
            "active-dependents",
            `Модуль "${moduleId}" нельзя удалить: у него есть активные зависимые модули.`,
            {
              moduleId,
              details: { activeDependents: active },
            },
          ),
        ];
      }
    }

    const diagnostics: RegistryDiagnostic[] = [];
    const def = rec.definition;
    if (rec.status === "activated" && def && typeof def.deactivate === "function") {
      try {
        await def.deactivate();
      } catch (err) {
        const d = registryDiagnostic(
          "deactivation-error",
          `deactivate() модуля "${moduleId}" завершился ошибкой.`,
          { moduleId, details: toErrorDetails(err) },
        );
        diagnostics.push(d);
        rec.diagnostics.push(d);
      }
    }
    this.store.removeModuleContributions(moduleId);
        this.hub?.removeModule(moduleId);
    this.activationOrder = this.activationOrder.filter((x) => x !== moduleId);
    this.records.delete(moduleId);
    return diagnostics;
  }

  private activeDependentsOf(moduleId: string): string[] {
    const set = this.dependents.get(moduleId);
    if (!set) return [];
    const active: string[] = [];
    for (const id of set) {
      const rec = this.records.get(id);
      if (rec && rec.status === "activated") active.push(id);
    }
    return active;
  }

  snapshot(): readonly ModuleStatusRecord[] {
    return [...this.records.values()].map((rec) => ({
      moduleId: rec.moduleId,
      declaredState: rec.declaredState,
      status: rec.status,
      diagnostics: [...rec.diagnostics],
      contributionIds: this.store.contributionIdsFor(rec.moduleId),
    }));
  }

  getStatus(moduleId: string): ModuleStatusRecord | null {
    const rec = this.records.get(moduleId);
    if (!rec) return null;
    return {
      moduleId: rec.moduleId,
      declaredState: rec.declaredState,
      status: rec.status,
      diagnostics: [...rec.diagnostics],
      contributionIds: this.store.contributionIdsFor(moduleId),
    };
  }

  allDiagnostics(): readonly RegistryDiagnostic[] {
    const out: RegistryDiagnostic[] = [];
    for (const rec of this.records.values()) out.push(...rec.diagnostics);
    return out;
  }
}

// ---------------------------------------------------------------------------
// PROMPT 15 §5 — helper: best-effort deactivate. Never throws; returns a
// diagnostic when deactivate() itself failed so the caller can attach it.
// ---------------------------------------------------------------------------

async function bestEffortDeactivate(
  moduleId: string,
  definition: WorkspaceModuleDefinition,
): Promise<RegistryDiagnostic | null> {
  if (typeof definition.deactivate !== "function") return null;
  try {
    await definition.deactivate();
    return null;
  } catch (err) {
    return registryDiagnostic(
      "deactivation-error",
      `Откат activate() модуля "${moduleId}" завершился ошибкой в deactivate().`,
      { moduleId, details: toErrorDetails(err) },
    );
  }
}

// ---------------------------------------------------------------------------
// PROMPT 15 §7 — construct an immutable, allow-listed context facade.
// Reject any unexpected/forbidden key BEFORE touching activate().
// ---------------------------------------------------------------------------

function buildImmutableContext(
  raw: WorkspaceModuleContext,
): WorkspaceModuleContext {
  if (!raw || typeof raw !== "object") {
    throw new Error("module context must be an object");
  }
  for (const key of FORBIDDEN_MODULE_CONTEXT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      throw new Error(`forbidden module context key: ${key}`);
    }
  }
  const allowed = new Set<string>(ALLOWED_MODULE_CONTEXT_KEYS as readonly string[]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      throw new Error(`unexpected module context key: ${key}`);
    }
  }

  const rawAsRecord = raw as unknown as Record<string, unknown>;
  const facade: Record<string, unknown> = {};
  for (const key of ALLOWED_MODULE_CONTEXT_KEYS) {
    const value = rawAsRecord[key];
    if (value === undefined) {
      throw new Error(`module context is missing required key: ${key}`);
    }
    facade[key] = value;
  }

  // Freeze kernel's granted arrays defensively.
  const kernel = facade.kernel as Record<string, unknown> | undefined;
  if (kernel) {
    const cloned: Record<string, unknown> = { ...kernel };
    if (Array.isArray(cloned.grantedOperations)) {
      cloned.grantedOperations = Object.freeze([...(cloned.grantedOperations as unknown[])]);
    }
    if (Array.isArray(cloned.grantedLevels)) {
      cloned.grantedLevels = Object.freeze([...(cloned.grantedLevels as unknown[])]);
    }
    facade.kernel = Object.freeze(cloned);
  }

  return Object.freeze(facade) as unknown as WorkspaceModuleContext;
}

function mapDeclaredStateToStatus(
  state: ModuleDeclaration["state"],
): ModuleRuntimeStatus {
  if (state === "planned") return "planned";
  if (state === "disabled") return "disabled";
  return "pending";
}

/** Re-exports for consumers. */
export type { ModuleLoaderTable, ModuleDeclaration, ModuleContextProvider };
