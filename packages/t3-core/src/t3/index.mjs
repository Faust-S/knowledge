import { readActivityFromT2Host } from "./activity/kernel-reader.mjs";
import { createSubjectKernelBinding } from "./subject-access-binding.mjs";
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
  const { signedAccess = null, authorizedRead: _unused, ...readerOptions } = options ?? {};
  // An explicit signed port is supplied by the trusted Host, never inferred
  // from the selected Workspace or a Publisher product licence. The original
  // T2 facade and Store are retained; its D1 binding authorizes every read.
  if (signedAccess !== null &&
      typeof context.currentWorkspace.subscribe !== "function") {
    contextError("T3_SIGNED_WORKSPACE_SELECTION_SUBSCRIPTION_REQUIRED");
  }
  // A caller cannot switch subjects by passing a different workspace ID.
  if (readerOptions.workspace_id !== undefined &&
      readerOptions.workspace_id !== workspace_id) {
    contextError("T3_ACTIVITY_SELECTED_WORKSPACE_MISMATCH");
  }
  const authorizedRead = signedAccess === null ? null :
    createSubjectKernelBinding({ kernel: context.kernel, access: signedAccess });
  let changed = false;
  const unsubscribe = typeof context.currentWorkspace.subscribe === "function"
    ? context.currentWorkspace.subscribe(() => { changed = true; }) : null;
  const ownerContext = signedAccess === null ? null :
    JSON.stringify(signedAccess.currentContext());
  try {
    if (changed || (unsubscribe && context.currentWorkspace.get() !== selection)) {
      contextError("T3_ACTIVITY_WORKSPACE_CHANGED_DURING_READ");
    }
    const result = await readActivityFromT2Host({
      ...readerOptions, workspace_id, kernel: context.kernel, authorizedRead,
    });
    // Observe all original T2 focus events, not only the final Workspace ID:
    // A → B → A and reselecting the same workspace also invalidate the read.
    if (changed || context.currentWorkspace.get()?.workspace_id !== workspace_id ||
        (unsubscribe && context.currentWorkspace.get() !== selection) ||
        (signedAccess !== null &&
          JSON.stringify(signedAccess.currentContext()) !== ownerContext)) {
      contextError("T3_ACTIVITY_WORKSPACE_CHANGED_DURING_READ");
    }
    return result;
  } finally {
    unsubscribe?.();
  }
}
export { createSubjectKernelBinding } from './subject-access-binding.mjs';
export { createSignedAccessHostPort } from "./signed-access-host-port.mjs";

export {
  LOCAL_INFERENCE_DRAFT_SCHEMA, LOCAL_INFERENCE_DRAFT_DECLARATION,
  saveLocalInferenceDraft, listLocalInferenceDrafts,
} from "./local-inference-draft.mjs";
