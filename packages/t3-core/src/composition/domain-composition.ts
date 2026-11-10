/**
 * Domain composition (PROMPT 18 §9).
 *
 * `resolveConfiguredModules` fuses a validated `workspace.config.json`
 * with the compile-time loader table into the exact input shape the
 * `ModuleRegistry` expects:
 *
 *   { declarations, loaderTable, diagnostics }
 *
 * Semantics:
 *   - `active` + known → included as declaration; loader is exposed.
 *   - `active` + unknown → declaration retained (registry reports
 *     `unknown`) + composition `unknown-active-module` diagnostic.
 *   - `planned` → declaration retained; loader is NEVER exposed.
 *   - `disabled` → declaration retained; loader is NEVER exposed.
 *   - Forbidden entry fields (url/path/import/loader/…) → diagnostic;
 *     the config is never allowed to supply an import target.
 */

import type {
  ModuleDeclaration,
  ModuleLoaderTable,
} from "@/workspace-host/modules";
import {
  resolveModuleDeclarations,
  type CompositionDiagnostic,
} from "./configured-module-declarations";
import {
  AVAILABLE_MODULE_IDS,
  PLANNED_MODULE_IDS,
} from "./available-modules";

/**
 * Minimal view of `workspace.config.json` this resolver reads. Kept
 * intentionally loose — validation happens in the host-config loader.
 */
export interface WorkspaceConfigView {
  modules: readonly Record<string, unknown>[];
}

export interface ResolveConfiguredModulesResult {
  declarations: readonly ModuleDeclaration[];
  /**
   * Sub-table of the compile-time loader map, restricted to the
   * modules that are BOTH declared active AND known. Planned and
   * disabled modules are absent — their loader can never be called.
   */
  loaderTable: ModuleLoaderTable;
  diagnostics: readonly CompositionDiagnostic[];
}

export function resolveConfiguredModules(
  workspaceConfig: WorkspaceConfigView,
  availableModules: ModuleLoaderTable,
): ResolveConfiguredModulesResult {
  const availableIds = Object.keys(availableModules);
  const { declarations, diagnostics } = resolveModuleDeclarations({
    modules: workspaceConfig.modules,
    availableModuleIds: availableIds,
    plannedModuleIds: PLANNED_MODULE_IDS,
  });

  // Loader table: ONLY active + known modules survive into the
  // registry input. This guarantees planned/disabled loaders can
  // never be invoked, even by mistake.
  const loaderTable: Record<
    string,
    ModuleLoaderTable[string]
  > = {};
  for (const decl of declarations) {
    if (decl.state === "active" && availableModules[decl.moduleId]) {
      loaderTable[decl.moduleId] = availableModules[decl.moduleId]!;
    }
  }

  return {
    declarations,
    loaderTable: Object.freeze(loaderTable),
    diagnostics,
  };
}

export { AVAILABLE_MODULE_IDS, PLANNED_MODULE_IDS };
