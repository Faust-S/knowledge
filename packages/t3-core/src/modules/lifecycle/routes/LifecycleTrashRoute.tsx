/**
 * `lifecycle.trash` route wrapper (PROMPT 27 §1-§13).
 *
 * Loads the trash via `kernel.listWorkspaces({ include_deleted: true })`
 * — a single call, no per-record N+1 — and filters to records that carry
 * `deleted_at`. Sorts by `deleted_at` DESC, then `workspace_id` ASC.
 *
 * Purge is a 12-state finite machine held only in React state:
 *   idle → previewing → preview-ready | awaiting-no-backup-ack
 *        → awaiting-challenge → committing → committed
 *        (with cancelling/cancelled/expired/stale/error side branches)
 *
 * Runtime rules enforced here:
 *   - The first preview NEVER passes `acknowledge_no_backup: true`.
 *   - A `missing` backup requires the user to click a separate
 *     acknowledgement checkbox; only THEN do we call a second preview
 *     with `acknowledge_no_backup: true`.
 *   - The challenge input must equal `preview.challenge` verbatim — no
 *     trim, no case fold, no workspace title alternative.
 *   - `purgeCommit` receives the user's input, not `preview.challenge`.
 *   - `purgeCancel` runs on close, workspace switch, route unmount,
 *     expiry — as long as the operation is granted.
 *   - `purge_token` stays in React memory; `challenge` is shown only in the
 *     active dialog for manual confirmation. Neither is logged or persisted.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useWorkspaceModuleRuntime } from "../../../workspace-host/rendering/ModuleRenderContext";
import type {
  PurgePreview,
  PurgeReceipt,
  WorkspaceRecord,
} from "@/kernel-client/contracts/runtime-1.3.0";
import { hostRouteRefs } from "@/workspace-host/router";
import { trashRefreshService } from "../services/trash-refresh-service";

import {
  INITIAL_PURGE_STATE,
  isChallengeAccepted,
  isPreviewExpired,
  purgeReducer,
} from "../state/purge-machine";

function isSoftDeleted(w: WorkspaceRecord): boolean {
  return typeof w.deleted_at === "string" && w.deleted_at.length > 0;
}

function sortTrash(list: readonly WorkspaceRecord[]): WorkspaceRecord[] {
  return [...list].sort((a, b) => {
    const ta = Date.parse(a.deleted_at ?? "") || 0;
    const tb = Date.parse(b.deleted_at ?? "") || 0;
    if (tb !== ta) return tb - ta;
    return a.workspace_id.localeCompare(b.workspace_id);
  });
}

export type PurgeErrorClass =
  | "expired"
  | "stale"
  | "lock"
  | "challenge"
  | "unknown";

export function classifyPurgeError(
  error: unknown,
): PurgeErrorClass {
  // CommandsFacade wraps Kernel failures as CommandInvocationError
  // { code: "handler-threw", cause: <original Kernel error> }.
  // Walk only these known wrappers; never infer a code from error.message.
  let current: unknown = error;
  let code = "";
  for (let depth = 0; depth < 3; depth++) {
    if (typeof current !== "object" || current === null) break;
    const wrapped = current as { code?: unknown; cause?: unknown };
    if (typeof wrapped.code !== "string") break;
    if (wrapped.code !== "handler-threw") {
      code = wrapped.code;
      break;
    }
    current = wrapped.cause;
  }

  switch (code) {
    case "PURGE_EXPIRED":
    case "PURGE_TOKEN_INVALID":
    case "PURGE_TOKEN_USED":
      return "expired";

    case "PURGE_STATE_CHANGED":
      return "stale";

    case "LOCK_UNAVAILABLE":
    case "WEB_LOCKS_UNAVAILABLE":
      return "lock";

    case "PURGE_CHALLENGE_MISMATCH":
      return "challenge";

    default:
      return "unknown";
  }
}

// Never render an untrusted Runtime/Kernel error message here: it may
// contain an internal purge_token, other capabilities or private identifiers.
const PREVIEW_FAILURE_MESSAGE = "Не удалось подготовить подтверждение удаления. Повторите попытку.";

function backupBanner(preview: PurgePreview | null): {
  tone: "info" | "warn" | "danger";
  text: string;
} | null {
  if (!preview) return null;
  const status = preview.last_export.backup_status;
  if (status === "current") {
    return { tone: "info", text: "Подтверждённая резервная копия актуальна." };
  }
  if (status === "stale") {
    return {
      tone: "warn",
      text: "Подтверждённая резервная копия существует, но рабочая область изменялась после неё.",
    };
  }
  return { tone: "danger", text: "Подтверждённая резервная копия отсутствует." };
}

export default function LifecycleTrashRoute() {
  const { context } = useWorkspaceModuleRuntime();
  const kernel = context.kernel;
  const canList = kernel.hasOperation("t1.listWorkspaces");
  const canSoftDelete = kernel.hasOperation("t1.softDeleteWorkspace");
  const canRestore = kernel.hasOperation("t1.restoreWorkspace");
  const canPreview = kernel.hasOperation("t1.purgePreview");
  const canCommit = kernel.hasOperation("t1.purgeCommit");
  // Direct kernel.purgeCancel is forbidden here (PROMPT 33 §3); the
  // guard lives in the command handler's requiredOperations.

  const [workspaces, setWorkspaces] = useState<readonly WorkspaceRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [purge, dispatch] = useReducer(purgeReducer, INITIAL_PURGE_STATE);

  // Track the current purge token in a ref so unmount/switch effects
  // can cancel it without stale-closure hazards. Never persisted.
  const purgeRef = useRef<{ token: string | null; workspaceId: string | null }>(
    { token: null, workspaceId: null },
  );
  const purgeGenerationRef = useRef(0);
  useEffect(() => {
    purgeRef.current = {
      token: purge.preview?.purge_token ?? null,
      workspaceId: purge.workspaceId,
    };
  }, [purge.preview, purge.workspaceId]);

  const refresh = useCallback(async () => {
    if (!canList) return;
    try {
      const list = await kernel.listWorkspaces({ include_deleted: true });
      setWorkspaces(list);
      setLoadError(null);
    } catch {
      setLoadError("Не удалось загрузить корзину. Повторите попытку.");
    }
  }, [canList, kernel]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Module-local trash refresh subscription (PROMPT 29 §5, §7).
  useEffect(() => trashRefreshService.subscribe(() => { void refresh(); }), [refresh]);


  // ---- token lifecycle guards (§11, PROMPT 33 §3) -------------------
  // All purge mutations flow through commands; the route never calls
  // kernel.purgePreview / purgeCommit / purgeCancel directly.
  const cancelPurgeToken = useCallback(
    async (token: string | null): Promise<boolean> => {
      if (!token) return true;

      if (
        !context.commands.has(
          "lifecycle.purge-cancel",
        )
      ) {
        return false;
      }

      try {
        await context.commands.invoke(
          "lifecycle.purge-cancel",
          { purgeToken: token },
        );
        return true;
      } catch {
        return false;
      }
    },
    [context.commands],
  );

  // Cancel on unmount.
  useEffect(() => {
    const commands = context.commands;
    return () => {
      purgeGenerationRef.current += 1;
      const t = purgeRef.current.token;
      if (!t) return;
      if (!commands.has("lifecycle.purge-cancel")) return;
      // Fire-and-forget: React lifecycle prohibits awaiting.
      void commands
        .invoke("lifecycle.purge-cancel", { purgeToken: t })
        .catch(() => {});
    };
  }, [context.commands]);

  const trash = useMemo(
    () => sortTrash(workspaces.filter(isSoftDeleted)),
    [workspaces],
  );

  // ---- soft delete via CommandsFacade (§2) -------------------------
  // Base module policy: only Lifecycle owns direct kernel.softDelete.
  // Route surfaces call the command through ctx.commands.

  const onRestore = useCallback(async (w: WorkspaceRecord) => {
    if (!canRestore) return;
    if (!context.commands.has("lifecycle.restore-workspace")) return;
    setBusyId(w.workspace_id);
    // Any active purge for a different workspace is cancelled first.
    if (purgeRef.current.workspaceId && purgeRef.current.workspaceId !== w.workspace_id) {
      purgeGenerationRef.current += 1;
      const cancelled = await cancelPurgeToken(purgeRef.current.token);
      if (!cancelled) {
        setLoadError("Не удалось подтвердить отмену активного purge preview.");
        setBusyId(null);
        return;
      }
      dispatch({ type: "reset" });
    }
    try {
      // Handler owns catalog + trash refresh fanout (PROMPT 29 §9,
      // PROMPT 33 §5). Route does NOT invoke workspace.catalog.refresh
      // or lifecycle.trash.refresh again.
      await context.commands.invoke("lifecycle.restore-workspace", {
        workspaceId: w.workspace_id,
      });
    } catch {
      setLoadError("Не удалось восстановить рабочую область. Повторите попытку.");
    } finally {
      setBusyId(null);
    }
  }, [canRestore, cancelPurgeToken, context.commands]);


  // ---- purge preview (first — no acknowledgement) (§5) -------------
  const onPreviewPurge = useCallback(async (w: WorkspaceRecord) => {
    if (!canPreview) return;
    if (!context.commands.has("lifecycle.purge-preview")) return;
    // Cancel any prior token before opening a new one.
    const prior = purgeRef.current.token;
    if (prior && !(await cancelPurgeToken(prior))) {
      setLoadError("Не удалось подтвердить отмену предыдущего purge preview.");
      return;
    }
    const generation = ++purgeGenerationRef.current;
    dispatch({
      type: "preview-started",
      workspaceId: w.workspace_id,
      acknowledgeNoBackup: false,
    });
    try {
      const preview = await context.commands.invoke<PurgePreview>(
        "lifecycle.purge-preview",
        {
          workspaceId: w.workspace_id,
          acknowledgeNoBackup: false,
        },
      );
      if (generation !== purgeGenerationRef.current) {
        await cancelPurgeToken(preview.purge_token);
        return;
      }
      dispatch({ type: "preview-succeeded", preview });
    } catch {
      if (generation !== purgeGenerationRef.current) return;
      dispatch({
        type: "preview-failed",
        error: PREVIEW_FAILURE_MESSAGE,
      });
    }
  }, [canPreview, cancelPurgeToken, context.commands]);

  // ---- second preview after missing-backup ack (§6) ----------------
  const onAcknowledgeNoBackup = useCallback(async () => {
    const wsId = purge.workspaceId;
    if (!wsId) return;
    if (!context.commands.has("lifecycle.purge-preview")) return;
    // Cancel the first preview's token before requesting a new one.
    const prior = purgeRef.current.token;
    if (prior && !(await cancelPurgeToken(prior))) {
      setLoadError("Не удалось подтвердить отмену первого purge preview.");
      return;
    }
    const generation = ++purgeGenerationRef.current;
    dispatch({ type: "ack-no-backup" });
    try {
      const preview = await context.commands.invoke<PurgePreview>(
        "lifecycle.purge-preview",
        {
          workspaceId: wsId,
          acknowledgeNoBackup: true,
        },
      );
      if (generation !== purgeGenerationRef.current) {
        await cancelPurgeToken(preview.purge_token);
        return;
      }
      dispatch({ type: "preview-succeeded", preview });
    } catch {
      if (generation !== purgeGenerationRef.current) return;
      dispatch({
        type: "preview-failed",
        error: PREVIEW_FAILURE_MESSAGE,
      });
    }
  }, [cancelPurgeToken, context.commands, purge.workspaceId]);

  // ---- cross-base navigation to Exchange (§6 stale branch) ---------
  const onOpenExchangeForBackup = useCallback(async () => {
    purgeGenerationRef.current += 1;
    const prior = purgeRef.current.token;
    if (prior && !(await cancelPurgeToken(prior))) {
      setLoadError("Не удалось подтвердить отмену purge preview перед переходом к экспорту.");
      return;
    }
    dispatch({ type: "reset" });
    context.router.navigate(hostRouteRefs.exchange.home);
  }, [cancelPurgeToken, context.router]);

  // ---- commit (exact user input) (§7, §8, PROMPT 33 §3, §5) --------
  const onCommit = useCallback(async () => {
    if (!canCommit) return;
    if (!purge.preview) return;
    if (!context.commands.has("lifecycle.purge-commit")) return;
    if (isPreviewExpired(purge.preview)) {
      dispatch({ type: "expire" });
      // Best-effort cancel of the stale token.
      await cancelPurgeToken(purge.preview.purge_token);
      return;
    }
    if (!isChallengeAccepted(purge)) return;
    const generation = purgeGenerationRef.current;
    dispatch({ type: "commit-started" });
    try {
      const receipt = await context.commands.invoke<PurgeReceipt>(
        "lifecycle.purge-commit",
        {
          workspaceId: purge.workspaceId!,
          purgeToken: purge.preview.purge_token,
          confirmation: purge.challengeInput,
        },
      );
      if (generation !== purgeGenerationRef.current) return;
      dispatch({ type: "commit-succeeded", receipt });
      // PROMPT 33 §5 — refresh is owned by `lifecycle.purge-commit`
      // handler; the route MUST NOT invoke workspace.catalog.refresh
      // or lifecycle.trash.refresh again.
    } catch (error) {
      if (generation !== purgeGenerationRef.current) return;
      const errorClass = classifyPurgeError(error);
      const token = purge.preview?.purge_token ?? null;

      if (errorClass === "expired") {
        await cancelPurgeToken(token);
        dispatch({ type: "expire" });
        return;
      }

      if (errorClass === "stale") {
        await cancelPurgeToken(token);
        dispatch({ type: "stale-detected" });
        return;
      }

      if (errorClass === "challenge") {
        dispatch({
          type: "commit-retryable",
          error:
            "Строка подтверждения не совпала. Введите её заново точно без изменений.",
          clearInput: true,
        });
        return;
      }

      if (errorClass === "lock") {
        dispatch({
          type: "commit-retryable",
          error:
            "Операция удаления занята другой вкладкой. Повторите попытку позднее.",
          clearInput: false,
        });
        return;
      }

      dispatch({
        type: "commit-failed",
        error: "Не удалось выполнить окончательное удаление. Проверьте состояние рабочей области.",
      });
    }
  }, [canCommit, cancelPurgeToken, context.commands, purge]);

  const onCancel = useCallback(async () => {
    purgeGenerationRef.current += 1;
    const token = purgeRef.current.token;
    dispatch({ type: "cancel-started" });
    const cancelled = await cancelPurgeToken(token);
    dispatch(cancelled
      ? { type: "cancel-succeeded" }
      : { type: "cancel-failed", error: "PURGE_CANCEL_NOT_CONFIRMED" });
  }, [cancelPurgeToken]);

  // Expiry watcher (§9, PROMPT 35 §4). Expiry MUST cancel the token
  // via `lifecycle.purge-cancel` so the kernel drops server-side state.
  useEffect(() => {
    if (!purge.preview) return;

    const token = purge.preview.purge_token;
    const expiresAt =
      Date.parse(purge.preview.expires_at);

    if (Number.isNaN(expiresAt)) return;

    const delay = Math.max(
      0,
      expiresAt - Date.now(),
    );

    const timerId = window.setTimeout(() => {
      purgeGenerationRef.current += 1;
      dispatch({ type: "expire" });
      void cancelPurgeToken(token).then((cancelled) => {
        if (!cancelled) setLoadError("Preview истёк, но Runtime не подтвердил отмену purge token.");
      });
    }, delay + 50);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [purge.preview, cancelPurgeToken]);

  // Gate: at least one lifecycle op required.
  if (!canList && !canSoftDelete && !canRestore && !canPreview) {
    return (
      <section
        className="p-4 text-sm text-slate-300"
        data-testid="lifecycle-trash-gated"
        data-t2-ui="lifecycle"
      >
        Нет доступных операций жизненного цикла для этого сеанса.
      </section>
    );
  }

  const banner = backupBanner(purge.preview);
  const active = purge.workspaceId;

  return (
    <section
      aria-labelledby="lifecycle-trash-title"
      className="p-4 space-y-4"
      data-testid="lifecycle-trash-route"
      data-t2-ui="lifecycle"
    >
      <h2 id="lifecycle-trash-title" className="text-lg font-medium text-slate-100">
        Корзина рабочих областей
      </h2>
      {loadError && (
        <p role="alert" className="text-sm text-rose-300">{loadError}</p>
      )}
      {trash.length === 0 ? (
        <p className="text-sm text-slate-400" data-testid="lifecycle-trash-empty">
          Корзина пуста.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="lifecycle-trash-list">
          {trash.map((w) => (
            <li
              key={w.workspace_id}
              className="border border-slate-800 rounded p-3 text-sm text-slate-200"
              data-testid={`lifecycle-trash-row-${w.workspace_id}`}
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-slate-100">{w.workspace_id}</span>
                <span className="text-xs text-slate-400">profile={w.profile}</span>
                <span className="text-xs text-slate-500">
                  deleted_at={w.deleted_at}
                </span>
                <span className="text-xs text-slate-500">
                  updated_at={w.updated_at}
                </span>
                {w.read_only && (
                  <span className="text-xs text-amber-300">read-only</span>
                )}
              </div>
              <div className="flex gap-3 mt-2">
                {canRestore && (
                  <button
                    type="button"
                    disabled={busyId === w.workspace_id}
                    onClick={() => void onRestore(w)}
                    className="text-xs text-emerald-300 hover:text-emerald-100 disabled:opacity-40"
                    data-testid={`lifecycle-restore-${w.workspace_id}`}
                  >
                    Восстановить
                  </button>
                )}
                {canPreview && (
                  <button
                    type="button"
                    disabled={active === w.workspace_id && purge.status !== "idle"}
                    onClick={() => void onPreviewPurge(w)}
                    className="text-xs text-rose-300 hover:text-rose-100 disabled:opacity-40"
                    data-testid={`lifecycle-purge-open-${w.workspace_id}`}
                  >
                    Удалить безвозвратно…
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {purge.status !== "idle" && purge.status !== "cancelled" && (
        <div
          role="dialog"
          aria-labelledby="purge-dialog-title"
          aria-modal="true"
          className="border border-rose-900 rounded p-3 space-y-2 bg-rose-950/40"
          data-testid="lifecycle-purge-dialog"
          data-t2-ui="dialog"
        >
          <h3 id="purge-dialog-title" className="text-sm font-medium text-rose-100">
            Безвозвратное удаление · {purge.workspaceId}
          </h3>

          {purge.status === "previewing" && (
            <p className="text-xs text-slate-300" data-testid="lifecycle-purge-loading">
              Получение предварительных данных…
            </p>
          )}

          {purge.preview && (
            <dl
              className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-300"
              data-testid="lifecycle-purge-preview-data"
            >
              <dt>workspace_id</dt>
              <dd className="font-mono">{purge.preview.workspace_id}</dd>
              <dt>workspace_state_timestamp</dt>
              <dd>{new Date(purge.preview.workspace_state_timestamp).toISOString()}</dd>
              <dt>expires_at</dt>
              <dd>{purge.preview.expires_at}</dd>
              <dt>counts.objects</dt>
              <dd>{purge.preview.counts.objects}</dd>
              <dt>counts.events</dt>
              <dd>{purge.preview.counts.events}</dd>
              <dt>counts.relations</dt>
              <dd>{purge.preview.counts.relations}</dd>
              <dt>counts.assets</dt>
              <dd>{purge.preview.counts.assets}</dd>
              <dt>counts.permissions</dt>
              <dd>{purge.preview.counts.permissions}</dd>
              <dt>counts.service_state</dt>
              <dd>{purge.preview.counts.service_state}</dd>
              <dt>counts.outbox</dt>
              <dd>{purge.preview.counts.outbox}</dd>
              <dt>last_export.prepared</dt>
              <dd>{purge.preview.last_export.prepared?.at ?? "—"}</dd>
              <dt>last_export.confirmed</dt>
              <dd>{purge.preview.last_export.confirmed?.at ?? "—"}</dd>
              <dt>last_export.backup_status</dt>
              <dd data-testid="lifecycle-backup-status">
                {purge.preview.last_export.backup_status}
              </dd>
              <dt>last_export.warning</dt>
              <dd>{purge.preview.last_export.warning ?? "—"}</dd>
              <dt>acknowledge_no_backup</dt>
              <dd>{String(purge.preview.acknowledge_no_backup)}</dd>
            </dl>
          )}

          {banner && (
            <p
              data-testid={`lifecycle-backup-banner-${purge.preview?.last_export.backup_status ?? "unknown"}`}
              className={
                banner.tone === "danger"
                  ? "text-xs text-rose-200"
                  : banner.tone === "warn"
                    ? "text-xs text-amber-200"
                    : "text-xs text-emerald-200"
              }
            >
              {banner.text}
            </p>
          )}

          {purge.status === "awaiting-no-backup-ack" && (
            <div className="space-y-2" data-testid="lifecycle-missing-backup-panel">
              <label className="flex items-start gap-2 text-xs text-slate-200">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  data-testid="lifecycle-ack-no-backup"
                  onChange={(e) => {
                    if (e.target.checked) void onAcknowledgeNoBackup();
                  }}
                />
                <span>Я понимаю, что подтверждённой резервной копии нет</span>
              </label>
              <p className="text-xs text-rose-200">
                Первый предпросмотр не позволяет продолжить: сначала подтвердите
                отсутствие резервной копии, затем ядро выдаст новый preview.
              </p>
            </div>
          )}

          {purge.preview?.last_export.backup_status === "stale" && (
            <div className="flex gap-3" data-testid="lifecycle-stale-actions">
              <button
                type="button"
                onClick={() => void onOpenExchangeForBackup()}
                className="text-xs text-sky-300 hover:text-sky-100"
                data-testid="lifecycle-open-exchange-for-backup"
              >
                Создать новую резервную копию
              </button>
            </div>
          )}

          {purge.status === "awaiting-challenge" && purge.preview && (
            <div className="space-y-2" data-testid="lifecycle-challenge-panel">
              <p className="text-xs text-slate-300">
                Для окончательного удаления вручную введите строку ниже точно,
                включая регистр и пробелы.
              </p>
              <code
                className="block max-w-full overflow-x-auto whitespace-pre rounded border border-rose-800 bg-slate-950 px-2 py-2 font-mono text-xs text-rose-100 select-text"
                data-testid="lifecycle-challenge-to-type"
              >
                {purge.preview.challenge}
              </code>
              <label className="block text-xs text-slate-400">
                <span className="sr-only">Подтверждение</span>
                <input
                  type="text"
                  value={purge.challengeInput}
                  onChange={(e) =>
                    dispatch({ type: "challenge-input", value: e.target.value })
                  }
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  className="mt-1 w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono"
                  data-testid="lifecycle-challenge-input"
                />
              </label>
            </div>
          )}

          {purge.status === "expired" && (
            <p className="text-xs text-amber-300" data-testid="lifecycle-purge-expired">
              Срок действия предпросмотра истёк. Запросите новый.
            </p>
          )}

          {purge.status === "stale" && (
            <p className="text-xs text-amber-300" data-testid="lifecycle-purge-stale">
              Состояние рабочей области изменилось. Запросите новый предпросмотр.
            </p>
          )}

          {purge.error && (
            <p role="alert" className="text-xs text-rose-300">{purge.error}</p>
          )}

          <div className="flex gap-2 pt-1">
            {purge.status === "awaiting-challenge" && (
              <button
                type="button"
                onClick={() => void onCommit()}
                disabled={!isChallengeAccepted(purge) || !canCommit}
                className="text-xs text-rose-200 hover:text-rose-50 disabled:opacity-40"
                data-testid="lifecycle-purge-commit"
              >
                Удалить безвозвратно
              </button>
            )}
            {purge.status !== "committed" && (
              <button
                type="button"
                onClick={() => void onCancel()}
                className="text-xs text-slate-300 hover:text-slate-100"
                data-testid="lifecycle-purge-cancel"
              >
                Отмена
              </button>
            )}
            {(purge.status === "expired" || purge.status === "stale") &&
              purge.workspaceId && (
                <button
                  type="button"
                  onClick={() =>
                    void onPreviewPurge({ workspace_id: purge.workspaceId! } as WorkspaceRecord)
                  }
                  className="text-xs text-sky-300 hover:text-sky-100"
                  data-testid="lifecycle-purge-repreview"
                >
                  Новый предпросмотр
                </button>
              )}
          </div>
        </div>
      )}

      {purge.status === "committed" && purge.receipt && (
        <div
          role="status"
          className="border border-emerald-900 rounded p-3 text-xs text-emerald-200 space-y-1"
          data-testid="lifecycle-purge-receipt"
          data-t2-ui="receipt"
        >
          <p className="font-medium">Рабочая область удалена безвозвратно.</p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <dt>workspace_id</dt>
            <dd className="font-mono">{purge.receipt.workspace_id}</dd>
            <dt>removed.workspaces</dt>
            <dd>{purge.receipt.removed.workspaces}</dd>
            <dt>removed.objects</dt>
            <dd>{purge.receipt.removed.objects}</dd>
            <dt>removed.events</dt>
            <dd>{purge.receipt.removed.events}</dd>
            <dt>removed.relations</dt>
            <dd>{purge.receipt.removed.relations}</dd>
            <dt>removed.assets</dt>
            <dd>{purge.receipt.removed.assets}</dd>
            <dt>removed.permissions</dt>
            <dd>{purge.receipt.removed.permissions}</dd>
            <dt>removed.service_state</dt>
            <dd>{purge.receipt.removed.service_state}</dd>
            <dt>removed.outbox</dt>
            <dd>{purge.receipt.removed.outbox}</dd>
          </dl>
        </div>
      )}
    </section>
  );
}
