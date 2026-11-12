/**
 * One T3 Workspace mount for BOTH ordinary domain boots and a trusted,
 * compile-time private Control/Access owner. The caller is the Host entrypoint,
 * not a URL, window global, module manifest or imported .iwxa document.
 *
 * Domain entry: mountT3App(root) -> standard inherited T2/T3 Workspace.
 * Signed Control entry: mountT3App(root, {
 *   requireSignedOwner: true, signedKernelAccess, signedActivityAccess,
 *   subscribeSignedAccessInvalidation,
 * }) -> the SAME Workspace/Kernel with original signed owner dispatch.
 */
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import App, { type AppProps } from "./App";
import { AVAILABLE_MODULES } from "./composition";
import "./styles.css";
import "./styles/a11y.css";

// Keep original compile-time module extensions in the SINGLE Host entry graph.
void AVAILABLE_MODULES;

export function mountT3App(target: HTMLElement, props: AppProps = {}): Root {
  if (!target || !(target instanceof HTMLElement)) {
    throw new TypeError("T3_HOST_MOUNT_ROOT_REQUIRED");
  }
  const root = createRoot(target);
  root.render(
    <StrictMode>
      <App {...props} />
    </StrictMode>,
  );
  return root;
}
