/**
 * LazyJsonDetails — a <details> whose SafeJsonViewer is NOT mounted until
 * the user opens it. A closed <details> visually hides children but React
 * still mounts them, so `SafeJsonViewer` would eagerly `JSON.stringify`
 * the value at first render.
 *
 * Contract (T2-03E):
 *   - Local `open` state, not persisted to any storage.
 *   - `open` is driven by <details onToggle>; SSR-safe initial `open={open}`.
 *   - When closed, children of the viewer slot are NOT rendered.
 *   - The summary caption never serialises `value`.
 *   - Summary control is at least 44px tall.
 *   - No links, no clipboard, no network.
 */
import { useCallback, useState } from "react";
import { SafeJsonViewer } from "./SafeJsonViewer";

export interface LazyJsonDetailsProps {
  summary: string;
  value: unknown;
  testId: string;
  maxHeight?: string;
}

export function LazyJsonDetails(props: LazyJsonDetailsProps) {
  const { summary, value, testId, maxHeight } = props;
  const [open, setOpen] = useState(false);

  const onToggle = useCallback(
    (e: React.SyntheticEvent<HTMLDetailsElement>) => {
      setOpen(e.currentTarget.open);
    },
    [],
  );

  return (
    <details
      className="text-xs border border-slate-800 rounded"
      data-testid={testId}
      open={open}
      onToggle={onToggle}
    >
      <summary
        className="cursor-pointer px-3 py-2 min-h-[44px] flex items-center text-slate-300"
        data-testid={`${testId}-toggle`}
      >
        {summary}
      </summary>
      <div className="p-2 pt-0">
        {open && (
          <SafeJsonViewer
            value={value}
            data-testid={`${testId}-json`}
            maxHeight={maxHeight}
          />
        )}
      </div>
    </details>
  );
}
