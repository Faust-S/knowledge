/**
 * Host rendering surfaces (PROMPT 20).
 *
 * Public entry points the AppShell uses to render module route
 * contributions and module navigation. Application-code renderers, and
 * `useWorkspaceModuleRuntime` for module route components, live here.
 */

export { ModuleRouteOutlet } from "./ModuleRouteOutlet";
export type { ModuleRouteOutletProps } from "./ModuleRouteOutlet";
export { ModuleRouteBoundary } from "./ModuleRouteBoundary";
export { ModuleRouteLoading } from "./ModuleRouteLoading";
export { ModuleRouteNotFound } from "./ModuleRouteNotFound";
export { ModuleNavigation } from "./ModuleNavigation";
export type { ModuleNavigationProps } from "./ModuleNavigation";
export {
  ModuleRuntimeProvider,
  useWorkspaceModuleRuntime,
} from "./ModuleRenderContext";
export type { ModuleRuntimeSnapshot } from "./ModuleRenderContext";

export { HostDashboardSurface } from "./HostDashboardSurface";
