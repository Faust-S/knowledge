/**
 * Same-origin domain theme loader.
 *
 * Contract (Prompt 09 §4):
 *  - `tokens_path` must be an ABSOLUTE PATH beginning with `/`.
 *  - Rejects: `..`, protocol-relative `//`, `data:`, `javascript:`,
 *    remote http/https URLs, whitespace/control chars.
 *  - Loaded stylesheet is a single managed `<link data-domain-theme>` — a
 *    new theme replaces the previous one; the previous element is removed.
 *  - Load failures never block the host — they surface as diagnostics and
 *    the shell falls back to the system-managed theme.
 *  - Font URLs are intentionally NOT honoured: `font_loading` is either
 *    `system-stack` (default) or `local-only`; remote font URLs are ignored
 *    to prevent third-party tracking.
 */

import { isSafeShellAssetPath } from "./safe-shell-path";

const MANAGED_ATTR = "data-domain-theme";

export type ThemeStatus =
  | "idle"
  | "loading"
  | "ready"
  | "blocked"
  | "system-fallback";

export interface ThemeState {
  status: ThemeStatus;
  themeId: string | null;
  tokensPath: string | null;
  diagnostic: string | null;
}

export interface ThemeSource {
  themeId: string;
  tokensPath: string;
  fontLoading: "system-stack" | "local-only";
}

/** @deprecated Prefer `isSafeShellAssetPath`. Retained for external test callers. */
export function isSafeThemePath(path: unknown): path is string {
  return isSafeShellAssetPath(path);
}

export function classifyThemeSource(
  raw: unknown,
): { source: ThemeSource | null; diagnostic: string | null } {
  if (!raw || typeof raw !== "object") {
    return { source: null, diagnostic: "theme-block-missing" };
  }
  const t = raw as Record<string, unknown>;
  const themeId = typeof t.theme_id === "string" ? t.theme_id : null;
  const tokensPath = t.tokens_path;
  const fontLoading = t.font_loading === "local-only" ? "local-only" : "system-stack";
  if (!themeId) return { source: null, diagnostic: "theme-id-invalid" };
  if (!isSafeShellAssetPath(tokensPath)) {
    return { source: null, diagnostic: "theme-path-invalid" };
  }
  return {
    source: { themeId, tokensPath: tokensPath as string, fontLoading },
    diagnostic: null,
  };
}

/**
 * Mount the managed theme link. Returns a cleanup that removes ONLY the
 * managed element — never touches host-owned stylesheets. Safe to call from
 * a React effect. Errors trigger the `onError` callback but never throw.
 */
export function mountDomainTheme(
  source: ThemeSource,
  onStatus: (status: Exclude<ThemeStatus, "idle">, diagnostic?: string) => void,
  options: { reuseSiteStylesheet?: boolean } = {},
): () => void {
  if (typeof document === "undefined") return () => {};
  const prev = document.head.querySelector(`link[${MANAGED_ATTR}]`);
  if (prev) prev.parentElement?.removeChild(prev);

  // In site-owned mode the site's original HTML should preload its own CSS.
  // Reuse that exact same-origin stylesheet rather than attaching a second
  // copy that could reorder styles or flash during React startup. Never
  // remove a stylesheet owned by the site when Host unmounts.
  if (options.reuseSiteStylesheet) {
    const expectedHref = new URL(source.tokensPath, document.baseURI).href;
    const siteLink = Array.from(
      document.head.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]:not([data-domain-theme])'),
    ).find((candidate) => {
      try {
        return new URL(candidate.href, document.baseURI).href === expectedHref;
      } catch {
        return false;
      }
    });
    if (siteLink) {
      if (siteLink.sheet) {
        onStatus("ready");
        return () => {};
      }
      const onLoad = () => onStatus("ready");
      const onError = () => onStatus("system-fallback", "theme-load-failed");
      siteLink.addEventListener("load", onLoad, { once: true });
      siteLink.addEventListener("error", onError, { once: true });
      onStatus("loading");
      return () => {
        siteLink.removeEventListener("load", onLoad);
        siteLink.removeEventListener("error", onError);
      };
    }
  }

  const link = document.createElement("link");
  link.setAttribute(MANAGED_ATTR, source.themeId);
  link.rel = "stylesheet";
  link.href = source.tokensPath;
  link.crossOrigin = "anonymous";
  link.addEventListener("load", () => onStatus("ready"), { once: true });
  link.addEventListener(
    "error",
    () => onStatus("system-fallback", "theme-load-failed"),
    { once: true },
  );
  document.head.appendChild(link);
  onStatus("loading");
  return () => {
    if (link.parentElement) link.parentElement.removeChild(link);
  };
}
