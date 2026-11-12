import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspaceModuleRuntime } from "@/workspace-host/rendering/ModuleRenderContext";
import { saveLocalInferenceDraft, listLocalInferenceDrafts, getLocalInferenceDraft } from "../../t3/index.mjs";
import { MODEL } from "./catalog.mjs";
import { requestPersistence, describeStorage, formatBytes } from "./storage.mjs";
// Engine and Worker are the unchanged BLI-1 WebLLM implementation, copied
// from the BLI owner at trusted build time (never loaded from an arbitrary URL).
import type { BrowserLocalRuntimeAdapter } from "./engine.mjs";

type Draft = { object_id: string; revision: number; model_id: string; text: string };
type OpenedDraft = Draft & { engine: string; status: "DRAFT_UNTRUSTED" };
type Source = { object_id: string; schema_id: string; revision: number };
type Engine = InstanceType<typeof BrowserLocalRuntimeAdapter>;
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function LocalInferencePanel() {
  const { context } = useWorkspaceModuleRuntime();
  const [workspaceId, setWorkspaceId] = useState(context.currentWorkspace.get()?.workspace_id ?? "");
  const [workspaceChoices, setWorkspaceChoices] = useState<{workspace_id:string;profile:string}[]>([]);
  const [workspaceChoice, setWorkspaceChoice] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [cached, setCached] = useState(false);
  const [cacheStatus, setCacheStatus] = useState("Проверка локального кеша...");
  const [storageStatus, setStorageStatus] = useState("Постоянство браузерного кеша ещё не проверялось.");
  const [status, setStatus] = useState("Выберите модель и подтвердите загрузку.");
  const [prompt, setPrompt] = useState("");
  const [maxTokens, setMaxTokens] = useState(64);
  const [output, setOutput] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const [saved, setSaved] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [openedDraft, setOpenedDraft] = useState<OpenedDraft | null>(null);
  const [pendingReadbackId, setPendingReadbackId] = useState<string | null>(null);
  const [draftIdToRecover, setDraftIdToRecover] = useState("");
  const [objects, setObjects] = useState<Source[]>([]);
  const [objectId, setObjectId] = useState("");
  const engine = useRef<Engine | null>(null);
  const initializingEngine = useRef<Promise<Engine> | null>(null);
  const alive = useRef(true);
  const focusEpoch = useRef(0);
  const sourceSelectionEpoch = useRef(0);
  const actionBusy = useRef(false);

  const current = useCallback(() => context.currentWorkspace.get()?.workspace_id ?? "", [context]);
  const invalidate = useCallback(() => {
    focusEpoch.current++;
    sourceSelectionEpoch.current++;
    setWorkspaceId(current());
    setWorkspaceChoice("");
    setWorkspaceChoices([]);
    setDraftReady(false);
    setSaved(false);
    setOutput("");
    setPrompt("");
    engine.current?.cancel();
    setReady(Boolean(engine.current?.ready));
    setObjects([]);
    setObjectId("");
    setDrafts([]);
    setOpenedDraft(null);
    setPendingReadbackId(null);
    setDraftIdToRecover("");
    setStatus("Рабочая область изменена. Новый ответ не может использовать старый контекст.");
  }, [current]);

  useEffect(() => {
    alive.current = true;
    const off = context.currentWorkspace.subscribe(invalidate);
    return () => {
      alive.current = false;
      focusEpoch.current++;
      off();
      engine.current?.dispose();
    };
  }, [context, invalidate]);

  const ensureEngine = async (): Promise<Engine> => {
    if (engine.current) return engine.current;
    if (!initializingEngine.current) {
      initializingEngine.current = import("./engine.mjs")
        .then(({BrowserLocalRuntimeAdapter}) => {
          if (!alive.current) throw Error("T3_D5_PANEL_CLOSED");
          return engine.current ?? (engine.current = new BrowserLocalRuntimeAdapter());
        })
        .finally(() => { initializingEngine.current = null; });
    }
    return initializingEngine.current;
  };
  const checkCache = async () => {
    try {
      const cachedStatus = await (await ensureEngine()).cachedForOffline();
      if (alive.current) {
        setCached(cachedStatus.ready);
        setCacheStatus(cachedStatus.ready
          ? "Модель и WebGPU-ресурсы найдены в локальном кеше."
          : "Для офлайн-запуска не хватает: "+cachedStatus.missing.join(", ")+
            ". Установка требует отдельного разрешения.");
      }
    } catch (e) { if (alive.current) setCacheStatus(message(e)); }
  };
  // Cold offline reopens should discover the installed WebLLM model without
  // another manual cache check. Read-only CacheStorage inspection never starts
  // inference or downloads model files; actual launch still needs a click.
  useEffect(() => { void checkCache(); }, []);

  const persist = async () => {
    try {
      const granted = await requestPersistence();
      const info = await describeStorage();
      if (alive.current) setStorageStatus((granted || info.persistent
        ? "Браузер разрешил постоянное хранение" : "Браузер может автоматически очистить кеш") +
        " · " + formatBytes(info.usage) + " / " + formatBytes(info.quota));
    } catch (e) { if (alive.current) setStorageStatus("Ошибка проверки хранилища: " + message(e)); }
  };
  const load = async (networkConsent: boolean) => {
    if (actionBusy.current) return;
    if (networkConsent && !consent) { setStatus("Сначала разрешите получение модели."); return; }
    if (networkConsent && !window.confirm("Установить " + MODEL.label +
      " в текущем браузере? Будут загружены веса и WebGPU-ресурсы модели.")) {
      setStatus("Установка модели отменена."); return;
    }
    actionBusy.current = true;
    setBusy(true);
    const epoch = focusEpoch.current;
    let finishInstall: (() => Promise<void>) | null = null;
    try {
      setStatus(networkConsent ? "Скачивание по вашему разрешению…" : "Запуск только из локального кеша…");
      if (networkConsent) {
        const { beginDomainModelInstallation } = await import("./domain-model-install.mjs");
        finishInstall = await beginDomainModelInstallation();
      }
      await (await ensureEngine()).load({ networkConsent, onProgress: (p: {text?: string}) => {
        if (alive.current) setStatus(p.text ?? "Загрузка модели…");
      }});
      if (alive.current) {
        setReady(true);
        setStatus(epoch === focusEpoch.current
          ? "Модель доступна в текущем браузере." : "Модель запущена. Контекст Workspace изменён.");
      }
    } catch (e) { if (alive.current) setStatus("Модель не запущена: " + message(e)); }
    finally {
      // Close the temporary download exception, regardless of WebLLM result.
      if (finishInstall) {
        try { await finishInstall(); }
        catch (e) { if (alive.current) setStatus("Не удалось завершить разрешение загрузки: " + message(e)); }
      }
      actionBusy.current = false;
      if (alive.current) { setBusy(false); void checkCache(); }
    }
  };
  // Only the existing base Workspace owner can change Host focus. The
  // inference module requests that command after an explicit user selection.
  const discoverWorkspaces = async () => {
    if (!context.kernel.hasOperation("t1.listWorkspaces") || actionBusy.current) return;
    const epoch=focusEpoch.current;
    try {
      const rows=await context.kernel.listWorkspaces({include_deleted:false});
      if (!alive.current || epoch!==focusEpoch.current) return;
      const allowed=rows.filter(w=>w.deleted_at==null && w.profile===context.profile.id)
        .map(w=>({workspace_id:w.workspace_id,profile:w.profile}));
      setWorkspaceChoices(allowed);
      setWorkspaceChoice("");
      setStatus(allowed.length?"Выберите Workspace и подтвердите переключение.":"Нет доступных рабочих областей этого профиля.");
    }catch(e){if(alive.current && epoch===focusEpoch.current)setStatus(message(e));}
  };
  const selectWorkspace = async () => {
    if (!workspaceChoice || actionBusy.current ||
        !context.commands.has("workspace.focus.select")) return;
    actionBusy.current=true;
    setBusy(true);
    try {
      await context.commands.invoke("workspace.focus.select",{workspace_id:workspaceChoice});
      if (alive.current) {
        setWorkspaceId(current());
        setStatus("Рабочая область выбрана через Host. Теперь можно выбрать объект и сохранить результат.");
      }
    }catch(e){if(alive.current)setStatus("Не удалось выбрать Workspace: "+message(e));}
    finally{actionBusy.current=false;if(alive.current)setBusy(false);}
  };
  const loadObjects = async () => {
    if (!workspaceId || !context.kernel.hasOperation("t1.listObjects")) return;
    const epoch = focusEpoch.current;
    const sourceEpoch = ++sourceSelectionEpoch.current;
    setStatus("Читаю список объектов только выбранной рабочей области…");
    try {
      const rows = await context.kernel.listObjects({workspace_id: workspaceId});
      if (!alive.current || epoch !== focusEpoch.current ||
          sourceEpoch !== sourceSelectionEpoch.current || current() !== workspaceId) return;
      if (rows.some(row => row.workspace_id !== workspaceId)) throw Error("T3_D5_SOURCE_SCOPE_MISMATCH");
      setObjects(rows.filter(row => !row.deleted && !row.deleted_at &&
        row.schema_id !== "iwxa.local-inference.draft").map(row =>
          ({object_id: row.object_id, schema_id: row.schema_id, revision: row.revision})));
      setObjectId("");
      setStatus("Содержимое объектов не прочитано. Выберите один объект и подтвердите.");
    } catch (e) { if (alive.current && epoch === focusEpoch.current) setStatus(message(e)); }
  };
  const addSource = async () => {
    if (!workspaceId || !objectId || !context.kernel.hasOperation("t1.getObject")) return;
    const epoch = focusEpoch.current;
    const sourceEpoch = sourceSelectionEpoch.current;
    const chosen = objects.find(row => row.object_id === objectId);
    if (!chosen) return;
    try {
      const result = await context.kernel.getObject(workspaceId, objectId);
      if (!alive.current || epoch !== focusEpoch.current ||
          sourceEpoch !== sourceSelectionEpoch.current || current() !== workspaceId) return;
      if (!result?.object || result.object.workspace_id !== workspaceId ||
          result.object.object_id !== objectId || result.object.revision !== chosen.revision ||
          result.object.deleted_at != null) {
        throw Error("T3_D5_SOURCE_CHANGED");
      }
      const data = JSON.stringify(result.object.data);
      const prepared = [prompt, "Контекст объекта " + objectId +
        " (редакция " + chosen.revision + "):", data].filter(Boolean).join("\n\n");
      if (prepared.length > 6000) throw Error("T3_D5_CONTEXT_TOO_LARGE");
      setPrompt(prepared);
      setStatus("Контекст добавлен. Проверьте его в поле запроса перед запуском.");
    } catch (e) { if (alive.current && epoch === focusEpoch.current) setStatus(message(e)); }
  };
  const run = async () => {
    if (!ready || actionBusy.current || !prompt.trim() || prompt.length > 6000) return;
    const epoch = focusEpoch.current;
    actionBusy.current = true;
    setBusy(true);
    setOutput("");
    setDraftReady(false);
    setSaved(false);
    setStatus("Генерация выполняется локально. Можно остановить.");
    try {
      const result = await (await ensureEngine()).invoke(prompt, {
        maxTokens,
        onChunk: (text: string) => {
          if (alive.current && epoch === focusEpoch.current) setOutput(text);
        },
      });
      if (!alive.current || epoch !== focusEpoch.current) return;
      setOutput(result);
      setDraftReady(Boolean(result.trim()));
      setStatus("Черновик готов. Просмотрите его перед отдельным сохранением.");
    } catch (e) {
      if (alive.current && epoch === focusEpoch.current) {
        // Timeout and explicit Stop terminate the existing WebLLM Worker.
        // Never leave the launch UI claiming that a dead engine is ready.
        setReady(Boolean(engine.current?.ready));
        setDraftReady(false);
        setStatus(message(e));
      }
    } finally { actionBusy.current = false; if (alive.current) setBusy(false); }
  };
  const save = async () => {
    if (!draftReady || saved || !workspaceId || !output.trim() || actionBusy.current ||
        !context.kernel.hasOperation("t1.putObject")) return;
    const epoch = focusEpoch.current;
    actionBusy.current = true;
    setBusy(true);
    try {
      const receipt = await saveLocalInferenceDraft(context, {
        expected_workspace_id: workspaceId,
        model_id: MODEL.id, engine: MODEL.engine, output,
      });
      if (!alive.current || epoch !== focusEpoch.current) return;
      setSaved(true);
      setPendingReadbackId(null);
      setStatus("Kernel подтвердил запись и чтение: " + receipt.object_id +
        " · ревизия " + receipt.revision + " · " + receipt.status);
      // Show the new draft using the original Kernel history, not local UI state.
      // A failed history refresh never triggers a duplicate write.
      try {
        const history = await listLocalInferenceDrafts(context, {
          expected_workspace_id: workspaceId,
        });
        if (alive.current && epoch === focusEpoch.current) setDrafts(history);
      } catch {
        // The receipt/readback above remains the write confirmation.
        // History can be opened explicitly after a permission or focus change.
      }
    } catch (e) {
      if (alive.current && epoch === focusEpoch.current) {
        const uncertain=e as {code?:string; object_id?:string};
        if (uncertain.code==="T3_D5_WRITE_MAY_HAVE_COMMITTED" &&
            typeof uncertain.object_id==="string") {
          // The Kernel may have committed the write once. Lock out retries
          // of the same draft; use the original getObject read path below.
          setPendingReadbackId(uncertain.object_id);
          setDraftReady(false);
          setStatus("Kernel мог сохранить черновик " + uncertain.object_id +
            ". Не повторяйте запись: проверьте её отдельно по идентификатору.");
        } else {
          setStatus("Сохранение не подтверждено: " + message(e) +
            ". Не повторяйте автоматически: проверьте историю.");
        }
      }
    } finally { actionBusy.current = false; if (alive.current) setBusy(false); }
  };
  const list = async () => {
    if (!workspaceId || actionBusy.current || !context.kernel.hasOperation("t1.listObjects")) return;
    const epoch = focusEpoch.current;
    try {
      const rows = await listLocalInferenceDrafts(context, {expected_workspace_id: workspaceId});
      if (!alive.current || epoch !== focusEpoch.current) return;
      setDrafts(rows);
      setStatus("Черновиков в выбранном Workspace: " + rows.length);
    } catch (e) { if (alive.current && epoch === focusEpoch.current) setStatus(message(e)); }
  };

  const openSaved = async (id: string) => {
    if (!workspaceId || actionBusy.current ||
        !context.kernel.hasOperation("t1.getObject")) return;
    const epoch=focusEpoch.current;
    actionBusy.current=true;
    setBusy(true);
    setOpenedDraft(null);
    try {
      const result=await getLocalInferenceDraft(context, {
        expected_workspace_id:workspaceId, object_id:id,
      });
      if (!alive.current || focusEpoch.current!==epoch || current()!==workspaceId) return;
      setOpenedDraft(result);
      if (pendingReadbackId===id) setPendingReadbackId(null);
      setStatus("Черновик заново прочитан из Kernel: "+id+" · редакция "+result.revision);
    } catch (e) {
      if (alive.current && epoch===focusEpoch.current)
        setStatus("Не удалось открыть черновик через Kernel: "+message(e));
    } finally {
      actionBusy.current=false;
      if (alive.current) setBusy(false);
    }
  };

  return <div className="space-y-3 text-sm" data-testid="t3-local-inference-panel">
    <h3 className="text-base font-semibold">Локальная модель · WebGPU</h3>
    <p>Текущий Workspace: <strong className="break-all">{workspaceId || "не выбран"}</strong></p>
    <div className="space-y-2 rounded border border-slate-700 p-3" data-testid="t3-d5-workspace-chooser">
      <p className="text-sm">Выберите рабочую область для контекста и сохранения через оригинальный Kernel.</p>
      <button type="button" disabled={busy ||
        !context.kernel.hasOperation("t1.listWorkspaces") ||
        !context.commands.has("workspace.focus.select")}
        onClick={() => void discoverWorkspaces()}>Найти рабочие области</button>
      <select aria-label="Workspace для локальной модели"
        className="w-full rounded p-2 text-slate-900"
        disabled={busy || !workspaceChoices.length}
        value={workspaceChoice} onChange={e=>setWorkspaceChoice(e.target.value)}>
        <option value="">Не выбран</option>
        {workspaceChoices.map(w=><option key={w.workspace_id} value={w.workspace_id}>{w.workspace_id} · {w.profile}</option>)}
      </select>
      <button type="button" disabled={busy || !workspaceChoice ||
        !context.commands.has("workspace.focus.select")}
        onClick={() => void selectWorkspace()}>Использовать выбранный Workspace</button>
    </div>
    <p>{MODEL.label} · {MODEL.engine}. Запрос выполняется на устройстве. Нет облачного fallback.</p>
    <label className="flex gap-2 items-start"><input type="checkbox" checked={consent}
      onChange={e => setConsent(e.target.checked)}/>Разрешаю скачать файлы модели по сети</label>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => void checkCache()}>Проверить кеш</button>
      <button type="button" disabled={busy || ready || !consent} onClick={() => void load(true)}>Скачать и запустить</button>
      <button type="button" disabled={busy || ready || !cached} onClick={() => void load(false)}>Из кеша, без сети</button>
      <button type="button" disabled={busy || !ready} onClick={() => {
        void ensureEngine().then(adapter => adapter.unload()).then(() => {setReady(false); setStatus("Модель выгружена. Веса сохранены.");})
          .catch(e => setStatus(message(e)));
      }}>Выгрузить</button>
      <button type="button" disabled={busy || ready || !cached} onClick={() => {
        if (!window.confirm("Удалить локальные веса модели из кеша? Данные Workspace останутся.")) return;
        void ensureEngine().then(adapter => adapter.deleteCachedWeights())
          .then(() => {setCached(false); setStatus("Локальные веса модели удалены.");})
          .catch(e => setStatus("Не удалось удалить кеш: " + message(e)));
      }}>Удалить веса модели</button>
    </div>
    <p role="status" className="text-xs" data-testid="t3-d5-cache-status">{cacheStatus}</p>
    <div className="flex flex-wrap gap-2 items-center">
      <button type="button" disabled={busy} onClick={() => void persist()}>
        Запросить постоянное хранение модели
      </button>
      <p className="text-xs">{storageStatus}</p>
    </div>
    <p role="status" aria-live="polite">{status}</p>
    <hr className="border-slate-700"/>
    <p>Контекст читается только по отдельному выбору. Промпт не сохраняется.</p>
    <button type="button" disabled={!workspaceId || busy ||
      !context.kernel.hasOperation("t1.listObjects")} onClick={() => void loadObjects()}>
      Выбрать объект Workspace
    </button>
    <select aria-label="Объект для локальной модели" value={objectId} disabled={busy}
      onChange={e => {sourceSelectionEpoch.current++; setObjectId(e.target.value);}} className="w-full text-slate-900">
      <option value="">Не выбран</option>
      {objects.map(row => <option key={row.object_id} value={row.object_id}>
        {row.schema_id} · {row.object_id} · r{row.revision}
      </option>)}
    </select>
    <button type="button" disabled={!objectId || busy} onClick={() => void addSource()}>
      Добавить выбранное содержимое к запросу
    </button>
    <label className="block">Запрос
      <textarea className="w-full min-h-28 p-2 rounded text-slate-900" maxLength={6000}
        value={prompt} onChange={e => setPrompt(e.target.value)}/>
    </label>
    <label className="block">Максимум токенов ответа
      <input type="number" min={1} max={256} step={1}
        data-testid="t3-d5-max-tokens"
        className="w-24 rounded p-2 text-slate-900"
        value={maxTokens} onChange={e => {
          const n = Number(e.target.value);
          if (Number.isInteger(n) && n >= 1 && n <= 256) setMaxTokens(n);
        }}/>
    </label>
    <button type="button" disabled={!ready || busy || !prompt.trim()}
      onClick={() => void run()}>Сгенерировать локально</button>
    <button type="button" disabled={!busy} onClick={() => engine.current?.cancel()}>Остановить</button>
    <label className="block">Черновик · редактируемый
      <textarea className="w-full min-h-28 p-2 rounded text-slate-900" maxLength={64000}
        value={output} onChange={e => {setOutput(e.target.value); setSaved(false);}}/>
    </label>
    <button type="button" disabled={!workspaceId || !draftReady || saved || busy || !output.trim() ||
      !context.kernel.hasOperation("t1.putObject")} onClick={() => void save()}>
      Сохранить черновик через Kernel
    </button>
    {pendingReadbackId && <div className="space-y-1">
      <p role="alert" className="text-xs break-all">Запись могла состояться: {pendingReadbackId}.
        Повторное сохранение заблокировано до проверки.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !workspaceId ||
          !context.kernel.hasOperation("t1.getObject")}
          onClick={() => void openSaved(pendingReadbackId)}>
          Проверить неопределённую запись в Kernel
        </button>
        <button type="button" onClick={() => {
          if (!navigator.clipboard?.writeText) {
            setStatus("Буфер обмена недоступен. Выделите идентификатор выше вручную.");
            return;
          }
          void navigator.clipboard.writeText(pendingReadbackId).then(
            () => setStatus("Идентификатор скопирован. После перезапуска вставьте его в поле восстановления."),
            () => setStatus("Не удалось скопировать ID. Выделите идентификатор выше вручную."),
          );
        }}>Скопировать ID для восстановления</button>
      </div>
    </div>}
    <div className="space-y-2 rounded border border-slate-700 p-3">
      <label className="block">Проверить черновик по идентификатору после перезапуска
        <input type="text" className="w-full rounded p-2 text-slate-900"
          data-testid="t3-d5-recover-draft-id" maxLength={64}
          placeholder="local-inference:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          value={draftIdToRecover}
          onChange={e => setDraftIdToRecover(e.target.value.trim())}/>
      </label>
      <button type="button" disabled={!workspaceId || busy ||
        !/^local-inference:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(draftIdToRecover) ||
        !context.kernel.hasOperation("t1.getObject")}
        onClick={() => void openSaved(draftIdToRecover)}>
        Прочитать черновик из Kernel по ID
      </button>
      <p className="text-xs">Повторная запись не выполняется. Чтение доступно только в текущем выбранном Workspace.</p>
    </div>
    <button type="button" disabled={!workspaceId || busy ||
      !context.kernel.hasOperation("t1.listObjects")} onClick={() => void list()}>
      Открыть сохранённые черновики
    </button>
    <ul className="space-y-2">{drafts.map(d => <li key={d.object_id} className="border border-slate-600 p-2 rounded break-all">
      <strong>{d.object_id}</strong> · r{d.revision} · {d.model_id}
      <button type="button" className="block mt-2 border rounded px-3 py-2 min-h-11"
        disabled={busy || !context.kernel.hasOperation("t1.getObject")}
        onClick={() => void openSaved(d.object_id)}>Открыть из Kernel</button>
    </li>)}</ul>
    {openedDraft && <section data-testid="t3-d5-saved-draft-readback"
      className="rounded border border-slate-600 p-3 space-y-2">
      <h4 className="font-semibold">Сохранённый черновик · прочитан из Kernel</h4>
      <p className="text-xs break-all">{openedDraft.object_id} · r{openedDraft.revision}
        · {openedDraft.status} · {openedDraft.model_id}</p>
      <p className="whitespace-pre-wrap break-words">{openedDraft.text}</p>
      <button type="button" disabled={busy || !workspaceId ||
        openedDraft.model_id !== MODEL.id || openedDraft.engine !== MODEL.engine ||
        !context.kernel.hasOperation("t1.putObject")}
        onClick={() => {
          if (current() !== workspaceId) return;
          // Editing makes a distinct, explicitly saved draft; the original
          // Kernel object and revision are never overwritten silently.
          setOutput(openedDraft.text);
          setDraftReady(true);
          setSaved(false);
          setOpenedDraft(null);
          setPendingReadbackId(null);
          setStatus("Копия черновика открыта в редакторе. Оригинал сохранён; новая запись потребует отдельного нажатия.");
        }}>
        Продолжить редактирование как новый черновик
      </button>
    </section>}
    <p className="text-xs">Результат модели: DRAFT_UNTRUSTED. Он не становится принятым Result автоматически.</p>
  </div>;
}
