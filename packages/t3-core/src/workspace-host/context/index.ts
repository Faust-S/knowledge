/**
 * Production ModuleContext factory — public barrel (PROMPT 17 §7).
 */

export { CurrentWorkspaceStore } from "./current-workspace-store";
export { createKernelFacade, type KernelFacadeInput } from "./create-kernel-facade";
export {
  createCommandsFacade,
  type CommandsFacadeInput,
} from "./create-commands-facade";
export { createViewsFacade } from "./create-views-facade";
export {
  createPanelsFacade,
  type PanelsFacadeInput,
  type PanelsState,
} from "./create-panels-facade";
export {
  createDashboardFacade,
  type DashboardFacadeInput,
  type DashboardState,
} from "./create-dashboard-facade";
export {
  createDiagnosticsFacade,
  type DiagnosticsFacadeInput,
  type DiagnosticSink,
} from "./create-diagnostics-facade";
export {
  createModuleContextProvider,
  type ModuleContextFactoryInput,
} from "./create-module-context";
