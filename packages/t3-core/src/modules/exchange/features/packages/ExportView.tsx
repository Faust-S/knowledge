import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { KernelFacade } from "@/workspace-contract";
import {androidPackageFileMessage,isAndroidPackageFileRuntime,saveAndroidPackageFile} from "./android-package-file.mjs";
import type { createTrustedAgeExchange } from "../../../../t3/index.mjs";
import { CONTRACT_VERSION, type PackageArtifact } from "@/kernel-client/contracts/runtime-1.3.0";
import {
  INITIAL_EXPORT_STATE,
  exportReducer,
  canStartExportPreview,
  canStartExportPackage,
  selectionsEqual,
  toExportOptions,
  type ExportState,
  type ExportSelection,
} from "../state/export-machine";

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const set = new Set(left);
  return set.size === left.length && new Set(right).size === right.length && right.every((value) => set.has(value));
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
  /** Original signed Host scope hint only. The Kernel still owns permissions. */
  signedWorkspaceScope?: boolean;
  protectedExchange?: ReturnType<typeof createTrustedAgeExchange> | null;
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
export function ExportView({ kernel, scopedWorkspaceId,
  signedWorkspaceScope = false, protectedExchange = null }: ExportViewProps) {
  const [state, dispatch] = useReducer(exportReducer, INITIAL_EXPORT_STATE);
  const busyRef = useRef(false);
  const objectUrlRef = useRef<string | null>(null);
  const revokeTimerRef = useRef<number | null>(null);
  const [protectedBusy,setProtectedBusy] = useState(false);
  const [protectedError,setProtectedError] = useState<string|null>(null);
  const [downloadedName,setDownloadedName] = useState<string|null>(null);
  const nativeDelivery = isAndroidPackageFileRuntime();
  const nativeSavingRef = useRef(false);
  const [nativeSaving,setNativeSaving] = useState(false);
  const [nativeSaveError,setNativeSaveError] = useState<string|null>(null);
  const nativeSavedArtifactRef = useRef<PackageArtifact|null>(null);
  const [nativeSaved,setNativeSaved] = useState<{artifact:PackageArtifact;message:string}|null>(null);
  const nativeSaveMessage = nativeSaved && nativeSaved.artifact===state.artifact ? nativeSaved.message : null;
  const [protectedDownloadedName,setProtectedDownloadedName] = useState<string|null>(null);
  const artifactRef = useRef(state.artifact);
  artifactRef.current = state.artifact;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (revokeTimerRef.current !== null) {
        window.clearTimeout(revokeTimerRef.current);
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  useEffect(()=>{
    setProtectedDownloadedName(null);setNativeSaveError(null);setDownloadedName(null);
    setNativeSaved(null);nativeSavedArtifactRef.current=null;
  },[state.artifact]);

  const canPreview = kernel.hasOperation("t2.exportPreview");
  const canPackage = kernel.hasOperation("t2.exportPackage");
  const canConfirm = kernel.hasOperation("t2.confirmExport");

  useEffect(() => {
    let alive = true;
    dispatch({ type: "load-workspaces" });
    kernel.listWorkspaces().then((wss) => {
      if (!alive) return;
      const usable = wss.filter((w) => !w.deleted_at);
      const signedFocus = signedWorkspaceScope ? scopedWorkspaceId : null;
      // A signed company session never defaults to ALL visible Workspace
      // rows when its selected company scope has not yet been resolved.
      // An absent signed scope must block export, not quietly broaden it.
      const initial = signedWorkspaceScope
        ? (signedFocus
          ? usable.filter(w => w.workspace_id === signedFocus).map(w => w.workspace_id)
          : usable.length === 1 ? [usable[0].workspace_id] : [])
        : usable.map(w => w.workspace_id);
      dispatch({ type: "workspaces-loaded", catalog: usable, initialWorkspaces: initial });
      // Keep the ORIGINAL T2 state-machine snapshots identical to the
      // complete package requested from Kernel after previous selection.
      const whole = signedFocus ??
        (signedWorkspaceScope && usable.length === 1
          ? usable[0].workspace_id : null);
      if (whole && usable.some(w => w.workspace_id === whole)) {
        dispatch({ type: "set-selection", selection: {
          workspaces: [whole], include_history: true, include_assets: true,
          include_relations: true, include_schemas: true,
        } });
      }
    }).catch((e) => {
      if (!alive) return;
      dispatch({ type: "workspaces-failed", error: e instanceof Error ? e.message : String(e) });
    });
    return () => { alive = false; };
  }, [kernel, scopedWorkspaceId, signedWorkspaceScope]);

  // A single catalog row is not evidence of a signed company Workspace.
  // Only a trusted original signed Host makes one selected Workspace a
  // mandatory full .iwxa; ordinary T2 retains its original export options.
  const wholeWorkspaceId = (signedWorkspaceScope ? scopedWorkspaceId : null) ??
    (signedWorkspaceScope && state.catalog.length === 1
      ? state.catalog[0].workspace_id : null);
  const selection: ExportSelection = useMemo(() => wholeWorkspaceId
    ? {
        workspaces: [wholeWorkspaceId],
        include_history: true,
        include_assets: true,
        include_relations: true,
        include_schemas: true,
      }
    : state.selection, [state.selection, wholeWorkspaceId]);
  const scopeReady = !signedWorkspaceScope || Boolean(wholeWorkspaceId && (
    state.catalog.some(w => w.workspace_id === wholeWorkspaceId) &&
    state.selection.workspaces.length === 1 &&
    state.selection.workspaces[0] === wholeWorkspaceId));
  const options = useMemo(() => toExportOptions(selection), [selection]);

  const runPreview = async () => {
    if (busyRef.current || nativeSavingRef.current || protectedBusy || !scopeReady ||
        !canPreview || !canStartExportPreview(state)) return;
    nativeSavedArtifactRef.current=null;
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
    if (busyRef.current || nativeSavingRef.current || protectedBusy || !canPackage ||
        !canStartExportPackage(state) || !scopeReady ||
        !selectionsEqual(state.previewSnapshot ?? state.selection, selection)) return;
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
      if (!isValidPackageArtifact(artifact, selection)) {
        throw new Error("Ядро вернуло некорректный PackageArtifact.");
      }
      dispatch({ type: "package-succeeded", artifact });
    } catch (e) {
      dispatch({ type: "package-failed", error: e instanceof Error ? e.message : String(e) });
    } finally { busyRef.current = false; }
  };

  const triggerDownload = (raw: Uint8Array, filename: string, original: boolean) => {

    if (revokeTimerRef.current !== null) {
      window.clearTimeout(revokeTimerRef.current);
      revokeTimerRef.current = null;
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }

    const blob = new Blob(
      [raw as BlobPart],
      { type: "application/octet-stream" },
    );

    const url = URL.createObjectURL(blob);
    objectUrlRef.current = url;

    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    link.click();

    if (original) {
      setDownloadedName(filename);
      dispatch({ type: "download-initiated" });
    } else {
      // A protected .iwxa.age is NOT the original ZIP backup. Its download
      // must never certify the original Kernel confirmExport receipt.
      setProtectedDownloadedName(filename);
    }

    revokeTimerRef.current = window.setTimeout(() => {
      if (objectUrlRef.current === url) {
        URL.revokeObjectURL(url);
        objectUrlRef.current = null;
      }
    }, 30_000);
  };

  const runDownload = () => {
    const artifact=state.artifact;
    if(!scopeReady||!artifact||nativeSavingRef.current||busyRef.current||protectedBusy||
        !["package-ready","download-initiated","confirmed"].includes(state.status))return;
    if(!nativeDelivery){triggerDownload(artifact.bytes,artifact.filename,true);return;}
    if(!["package-ready","download-initiated"].includes(state.status))return;
    nativeSavingRef.current=true;setNativeSaving(true);setNativeSaveError(null);
    nativeSavedArtifactRef.current=null;setNativeSaved(null);setDownloadedName(null);
    dispatch({type:"ack-file-saved",value:false});
    void saveAndroidPackageFile(artifact.bytes,artifact.filename,{
      isCurrent:()=>mountedRef.current&&artifactRef.current===artifact,
    }).then(saved=>{
      if(!mountedRef.current)return;
      if(artifactRef.current!==artifact){
        setNativeSaveError("Файл предыдущего выбора сохранён. Проверьте его отдельно.");
        return;
      }
      setDownloadedName(saved.filename);
      nativeSavedArtifactRef.current=artifact;
      setNativeSaved({artifact,message:saved.filenameConfirmed
        ? (/\.iwxa$/i.test(saved.filename)
          ? "Файл записан и повторно прочитан: "+saved.filename
          : "Файл записан: "+saved.filename+". Перед импортом переименуйте его, сохранив расширение .iwxa.")
        : "Файл записан и повторно прочитан. Проверьте выбранное имя и расширение .iwxa."});
      // Use the original state machine; manual acknowledgement and Kernel
      // confirmExport still remain separate explicit user actions.
      dispatch({type:"download-initiated"});
    }).catch(error=>{
      if(mountedRef.current)setNativeSaveError(androidPackageFileMessage(error));
    }).finally(()=>{
      nativeSavingRef.current=false;
      if(mountedRef.current)setNativeSaving(false);
    });
  };
  const runProtectedDownload = async () => {
    const artifact=state.artifact;
    if (!protectedExchange || protectedExchange.canSeal === false ||
        !artifact || protectedBusy || busyRef.current ||
        selection.workspaces.length!==1 || !scopeReady ||
        !isValidPackageArtifact(artifact,selection)) return;
    if(artifact.bytes.byteLength>protectedExchange.maxArchiveBytes){
      setProtectedError("Размер архива превышает лимит установленного age. Обычный .iwxa доступен отдельно.");
      return;
    }
    const workspace_id=selection.workspaces[0];
    setProtectedBusy(true);
    setProtectedError(null);
    try {
      const protectedResult=await protectedExchange.seal({
        workspace_id,archiveBytes:artifact.bytes,
      });
      // The source can change during recipient confirmation or native age.
      if(!mountedRef.current || artifactRef.current!==artifact)return;
      triggerDownload(protectedResult.ciphertext,artifact.filename+".age",false);
    } catch(error) {
      if(mountedRef.current&&artifactRef.current===artifact)
        setProtectedError(error instanceof Error?error.message:"T3_D7_AGE_OWNER_UNAVAILABLE");
    } finally {
      if(mountedRef.current)setProtectedBusy(false);
    }
  };
  const runConfirm = async () => {
    if (busyRef.current || nativeSavingRef.current || protectedBusy ||
        (nativeDelivery && (!nativeSaveMessage || nativeSavedArtifactRef.current!==state.artifact)) ||
        !scopeReady || state.status !== "download-initiated" ||
        !state.fileSavedConfirmed) return;
    if (!state.artifact) return;
    if (!canConfirm) return;
    const workspaceIds = state.packageSnapshot?.workspaces ?? [];
    busyRef.current=true;
    dispatch({ type: "confirm-started" });
    try {
      const receipt = await kernel.confirmExport({
        package_digest: state.artifact.package_digest,
        workspace_ids: [...workspaceIds],
      });
      dispatch({ type: "confirm-succeeded", receipt });
    } catch (e) {
      dispatch({ type: "confirm-failed", error: e instanceof Error ? e.message : String(e) });
    } finally { busyRef.current=false; }
  };

  return renderExport({
    state, selection, scopedWorkspaceId: wholeWorkspaceId,
    signedWorkspaceScope, scopeReady,
    canPreview, canPackage, canConfirm,
    runPreview, runPackage, runDownload, runProtectedDownload, runConfirm, dispatch,
    protectedExchange, protectedBusy, protectedError, downloadedName,
    protectedDownloadedName,nativeDelivery,nativeSaving,nativeSaveError,nativeSaveMessage,
  });
}

interface RenderProps {
  state: ExportState;
  selection: ExportSelection;
  scopedWorkspaceId?: string | null;
  signedWorkspaceScope: boolean;
  scopeReady: boolean;
  canPreview: boolean;
  canPackage: boolean;
  canConfirm: boolean;
  runPreview: () => void;
  runPackage: () => void;
  runDownload: () => void;
  runProtectedDownload: () => Promise<void>;
  protectedExchange: ReturnType<typeof createTrustedAgeExchange> | null;
  protectedBusy: boolean;
  protectedError: string | null;
  downloadedName: string | null;
  protectedDownloadedName: string | null;
  nativeDelivery:boolean;
  nativeSaving:boolean;
  nativeSaveError:string|null;
  nativeSaveMessage:string|null;
  runConfirm: () => void;
  dispatch: React.Dispatch<import("../state/export-machine").ExportEvent>;
}

function renderExport(p: RenderProps) {
  const { state, selection, scopedWorkspaceId, signedWorkspaceScope, scopeReady,
    canPreview, canPackage, canConfirm,
    runPreview, runPackage, runDownload, runProtectedDownload, runConfirm, dispatch,
    protectedExchange, protectedBusy, protectedError, downloadedName,
    protectedDownloadedName,nativeDelivery,nativeSaving,nativeSaveError,nativeSaveMessage } = p;
  const busy = nativeSaving || state.status === "previewing" || state.status === "packaging" || state.status === "confirming";
  const previewDisabled = !canPreview || !canStartExportPreview(state) || !scopeReady || busy || protectedBusy;
  const packageDisabled = !canPackage || !canStartExportPackage(state) ||
    !scopeReady || busy || protectedBusy;
  const downloadDisabled = !state.artifact || !scopeReady || busy || protectedBusy ||
    (nativeDelivery && !["package-ready","download-initiated"].includes(state.status));
  const confirmDisabled =
    !state.artifact || !canConfirm || !scopeReady || !state.fileSavedConfirmed ||
    busy || protectedBusy || (nativeDelivery && !nativeSaveMessage) || state.status !== "download-initiated";
  const nativeAgeTooLarge=Boolean(protectedExchange && state.artifact &&
    state.artifact.bytes.byteLength>protectedExchange.maxArchiveBytes);

  return (
    <div className="space-y-4" data-testid="export-view" data-export-state={state.status} data-native-file-delivery={nativeDelivery?"IWXA_ANDROID_PACKAGE_FILE_V1":undefined}>
      <p className="text-xs text-slate-400">
        Экспорт следует Runtime Contract {CONTRACT_VERSION}: предпросмотр → архив → скачивание → подтверждение приёма.
      </p>

      {signedWorkspaceScope && !scopeReady && (
        <p role="status" className="text-xs text-slate-400">
          Подписанная Workspace компании ещё не выбрана или не подтверждена Kernel.
          Экспорт недоступен до восстановления исходной рабочей области.
        </p>
      )}
      <fieldset className="border border-slate-800 rounded p-2 max-h-56 overflow-auto">
        <legend className="text-xs px-1 text-slate-400">Рабочие области</legend>
        {state.catalog.filter(w => !signedWorkspaceScope ||
          (scopedWorkspaceId && w.workspace_id === scopedWorkspaceId)).map((w) => {
          const checked = selection.workspaces.includes(w.workspace_id);
          return (
            <label key={w.workspace_id} className="flex items-center gap-2 text-sm py-1">
              <input type="checkbox" checked={checked}
                disabled={busy || protectedBusy || signedWorkspaceScope || Boolean(scopedWorkspaceId)} onChange={(e) => {
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

      {!signedWorkspaceScope && !scopedWorkspaceId ? <fieldset className="border border-slate-800 rounded p-2 space-y-1">
        <legend className="text-xs px-1 text-slate-400">Что включить в пакет</legend>
        {([
          ["include_history", "История событий", state.selection.include_history],
          ["include_assets", "Ассеты", state.selection.include_assets],
          ["include_relations", "Связи", state.selection.include_relations],
          ["include_schemas", "Схемы", state.selection.include_schemas],
        ] as const).map(([id, label, value]) => (
          <label key={id} className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={value} disabled={busy || protectedBusy} data-testid={`export-${id}`}
              onChange={(e) => dispatch({ type: "set-selection", selection: { [id]: e.target.checked } as never })} />
            <span className="text-slate-200">{label}</span>
          </label>
        ))}
      </fieldset> : <p className="text-xs text-slate-400" data-testid="export-whole-workspace-scope">
        Передаётся вся выбранная Workspace: объекты, история, файлы, связи и схемы.
      </p>}

      {state.preview && state.status !== "confirmed" && (
        <label className="flex items-start gap-2 text-xs text-slate-300">
          <input type="checkbox" id="iwxa-exchange-ack-sensitive" data-testid="export-ack-sensitive"
            aria-label="Состав архива проверен" aria-describedby="iwxa-exchange-sensitive-description"
            checked={state.ackSensitive} disabled={busy || protectedBusy}
            onChange={(e) => dispatch({ type: "ack-sensitive", value: e.target.checked })}
            className="mt-0.5" />
          <span id="iwxa-exchange-sensitive-description">Я проверил состав предпросмотра и понимаю, что экспортируемый
            архив .iwxa не зашифрован. Защищённая копия создаётся отдельно у установленного владельца age.</span>
        </label>
      )}

      <div className="flex gap-2 flex-wrap">
        <button type="button" onClick={runPreview} disabled={previewDisabled}
          id="iwxa-exchange-export-preview" data-testid="export-preview"
          className="px-3 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 min-h-[44px]">
          Предпросмотр
        </button>
        <button type="button" onClick={runPackage} disabled={packageDisabled}
          id="iwxa-exchange-export-package" data-testid="export-package"
          className="px-3 py-1.5 text-xs rounded bg-amber-900/70 hover:bg-amber-900 disabled:opacity-40 min-h-[44px]">
          Собрать архив
        </button>
        <button type="button" onClick={runDownload} disabled={downloadDisabled}
          id="iwxa-exchange-export-download" data-testid="export-download"
          className="px-3 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 min-h-[44px]">
          {nativeDelivery?(nativeSaving?"Сохранение…":"Сохранить .iwxa"):"Скачать .iwxa"}
        </button>
        {protectedExchange && protectedExchange.canSeal !== false &&
          <button type="button" onClick={() => void runProtectedDownload()}
          disabled={downloadDisabled || selection.workspaces.length!==1 ||
            nativeAgeTooLarge}
          data-testid="export-age-protected"
          className="px-3 py-1.5 text-xs rounded bg-indigo-900/70 hover:bg-indigo-900 disabled:opacity-40 min-h-[44px]">
          {protectedBusy ? "Защита…" : "Скачать защищённую .iwxa.age"}
        </button>}
        <button type="button" onClick={runConfirm} disabled={confirmDisabled}
          id="iwxa-exchange-export-confirm" data-testid="export-confirm"
          className="px-3 py-1.5 text-xs rounded bg-emerald-900/70 hover:bg-emerald-900 disabled:opacity-40 min-h-[44px]">
          Подтвердить сохранение
        </button>
      </div>

      {nativeSaveError&&<p role="alert" data-testid="export-native-file-error" className="text-xs text-red-300">{nativeSaveError}</p>}
      {nativeSaveMessage&&<p role="status" data-testid="export-native-file-saved" className="text-xs text-slate-300">{nativeSaveMessage}</p>}
      {nativeAgeTooLarge && protectedExchange && <p role="note"
        data-testid="export-age-native-limit" className="text-xs text-amber-200">
        Защищённый перенос ограничен возможностями установленного age
        ({(protectedExchange.maxArchiveBytes/(1024*1024)).toFixed(1)} МиБ).
        Обычный экспорт .iwxa остаётся доступен.
      </p>}
      {protectedError && <p role="alert" data-testid="export-age-error" className="text-xs text-red-300">Защита не выполнена: {protectedError}</p>}
      {protectedDownloadedName && <p role="status" data-testid="export-age-download-not-backup"
        className="text-xs text-slate-400">Браузеру передан {protectedDownloadedName}. Сохранение файла проверьте самостоятельно. Это не квитанция исходного Kernel о резервной копии .iwxa.</p>}
      {state.artifact && ["download-initiated", "confirming", "confirmed"].includes(state.status) && (
        <label className="flex items-start gap-2 text-xs text-slate-300">
          <input type="checkbox" id="iwxa-exchange-confirm-saved-file" data-testid="export-confirm-saved-file"
            aria-label="Файл архива сохранён" aria-describedby="iwxa-exchange-saved-description"
            checked={state.fileSavedConfirmed}
            disabled={nativeSaving||(nativeDelivery&&!nativeSaveMessage)||state.status !== "download-initiated"}
            onChange={(e) => dispatch({ type: "ack-file-saved", value: e.target.checked })}
            className="mt-0.5" />
          <span id="iwxa-exchange-saved-description">Я проверил, что файл {downloadedName ?? state.artifact.filename} действительно сохранён
            на устройстве. {nativeDelivery?"Файл должен иметь расширение .iwxa.":"Начало скачивания само по себе не подтверждает наличие копии."}</span>
        </label>
      )}

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
            <dt>Файл</dt><dd id="iwxa-exchange-archive-filename" className="text-slate-200">{state.artifact.filename}</dd>
            <dt>Размер</dt><dd className="text-slate-200">{state.artifact.size} Б</dd>
            <dt>Package digest</dt><dd className="text-slate-200 truncate" id="iwxa-exchange-archive-digest" data-testid="export-artifact-digest">{state.artifact.package_digest}</dd>
            <dt>Semantic digest</dt><dd className="text-slate-200 truncate">{state.artifact.semantic_digest}</dd>
          </dl>
        </section>
      )}

      {state.receipt && (
        <section aria-labelledby="exp-receipt" data-testid="export-receipt">
          <h4 id="exp-receipt" className="text-sm font-medium text-emerald-300 mb-1">
            Сохранение архива подтверждено вами
          </h4>
          <p className="text-xs text-slate-400">Это квитанция локального экспорта.
            Она не означает, что другой получатель импортировал .iwxa.</p>
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
