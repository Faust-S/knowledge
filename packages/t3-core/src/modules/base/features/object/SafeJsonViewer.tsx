/**
 * SafeJsonViewer — a payload-safe read-only viewer.
 *
 * Guarantees:
 *   - Serialises ONLY the value passed in. Never any wider context.
 *   - Never uses `dangerouslySetInnerHTML`.
 *   - Emits plain text in a <pre>; strings never become active links.
 *   - Height-capped scrollable region.
 *   - Cyclic / non-serialisable inputs are handled gracefully.
 *   - No network, no clipboard, no side effects.
 *   - T2-03E soft cap: the rendered text is truncated at
 *     MAX_JSON_VIEWER_CHARS. The source object is never mutated.
 *
 * This viewer must NEVER be mounted in a health-blocked surface — that
 * gate lives in the caller (ObjectView), not here. In practice callers
 * wrap it in LazyJsonDetails so serialisation is deferred until the
 * user explicitly opens the container.
 */
import { useMemo } from "react";

export const MAX_JSON_VIEWER_CHARS = 500_000;

export interface SafeJsonViewerProps {
  value: unknown;
  /** Max height in CSS units; defaults to `24rem`. */
  maxHeight?: string;
  "data-testid"?: string;
}

const UNSERIALISABLE = "Исходные данные невозможно представить в JSON.";
const TRUNCATED_NOTE =
  "Визуальное представление сокращено; исходная запись не изменена.";

interface StringifyResult {
  text: string;
  ok: boolean;
  truncated: boolean;
}

function stringify(value: unknown): StringifyResult {
  try {
    const text = JSON.stringify(value, null, 2);
    if (typeof text !== "string") {
      return { text: UNSERIALISABLE, ok: false, truncated: false };
    }
    if (text.length > MAX_JSON_VIEWER_CHARS) {
      return {
        text: text.slice(0, MAX_JSON_VIEWER_CHARS),
        ok: true,
        truncated: true,
      };
    }
    return { text, ok: true, truncated: false };
  } catch {
    return { text: UNSERIALISABLE, ok: false, truncated: false };
  }
}

export function SafeJsonViewer(props: SafeJsonViewerProps) {
  const { value, maxHeight = "24rem" } = props;
  const testId = props["data-testid"] ?? "safe-json-viewer";
  const { text, ok, truncated } = useMemo(() => stringify(value), [value]);

  if (!ok) {
    return (
      <p
        role="status"
        data-testid={`${testId}-unserialisable`}
        className="text-xs text-amber-200 border border-amber-800/60 rounded p-2"
      >
        {UNSERIALISABLE}
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <pre
        data-testid={testId}
        className="text-xs bg-slate-950 border border-slate-800 rounded p-2 overflow-auto whitespace-pre-wrap break-all"
        style={{ maxHeight }}
      >
        {text}
      </pre>
      {truncated && (
        <p
          role="status"
          data-testid={`${testId}-truncated`}
          className="text-[11px] text-amber-200 border border-amber-800/60 rounded p-2"
        >
          {TRUNCATED_NOTE}
        </p>
      )}
    </div>
  );
}
