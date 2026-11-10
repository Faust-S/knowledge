/**
 * ModuleRegistry public types — PROMPT 13 / PROMPT 15.
 */

import type {
  RuntimeCompatibilityView,
  WorkspaceModuleContext,
  WorkspaceModuleDefinition,
  AnyContribution,
  ContributionGroup,
} from "@/workspace-contract";
import type { Level } from "@/kernel-client/contracts/runtime-1.3.0";
import type { OperationId } from "@/kernel-client";
import type { RegistryDiagnostic } from "./module-diagnostics";

// --- Loader table ----------------------------------------------------------

export type ModuleLoaderTable = Readonly<
  Record<string, () => Promise<{ default: WorkspaceModuleDefinition }>>
>;

// --- Declarations ----------------------------------------------------------

export type ModuleDeclaredState = "active" | "planned" | "disabled";

export interface ModuleDeclaration {
  moduleId: string;
  state: ModuleDeclaredState;
  requiredLevels: readonly Level[];
  requiredOperations: readonly OperationId[];
  requiredCapabilitiesAll?: readonly string[];
  requiredCapabilitiesAny?: readonly string[];
  dependencies: readonly string[];
}

// --- Runtime status --------------------------------------------------------

/**
 * Terminal per-module state produced by the registry.
 *
 * PROMPT 15:
 *   - `pending` — provisional state before load+activate has been
 *     attempted. Never observable outside `start()`.
 *   - `definition-unverified` — loader returned an unbranded definition.
 *   - `context-invalid` — Host produced a context that violated the
 *     module context invariants.
 *   - `contribution-invalid` — activation returned contributions that
 *     violated the manifest / contract shape.
 */
export type ModuleRuntimeStatus =
  | "pending"
  | "planned"
  | "disabled"
  | "unknown"
  | "duplicate-module-id"
  | "incompatible"
  | "dependency-error"
  | "missing-level"
  | "missing-operation"
  | "missing-capability"
  | "loader-failed"
  | "definition-unverified"
  | "context-invalid"
  | "module-id-mismatch"
  | "contribution-invalid"
  | "activation-error"
  | "deactivation-error"
  | "activated";

export interface ModuleStatusRecord {
  moduleId: string;
  declaredState: ModuleDeclaredState | "not-declared";
  status: ModuleRuntimeStatus;
  diagnostics: readonly RegistryDiagnostic[];
  contributionIds: readonly string[];
}

// --- Context provider ------------------------------------------------------

export interface ModuleContextProvider {
  createContext(moduleId: string): WorkspaceModuleContext;
}

// --- Registry input --------------------------------------------------------

export interface RegistryStartInput {
  declarations: readonly ModuleDeclaration[];
  loaderTable: ModuleLoaderTable;
  runtime: RuntimeCompatibilityView;
  contextProvider: ModuleContextProvider;
  /**
   * PROMPT 17 §11 — optional wire-through to the production
   * HostContributionHub. When present, the registry mirrors each
   * successful activation into the hub and cleans it up on
   * deactivation. The hub type is imported lazily via `unknown` to keep
   * this module free of a compile-time dependency on host code.
   */
  hub?: {
    registerModule(
      moduleId: string,
      contributions: Record<string, readonly unknown[]>,
    ): { ok: boolean; diagnostics: readonly { code: string; message: string }[] };
    removeModule(moduleId: string): void;
  };
}

// --- Contribution store record --------------------------------------------

export interface OwnedContribution {
  moduleId: string;
  group: ContributionGroup;
  contribution: AnyContribution;
}
