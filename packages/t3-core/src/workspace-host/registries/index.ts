/**
 * Host contribution registries — public entry point (PROMPT 17 §1).
 *
 * Only Host code imports from this barrel. Modules never see registries;
 * they receive scoped facades through `WorkspaceModuleContext`.
 */

export {
  RegistryBase,
  type RegistryEntry,
  type RegistryEntryInput,
  type RegisterResult,
  type RegistryDiagnostic,
  type RegistryDiagnosticCode,
} from "./RegistryBase";

export { NavigationRegistry } from "./NavigationRegistry";
export {
  ViewerRegistry,
  GENERIC_PROFILE_ID,
  type ViewerResolveQuery,
  type ViewerResolution,
} from "./ViewerRegistry";
export { EditorRegistry } from "./EditorRegistry";
export {
  CommandRegistry,
  CommandInvocationError,
  type CommandInvokeErrorCode,
} from "./CommandRegistry";
export { PanelRegistry } from "./PanelRegistry";
export { DashboardRegistry } from "./DashboardRegistry";
export { ValidatorRegistry } from "./ValidatorRegistry";
export {
  MigrationRegistry,
  MigrationPathError,
  type MigrationPathErrorCode,
} from "./MigrationRegistry";
export {
  LegacyImporterRegistry,
  LegacyDetectError,
  type LegacyDetectErrorCode,
} from "./LegacyImporterRegistry";

export {
  HostContributionHub,
  type HostContributionHubOptions,
  type RegistrationResult,
} from "./HostContributionHub";
