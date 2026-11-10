/**
 * Managed favicon helper.
 *
 * Owns exactly one `<link rel="icon" data-domain-favicon>` in <head>.
 * Unmanaged favicons authored by the host document are never removed.
 *
 * Path validation is centralised in `safe-shell-path.ts`.
 */
import { isSafeShellAssetPath } from "./safe-shell-path";

export interface FaviconMountResult {
  mounted: boolean;
  diagnostic: string | null;
  cleanup: () => void;
}

export function mountDomainFavicon(faviconPath: unknown): FaviconMountResult {
  if (typeof document === "undefined") {
    return { mounted: false, diagnostic: null, cleanup: () => {} };
  }
  if (!isSafeShellAssetPath(faviconPath)) {
    return {
      mounted: false,
      diagnostic: "favicon-path-invalid",
      cleanup: () => {},
    };
  }
  const head = document.head;
  let el = head.querySelector<HTMLLinkElement>("link[data-domain-favicon]");
  const created = !el;
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "icon");
    el.setAttribute("data-domain-favicon", "");
    head.appendChild(el);
  }
  el.setAttribute("href", faviconPath);
  const managed = el;
  return {
    mounted: true,
    diagnostic: null,
    cleanup: () => {
      // Only remove elements this call created; never touch host-owned icons.
      if (created && managed.parentNode) {
        managed.parentNode.removeChild(managed);
      }
    },
  };
}
