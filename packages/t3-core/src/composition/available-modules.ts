/**
 * Compile-time loader table (PROMPT 18 §1).
 *
 * The Workspace Host loads modules ONLY through this map. Adding a
 * module requires editing this file — the map is a plain object of
 * `module_id → () => import("../modules/<path>")`. The composition
 * layer NEVER resolves a loader from a `workspace.config.json` field,
 * a URL, or a filesystem path.
 *
 * Forbidden:
 *   - `import(config.url)`
 *   - `import(config.path)`
 *   - remote URL
 *   - filesystem path from config
 *
 * Every current built-in module is resolved only through this table.
 * A config declaration never supplies an import URL or filesystem path.
 */

import type { ModuleLoaderTable } from "@/workspace-host/modules";

export const AVAILABLE_MODULES: ModuleLoaderTable = Object.freeze({
  "iwxa.workspace.base": () => import("../modules/base"),
  "iwxa.workspace.exchange": () => import("../modules/exchange"),
  "iwxa.workspace.lifecycle": () => import("../modules/lifecycle"),
  "iwxa.workspace.view-state": () => import("../modules/view-state"),
});

/**
 * Add modules that the embedding Host application has imported at build
 * time. The module config can only select module ids from this table; it
 * never supplies loader code, a URL, or a filesystem path.
 *
 * This is the supported composition boundary for independently developed
 * domain modules. Built-in ids are reserved and cannot be replaced.
 */
export function composeAvailableModules(
  extensions: ModuleLoaderTable = Object.freeze({}),
): ModuleLoaderTable {
  const result: Record<string, ModuleLoaderTable[string]> = {
    ...AVAILABLE_MODULES,
  };
  for (const [moduleId, loader] of Object.entries(extensions)) {
    if (!moduleId.trim() || typeof loader !== "function") {
      throw new Error("COMPILE_TIME_MODULE_EXTENSION_INVALID");
    }
    if (Object.prototype.hasOwnProperty.call(AVAILABLE_MODULES, moduleId)) {
      throw new Error("COMPILE_TIME_MODULE_ID_RESERVED:" + moduleId);
    }
    result[moduleId] = loader;
  }
  return Object.freeze(result);
}

/** Module IDs whose loaders are present in the compile-time table. */
export const AVAILABLE_MODULE_IDS: readonly string[] = Object.freeze(
  Object.keys(AVAILABLE_MODULES),
);

/**
 * Module IDs the composition layer recognises as valid but does NOT
 * currently expose through {@link AVAILABLE_MODULES}. A `planned`
 * declaration for one of these IDs is a normal, no-error diagnostic;
 * an `active` declaration for one of these IDs is an error because the
 * loader table cannot serve it.
 */
export const PLANNED_MODULE_IDS: readonly string[] = Object.freeze([]);

export function isAvailableModuleId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(AVAILABLE_MODULES, id);
}

export function isPlannedModuleId(id: string): boolean {
  return PLANNED_MODULE_IDS.includes(id);
}
