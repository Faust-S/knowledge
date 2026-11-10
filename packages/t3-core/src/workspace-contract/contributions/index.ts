/**
 * Contribution types.
 *
 * Every contribution the Workspace Contract accepts is declared as a strict
 * TypeScript type here. Contributions travel from a module's `activate()`
 * function through the (future) ModuleRegistry into the Host — the types
 * are the same on both sides.
 *
 * COMMON RULES for every contribution:
 *   - `id` is unique within the containing contribution group.
 *   - `moduleId` identifies the owning module and MUST match the manifest.
 *   - `requiredOperations` names the exact `granted_operations` strings the
 *     contribution needs to function; the Host will refuse to mount the
 *     contribution when any required operation is not granted.
 *   - UI contributions carry a `loader` that returns a component or module
 *     lazily. The Host will wrap every UI contribution in its own error
 *     boundary — modules MUST NOT provide their own top-level boundary.
 */

import type { ComponentType } from "react";
import type { OperationId } from "../../kernel-client";
import type { RouteRef } from "../route-ref";

// --- Common surface --------------------------------------------------------

export interface ContributionBase {
  id: string;
  moduleId: string;
  requiredOperations: readonly OperationId[];
  /** Defense-in-depth Workspace guard; Kernel remains operation authority. */
  requiredCapabilitiesAll?: readonly string[];
  /** When non-empty, at least one capability must be ACTIVE. */
  requiredCapabilitiesAny?: readonly string[];
}

/**
 * Lazy loader for a React component. The Host is the ONLY party that awaits
 * this promise, and it does so inside an error boundary. The loader MUST NOT
 * perform any Kernel or storage work.
 */
export type ComponentLoader<TProps = unknown> = () => Promise<{
  default: ComponentType<TProps>;
}>;

/**
 * Lazy loader for an arbitrary contribution module. Same isolation contract
 * as `ComponentLoader`: the Host owns the promise lifecycle and error
 * boundary.
 */
export type ModuleLoader<T = unknown> = () => Promise<T>;

// --- UI contributions ------------------------------------------------------

export interface RouteContribution extends ContributionBase {
  kind: "route";
  /**
   * Opaque route reference. The Host owns the mapping from `routeRef` to
   * a concrete URL — modules never carry raw paths or hashes across the
   * contract boundary (Workspace Contract 0.1, PROMPT 12 §4).
   */
  routeRef: RouteRef;
  loader: ComponentLoader;
}

export interface NavigationContribution extends ContributionBase {
  kind: "navigation";
  /** Terminology key OR a literal label — the shell prefers keys. */
  labelKey: string;
  /** Opaque route reference; navigation MUST NOT carry raw paths. */
  routeRef: RouteRef;
  placement: "primary" | "utility";
  order: number;
}

export type ViewerSurface = "preview" | "list" | "detail" | "player";

export interface ViewerProps { data: unknown; mode?: "preview" | "detail"; }

export interface ViewerContribution extends ContributionBase {
  kind: "viewer";
  /** Human-readable name declared by the owner. */
  label?: string;
  profileId: string;
  schemaId: string;
  /**
   * SemVer range the viewer supports. The Host resolves the best viewer for
   * an object by matching (`profileId`, `schemaId`, `schemaVersionRange`).
   */
  schemaVersionRange: string;
  surface: ViewerSurface;
  loader: ComponentLoader<ViewerProps>;
}

export interface EditorContribution extends ContributionBase {
  kind: "editor";
  profileId: string;
  schemaId: string;
  schemaVersionRange: string;
  loader: ComponentLoader;
}

export interface PanelContribution extends ContributionBase {
  kind: "panel";
  slot: "inspector" | "sidebar" | "footer";
  loader: ComponentLoader;
}

export interface DashboardCardContribution extends ContributionBase {
  kind: "dashboard_card";
  size: "small" | "medium" | "large";
  loader: ComponentLoader;
}

// --- Behavioural contributions --------------------------------------------

export interface CommandContribution extends ContributionBase {
  kind: "command";
  labelKey: string;
  /**
   * Loader returns `{ run(ctx, args?) }`. Handlers MAY return a
   * Runtime receipt (or any value); the Host preserves it and passes
   * it back to the caller via `CommandsFacade.invoke<TResult>()`
   * (PROMPT 29 §2). The Host owns invocation and error boundaries.
   */
  loader: ModuleLoader<{
    run(context: unknown, args?: unknown): Promise<unknown> | unknown;
  }>;
}


export interface ValidatorContribution extends ContributionBase {
  kind: "validator";
  schemaId: string;
  schemaVersionRange: string;
  loader: ModuleLoader<{
    validate(input: unknown): { ok: boolean; issues?: unknown[] };
  }>;
}

export interface MigrationContribution extends ContributionBase {
  kind: "migration";
  schemaId: string;
  fromVersion: string;
  toVersion: string;
  loader: ModuleLoader<{ migrate(input: unknown): unknown }>;
}

export interface LegacyImporterContribution extends ContributionBase {
  kind: "legacy_importer";
  /** Discriminator for the legacy format the importer understands. */
  formatId: string;
  loader: ModuleLoader<{
    detect(bytes: Uint8Array | string): boolean;
    import(bytes: Uint8Array | string): unknown;
  }>;
}

// --- Group aggregate -------------------------------------------------------

export interface ContributionSet {
  routes: RouteContribution[];
  navigation: NavigationContribution[];
  editors: EditorContribution[];
  viewers: ViewerContribution[];
  commands: CommandContribution[];
  panels: PanelContribution[];
  dashboard_cards: DashboardCardContribution[];
  validators: ValidatorContribution[];
  migrations: MigrationContribution[];
  legacy_importers: LegacyImporterContribution[];
}

export const CONTRIBUTION_GROUPS = [
  "routes",
  "navigation",
  "editors",
  "viewers",
  "commands",
  "panels",
  "dashboard_cards",
  "validators",
  "migrations",
  "legacy_importers",
] as const;

export type ContributionGroup = (typeof CONTRIBUTION_GROUPS)[number];

export function emptyContributionSet(): ContributionSet {
  return {
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
}

export type AnyContribution =
  | RouteContribution
  | NavigationContribution
  | ViewerContribution
  | EditorContribution
  | CommandContribution
  | PanelContribution
  | DashboardCardContribution
  | ValidatorContribution
  | MigrationContribution
  | LegacyImporterContribution;
