import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type {
  CommandsFacade,
  KernelFacade,
} from "@/workspace-contract";
import type {
  ConflictPolicy,
  ImportMode,
  ObjectKey,
} from "@/kernel-client/contracts/runtime-1.3.0";
import type { WorkspaceRecord } from "@/kernel-client";
import type { createTrustedAgeExchange } from "../../../../t3/index.mjs";
import { PackageCorruptedError } from "@/kernel-client/errors";
import {
  INITIAL_IMPORT_STATE,
  importReducer,
  toKernelImportPlan,
  validateImportPlan,
  validateImportScope,
  validateRestorationReceipt,
  type ImportState,
  type ImportPreviewHandle,
} from "../state/import-machine";

/** OS File Handling passes a handle, never an automatic Kernel write. */
export type InstalledPwaFileHandle = Readonly<{
  kind: "file";
  name: string;
  getFile: () => Promise<File>;
}>;
export interface ImportViewProps {
  kernel: KernelFacade;
  commands: CommandsFacade;
  pwaFileHandle?: InstalledPwaFileHandle | null;
  protectedExchange?: ReturnType<typeof createTrustedAgeExchange> | null;
}

const MAX_PACKAGE_BYTES = 200 * 1024 * 1024;
const ALLOWED_EXTENSION = ".iwxa";

export type ImportErrorClass =
  | "expired"
  | "invalid"
  | "consumed"
  | "lock"
  | "stale"
  | "digest"
  | "unknown";

export function classifyImportError(
  error: unknown,
): ImportErrorClass {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error
      ? String((error as { code?: unknown }).code)
      : "";

  switch (code) {
    case "PREVIEW_EXPIRED":
      return "expired";

    case "PREVIEW_REQUIRED":
    case "PREVIEW_TOKEN_INVALID":
    case "PREVIEW_SERVICE_MISMATCH":
    case "PREVIEW_ORIGIN_MISMATCH":
      return "invalid";

    case "PREVIEW_TOKEN_USED":
      return "consumed";

    case "LOCK_UNAVAILABLE":
    case "WEB_LOCKS_UNAVAILABLE":
      return "lock";

    case "PLAN_NOT_IN_PREVIEW":
      return "stale";

    case "PACKAGE_DIGEST_MISMATCH":
      return "digest";

    default:
      return "unknown";
  }
}

/**
 * PROMPT 23 §8–§16, PROMPT 32 — canonical Import state machine surface.
 */
export function ImportView({ kernel, commands, pwaFileHandle = null,
  protectedExchange = null }: ImportViewProps) {
  const [state, dispatch] = useReducer(importReducer, INITIAL_IMPORT_STATE);
  const [pwaReadBusy, setPwaReadBusy] = useState(false);
  const [pwaReadError, setPwaReadError] = useState<string | null>(null);
  const [pwaUsed, setPwaUsed] = useState<InstalledPwaFileHandle | null>(null);
  const pwaReadGuard = useRef(false);
  const [ageFile,setAgeFile] = useState<File|null>(null);
  const [ageBusy,setAgeBusy] = useState(false);
  const [ageError,setAgeError] = useState<string|null>(null);
  const ageGuard = useRef(false);
  useEffect(() => {
    setPwaUsed(null);
    setPwaReadError(null);
  }, [pwaFileHandle]);
  const [localWorkspaces, setLocalWorkspaces] = useState<readonly WorkspaceRecord[]>([]);
  const activeTokenRef = useRef<string | null>(null);
  const commitGuardRef = useRef(false); // §13
  const expiryTimerRef = useRef<number | null>(null);
  const operationGenerationRef = useRef(0);
  const cancelGuardRef = useRef(false);

  const canPreview = kernel.hasOperation("t2.importPreview");
  const canCommit = kernel.hasOperation("t2.importCommit");
  const canCancel = kernel.hasOperation("t2.importCancel");
  const canListLocal = kernel.hasOperation("t1.listWorkspaces");

  const cancelActive = useCallback(async (
    why: "explicit" | "new-file" | "unmount" | "session-change",
  ): Promise<boolean> => {
    if (cancelGuardRef.current) return false;
    cancelGuardRef.current = true;
    operationGenerationRef.current += 1;
    const tok = activeTokenRef.current;
    try {
      if (tok) {
        if (!canCancel) {
          dispatch({ type: "cancel-failed", error: "IMPORT_CANCEL_NOT_AVAILABLE" });
          return false;
        }
        let cancelled = false;
        try {
          cancelled = (await kernel.importCancel(tok)) === true;
        } catch {
          cancelled = false;
        }
        if (!cancelled) {
          dispatch({ type: "cancel-failed", error: "IMPORT_CANCEL_NOT_CONFIRMED" });
          return false;
        }
      }

      activeTokenRef.current = null;
      commitGuardRef.current = false;
      if (expiryTimerRef.current !== null) {
        clearTimeout(expiryTimerRef.current);
        expiryTimerRef.current = null;
      }
      dispatch({ type: "cancel", reason: why });
      return true;
    } finally {
      cancelGuardRef.current = false;
    }
  }, [kernel, canCancel]);

  // §14 — cancel on unmount / session change.
  useEffect(() => {
    const onUnload = () => {
      const tok = activeTokenRef.current;
      if (tok && canCancel) void kernel.importCancel(tok);
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      operationGenerationRef.current += 1;
      commitGuardRef.current = false;
      const tok = activeTokenRef.current;
      activeTokenRef.current = null;
      if (expiryTimerRef.current !== null) clearTimeout(expiryTimerRef.current);
      if (tok && canCancel) void kernel.importCancel(tok);
    };
  }, [kernel, canCancel]);

  const armExpiry = (handle: ImportPreviewHandle) => {
    if (expiryTimerRef.current !== null) clearTimeout(expiryTimerRef.current);
    const ms = new Date(handle.expires_at).getTime() - Date.now();
    if (ms <= 0) {
      const token = activeTokenRef.current;
      activeTokenRef.current = null;
      dispatch({ type: "expire" });
      if (token && canCancel) void kernel.importCancel(token);
      return;
    }
    expiryTimerRef.current = window.setTimeout(() => {
      const token = activeTokenRef.current;
      activeTokenRef.current = null;
      dispatch({ type: "expire" });
      if (token && canCancel) {
        void kernel.importCancel(token);
      }
    }, Math.min(ms, 2 ** 31 - 1));
  };

  const onFile = async (file: File) => {
    // §9, §14 — new file => cancel previous.
    const cancelledPrevious = await cancelActive("new-file");
    if (!cancelledPrevious) return;
    const generation = ++operationGenerationRef.current;
    dispatch({ type: "preview-started" });

    if (!file.name.toLowerCase().endsWith(ALLOWED_EXTENSION)) {
      dispatch({ type: "preview-failed", error: `Принимаются только пакеты ${ALLOWED_EXTENSION}.` });
      return;
    }
    if (file.size > MAX_PACKAGE_BYTES) {
      dispatch({ type: "preview-failed", error:
        `Размер пакета ${file.size} байт превышает предельные ${MAX_PACKAGE_BYTES} байт. Файл не был передан ядру.` });
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer()); // §9 — bytes live only until kernel returns
      if (generation !== operationGenerationRef.current) return;
      const secure = await kernel.importPreview(bytes);
      if (generation !== operationGenerationRef.current) {
        if (secure?.preview_token) {
          let cancelled = false;
          if (canCancel) {
            try { cancelled = (await kernel.importCancel(secure.preview_token)) === true; } catch { cancelled = false; }
          }
          if (!cancelled) {
            operationGenerationRef.current += 1;
            dispatch({ type: "preview-failed", error: "IMPORT_STALE_PREVIEW_CANCEL_NOT_CONFIRMED" });
          }
        }
        return;
      }
      const handle: ImportPreviewHandle = {
        preview_token: secure.preview_token,
        package_digest: secure.package_digest,
        semantic_digest: secure.semantic_digest,
        expires_at: secure.expires_at,
        allowed_modes: secure.allowed_modes,
        preview: secure.preview,
      };
      activeTokenRef.current = handle.preview_token;
      commitGuardRef.current = false;
      // The original signed Kernel lists ONLY its selected Workspace.
      // Read it before offering a plan: a foreign-source package would
      // otherwise default to 'selective', which signed importCommit refuses.
      let available: WorkspaceRecord[] = [];
      if (canListLocal) {
        try {
          available = (await kernel.listWorkspaces({ include_deleted: false }))
            .filter((w) => !w.deleted_at);
        } catch {
          // The preview remains readable; user can retry local target selection.
        }
      }
      if (generation !== operationGenerationRef.current) return;
      setLocalWorkspaces(available);
      const writable = available.filter((w) => !w.read_only);
      const preferredTargetWorkspaceId = writable.length === 1
        ? writable[0].workspace_id : null;
      dispatch({ type: "preview-succeeded", handle, preferredTargetWorkspaceId });
      armExpiry(handle);
    } catch (e) {
      if (generation !== operationGenerationRef.current) return;
      const msg = e instanceof PackageCorruptedError || (e as { code?: string })?.code === "package_corrupted"
        ? "Пакет .iwxa повреждён; предпросмотр не создан и запись невозможна."
        : e instanceof Error ? e.message : String(e);
      dispatch({ type: "preview-failed", error: msg });
    }
  };

  const runCommit = async () => {
    if (!state.handle) return;
    if (commitGuardRef.current) return; // §13
    const previewWorkspaceIds =
      state.handle.preview.workspaces.map((workspace) => workspace.workspace_id);
    const previewObjectKeys =
      state.handle.preview.objects.map(
        (object) => `${object.workspace_id}/${object.object_id}`,
      );
    const localWorkspaceIds = localWorkspaces.map((workspace) => workspace.workspace_id);
    dispatch({ type: "validate-plan", localWorkspaceIds });
    const validation = validateImportPlan(
      state.plan,
      state.handle.allowed_modes,
      previewWorkspaceIds,
      previewObjectKeys,
      localWorkspaceIds,
    );
    if (validation.length > 0 || validateImportScope(state.handle.preview, state.plan).length > 0) return;
    if (!canCommit) return;
    commitGuardRef.current = true;
    const generation = operationGenerationRef.current;
    dispatch({ type: "commit-started" });
    try {
      const receipt = await kernel.importCommit({
        preview_token: state.handle.preview_token,
        package_digest: state.handle.package_digest,
        plan: toKernelImportPlan(state.plan),
      });
      if (generation !== operationGenerationRef.current) return;
      activeTokenRef.current = null;
      if (expiryTimerRef.current !== null) {
        clearTimeout(expiryTimerRef.current);
        expiryTimerRef.current = null;
      }
      const restoreIssues = [...validateRestorationReceipt(
        state.handle.preview, state.plan, receipt,
      )];
      let readbackUnconfirmed = false;
      // A Kernel receipt is not a readback. In a signed cross-Workspace merge,
      // read the destination from the ORIGINAL selected Kernel again before
      // reporting completion. An uncertain read leaves the committed receipt
      // visible and must NEVER silently replay the import.
      if (state.plan.mode === "merge" && state.plan.target_workspace &&
          !receipt.cancelled && kernel.hasOperation("t1.getWorkspace")) {
        const target = state.plan.target_workspace;
        try {
          const workspace = await kernel.getWorkspace(target);
          if (!workspace || workspace.workspace_id !== target)
            throw new Error("DESTINATION_WORKSPACE_READBACK_MISSING");
          const sample = state.handle.preview.objects[0];
          if (sample && kernel.hasOperation("t1.getObject")) {
            const stored = await kernel.getObject(target, sample.object_id);
            if (!stored || stored.object.workspace_id !== target ||
                stored.object.object_id !== sample.object_id ||
                stored.object.schema_id !== sample.schema_id ||
                stored.object.schema_version !== sample.schema_version)
              throw new Error("DESTINATION_OBJECT_READBACK_MISMATCH");
          }
        } catch {
          readbackUnconfirmed = true;
          restoreIssues.push("Контрольное чтение получателя не подтвердило " +
            "сохранённый объект. Не импортируйте файл повторно автоматически.");
        }
      }
      if (generation !== operationGenerationRef.current) return;
      if (restoreIssues.length > 0) {
        // Kernel may already have committed a partial transaction. Retain the
        // real receipt, warn the user, refresh the catalog, and never reuse
        // the consumed preview token or imply that the write was rolled back.
        const partial = restoreIssues.length > (readbackUnconfirmed ? 1 : 0);
        dispatch({
          type: partial ? "commit-incomplete" : "commit-unconfirmed",
          receipt,
          error: partial
            ? "Kernel записал данные, но восстановление неполное. " + restoreIssues.join(" ")
            : "Kernel вернул квитанцию, но повторное чтение ещё не подтвердило результат. " +
              restoreIssues.join(" "),
        });
      } else {
        dispatch({ type: "commit-succeeded", receipt });
      }
      // §16, PROMPT 32 §1 — refresh the actual catalog even when the
      // receipt proves only a partial import: its objects may now exist.
      // Host-owned catalog refresh via commands.
      if (commands.has("workspace.catalog.refresh")) {
        try {
          await commands.invoke("workspace.catalog.refresh", {
            reason: "import.committed",
          });
        } catch {
          // Импорт уже выполнен. Ошибка обновления каталога не отменяет receipt.
        }
      }
    } catch (error) {
      if (generation !== operationGenerationRef.current) return;
      commitGuardRef.current = false;

      const errorClass = classifyImportError(error);
      const token = activeTokenRef.current;

      if (
        errorClass === "expired" ||
        errorClass === "invalid" ||
        errorClass === "consumed" ||
        errorClass === "stale" ||
        errorClass === "digest"
      ) {
        activeTokenRef.current = null;
        if (expiryTimerRef.current !== null) {
          clearTimeout(expiryTimerRef.current);
          expiryTimerRef.current = null;
        }
        if (token && canCancel) void kernel.importCancel(token);
        if (errorClass === "expired") {
          dispatch({ type: "expire" });
        } else {
          const code =
            error && typeof error === "object" && "code" in error
              ? String(error.code)
              : "IMPORT_INVALID";
          dispatch({
            type: "commit-invalid",
            error: code === "PLAN_NOT_IN_PREVIEW"
              ? "План импорта не соответствует разрешённым данным предпросмотра " +
                "(PLAN_NOT_IN_PREVIEW). Проверьте права и выберите файл заново."
              : `Kernel отклонил импорт: ${code}. Выберите пакет заново.`,
          });
        }
        return;
      }

      if (errorClass === "lock") {
        dispatch({
          type: "commit-retryable",
          error:
            "Импорт занят другой операцией. Повторите попытку позднее.",
        });
        return;
      }

      // An unclassified failure may have happened AFTER Kernel committed.
      // Do not reuse a possibly consumed preview token or claim rollback.
      activeTokenRef.current = null;
      if (expiryTimerRef.current !== null) {
        clearTimeout(expiryTimerRef.current);
        expiryTimerRef.current = null;
      }
      dispatch({
        type: "commit-failed",
        error: "Применение не подтверждено. Проверьте Workspace перед повтором: " +
          (error instanceof Error ? error.message : String(error)),
      });
    }
  };

  const openAgeFile = async () => {
    if (!protectedExchange || !ageFile || ageGuard.current || !canPreview) return;
    const encryptedFile=ageFile;
    if(!encryptedFile.name.toLowerCase().endsWith(".iwxa.age") ||
       encryptedFile.size>MAX_PACKAGE_BYTES+1024*1024){
      setAgeError("Нужен защищённый файл .iwxa.age допустимого размера.");
      return;
    }
    ageGuard.current=true;
    setAgeBusy(true);
    setAgeError(null);
    try {
      if(!await cancelActive("new-file"))return;
      const ticket=operationGenerationRef.current;
      const ciphertext=new Uint8Array(await encryptedFile.arrayBuffer());
      if(ticket!==operationGenerationRef.current)return;
      const opened=await protectedExchange.open({ciphertext});
      if(ticket!==operationGenerationRef.current)return;
      // The existing T2 ImportView performs original importPreview and
      // separately waits for the human-confirmed Kernel importCommit.
      const archive=new File([opened.archiveBytes as BlobPart],
        encryptedFile.name.slice(0,-4),{type:"application/octet-stream"});
      setAgeFile(null);
      await onFile(archive);
    } catch(error) {
      setAgeError("Не удалось проверить или расшифровать защищённый файл: "+
        (error instanceof Error?error.message:"T3_D7_AGE_OPEN_FAILED"));
    } finally {ageGuard.current=false;setAgeBusy(false);}
  };

  const openPwaFile = async () => {
    if (!pwaFileHandle || pwaReadGuard.current || pwaUsed === pwaFileHandle ||
        !canPreview || state.status === "previewing" || state.status === "committing") return;
    pwaReadGuard.current = true;
    setPwaReadBusy(true);
    setPwaReadError(null);
    try {
      const file = await pwaFileHandle.getFile();
      if (file.name !== pwaFileHandle.name)
        throw Error("Имя файла изменилось после выбора в системе.");
      // The canonical ImportView enforces the .iwxa extension, 200 MiB limit,
      // original Kernel importPreview, exact digest and separate commit.
      setPwaUsed(pwaFileHandle);
      await onFile(file);
    } catch (error) {
      setPwaReadError("Не удалось открыть переданный системой файл: " +
        (error instanceof Error ? error.message : String(error)));
    } finally {
      pwaReadGuard.current = false;
      setPwaReadBusy(false);
    }
  };
  return renderImport({
    state, canPreview, canCommit, canCancel, localWorkspaces,
    onFile, runCommit, cancelActive, dispatch,
    pwaFileHandle, pwaReadBusy, pwaReadError, pwaUsed,
    openPwaFile,
    protectedExchange, ageFile, setAgeFile, ageBusy, ageError, openAgeFile,
  });
}

interface RenderProps {
  state: ImportState;
  canPreview: boolean;
  canCommit: boolean;
  canCancel: boolean;
  localWorkspaces: readonly WorkspaceRecord[];
  onFile: (f: File) => void;
  runCommit: () => void;
  cancelActive: (why: "explicit") => Promise<boolean>;
  dispatch: React.Dispatch<import("../state/import-machine").ImportEvent>;
  pwaFileHandle: InstalledPwaFileHandle | null;
  pwaReadBusy: boolean;
  pwaReadError: string | null;
  pwaUsed: InstalledPwaFileHandle | null;
  openPwaFile: () => Promise<void>;
  protectedExchange: ReturnType<typeof createTrustedAgeExchange> | null;
  ageFile: File | null;
  setAgeFile: (file: File | null) => void;
  ageBusy: boolean;
  ageError: string | null;
  openAgeFile: () => Promise<void>;
}

function renderImport(p: RenderProps) {
  const {
    state, canPreview, canCommit, canCancel, localWorkspaces,
    onFile, runCommit, cancelActive, dispatch,
    pwaFileHandle, pwaReadBusy, pwaReadError, pwaUsed, openPwaFile,
    protectedExchange, ageFile, setAgeFile, ageBusy, ageError, openAgeFile,
  } = p;
  const busy = state.status === "previewing" || state.status === "committing";
  const scopeIssues = state.handle ? validateImportScope(state.handle.preview, state.plan) : [];
  const commitDisabled = scopeIssues.length > 0 || !canCommit || busy || !state.handle
    || state.planValidation.length > 0
    || state.status === "committed";

  return (
    <div className="space-y-4" data-testid="import-view" data-import-state={state.status}>
      <p className="text-xs text-slate-400">
        Выберите сохранённый пакет <code>.iwxa</code>
        (не более {MAX_PACKAGE_BYTES / (1024 * 1024)} МиБ). Байты передаются ядру и
        не сохраняются в оболочке — предпросмотр удерживает только токен и digest'ы.
      </p>
      {pwaFileHandle && (
        <div className="rounded border border-sky-800 p-3 space-y-2"
          data-testid="import-pwa-file">
          <p className="text-sm break-all">
            Передан системой файл: <strong>{pwaFileHandle.name}</strong>
          </p>
          <p className="text-xs">
            Данные не прочитаны и не записаны. Сначала просмотрите пакет,
            затем отдельно подтвердите его применение в выбранную Workspace.
          </p>
          <button type="button"
            disabled={!canPreview || busy || pwaReadBusy || pwaUsed === pwaFileHandle}
            onClick={() => void openPwaFile()}
            data-testid="import-pwa-preview"
            className="border rounded px-3 py-2 min-h-11">
            {pwaUsed === pwaFileHandle ? "Файл передан на предпросмотр"
              : "Просмотреть переданный файл .iwxa"}
          </button>
          {pwaReadError && <p role="alert" className="text-xs text-red-300">
            {pwaReadError}
          </p>}
        </div>
      )}
      <input
        type="file"
        accept={ALLOWED_EXTENSION}
        disabled={!canPreview || busy}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          // Reset the native chooser synchronously so choosing this same
          // file again after cancellation (or failure) fires change.
          event.currentTarget.value = "";
          if (file) void onFile(file);
        }}
        aria-label="Выберите файл .iwxa"
        data-testid="import-file"
        className="text-xs"
      />
      {protectedExchange && <div className="border border-slate-700 rounded p-3 space-y-2"
        data-testid="import-age-protected">
        <p className="text-xs text-slate-300">
          Защищённый пакет .iwxa.age проверяется установленным владельцем age.
          Расшифровка не означает согласие на импорт.
        </p>
        <input type="file" accept=".iwxa.age" disabled={!canPreview||busy||ageBusy}
          aria-label="Выберите защищённый файл .iwxa.age"
          data-testid="import-age-file"
          onChange={event=>{
            setAgeFile(event.currentTarget.files?.[0]??null);
            event.currentTarget.value="";
          }} className="text-xs"/>
        {ageFile && <button type="button" disabled={!canPreview||busy||ageBusy}
          onClick={()=>void openAgeFile()} data-testid="import-age-preview"
          className="px-3 py-1.5 text-xs rounded bg-slate-800 min-h-[44px] disabled:opacity-40">
          {ageBusy?"Расшифровка…" :"Расшифровать и показать предпросмотр .iwxa"}
        </button>}
        {ageError && <p role="alert" className="text-xs text-red-300">{ageError}</p>}
      </div>}
      {!canPreview && (
        <p className="text-xs text-slate-500">Предпросмотр импорта не предоставлен ядром.</p>
      )}
      {canPreview && !canCommit && (
        <p className="text-xs text-slate-500">Ядро разрешает только предпросмотр — фиксация недоступна.</p>
      )}

      {state.error && (
        <p role="alert" data-testid="import-error" className="text-xs text-red-300">{state.error}</p>
      )}

      {state.handle && (
        <section aria-labelledby="imp-preview" className="space-y-2" data-testid="import-preview">
          <h4 id="imp-preview" className="text-sm font-medium text-slate-200">Предпросмотр</h4>
          <p className="text-xs text-slate-400" data-testid="import-expires">
            Действителен до: <span className="text-slate-200">{state.handle.expires_at}</span>
          </p>
          <p className="text-xs text-slate-500 truncate">
            package_digest: <span className="text-slate-300">{state.handle.package_digest}</span>
          </p>

          <dl className="text-xs text-slate-400 grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-0.5">
            <dt>Рабочих областей</dt><dd className="text-slate-200">{state.handle.preview.totals.workspaces}</dd>
            <dt>Объектов</dt><dd className="text-slate-200">{state.handle.preview.totals.objects}</dd>
            <dt>Событий</dt><dd className="text-slate-200">{state.handle.preview.totals.events}</dd>
            <dt>Связей</dt><dd className="text-slate-200">{state.handle.preview.totals.relations}</dd>
            <dt>Ассетов</dt><dd className="text-slate-200">{state.handle.preview.totals.assets}</dd>
            <dt>Схем</dt><dd className="text-slate-200">{state.handle.preview.totals.schemas}</dd>
          </dl>
          {state.handle.preview.included && state.handle.preview.excluded_by_permission && (
            <p className="text-xs text-slate-300" data-testid="import-history-scope">
              История: в пакете {state.handle.preview.totals.events} событий, разрешено
              {" "}{state.handle.preview.included.events}, исключено полномочиями
              {" "}{state.handle.preview.excluded_by_permission.events}.
            </p>
          )}
          {!state.plan.include_history && state.handle.preview.totals.events > 0 && (
            <p role="status" className="text-xs text-amber-300" data-testid="import-history-disabled">
              История отключена в плане: события пакета не будут восстановлены.
              Для полного восстановления её необходимо включить.
              Выборочный перенос без истории может не восстановить связи Result с рабочими решениями.
            </p>
          )}

          <fieldset className="border border-slate-800 rounded p-2 space-y-1">
            <legend className="text-xs px-1 text-slate-400">Режим импорта (allowed_modes)</legend>
            <select
              className="bg-slate-900 text-slate-100 text-xs rounded px-1 py-1 border border-slate-700"
              value={state.plan.mode}
              data-testid="import-mode"
              onChange={(e) => dispatch({ type: "set-plan", plan: { mode: e.target.value as ImportMode } })}
            >
              {(["full", "selective", "new-workspace", "merge", "cancel"] as ImportMode[]).map((m) => {
                const allowed = state.handle!.allowed_modes.includes(m);
                return (
                  <option key={m} value={m} disabled={!allowed}>
                    {m}{!allowed ? " (не разрешён ядром)" : ""}
                  </option>
                );
              })}
            </select>
          </fieldset>

          <fieldset className="border border-slate-800 rounded p-2 space-y-1">
            <legend className="text-xs px-1 text-slate-400">Политика конфликтов (по умолчанию — fail)</legend>
            <select
              className="bg-slate-900 text-slate-100 text-xs rounded px-1 py-1 border border-slate-700"
              value={state.plan.conflict}
              data-testid="import-conflict"
              onChange={(e) => dispatch({ type: "set-plan", plan: { conflict: e.target.value as ConflictPolicy } })}
            >
              {(["fail", "skip", "overwrite"] as ConflictPolicy[]).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </fieldset>

          <fieldset className="border border-slate-800 rounded p-2">
            <legend className="text-xs px-1 text-slate-400">Рабочие области в пакете</legend>
            {state.handle.preview.workspaces.map((w) => {
              const checked = state.plan.include_workspaces.includes(w.workspace_id);
              return (
                <label key={w.workspace_id} className="flex items-center gap-2 text-sm py-1">
                  <input type="checkbox" checked={checked}
                    disabled={state.plan.mode !== "selective"}
                    onChange={(event) => {
                      const nextWorkspaces =
                        new Set(state.plan.include_workspaces);

                      if (event.target.checked) {
                        nextWorkspaces.add(w.workspace_id);
                      } else {
                        nextWorkspaces.delete(w.workspace_id);
                      }

                      const nextObjects =
                        (state.plan.include_objects ?? []).filter(
                          (key) => {
                            const slash = key.indexOf("/");
                            const workspaceId =
                              slash > 0 ? key.slice(0, slash) : "";

                            return nextWorkspaces.has(workspaceId);
                          },
                        );

                      dispatch({
                        type: "set-plan",
                        plan: {
                          include_workspaces: [...nextWorkspaces],
                          include_objects: nextObjects,
                        },
                      });
                    }} />
                  <span className="text-slate-100">{w.workspace_id}</span>
                  <span className="text-xs text-slate-500">
                    (объектов: {w.incoming_objects}{w.exists_locally ? " · уже существует" : ""})
                  </span>
                </label>
              );
            })}
          </fieldset>

          {state.plan.mode === "selective" &&
            state.handle.preview.objects.length > 0 && (
              <fieldset
                className="border border-slate-800 rounded p-2 space-y-1"
                data-testid="import-objects"
              >
                <legend className="text-xs px-1 text-slate-400">
                  Объекты
                </legend>
                {state.handle.preview.objects.map((object) => {
                  const key =
                    `${object.workspace_id}/${object.object_id}` as ObjectKey;

                  const workspaceSelected =
                    state.plan.include_workspaces.includes(
                      object.workspace_id,
                    );

                  const checked =
                    state.plan.include_objects?.includes(key) ??
                    false;

                  return (
                    <label
                      key={key}
                      className="flex items-center gap-2 text-xs py-0.5"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!workspaceSelected}
                        data-testid={`import-object-${key}`}
                        onChange={(event) => {
                          const next = new Set(
                            state.plan.include_objects ?? [],
                          );

                          if (event.target.checked) {
                            next.add(key);
                          } else {
                            next.delete(key);
                          }

                          dispatch({
                            type: "set-plan",
                            plan: {
                              include_objects: [...next],
                            },
                          });
                        }}
                      />
                      <span className="text-slate-200 truncate">
                        {key}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            )}

          {state.plan.mode === "new-workspace" && (
            <fieldset className="border border-slate-800 rounded p-2 space-y-1" data-testid="import-ws-map">
              <legend className="text-xs px-1 text-slate-400">
                Новые workspace_id (создаются локально)
              </legend>
              {state.handle.preview.workspaces.map((w) => (
                <label key={w.workspace_id} className="flex items-center gap-2 text-xs py-0.5">
                  <span className="text-slate-400 w-40 truncate">{w.workspace_id} →</span>
                  <input
                    type="text"
                    value={state.plan.workspace_id_map?.[w.workspace_id] ?? ""}
                    data-testid={`import-ws-map-${w.workspace_id}`}
                    onChange={(event) => {
                      const next = {
                        ...(state.plan.workspace_id_map ?? {}),
                        [w.workspace_id]: event.target.value,
                      };
                      dispatch({
                        type: "set-plan",
                        plan: { workspace_id_map: next },
                      });
                    }}
                    className="bg-slate-900 text-slate-100 text-xs rounded px-1 py-0.5 border border-slate-700 flex-1"
                  />
                </label>
              ))}
            </fieldset>
          )}

          {state.plan.mode === "merge" && state.plan.target_workspace &&
            state.handle.preview.workspaces.length === 1 &&
            state.handle.preview.workspaces[0].workspace_id !== state.plan.target_workspace && (
              <p className="text-xs text-sky-200" role="status"
                data-testid="import-foreign-workspace-target">
                Перенос из рабочей области «{state.handle.preview.workspaces[0].workspace_id}»
                {" "}в выбранную локальную «{state.plan.target_workspace}».
                Запись произойдёт только после вашего подтверждения.
              </p>
            )}
          {state.plan.mode === "merge" && (
            <fieldset className="border border-slate-800 rounded p-2 space-y-1" data-testid="import-merge-target">
              <legend className="text-xs px-1 text-slate-400">
                Локальная целевая рабочая область (target_workspace)
              </legend>
              <select
                value={state.plan.target_workspace ?? ""}
                data-testid="import-target-workspace"
                onChange={(event) =>
                  dispatch({
                    type: "set-plan",
                    plan: {
                      target_workspace:
                        event.target.value || null,
                    },
                  })
                }
                className="bg-slate-900 text-slate-100 text-xs rounded px-1 py-1 border border-slate-700 w-full"
              >
                <option value="">Выберите рабочую область</option>
                {localWorkspaces
                  .filter((workspace) => !workspace.read_only)
                  .map((workspace) => (
                    <option
                      key={workspace.workspace_id}
                      value={workspace.workspace_id}
                    >
                      {workspace.workspace_id}
                    </option>
                  ))}
              </select>
            </fieldset>
          )}

          <fieldset className="border border-slate-800 rounded p-2 space-y-1">
            <legend className="text-xs px-1 text-slate-400">Что импортировать</legend>
            {([
              ["include_history", "История событий", state.plan.include_history],
              ["include_assets", "Ассеты", state.plan.include_assets],
              ["include_relations", "Связи", state.plan.include_relations],
            ] as const).map(([id, label, value]) => (
              <label key={id} className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={value} data-testid={`import-${id}`}
                  onChange={(e) => dispatch({ type: "set-plan", plan: { [id]: e.target.checked } as never })} />
                <span className="text-slate-200">{label}</span>
              </label>
            ))}
          </fieldset>

          {state.handle.preview.conflicts.length > 0 && (
            <section aria-labelledby="imp-conflicts" data-testid="import-conflicts">
              <h5 id="imp-conflicts" className="text-xs font-medium text-amber-300">Конфликты</h5>
              <ul className="text-xs text-amber-300 list-disc pl-4">
                {state.handle.preview.conflicts.map((c, i) => (
                  <li key={`${c.workspace_id}:${c.object_id}:${i}`}>
                    {c.workspace_id}/{c.object_id} — rev {c.local_revision ?? "—"} → {c.incoming_revision}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {state.handle.preview.schemas?.some((schema) =>
            schema.status === "missing" || schema.status === "invalid" ||
            schema.status === "conflict") && (
            <section aria-labelledby="imp-schema-compatibility"
              data-testid="import-incompatible-schemas">
              <h5 id="imp-schema-compatibility" className="text-xs font-medium text-rose-300">
                Несовместимые объявления схем
              </h5>
              <ul className="text-xs text-rose-300 list-disc pl-4 break-words">
                {state.handle.preview.schemas.filter((schema) =>
                  schema.status === "missing" || schema.status === "invalid" ||
                  schema.status === "conflict").map((schema) => (
                    <li key={`${schema.schema_id}@${schema.schema_version}`}>
                      {schema.schema_id}@{schema.schema_version}:{" "}
                      {schema.status === "missing" ? "описание отсутствует"
                        : schema.status === "invalid" ? "описание некорректно"
                        : "конфликт версий"}
                    </li>
                  ))}
              </ul>
              <p className="text-xs text-slate-400">
                Требуется совместимое объявление в исходном сервисе. Kernel не
                разрешит подтвердить такой импорт с потерей данных.
              </p>
            </section>
          )}

          {state.handle.preview.unsupported.length > 0 && (
            <section aria-labelledby="imp-unsupported" data-testid="import-unsupported">
              <h5 id="imp-unsupported" className="text-xs font-medium text-rose-300">
                Совместимость содержимого
              </h5>
              <ul className="text-xs text-rose-300 list-disc pl-4 break-words">
                {state.handle.preview.unsupported.map((item, i) => (
                  <li key={i}>
                    {item.kind === "unknown_schema"
                      ? `Неизвестная схема ${item.schema_id}@${item.schema_version}: ${item.object_count} объект(ов).`
                      : item.kind === "forbidden_for_service"
                        ? `Сервису запрещена запись ${item.schema_id}@${item.schema_version}: ${item.object_count} объект(ов).`
                        : `Дополнительное поле ${item.path}: требуется проверить поддержку предметной семантики у владельца схемы.`}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-slate-400">
                Источник сведений: предпросмотр оригинального Kernel, без замены
                парсера .iwxa. Неподдерживаемые схемы и права блокируют импорт;
                дополнительные поля показаны для проверки совместимости.
              </p>
            </section>
          )}

          {state.handle.preview.warnings.length > 0 && (
            <ul className="text-xs text-amber-300 list-disc pl-4" data-testid="import-warnings">
              {state.handle.preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}

          {scopeIssues.length > 0 && (
            <div role="alert" data-testid="import-scope-blocked" className="text-xs text-amber-300">
              <p>Этот пакет нельзя восстановить полностью с текущими правами:</p>
              <ul className="list-disc pl-4">
                {scopeIssues.map((issue, i) => <li key={i}>{issue}</li>)}
              </ul>
            </div>
          )}

          {state.planValidation.length > 0 && (
            <ul role="alert" data-testid="import-plan-issues" className="text-xs text-rose-300 list-disc pl-4">
              {state.planValidation.map((v, i) => <li key={i}>{v}</li>)}
            </ul>
          )}

          <div className="flex gap-2">
            <button type="button" onClick={runCommit} disabled={commitDisabled}
              data-testid="import-commit"
              className="px-3 py-1.5 text-xs rounded bg-emerald-900/70 hover:bg-emerald-900 disabled:opacity-40 min-h-[44px]">
              Импортировать ({state.plan.include_workspaces.length})
            </button>
            <button type="button" onClick={() => { void cancelActive("explicit"); }}
              disabled={!canCancel || busy || !state.handle ||
                ["committed","incomplete","unconfirmed"].includes(state.status)}
              data-testid="import-cancel"
              className="px-3 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 min-h-[44px]">
              Отменить
            </button>
          </div>
        </section>
      )}

      {state.status === "expired" && (
        <p role="alert" data-testid="import-expired" className="text-xs text-rose-300">
          Preview token истёк — выберите пакет заново.
        </p>
      )}

      {state.receipt && (
        <section aria-labelledby="imp-receipt" data-testid="import-receipt">
          <h4 id="imp-receipt" className="text-sm font-medium text-slate-200 mb-1">
            {state.status === "incomplete" ? "Импорт выполнен не полностью"
            : state.status === "unconfirmed" ? "Импорт требует проверки" : "Отчёт"}
          </h4>
          {["incomplete","unconfirmed"].includes(state.status) && (
            <p role="status" className="text-xs text-amber-300" data-testid="import-incomplete-notice">
              Оригинальный Kernel мог записать данные полностью или частично.
              Проверьте полученную рабочую область перед новым импортом:
              эта операция не отменена и не будет автоматически повторена.
            </p>
          )}
          <dl className="text-xs text-slate-400 grid grid-cols-2 gap-x-3 gap-y-0.5">
            <dt>Импорт</dt><dd className="text-slate-200 truncate">{state.receipt.import_id}</dd>
            <dt>Режим</dt><dd className="text-slate-200">{state.receipt.mode}</dd>
            <dt>Конфликты</dt><dd className="text-slate-200">{state.receipt.conflict_policy}</dd>
            <dt>Завершено</dt><dd className="text-slate-200">{state.receipt.committed_at}</dd>
            <dt>package_digest</dt><dd className="text-slate-200 truncate">{state.receipt.package_digest}</dd>
            <dt>Объектов создано</dt><dd className="text-slate-200">{state.receipt.applied.objects_inserted}</dd>
            <dt>Объектов обновлено</dt><dd className="text-slate-200">{state.receipt.applied.objects_updated}</dd>
            <dt>Объектов пропущено</dt><dd className="text-slate-200">{state.receipt.applied.objects_skipped}</dd>
            <dt>Событий</dt><dd className="text-slate-200">{state.receipt.applied.events}</dd>
            <dt>Связей</dt><dd className="text-slate-200">{state.receipt.applied.relations}</dd>
          </dl>
        </section>
      )}
    </div>
  );
}
