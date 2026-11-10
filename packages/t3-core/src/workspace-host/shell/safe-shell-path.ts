/**
 * Central safe path guard for domain-shell assets (favicon, logo, theme
 * tokens). The Shell must only load same-origin, absolute paths — anything
 * else is blocked and reported as a non-fatal diagnostic.
 *
 * Reject:
 *   - non-strings, empty strings
 *   - schemes: http:, https:, data:, javascript:, blob:, and any other
 *     scheme-like prefix (`^[a-z][a-z0-9+.-]*:`)
 *   - protocol-relative `//`
 *   - `..` path traversal
 *   - percent-encoded traversal: `%2e`, `%2f`, `%5c`
 *   - backslash `\`
 *   - control characters (0x00–0x1f, 0x7f)
 *   - any whitespace (space, tab, newline)
 *   - anything not starting with a single `/`
 */
const CONTROL_OR_WS_RE = /[\s\u0000-\u001f\u007f]/;
const SCHEME_LIKE_RE = /^[a-z][a-z0-9+.\-]*:/i;

export function isSafeShellAssetPath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > 1024) return false;
  if (CONTROL_OR_WS_RE.test(value)) return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  if (value.includes("\\")) return false;
  if (value.includes("..")) return false;
  const lower = value.toLowerCase();
  if (lower.includes("%2e") || lower.includes("%2f") || lower.includes("%5c")) return false;
  if (SCHEME_LIKE_RE.test(value)) return false;
  return true;
}
