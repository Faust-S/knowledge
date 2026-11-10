/**
 * ModuleRegistry — public entry point (PROMPT 13).
 */

export { ModuleRegistry } from "./ModuleRegistry";
export { ContributionStore } from "./contribution-store";
export { analyzeDependencies } from "./dependency-graph";
export { preflight } from "./module-resolution";
export { loadAndActivate } from "./module-loader";
export {
  registryDiagnostic,
  fromModuleDiagnostic,
  toErrorDetails,
  type RegistryDiagnostic,
  type RegistryDiagnosticCode,
} from "./module-diagnostics";
export type {
  ModuleDeclaration,
  ModuleDeclaredState,
  ModuleRuntimeStatus,
  ModuleStatusRecord,
  ModuleLoaderTable,
  ModuleContextProvider,
  RegistryStartInput,
  OwnedContribution,
} from "./module-types";
