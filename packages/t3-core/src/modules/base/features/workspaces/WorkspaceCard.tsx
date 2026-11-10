import { useState } from "react";
import type { CommandsFacade, KernelFacade } from "@/workspace-contract";
import type { WorkspaceCatalogItem } from "./catalog-types";
import { formatWorkspaceDate } from "./workspace-format";

export interface WorkspaceCardProps {
  item: WorkspaceCatalogItem;
  activeProfileId: string;
  activeProfileLabel: string;
  kernel: KernelFacade;
  commands: CommandsFacade;
  onOpen: (id: string) => void;
  onExport: (id: string) => void;
}

/**
 * Baseline 1.2 — `WorkspaceRecord` carries no per-workspace counts.
 * The card never displays fabricated numbers for objects / events /
 * relations; those become visible only after the workspace is opened
 * and the shell has successfully called `t1.listObjects` /
 * `t1.listEventsSince`.
 */
export function WorkspaceCard({
  item,
  activeProfileId,
  activeProfileLabel,
  kernel,
  commands,
  onOpen,
  onExport,
}: WorkspaceCardProps) {
  const w = item.workspace;
  const isActiveProfile = w.profile === activeProfileId;
  const profileLabel = isActiveProfile
    ? activeProfileLabel
    : `Другой профиль · ${w.profile}`;

  const sensitivity = (w.capabilities ?? []).filter((c) =>
    c.startsWith("sensitivity:"),
  );

  const canExport = kernel.hasOperation("t2.exportPackage");
  // PROMPT 33 §6 — "В корзину" gates on the lifecycle command being
  // available. Base module NEVER calls kernel.softDeleteWorkspace here.
  const canSoftDelete =
    !w.read_only && commands.has("lifecycle.soft-delete-workspace");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSoftDelete = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await commands.invoke("lifecycle.soft-delete-workspace", {
        workspaceId: w.workspace_id,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      className="p-3 border border-slate-800 rounded bg-slate-900/40 flex flex-col gap-2"
      data-testid="workspace-card"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-medium text-slate-100 truncate">
          {w.workspace_id}
        </h3>
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
          {profileLabel}
        </span>
        {w.read_only && (
          <span
            className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-900/60 text-amber-200"
            data-testid="workspace-card-readonly"
          >
            Только чтение
          </span>
        )}
        {sensitivity.map((s) => (
          <span
            key={s}
            className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-900/60 text-rose-200"
          >
            {s}
          </span>
        ))}
      </div>

      <dl className="text-xs text-slate-400 grid grid-cols-2 gap-x-3 gap-y-0.5">
        <dt>Обновлено</dt>
        <dd className="text-slate-200">{formatWorkspaceDate(w.updated_at)}</dd>
        <dt>Создано</dt>
        <dd className="text-slate-200">{formatWorkspaceDate(w.created_at)}</dd>
        <dt>Профиль</dt>
        <dd className="text-slate-200 break-all"><code>{w.profile}</code></dd>
      </dl>

      {error && (
        <p role="alert" className="text-[11px] text-rose-200" data-testid="workspace-card-soft-delete-error">
          Не удалось переместить в корзину: {error}
        </p>
      )}

      <div className="mt-auto flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onOpen(w.workspace_id)}
          className="px-3 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 min-h-[44px] min-w-[44px]"
        >
          Открыть
        </button>
        {canExport && (
          <button
            type="button"
            onClick={() => onExport(w.workspace_id)}
            className="px-3 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 min-h-[44px] min-w-[44px]"
            aria-label={`Экспортировать рабочую область ${w.workspace_id}`}
          >
            Экспортировать
          </button>
        )}
        {canSoftDelete && (
          <button
            type="button"
            onClick={() => void onSoftDelete()}
            disabled={busy}
            className="px-3 py-1.5 text-xs rounded bg-rose-900/60 hover:bg-rose-800/70 text-rose-100 disabled:opacity-40 min-h-[44px] min-w-[44px]"
            data-testid="workspace-card-soft-delete"
            aria-label={`Переместить рабочую область ${w.workspace_id} в корзину`}
          >
            {busy ? "…" : "В корзину"}
          </button>
        )}
      </div>
    </li>
  );
}
