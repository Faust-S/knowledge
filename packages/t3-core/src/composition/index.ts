/**
 * Composition root — public entry point (PROMPT 18 §1).
 *
 * The Host imports the compile-time loader table + the configured-
 * module resolver from this barrel. Nothing else in the codebase may
 * reach into subpaths of `src/composition/`.
 */

export {
  AVAILABLE_MODULES,
  composeAvailableModules,
  AVAILABLE_MODULE_IDS,
  PLANNED_MODULE_IDS,
  isAvailableModuleId,
  isPlannedModuleId,
} from "./available-modules";

export {
  resolveModuleDeclarations,
  FORBIDDEN_MODULE_ENTRY_KEYS,
  type CompositionDiagnostic,
  type CompositionDiagnosticCode,
  type ResolveModuleDeclarationsInput,
  type ResolveModuleDeclarationsResult,
} from "./configured-module-declarations";

export {
  resolveConfiguredModules,
  type WorkspaceConfigView,
  type ResolveConfiguredModulesResult,
} from "./domain-composition";

export {
  STATIC_WORKSPACE_ROUTE_BASES,
  ACTIVE_WORKSPACE_ROUTE_BASES,
  activeStaticRouteBases,
  isActiveStaticRouteBase,
  isReservedStaticRouteBase,
  type StaticWorkspaceRouteBase,
} from "./static-route-bases";
