import type { ViewerProps } from "../workspace-contract";

interface DeckData {
  title?: string;
  cardCount?: number;
  dueToday?: number;
  lastStudiedAt?: string;
}

export function DeckRenderer({ data }: ViewerProps) {
  const d = (data ?? {}) as DeckData;
  return (
    <div className="flex flex-col gap-3">
      {d.title && <h4 className="text-lg font-semibold">{d.title}</h4>}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {typeof d.cardCount === "number" && (
          <>
            <dt className="opacity-60">Cards</dt>
            <dd className="text-right">{d.cardCount}</dd>
          </>
        )}
        {typeof d.dueToday === "number" && (
          <>
            <dt className="opacity-60">Due today</dt>
            <dd className="text-right">{d.dueToday}</dd>
          </>
        )}
        {d.lastStudiedAt && (
          <>
            <dt className="opacity-60">Last studied</dt>
            <dd className="text-right">{d.lastStudiedAt.slice(0, 10)}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
