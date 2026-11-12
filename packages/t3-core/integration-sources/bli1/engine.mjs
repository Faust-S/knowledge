import {
  CreateWebWorkerMLCEngine,
  prebuiltAppConfig,
  hasModelInCache,
  deleteModelInCache,
  deleteChatConfigInCache,
} from '@mlc-ai/web-llm';
import { MODEL, requireCatalogModel } from './catalog.mjs';
import { BrowserInferenceError, decideLoad, requirePrompt } from './policy.mjs';
import { inspectWebLlmOfflineCache } from './cache-readiness.mjs';

const modelRecord = prebuiltAppConfig.model_list.find((m) => m.model_id === MODEL.id);
if (!modelRecord) throw new Error('WEBLLM_MODEL_NOT_PREBUILT');
// One model only. Cache API is the upstream default; do not duplicate weights in T2 DB8.
const appConfig = {
  ...prebuiltAppConfig,
  cacheBackend: 'cache',
  model_list: [modelRecord],
};

export class BrowserLocalRuntimeAdapter {
  #engine = null;
  #worker = null;
  #loading = false;
  #running = false;
  #abortLoad = null;
  #abortGeneration = null;
  #cancelRequested = false;

  async probe() {
    if (!globalThis.isSecureContext) throw new BrowserInferenceError('INSECURE_CONTEXT', 'Требуется HTTPS или localhost.');
    if (!navigator.gpu?.requestAdapter) throw new BrowserInferenceError('WEBGPU_UNAVAILABLE', 'Нужен браузер с WebGPU.');
    const gpu = await navigator.gpu.requestAdapter();
    if (!gpu) throw new BrowserInferenceError('WEBGPU_UNAVAILABLE', 'Нет совместимого GPU-адаптера.');
    if (!('caches' in globalThis)) throw new BrowserInferenceError('CACHE_UNAVAILABLE', 'Cache Storage не поддерживается.');
    return { gpu: true, cache: true };
  }

  listModels() { return [MODEL]; }
  describeModel(modelId) { return requireCatalogModel(modelId); }
  async cachedWeights() { return hasModelInCache(MODEL.id, appConfig); }
  async cachedForOffline(knownWeights) {
    const weightsPresent=typeof knownWeights === 'boolean' ?
      knownWeights : await this.cachedWeights();
    return inspectWebLlmOfflineCache({
      model:modelRecord, weightsPresent, cacheStorage:globalThis.caches,
    });
  }
  get ready() { return Boolean(this.#engine); }

  async load({ networkConsent = false, onProgress = () => {}, signal } = {}) {
    if (this.#loading || this.#running) throw new BrowserInferenceError('BUSY', 'Модель занята.');
    if (this.#engine) {
      this.#worker?.postMessage({ kind: 'IWXA_NETWORK_POLICY', denyNetwork: true });
      return { reused: true, cachedWeights: true };
    }
    const aborted = () => {
      if (signal?.aborted) throw new BrowserInferenceError('CANCELLED', 'Загрузка модели остановлена.');
    };
    aborted();
    await this.probe();
    aborted();
    const cachedBefore = await this.cachedWeights();
    aborted();
    const policy = decideLoad({ cachedWeights: cachedBefore, networkConsent });
    if (!policy.networkAllowed) {
      const offline = await this.cachedForOffline(cachedBefore);
      if (!offline.ready) {
        throw new BrowserInferenceError('OFFLINE_ASSETS_INCOMPLETE',
          'Для офлайн-запуска недостаёт: ' + offline.missing.join(', ') +
          '. Установите модель заново по отдельному разрешению.');
      }
    }
    this.#loading = true;
    let onAbort;
    try {
      this.#worker = new Worker(new URL('./model-worker.mjs', import.meta.url), { type: 'module' });
      // Sent before WebLLM initialization; messages to the same worker are ordered.
      this.#worker.postMessage({ kind: 'IWXA_NETWORK_POLICY', denyNetwork: !policy.networkAllowed });
      let rejectCancelled;
      let rejectWorkerFailure;
      const interrupted = new Promise((_, reject) => { rejectCancelled = reject; });
      const workerFailed = new Promise((_, reject) => { rejectWorkerFailure = reject; });
      this.#abortLoad = () => {
        this.#worker?.terminate();
        this.#worker = null;
        rejectCancelled(new BrowserInferenceError('CANCELLED', 'Загрузка модели остановлена.'));
      };
      this.#worker.addEventListener('error', () => {
        rejectWorkerFailure(new BrowserInferenceError('WORKER_FAILED', 'Не удалось запустить WebLLM Worker.'));
      }, { once: true });
      onAbort = () => this.#abortLoad?.();
      signal?.addEventListener('abort', onAbort, { once: true });
      aborted();
      this.#engine = await Promise.race([
        CreateWebWorkerMLCEngine(this.#worker, MODEL.id, {
          appConfig,
          initProgressCallback: (progress) => onProgress(progress),
        }), interrupted, workerFailed,
      ]);
      // Download permission applies ONLY to initialization. Close the
      // worker's network boundary before any user prompt can be inferred.
      this.#worker?.postMessage({ kind: 'IWXA_NETWORK_POLICY', denyNetwork: true });
      return { reused: false, cachedWeights: cachedBefore };
    } catch (e) {
      this.#worker?.terminate();
      this.#worker = null;
      this.#engine = null;
      throw e;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      this.#loading = false;
      this.#abortLoad = null;
    }
  }

  async invoke(prompt, { onChunk = () => {}, maxTokens = 256 } = {}) {
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 1024) {
      throw new BrowserInferenceError('OUTPUT_LIMIT_INVALID', 'Недопустимый размер ответа локальной модели.');
    }
    if (!this.#engine) throw new BrowserInferenceError('MODEL_NOT_LOADED', 'Сначала загрузите модель.');
    if (this.#running) throw new BrowserInferenceError('BUSY', 'Генерация уже идёт.');
    const content = requirePrompt(prompt);
    const activeEngine = this.#engine;
    const activeWorker = this.#worker;
    this.#running = true;
    this.#cancelRequested = false;
    let output = '';
    let timer = null;
    let rejectStopped;
    const stopped = new Promise((_, reject) => { rejectStopped = reject; });

    // Interrupting an in-flight GPU dispatch is not guaranteed to respond.
    // Terminate ONLY the existing WebLLM Worker and reject the pending UI
    // operation immediately; this does not create another inference engine.
    const hardStop = (code, reason) => {
      if (this.#cancelRequested) return;
      this.#cancelRequested = true;
      activeWorker?.terminate();
      if (this.#worker === activeWorker) this.#worker = null;
      if (this.#engine === activeEngine) this.#engine = null;
      rejectStopped(new BrowserInferenceError(code, reason));
    };
    const workerFailed = () => hardStop('WORKER_FAILED', 'WebLLM Worker завершился во время генерации. Перезапустите модель из кеша.');
    activeWorker?.addEventListener('error', workerFailed);
    activeWorker?.addEventListener('messageerror', workerFailed);
    this.#abortGeneration = hardStop;
    const armTimeout = (ms, kind) => {
      clearTimeout(timer);
      timer = setTimeout(() => hardStop('GENERATION_TIMEOUT',
        (kind === 'first' ? 'Модель не выдала первый токен за 120 секунд. ' :
          'Модель перестала отвечать более чем на 60 секунд. ') +
        'Worker остановлен, локальные веса сохранены. Можно запустить модель заново.'), ms);
    };
    armTimeout(120000, 'first');
    const infer = async () => {
      const stream = await activeEngine.chat.completions.create({
        messages: [{ role: 'user', content }],
        stream: true,
        max_tokens: maxTokens,
        temperature: 0.4,
      });
      for await (const chunk of stream) {
        if (this.#cancelRequested) throw new BrowserInferenceError('CANCELLED', 'Генерация остановлена.');
        const delta = chunk.choices?.[0]?.delta?.content ?? '';
        if (delta) {
          output += delta;
          armTimeout(60000, 'next');
        }
        onChunk(output);
      }
      if (this.#cancelRequested) throw new BrowserInferenceError('CANCELLED', 'Генерация остановлена.');
      if (!output.trim()) {
        throw new BrowserInferenceError('EMPTY_GENERATION', 'Модель завершила генерацию без текста. Попробуйте другой запрос.');
      }
      return output;
    };
    try {
      return await Promise.race([infer(), stopped]);
    } finally {
      clearTimeout(timer);
      activeWorker?.removeEventListener('error', workerFailed);
      activeWorker?.removeEventListener('messageerror', workerFailed);
      this.#abortGeneration = null;
      this.#running = false;
      this.#cancelRequested = false;
    }
  }

  cancel() {
    if (this.#running) {
      this.#abortGeneration?.('CANCELLED', 'Генерация остановлена. Для повторного запроса запустите модель из кеша.');
    } else if (this.#loading) this.#abortLoad?.();
  }

  async unload() {
    if (this.#running || this.#loading) throw new BrowserInferenceError('BUSY', 'Завершите операцию перед освобождением памяти.');
    try { await this.#engine?.unload(); }
    finally {
      this.#worker?.terminate();
      this.#engine = null;
      this.#worker = null;
    }
  }

  dispose() {
    // Closing the Workspace panel must terminate its Worker even when an
    // ongoing generation prevents WebLLM.unload(). No remote fallback.
    if (this.#loading) this.#abortLoad?.();
    if (this.#running) this.#abortGeneration?.('CANCELLED', 'Панель закрыта: генерация остановлена.');
    this.#worker?.terminate();
    this.#worker = null;
    this.#engine = null;
  }

  async deleteCachedWeights() {
    if (this.#engine || this.#loading || this.#running) throw new BrowserInferenceError('BUSY', 'Сначала освободите память модели.');
    await deleteModelInCache(MODEL.id, appConfig);
    await deleteChatConfigInCache(MODEL.id, appConfig);
    // Shared WASM may be reused by another model; intentionally retain it.
  }
}
