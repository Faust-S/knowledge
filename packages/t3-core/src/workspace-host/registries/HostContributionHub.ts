/**
 * HostContributionHub — orchestrator for every contribution group
 * (PROMPT 17 §6).
 *
 * Registration of one module is transactional across ALL groups
 * (including routes through the existing RouteRegistry). If any group
 * rejects the batch, previously-accepted groups are rolled back and the
 * module is considered unregistered.
 */

import {
  emptyContributionSet,
  type ContributionBase,
  type ContributionGroup,
  type ContributionSet,
  type NavigationContribution,
  type ViewerContribution,
  type EditorContribution,
  type CommandContribution,
  type PanelContribution,
  type DashboardCardContribution,
  type ValidatorContribution,
  type MigrationContribution,
  type LegacyImporterContribution,
  type RouteContribution,
} from "@/workspace-contract";
import type { OperationId } from "@/kernel-client";
import { CommandRegistry } from "./CommandRegistry";
import { DashboardRegistry } from "./DashboardRegistry";
import { EditorRegistry } from "./EditorRegistry";
import { LegacyImporterRegistry } from "./LegacyImporterRegistry";
import { MigrationRegistry } from "./MigrationRegistry";
import { NavigationRegistry } from "./NavigationRegistry";
import { PanelRegistry } from "./PanelRegistry";
import { ValidatorRegistry } from "./ValidatorRegistry";
import { ViewerRegistry } from "./ViewerRegistry";
import type {
  RegistryBase,
  RegistryDiagnostic,
  RegistryEntryInput,
} from "./RegistryBase";
import {
  RouteRegistry,
  registerRouteContributions,
  type HostRouteBinding,
  type RouteContributionDiagnostic,
} from "../router";

export interface HostContributionHubOptions {
  routeRegistry: RouteRegistry;
  /** Bindings currently active in the Host — for route contribution validation. */
  hostRouteBindings: readonly HostRouteBinding[];
  /** Session-scoped granted operations — used by route validator. */
  grantedOperations: readonly OperationId[];
  /** Read-only capability snapshot used only for Workspace defense-in-depth. */
  activeCapabilities?: readonly string[];
  /** Optional overrides for tests. */
  registries?: {
    navigation?: NavigationRegistry;
    viewers?: ViewerRegistry;
    editors?: EditorRegistry;
    commands?: CommandRegistry;
    panels?: PanelRegistry;
    dashboard?: DashboardRegistry;
    validators?: ValidatorRegistry;
    migrations?: MigrationRegistry;
    legacyImporters?: LegacyImporterRegistry;
  };
}

export interface RegistrationResult {
  ok: boolean;
  diagnostics: readonly (RegistryDiagnostic | RouteContributionDiagnostic)[];
  /** Contribution ids accepted per group (empty on failure). */
  accepted: Readonly<Record<ContributionGroup, readonly string[]>>;
}

function snapshotContribution<T extends ContributionBase>(contribution: T): T {
  const snapshot = {
    ...contribution,
    requiredOperations: Object.freeze([...(contribution.requiredOperations ?? [])]),
    requiredCapabilitiesAll: contribution.requiredCapabilitiesAll === undefined
      ? undefined
      : Object.freeze([...contribution.requiredCapabilitiesAll]),
    requiredCapabilitiesAny: contribution.requiredCapabilitiesAny === undefined
      ? undefined
      : Object.freeze([...contribution.requiredCapabilitiesAny]),
  } as unknown as Record<string, unknown>;
  const routeRef = (contribution as unknown as { routeRef?: { readonly id: string } }).routeRef;
  if (routeRef) {
    snapshot.routeRef = Object.freeze({ id: routeRef.id });
  }
  return Object.freeze(snapshot) as unknown as T;
}

function snapshotContributionSet(contributions: Partial<ContributionSet>): ContributionSet {
  const source = { ...emptyContributionSet(), ...contributions };
  return {
    routes: source.routes.map(snapshotContribution),
    navigation: source.navigation.map(snapshotContribution),
    editors: source.editors.map(snapshotContribution),
    viewers: source.viewers.map(snapshotContribution),
    commands: source.commands.map(snapshotContribution),
    panels: source.panels.map(snapshotContribution),
    dashboard_cards: source.dashboard_cards.map(snapshotContribution),
    validators: source.validators.map(snapshotContribution),
    migrations: source.migrations.map(snapshotContribution),
    legacy_importers: source.legacy_importers.map(snapshotContribution),
  };
}

function inputFrom<
  T extends {
    id: string;
    moduleId: string;
    requiredOperations: readonly OperationId[];
    requiredCapabilitiesAll?: readonly string[];
    requiredCapabilitiesAny?: readonly string[];
  },
>(c: T): RegistryEntryInput<T> {
  return {
    contributionId: c.id,
    ownerModuleId: c.moduleId,
    requiredOperations: c.requiredOperations,
    requiredCapabilitiesAll: c.requiredCapabilitiesAll ?? [],
    requiredCapabilitiesAny: c.requiredCapabilitiesAny ?? [],
    contribution: c,
  };
}

export class HostContributionHub {
  readonly routes: RouteRegistry;
  readonly navigation: NavigationRegistry;
  readonly viewers: ViewerRegistry;
  readonly editors: EditorRegistry;
  readonly commands: CommandRegistry;
  readonly panels: PanelRegistry;
  readonly dashboard: DashboardRegistry;
  readonly validators: ValidatorRegistry;
  readonly migrations: MigrationRegistry;
  readonly legacyImporters: LegacyImporterRegistry;

  private readonly hostRouteBindings: readonly HostRouteBinding[];
  private readonly grantedOperations: readonly OperationId[];
  private readonly activeCapabilities: readonly string[];
  private readonly ownedRouteIds = new Map<string, Set<string>>();
  /** PROMPT 20 §1 — retain module route contributions for outlet lookup. */
  private readonly routeContributionsByRefId = new Map<
    string,
    { contribution: RouteContribution; moduleId: string }
  >();

  constructor(opts: HostContributionHubOptions) {
    this.routes = opts.routeRegistry;
    this.hostRouteBindings = opts.hostRouteBindings;
    this.grantedOperations = opts.grantedOperations;
    this.activeCapabilities = Object.freeze([...(opts.activeCapabilities ?? [])]);
    const r = opts.registries ?? {};
    this.navigation = r.navigation ?? new NavigationRegistry();
    this.viewers = r.viewers ?? new ViewerRegistry();
    this.editors = r.editors ?? new EditorRegistry();
    this.commands = r.commands ?? new CommandRegistry();
    this.panels = r.panels ?? new PanelRegistry();
    this.dashboard = r.dashboard ?? new DashboardRegistry();
    this.validators = r.validators ?? new ValidatorRegistry();
    this.migrations = r.migrations ?? new MigrationRegistry();
    this.legacyImporters = r.legacyImporters ?? new LegacyImporterRegistry();
  }

  registerModule(
    moduleId: string,
    contributions: Partial<ContributionSet>,
  ): RegistrationResult {
    const set = snapshotContributionSet(contributions);
    const diagnostics: (RegistryDiagnostic | RouteContributionDiagnostic)[] = [];
    const accepted: Record<ContributionGroup, string[]> = {
      routes: [],
      navigation: [],
      editors: [],
      viewers: [],
      commands: [],
      panels: [],
      dashboard_cards: [],
      validators: [],
      migrations: [],
      legacy_importers: [],
    };
    const rollbacks: Array<() => void> = [];

    const tryGroup = <T extends { id: string }>(
      group: ContributionGroup,
      registry: RegistryBase<T>,
      items: readonly T[],
    ): boolean => {
      if (items.length === 0) return true;
      const inputs = items.map((c) =>
        inputFrom(
          c as unknown as {
            id: string;
            moduleId: string;
            requiredOperations: readonly OperationId[];
            requiredCapabilitiesAll?: readonly string[];
            requiredCapabilitiesAny?: readonly string[];
          },
        ),
      ) as unknown as RegistryEntryInput<T>[];
      const active = new Set<string>(this.activeCapabilities);
      for (const input of inputs) {
        const requiredAll = input.requiredCapabilitiesAll ?? [];
        const requiredAny = input.requiredCapabilitiesAny ?? [];
        const missingAll = requiredAll.find((capability) => !active.has(capability));
        if (missingAll || (requiredAny.length > 0 && !requiredAny.some((capability) => active.has(capability)))) {
          diagnostics.push({
            code: "capability-not-granted",
            group,
            contributionId: input.contributionId,
            ownerModuleId: input.ownerModuleId,
            message: `${group}: contribution "${input.contributionId}" requires an inactive capability.`,
          });
          return false;
        }
      }
      const res = registry.registerMany(moduleId, inputs);
      if (!res.ok) {
        diagnostics.push(...res.diagnostics);
        return false;
      }
      for (const i of items) accepted[group].push(i.id);
      rollbacks.push(() => registry.removeOwner(moduleId));
      return true;
    };

    // Routes are handled first through the RouteRegistry, wrapped in a
    // rollback closure so a later group failure can undo them.
    if (set.routes.length > 0) {
      const routeCheck = registerRouteContributions({
        ownerModuleId: moduleId,
        contributions: set.routes as readonly RouteContribution[],
        hostBindings: this.hostRouteBindings,
        grantedOperations: this.grantedOperations,
        activeCapabilities: this.activeCapabilities,
      });
      if (!routeCheck.ok) {
        return {
          ok: false,
          diagnostics: Object.freeze(routeCheck.diagnostics),
          accepted: freezeAccepted(accepted),
        };
      }
      // The route registry only stores Host-owned bindings; module
      // route contributions are tracked here as ownership references we
      // can drop on rollback.
      const routeRefIds = new Set<string>();
      const activatedRefs = [];
      for (const r of routeCheck.accepted) {
        accepted.routes.push(r.id);
        if (r.routeRef?.id) routeRefIds.add(r.routeRef.id);
        if (r.routeRef) activatedRefs.push(r.routeRef);
      }
      this.ownedRouteIds.set(moduleId, routeRefIds);
      if (activatedRefs.length > 0) {
        const act = this.routes.activateOwnerRoutes(moduleId, activatedRefs);
        if (!act.ok) {
          this.ownedRouteIds.delete(moduleId);
          for (const d of act.diagnostics) {
            diagnostics.push({
              code: "unknown-route" as never,
              message: `route activation refused: ${d.message}`,
              routeRefId: d.routeRefId,
            } as RouteContributionDiagnostic);
          }
          return {
            ok: false,
            diagnostics: Object.freeze(diagnostics),
            accepted: freezeAccepted(accepted),
          };
        }
      }
      for (const r of routeCheck.accepted) {
        if (r.routeRef?.id) {
          this.routeContributionsByRefId.set(r.routeRef.id, {
            contribution: r as RouteContribution,
            moduleId,
          });
        }
      }
      rollbacks.push(() => {
        this.routes.deactivateOwnerRoutes(moduleId);
        this.ownedRouteIds.delete(moduleId);
        for (const r of routeCheck.accepted) {
          if (r.routeRef?.id) this.routeContributionsByRefId.delete(r.routeRef.id);
        }
      });
    }

    const ok =
      tryGroup<NavigationContribution>(
        "navigation",
        this.navigation,
        set.navigation,
      ) &&
      tryGroup<ViewerContribution>("viewers", this.viewers, set.viewers) &&
      tryGroup<EditorContribution>("editors", this.editors, set.editors) &&
      tryGroup<CommandContribution>("commands", this.commands, set.commands) &&
      tryGroup<PanelContribution>("panels", this.panels, set.panels) &&
      tryGroup<DashboardCardContribution>(
        "dashboard_cards",
        this.dashboard,
        set.dashboard_cards,
      ) &&
      tryGroup<ValidatorContribution>(
        "validators",
        this.validators,
        set.validators,
      ) &&
      tryGroup<MigrationContribution>(
        "migrations",
        this.migrations,
        set.migrations,
      ) &&
      tryGroup<LegacyImporterContribution>(
        "legacy_importers",
        this.legacyImporters,
        set.legacy_importers,
      );

    if (!ok) {
      // Rollback in reverse order.
      for (let i = rollbacks.length - 1; i >= 0; i--) {
        try {
          rollbacks[i]!();
        } catch {
          // ignore — best-effort cleanup.
        }
      }
      return {
        ok: false,
        diagnostics: Object.freeze(diagnostics),
        accepted: freezeAccepted({
          routes: [],
          navigation: [],
          editors: [],
          viewers: [],
          commands: [],
          panels: [],
          dashboard_cards: [],
          validators: [],
          migrations: [],
          legacy_importers: [],
        }),
      };
    }

    return {
      ok: true,
      diagnostics: [],
      accepted: freezeAccepted(accepted),
    };
  }

  removeModule(moduleId: string): void {
    this.navigation.removeOwner(moduleId);
    this.viewers.removeOwner(moduleId);
    this.editors.removeOwner(moduleId);
    this.commands.removeOwner(moduleId);
    this.panels.removeOwner(moduleId);
    this.dashboard.removeOwner(moduleId);
    this.validators.removeOwner(moduleId);
    this.migrations.removeOwner(moduleId);
    this.legacyImporters.removeOwner(moduleId);
    this.routes.deactivateOwnerRoutes(moduleId);
    const owned = this.ownedRouteIds.get(moduleId);
    if (owned) {
      for (const refId of owned) this.routeContributionsByRefId.delete(refId);
    }
    this.ownedRouteIds.delete(moduleId);
  }

  clear(): void {
    for (const moduleId of this.ownedRouteIds.keys()) {
      this.routes.deactivateOwnerRoutes(moduleId);
    }
    this.navigation.clear();
    this.viewers.clear();
    this.editors.clear();
    this.commands.clear();
    this.panels.clear();
    this.dashboard.clear();
    this.validators.clear();
    this.migrations.clear();
    this.legacyImporters.clear();
    this.ownedRouteIds.clear();
    this.routeContributionsByRefId.clear();
  }

  /** PROMPT 20 §1 — resolve an active route contribution for the outlet. */
  getRouteContribution(
    routeRefId: string,
  ): { contribution: RouteContribution; moduleId: string } | null {
    return this.routeContributionsByRefId.get(routeRefId) ?? null;
  }
}

function freezeAccepted(
  x: Record<ContributionGroup, string[]>,
): Readonly<Record<ContributionGroup, readonly string[]>> {
  const out = {} as Record<ContributionGroup, readonly string[]>;
  for (const [k, v] of Object.entries(x)) {
    out[k as ContributionGroup] = Object.freeze([...v]);
  }
  return Object.freeze(out);
}
