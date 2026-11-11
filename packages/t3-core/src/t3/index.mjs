import { readActivityFromT2Host } from "./activity/kernel-reader.mjs";
export { projectActivitySnapshot } from "./activity/index.mjs";
export { readActivityFromT2Host } from "./activity/kernel-reader.mjs";

// This is the T3 successor's single Host-facing semantic extension.
// It reads the inherited T2 KernelFacade; it never creates another Kernel or Store.
export async function readActivityFromWorkspaceContext(context, options = {}) {
  if (!context || !context.kernel) {
    const error = new TypeError("T3_KERNEL_CONTEXT_REQUIRED");
    error.code = "T3_KERNEL_CONTEXT_REQUIRED";
    throw error;
  }
  return readActivityFromT2Host({ ...options, kernel: context.kernel });
}
export { createSubjectKernelBinding } from './subject-access-binding.mjs';
export { createSignedAccessHostPort } from "./signed-access-host-port.mjs";
