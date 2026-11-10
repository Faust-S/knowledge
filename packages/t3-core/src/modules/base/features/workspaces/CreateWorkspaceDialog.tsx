import { useCallback, useEffect, useId, useRef, useState } from "react";

export interface CreateWorkspaceDialogProps {
  open: boolean;
  profileLabel: string;
  disabled?: boolean;
  onCancel: () => void;
  onCreate: () => Promise<void>;
}

const FOCUSABLE =
  'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Confirmation dialog for creating a new workspace.
 *
 * Accessibility:
 *   - role=dialog + aria-modal, aria-labelledby, aria-describedby;
 *   - Esc cancels but never during a running create;
 *   - Tab is trapped inside the dialog;
 *   - the cancel button receives initial focus.
 *
 * Ownership contract (T2-02E):
 *   - `onCancel` fires only for explicit user cancel (Esc / Cancel /
 *     backdrop click).
 *   - `onCreate` fires for successful creation.
 *   - The dialog NEVER decides where to send focus after unmount. The
 *     parent decides: cancel → return to trigger; success → let the
 *     shell move focus to <main> after route change.
 */
export function CreateWorkspaceDialog(props: CreateWorkspaceDialogProps) {
  const { open, profileLabel, disabled, onCancel, onCreate } = props;
  const titleId = useId();
  const descId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const requestCancel = useCallback(() => {
    if (busy) return;
    onCancel();
  }, [busy, onCancel]);

  useEffect(() => {
    if (!open) {
      setBusy(false);
      setError(null);
      return;
    }
    // defer focus until the dialog is mounted
    const t = window.setTimeout(() => cancelRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(t);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (busy) return;
        e.stopPropagation();
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === "Tab" && rootRef.current) {
        const nodes = Array.from(
          rootRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
        ).filter((n) => !n.hasAttribute("aria-hidden"));
        if (nodes.length === 0) {
          e.preventDefault();
          return;
        }
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && (active === first || !rootRef.current.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const submit = async () => {
    if (busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate();
      // parent decides focus target after unmount — do NOT touch focus here.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      data-testid="create-workspace-dialog"
      data-t2-ui="dialog-overlay"
      ref={rootRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        // click on backdrop cancels, click inside the panel does not
        if (e.target === e.currentTarget) requestCancel();
      }}
    >
      <div data-t2-ui="dialog" className="w-full max-w-md rounded border border-slate-800 bg-slate-950 p-4 space-y-3">
        <h2 id={titleId} className="text-base font-medium text-slate-100">
          Новая рабочая область
        </h2>
        <p id={descId} className="text-sm text-slate-300">
          Будет создана пустая рабочая область профиля «{profileLabel}».
          Технический идентификатор сформируется автоматически.
        </p>
        {error && (
          <p role="alert" className="text-xs text-red-300">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            ref={cancelRef}
            data-t2-ui="secondary-action"
            type="button"
            onClick={requestCancel}
            disabled={busy}
            className="px-3 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 min-h-[44px] min-w-[44px]"
          >
            Отмена
          </button>
          <button
            type="button"
            data-t2-ui="primary-action"
            onClick={() => void submit()}
            disabled={busy || disabled}
            className="px-3 py-1.5 text-xs rounded bg-emerald-800 hover:bg-emerald-700 disabled:opacity-40 min-h-[44px] min-w-[44px]"
            data-testid="create-workspace-confirm"
          >
            {busy ? "Создание…" : "Создать рабочую область"}
          </button>
        </div>
      </div>
    </div>
  );
}
