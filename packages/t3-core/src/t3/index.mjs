import { readActivityFromT2Host } from "./activity/kernel-reader.mjs";
export { projectActivitySnapshot } from "./activity/index.mjs";
export { readActivityFromT2Host } from "./activity/kernel-reader.mjs";

// D2 uses the already-selected Workspace of the original T2 ModuleContext.
// The currentWorkspace facade is a Host UI selection, NOT a new authorization
// source: inherited Kernel grants and per-operation checks remain authoritative.
function contextError(code) {
  const error = new TypeError(code);
  error.code = code;
  throw error;
}
export async function readActivityFromWorkspaceContext(context, options = {}) {
  if (!context?.kernel || typeof context?.currentWorkspace?.get !== "function") {
    contextError("T3_WORKSPACE_MODULE_CONTEXT_REQUIRED");
  }
  const selection = context.currentWorkspace.get();
  const workspace_id = selection?.workspace_id;
  if (typeof workspace_id !== "string" || !workspace_id.trim()) {
    contextError("T3_ACTIVITY_WORKSPACE_NOT_SELECTED");
  }
  // A caller cannot switch subjects by passing a different workspace ID.
  if (options?.workspace_id !== undefined && options.workspace_id !== workspace_id) {
    contextError("T3_ACTIVITY_SELECTED_WORKSPACE_MISMATCH");
  }
  const result = await readActivityFromT2Host({
    ...options, workspace_id, kernel: context.kernel,
  });
  // Do not show a previous Workspace's read result after an asynchronous
  // switch. T2's own Kernel/Store/History remain the only source of truth.
  if (context.currentWorkspace.get()?.workspace_id !== workspace_id) {
    contextError("T3_ACTIVITY_WORKSPACE_CHANGED_DURING_READ");
  }
  return result;
}
export { createSubjectKernelBinding } from './subject-access-binding.mjs';
export { createSignedAccessHostPort } from "./signed-access-host-port.mjs";
