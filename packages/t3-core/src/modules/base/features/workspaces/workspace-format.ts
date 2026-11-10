/**
 * Presentation helpers for workspace records. No storage, no I/O.
 */

const FORMATTER = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * Format an ISO date string with a fixed ru-RU locale. Never throws:
 * returns the raw non-empty input when parsing fails, and `—` on empty.
 */
export function formatWorkspaceDate(value: string | null | undefined): string {
  if (!value) return "—";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  try {
    return FORMATTER.format(new Date(ms));
  } catch {
    return value;
  }
}

/** Latest valid updated_at across a list, or null. */
export function maxUpdatedAt(list: readonly { updated_at?: string }[]): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const w of list) {
    const v = w.updated_at;
    if (!v) continue;
    const ms = Date.parse(v);
    if (!Number.isFinite(ms)) continue;
    if (ms > bestMs) {
      bestMs = ms;
      best = v;
    }
  }
  return best;
}

function parseMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Compare two ISO date strings for "newest first" ordering. Safe for any
 * input: never throws, tolerates invalid values, and demotes empty ones.
 *
 * Rules:
 *  - both valid → newer first;
 *  - only one valid → valid first;
 *  - both invalid but non-empty → stable string compare (a vs b);
 *  - empties go last.
 */
export function compareWorkspaceDatesDesc(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const ma = parseMs(a);
  const mb = parseMs(b);
  if (ma !== null && mb !== null) {
    if (ma === mb) return 0;
    return mb - ma;
  }
  if (ma !== null) return -1;
  if (mb !== null) return 1;
  const sa = a ?? "";
  const sb = b ?? "";
  if (!sa && !sb) return 0;
  if (!sa) return 1;
  if (!sb) return -1;
  if (sa === sb) return 0;
  return sa < sb ? -1 : 1;
}

/** Stable ru-RU comparison for opaque workspace ids. */
export function compareWorkspaceIds(a: string, b: string): number {
  return a.localeCompare(b, "ru-RU");
}
