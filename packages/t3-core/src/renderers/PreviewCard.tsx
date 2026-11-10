/**
 * Minimal preview card used by every renderer's default preview surface.
 *
 * Preview MUST NOT reveal long free-form text — that is the reason
 * `summary` is already truncated by the caller via `truncatePreviewText`.
 */
import type { ReactNode } from "react";

export interface PreviewCardProps {
  rendererType: string;
  title?: string | null;
  summary?: string | null;
  chips?: ReactNode;
}

export function PreviewCard({
  rendererType,
  title,
  summary,
  chips,
}: PreviewCardProps) {
  return (
    <div
      className="flex flex-col gap-2"
      data-renderer={rendererType}
      data-preview-mode="preview"
    >
      {title && (
        <h4 className="text-sm font-semibold truncate">{title}</h4>
      )}
      {chips && <div className="flex flex-wrap gap-1">{chips}</div>}
      {summary && (
        <p className="text-xs opacity-80 whitespace-pre-line">{summary}</p>
      )}
    </div>
  );
}
