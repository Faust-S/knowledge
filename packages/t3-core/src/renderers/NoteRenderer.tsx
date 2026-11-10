import type { ViewerProps } from "../workspace-contract";

interface NoteData {
  title?: string;
  body?: string;
  tags?: string[];
}

export function NoteRenderer({ data }: ViewerProps) {
  const d = (data ?? {}) as NoteData;
  return (
    <div className="flex flex-col gap-3">
      {d.title && <h4 className="text-lg font-semibold">{d.title}</h4>}
      {d.body && (
        <p className="text-sm whitespace-pre-wrap opacity-90">{d.body}</p>
      )}
      {d.tags && d.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {d.tags.map((t) => (
            <span
              key={t}
              className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-200"
            >
              #{t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
