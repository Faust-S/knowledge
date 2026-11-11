// T3 D1: apply Host-held subject Access to the *inherited* T2 Workspace
// KernelFacade. No second Kernel, Store, Router, session or service.
// The owner is trusted Host input, never part of WorkspaceModuleContext.
import {
  createSubjectKernelBinding,
  SUBJECT_SCOPED_OPERATION_IDS,
} from "./subject-access-binding.mjs";

const scopedOperations = new Set(SUBJECT_SCOPED_OPERATION_IDS);

function denied(operation) {
  const error = new Error("T3_SUBJECT_OPERATION_REQUIRES_AUTHORIZED_HOST:" + operation);
  error.name = "T3SubjectHostOperationError";
  error.code = "T3_SUBJECT_OPERATION_REQUIRES_AUTHORIZED_HOST";
  error.outcome = "DENIED";
  return Promise.reject(error);
}
export function createSubjectScopedModuleKernelFacade({kernel,access,clock}={}) {
  if (!kernel || typeof kernel.hasOperation !== "function" ||
      !Array.isArray(kernel.grantedOperations) ||
      !kernel.sessionInfo || !access) {
    throw new TypeError("T3_SUBJECT_ORIGINAL_KERNEL_HOST_REQUIRED");
  }
  const scoped=createSubjectKernelBinding({kernel,access,clock});
  // Every original function outside the explicitly validated workspace-scoped
  // D1 surface is denied. This includes global enumeration, purge, package
  // import/export and raw Kernel capability witnesses: no unprotected escape.
  const guarded={};
  for(const [method,implementation] of Object.entries(kernel)) {
    if(typeof implementation === "function" && !Object.hasOwn(scoped,method)) {
      guarded[method]=()=>denied(method);
    }
  }
  const ops=Object.freeze(kernel.grantedOperations.filter(
    op=>scopedOperations.has(op) && kernel.hasOperation(op)));
  const facade={
    ...kernel,
    ...guarded,
    ...scoped,
    hasOperation:op=>scopedOperations.has(op) && kernel.hasOperation(op),
    grantedOperations:ops,
  };
  // Contract 1.3 atomic graph is optional; never invent it when the inherited
  // capability negotiation did not expose the original method.
  if(typeof kernel.commitObjectGraph !== "function") delete facade.commitObjectGraph;
  return Object.freeze(facade);
}
