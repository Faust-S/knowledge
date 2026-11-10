/**
 * Host Router — public surface.
 *
 * The Host imports this barrel. Modules do NOT — they only see the
 * `RouterFacade` handed to them via `WorkspaceModuleContext.router`.
 */

export { RouteRegistry, RouteRegistryError } from "./RouteRegistry";
export type {
  RouteRegistryDiagnostic,
  RouteRegistryErrorCode,
  RegisterManyResult,
} from "./RouteRegistry";

export { HostRouter } from "./HostRouter";
export type { HostRouterOptions } from "./HostRouter";

export { createRouterFacade } from "./create-router-facade";
export { createLegacyHashDriver } from "./legacy-hash-driver";
export { resolveProductFirstLanding } from "./product-first-landing";

export {
  hostRouteRefs,
  activeHostRouteBindings,
  allHostRouteRefs,
  HOST_ROUTER_OWNER_ID,
} from "./host-route-refs";

export {
  registerRouteContributions,
  type RouteContributionDiagnostic,
  type RouteContributionRegistrationInput,
  type RouteContributionRegistrationResult,
  type RouteContributionErrorCode,
} from "./register-route-contributions";

export {
  validateHostRouteBinding,
  validateStaticBase,
  parseFragmentPattern,
  freezeHostRouteBinding,
  type HostRouteBinding,
  type BindingValidationCode,
  type BindingValidationError,
} from "./route-binding";

export {
  ALLOWED_ROUTE_PARAM_NAMES,
  FORBIDDEN_ROUTE_PARAM_NAMES,
  encodeOpaqueRouteParam,
  decodeOpaqueRouteParam,
  isAllowedRouteParam,
  isForbiddenRouteParam,
  RouteParamError,
  type AllowedRouteParamName,
  type ForbiddenRouteParamName,
  type RouteParamErrorCode,
} from "./route-params";

export type {
  HostLocation,
  HostNavigationDriver,
  HostRouteMatch,
  HostRouteNavigationOptions,
} from "./host-route-state";

export { useHostRouteFocus } from "./use-host-route-focus";
export { useHostRouteMatch } from "./use-host-route-match";
export { hostRouteMatchToBreadcrumbRoute } from "./host-breadcrumb-route";
export {
  useLegacyRouteMigrations,
  DEFAULT_LEGACY_ROUTE_MIGRATIONS,
  type LegacyRouteMigration,
} from "./legacy-route-migrations";

