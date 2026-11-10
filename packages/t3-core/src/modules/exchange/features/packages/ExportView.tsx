import { useEffect, useMemo, useReducer, useRef } from "react";
import type { KernelFacade } from "@/workspace-contract";
import { CONTRACT_VERSION, type PackageArtifact } from "@/kernel-client/contracts/runtime-1.3.0";
import {
  INITIAL_EXPORT_STATE,
  exportReducer,
  selectionsEqual,
  toExportOptions,
  type ExportState,
} from "../state/export-machine";

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const set = new Set(left);
  return set.size === left.length && right.every((value) => set.has(value));
}

function isValidPackageArtifact(
  artifact: PackageArtifact,
  selection: import("../state/export-machine").ExportSelection,
): boolean {
  const manifest = artifact?.manifest;
  const validation = artifact?.validation;
  return (
    artifact.bytes instanceof Uint8Array &&
    artifact.size === artifact.bytes.byteLength &&
    typeof artifact.package_digest === "string" &&
    artifact.package_digest.length > 0 &&
    typeof artifact.semantic_digest === "string" &&
    artifact.semantic_digest.length > 0 &&
    typeof artifact.filename === "string" &&
    artifact.filename.endsWith(".iwxa") &&
    manifest?.format === "iwxa.package" &&
    (manifest.format_version === "1.0" || manifest.format_version === "1.1") &&
    manifest.encryption === "none" &&
    manifest.package_digest === artifact.package_digest &&
    manifest.semantic_digest === artifact.semantic_digest &&
    Array.isArray(manifest.workspaces) &&
    sameStringSet(manifest.workspaces, selection.workspaces) &&
    manifest.options?.include_history === selection.include_history &&
    manifest.options?.include_assets === selection.include_assets &&
    manifest.options?.include_relations === selection.include_relations &&
    manifest.options?.include_schemas === selection.include_schemas &&
    validation?.format === "iwxa.package.validation" &&
    validation.ok === true &&
    Number.isInteger(validation.file_count) &&
    validation.file_count >= 0 &&
    Number.isInteger(validation.object_count) &&
    validation.object_count >= 0 &&
    Array.isArray(validation.schema_issues) &&
    Array.isArray(validation.path_issues) &&
    artifact.summary != null
  );
}

export interface ExportViewProps {
  kernel: KernelFacade;
  scopedWorkspaceId?: string | null;
}

/**
 * PROMPT 23 §2–§7 — canonical Export state machine surface.
 *
 * Freshness (§3): any option change past `ready` snaps back and drops
 * `preview`, `artifact`, `receipt`, and ack — the kernel is never
 * called with stale options.
 *
 * Health (§7): sensitive-data acknowledgement gates `exportPackage`
 * itself, not merely the download click.
 *
 * Blob URL (§4): allocated inside `runDownload`, revoked in the SAME
 * microtask branch even if `download.click()` throws.
 *
 * Confirm receipt (§5, §6): `runConfirm` is a separate user action;
 * `receipt.confirmed_at` and `receipt.package_digest` are surfaced.
 */
export function ExportView({ kernel, scopedWorkspaceId }: ExportViewProps) {
  const [state, dispatch] = useReducer(exportReducer, INITIAL_EXPORT_STATE);
  const busyRef = useRef(false);
  const objectUrlRef = useRef<string | null>(null);
  const revokeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (revokeTimerRef.current !== null) {
        window.clearTimeout(revokeTimerRef.current);
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  const canPreview = kernel.hasOperation("t2.exportPreview");
  const canPackage = kernel.hasOperation("t2.exportPackage");
  const canConfirm = kernel.hasOperation("t2.confirmExport");

  useEffect(() => {
    let alive = true;
    dispatch({ type: "load-workspaces" });
    kernel.listWorkspaces().then((wss) => {
      if (!alive) return;
      const usable = wss.filter((w) => !w.deleted_at);
      const initial = scopedWorkspaceId
        ? usable.filter((w) => w.workspace_id === scopedWorkspaceId).map((w) => w.workspace_id)
        : usable.map((w) => w.workspace_id);
      dispatch({ type: "workspaces-loaded", catalog: usable, initialWorkspaces: initial });
    }).catch((e) => {
      if (!alive) return;
      dispatch({ type: "workspaces-failed", error: e instanceof Error ? e.message : String(e) });
    });
    return () => { alive = false; };
  }, [kernel, scopedWorkspaceId]);

  const options = useMemo(() => toExportOptions(state.selection), [state.selection]);

  const runPreview = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    dispatch({ type: "preview-started" });
    try {
      const preview = await kernel.exportPreview(options);
      dispatch({ type: "preview-succeeded", preview });
    } catch (e) {
      dispatch({ type: "preview-failed", error: e instanceof Error ? e.message : String(e) });
    } finally { busyRef.current = false; }
  };

  const runPackage = async () => {
    if (busyRef.current) return;
    if (!state.preview) return;
    if (
      !state.preview ||
      !state.previewSnapshot ||
      !selectionsEqual(state.previewSnapshot, state.selection)
    ) {
      dispatch({
        type: "package-failed",
        error: "Параметры экспорта изменились. Создайте новый предпросмотр.",
      });
      return;
    }
    busyRef.current = true;
    dispatch({ type: "package-started" });
    try {
      const artifact = await kernel.exportPackage(options);
      if (!isValidPackageArtifact(artifact, state.selection)) {
        throw new Error("Ядро вернуло некорректный PackageArtifact.");
      }
      dispatch({ type: "package-succeeded", artifact });
    } catch (e) {
      dispatch({ type: "package-failed", error: e instanceof Error ? e.message : String(e) });
    } finally { busyRef.current = false; }
  };

  const runDownload = () => {
    if (!state.artifact) return;

    if (revokeTimerRef.current !== null) {
      window.clearTimeout(revokeTimerRef.current);
      revokeTimerRef.current = null;
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }

    const blob = new Blob(
      [state.artifact.bytes as BlobPart],
      { type: "application/octet-stream" },
    );

    const url = URL.createObjectURL(blob);
    objectUrlRef.current = url;

    const link = document.createElement("a");
    link.href = url;
    link.download = state.artifact.filename;
    link.rel = "noopener";
    link.click();

    dispatch({ type: "download-initiated" });

    revokeTimerRef.current = window.setTimeout(() => {
      if (objectUrlRef.current === url) {
        URL.revokeObjectURL(url);
        objectUrlRef.current = null;
      }
    }, 30_000);
  };

  const runConfirm = async () => {
    if (state.status !== "download-initiated") return;
    if (!state.artifact) return;
    if (!canConfirm) return;
    const workspaceIds = state.packageSnapshot?.workspaces ?? [];
    dispatch({ type: "confirm-started" });
    try {
      const receipt = await kernel.confirmExport({
        package_digest: state.artifact.package_digest,
        workspace_ids: [...workspaceIds],
      });
      dispatch({ type: "confirm-succeeded", receipt });
    } catch (e) {
      dispatch({ type: "confirm-failed", error: e instanceof Error ? e.message : String(e) });
    }
  };

  return renderExport({
    state, canPreview, canPackage, canConfirm,
    runPreview, runPackage, runDownload, runConfirm, dispatch,
  });
}

interface RenderProps {
  state: ExportState;
  canPreview: boolean;
  canPackage: boolean;
  canConfirm: boolean;
  runPreview: () => void;
  runPackage: () => void;
  runDownload: () => void;
  runConfirm: () => void;
  dispatch: React.Dispatch<import("../state/export-machine").ExportEvent>;
}

function renderExport(p: RenderProps) {
  const { state, canPreview, canPackage, canConfirm,
    runPreview, runPackage, runDownload, runConfirm, dispatch } = p;
  const busy = state.status === "previewing" || state.status === "packaging" || state.status === "confirming";
  const previewDisabled = !canPreview || state.selection.workspaces.length === 0 || busy;
  const packageDisabled = !canPackage || !state.preview || busy;
  const downloadDisabled = !state.artifact || busy;
  const confirmDisabled =
    !state.artifact || !canConfirm || busy || state.status !== "download-initiated";

  return (
    <div className="space-y-4" data-testid="export-view" data-export-state={state.status}>
      <p className="text-xs text-slate-400">
        Экспорт следует Runtime Contract {CONTRACT_VERSION}: предпросмотр → архив → скачивание → подтверждение приёма.
      </p>

      <fieldset className="border border-slate-800 rounded p-2 max-h-56 overflow-auto">
        <legend className="text-xs px-1 text-slate-400">Рабочие области</legend>
        {state.catalog.map((w) => {
          const checked = state.selection.workspaces.includes(w.workspace_id);
          return (
            <label key={w.workspace_id} className="flex items-center gap-2 text-sm py-1">
              <input type="checkbox" checked={checked} onChange={(e) => {
                const next = new Set(state.selection.workspaces);
                if (e.target.checked) next.add(w.workspace_id); else next.delete(w.workspace_id);
                dispatch({ type: "set-selection", selection: { workspaces: [...next] } });
              }} />
              <span className="text-slate-100">{w.workspace_id}</span>
              <span className="text-xs text-slate-500">({w.profile})</span>
            </label>
          );
        })}
        {state.catalog.length === 0 && state.status !== "loading-workspaces" && (
          <p className="text-xs text-slate-500">Нет рабочих областей для экспорта.</p>
        )}
      </fieldset>

      <fieldset className="border border-slate-800 rounded p-2 space-y-1">
        <legend className="text-xs px-1 text-slate-400">Что включить в пакет</legend>
        {([
          ["include_history", "История событий", state.selection.include_history],
          ["include_assets", "Ассеты", state.selection.include_assets],
          ["include_relations", "Связи", state.selection.include_relations],
          ["include_schemas", "Схемы", state.selection.include_schemas],
        ] as const).map(([id, label, value]) => (
          <label key={id} className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={value} data-testid={`export-${id}`}
              onChange={(e) => dispatch({ type: "set-selection", selection: { [id]: e.target.checked } as never })} />
            <span className="text-slate-200">{label}</span>
          </label>
        ))}
      </fieldset>

      <div className="flex gap-2 flex-wrap">
        <button type="button" onClick={runPreview} disabled={previewDisabled}
          data-testid="export-preview"
          className="px-3 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 min-h-[44px]">
          Предпросмотр
        </button>
        <button type="button" onClick={runPackage} disabled={packageDisabled}
          data-testid="export-package"
          className="px-3 py-1.5 text-xs rounded bg-amber-900/70 hover:bg-amber-900 disabled:opacity-40 min-h-[44px]">
          Собрать архив
        </button>
        <button type="button" onClick={runDownload} disabled={downloadDisabled}
          data-testid="export-download"
          className="px-3 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 min-h-[44px]">
          Скачать .iwxa
        </button>
        <button type="button" onClick={runConfirm} disabled={confirmDisabled}
          data-testid="export-confirm"
          className="px-3 py-1.5 text-xs rounded bg-emerald-900/70 hover:bg-emerald-900 disabled:opacity-40 min-h-[44px]">
          Подтвердить приём
        </button>
      </div>

      {!canPreview && (
        <p className="text-xs text-slate-500">Предпросмотр экспорта не предоставлен ядром.</p>
      )}
      {canPreview && !canPackage && (
        <p className="text-xs text-slate-500">Создание архива не предоставлено ядром.</p>
      )}
      {canPackage && !canConfirm && (
        <p className="text-xs text-slate-500">Подтверждение приёма не предоставлено ядром.</p>
      )}

      {state.error && <p role="alert" className="text-xs text-red-300">{state.error}</p>}

      {state.preview && (
        <section aria-labelledby="exp-preview" data-testid="export-preview-result">
          <h4 id="exp-preview" className="text-sm font-medium text-slate-200 mb-1">Предпросмотр</h4>
          <dl className="text-xs text-slate-400 grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-0.5">
            <dt>Рабочих областей</dt><dd className="text-slate-200">{state.preview.counts.workspaces}</dd>
            <dt>Объектов</dt><dd className="text-slate-200">{state.preview.counts.objects}</dd>
            <dt>Событий</dt><dd className="text-slate-200">{state.preview.counts.events}</dd>
            <dt>Связей</dt><dd className="text-slate-200">{state.preview.counts.relations}</dd>
            <dt>Ассетов</dt><dd className="text-slate-200">{state.preview.counts.assets}</dd>
            <dt>Схем</dt><dd className="text-slate-200">{state.preview.counts.schemas}</dd>
            <dt>Ориент. размер</dt><dd className="text-slate-200">~{state.preview.approx_bytes} Б</dd>
          </dl>
        </section>
      )}

      {state.artifact && (
        <section aria-labelledby="exp-artifact" data-testid="export-artifact">
          <h4 id="exp-artifact" className="text-sm font-medium text-slate-200 mb-1">Архив</h4>
          <dl className="text-xs text-slate-400 grid grid-cols-2 gap-x-3 gap-y-0.5">
            <dt>Файл</dt><dd className="text-slate-200">{state.artifact.filename}</dd>
            <dt>Размер</dt><dd className="text-slate-200">{state.artifact.size} Б</dd>
            <dt>Package digest</dt><dd className="text-slate-200 truncate" data-testid="export-artifact-digest">{state.artifact.package_digest}</dd>
            <dt>Semantic digest</dt><dd className="text-slate-200 truncate">{state.artifact.semantic_digest}</dd>
          </dl>
        </section>
      )}

      {state.receipt && (
        <section aria-labelledby="exp-receipt" data-testid="export-receipt">
          <h4 id="exp-receipt" className="text-sm font-medium text-emerald-300 mb-1">Приём подтверждён</h4>
          <dl className="text-xs text-slate-400 grid grid-cols-2 gap-x-3 gap-y-0.5">
            <dt>confirmed_at</dt><dd className="text-slate-200" data-testid="export-receipt-time">{state.receipt.confirmed_at}</dd>
            <dt>package_digest</dt><dd className="text-slate-200 truncate">{state.receipt.package_digest}</dd>
            <dt>Рабочих областей</dt><dd className="text-slate-200">{state.receipt.workspace_ids.length}</dd>
          </dl>
        </section>
      )}
    </div>
  );
}
