/**
 * Preview-mode helpers shared across every renderer surface.
 *
 * `truncatePreviewText` is deliberately conservative: it never throws,
 * never inspects unknown object structures, never leaks
 * `[object Object]`, and never mutates the input. Any renderer that
 * needs a short summary in preview mode MUST go through this helper.
 */

const DEFAULT_MAX_LENGTH = 180;
const ELLIPSIS = "…";

export function truncatePreviewText(
  value: unknown,
  maxLength: number = DEFAULT_MAX_LENGTH,
): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const limit = Math.max(1, Math.floor(maxLength));
  if (trimmed.length <= limit) return trimmed;
  return trimmed.slice(0, limit).trimEnd() + ELLIPSIS;
}
