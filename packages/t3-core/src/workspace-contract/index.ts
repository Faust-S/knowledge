/**
 * Workspace Contract — public entry point.
 *
 * The IWXA Workspace shell imports EVERYTHING for the Host↔Module contract
 * from this file. Consumers MUST NOT reach into subpaths — the surface may
 * only grow through additive exports here.
 */

export {
  WORKSPACE_CONTRACT_VERSION,
  EXPECTED_RUNTIME_CONTRACT_VERSION,
  SUPPORTED_MODULE_MANIFEST_VERSION,
  type WorkspaceContractVersion,
  type ExpectedRuntimeContractVersion,
} from "./version";

export {
  moduleDiagnostic,
  WorkspaceContractError,
  type ModuleDiagnostic,
  type ModuleDiagnosticCode,
} from "./diagnostics";

export {
  validateWorkspaceModuleManifest,
  expectedWorkspaceContractVersion,
  type WorkspaceModuleManifest,
  type WorkspaceModuleManifestCompatibility,
  type WorkspaceModuleManifestContributions,
  type WorkspaceModuleManifestSecurity,
  type ManifestValidationResult,
} from "./module-manifest";

export {
  defineWorkspaceModule,
  collectContributions,
  findDuplicateContributionIds,
  validateActivationContributions,
  WORKSPACE_MODULE_BRAND,
  isVerifiedWorkspaceModule,
  type WorkspaceModuleDefinition,
  type WorkspaceModuleActivationResult,
  type WorkspaceModuleActivationDiagnostic,
  type DuplicateContributionReport,
} from "./module-definition";

export {
  createRouteRef,
  isRouteRef,
  ROUTE_REF_ID_PATTERN,
  type RouteRef,
} from "./route-ref";

export {
  REQUIRED_KERNEL_FACADE_METHODS,
} from "./module-context";

export {
  checkModuleCompatibility,
  type ModuleCompatibilityRequirements,
  type RuntimeCompatibilityView,
} from "./compatibility";

export {
  ALLOWED_MODULE_CONTEXT_KEYS,
  FORBIDDEN_MODULE_CONTEXT_KEYS,
  assertNoForbiddenContextKeys,
  type WorkspaceModuleContext,
  type KernelFacade,
  type RouterFacade,
  type CommandsFacade,
  type ViewsFacade,
  type PanelsFacade,
  type DashboardFacade,
  type TerminologyFacade,
  type DiagnosticsFacade,
  type CurrentWorkspaceFacade,
  type ProfileFacade,
} from "./module-context";

export {
  CONTRIBUTION_GROUPS,
  emptyContributionSet,
  type ContributionBase,
  type ContributionGroup,
  type ContributionSet,
  type AnyContribution,
  type ComponentLoader,
  type ModuleLoader,
  type RouteContribution,
  type NavigationContribution,
  type ViewerContribution,
  type ViewerProps,
  type ViewerSurface,
  type EditorContribution,
  type PanelContribution,
  type DashboardCardContribution,
  type CommandContribution,
  type ValidatorContribution,
  type MigrationContribution,
  type LegacyImporterContribution,
} from "./contributions";

// Re-export the already-materialized internal view-state schema identities.
export {
  WORKSPACE_SAVED_VIEW_SCHEMA_ID,
  WORKSPACE_SAVED_VIEW_SCHEMA_VERSION,
  isWorkspaceInternalObjectSchema,
} from "./internal-object-schemas";
