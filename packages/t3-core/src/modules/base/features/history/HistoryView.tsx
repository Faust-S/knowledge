import { useEffect, useMemo, useState } from "react";
import type { EventRecord } from "../../../../kernel-client";
import type { KernelFacade } from "@/workspace-contract";

export interface HistoryViewProps {
  kernel: KernelFacade;
}

const PAGE_SIZE = 25;

export function HistoryView({ kernel }: HistoryViewProps) {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [wsFilter, setWsFilter] = useState("");
  const [svcFilter, setSvcFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!kernel.hasOperation("t1.listWorkspaces")) return;
        const wss = await kernel.listWorkspaces();
        const canEvents = kernel.hasOperation("t1.listEventsSince");
        const chunks = canEvents
          ? await Promise.all(
              wss.filter((w) => !w.deleted_at).map((w) =>
                kernel.listEventsSince(w.workspace_id).catch(() => []),
              ),
            )
          : [];
        if (!alive) return;
        const flat = chunks.flat().sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
        setEvents(flat);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
  }, [kernel]);

  const workspaces = useMemo(() => [...new Set(events.map((e) => e.workspace_id))].sort(), [events]);
  const services = useMemo(() => [...new Set(events.map((e) => e.service_id))].sort(), [events]);
  const types = useMemo(() => [...new Set(events.map((e) => e.event_type))].sort(), [events]);

  const filtered = useMemo(() => events.filter((e) =>
    (!wsFilter || e.workspace_id === wsFilter) &&
    (!svcFilter || e.service_id === svcFilter) &&
    (!typeFilter || e.event_type === typeFilter),
  ), [events, wsFilter, svcFilter, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-3" data-testid="history-view">
      <p className="text-xs text-slate-500">
        Общая история событий по всем видимым рабочим областям. Только чтение — записи неизменяемы.
      </p>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Рабочая область" value={wsFilter} onChange={(e) => { setWsFilter(e.target.value); setPage(0); }}
          className="px-2 py-1.5 text-sm bg-slate-900 border border-slate-800 rounded min-h-[44px]">
          <option value="">Все рабочие области</option>
          {workspaces.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
        <select aria-label="Сервис" value={svcFilter} onChange={(e) => { setSvcFilter(e.target.value); setPage(0); }}
          className="px-2 py-1.5 text-sm bg-slate-900 border border-slate-800 rounded min-h-[44px]">
          <option value="">Все сервисы</option>
          {services.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Тип события" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
          className="px-2 py-1.5 text-sm bg-slate-900 border border-slate-800 rounded min-h-[44px]">
          <option value="">Все типы</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}

      <ul className="text-xs border border-slate-800 rounded divide-y divide-slate-800" aria-live="polite">
        {pageRows.length === 0 && <li className="p-3 text-slate-500">Событий нет.</li>}
        {pageRows.map((e) => (
          <li key={e.event_id} className="p-2 grid grid-cols-1 sm:grid-cols-4 gap-1">
            <span className="text-slate-300 truncate">{e.event_type}</span>
            <span className="text-slate-400 truncate">{e.workspace_id}</span>
            <span className="text-slate-400 truncate">{e.service_id}</span>
            <span className="text-slate-500">{e.occurred_at}</span>
          </li>
        ))}
      </ul>
      <nav aria-label="Постраничная навигация истории" className="flex items-center gap-2 text-xs text-slate-400">
        <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
          className="px-2 py-1 rounded bg-slate-800 disabled:opacity-40 min-h-[44px]">Назад</button>
        <span>Стр. {page + 1} / {totalPages}</span>
        <button type="button" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
          className="px-2 py-1 rounded bg-slate-800 disabled:opacity-40 min-h-[44px]">Вперёд</button>
      </nav>
    </div>
  );
}
