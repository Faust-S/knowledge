export class BrowserInferenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BrowserInferenceError';
    this.code = code;
  }
}

export function decideLoad({ cachedWeights, networkConsent }) {
  if (networkConsent !== true && !cachedWeights) {
    throw new BrowserInferenceError('MODEL_NOT_CACHED', 'Нет сохранённых весов модели. Разрешите загрузку отдельно.');
  }
  return Object.freeze({ networkAllowed: networkConsent === true });
}

export function requirePrompt(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BrowserInferenceError('EMPTY_PROMPT', 'Введите текст для обработки.');
  }
  if (value.length > 6000) {
    throw new BrowserInferenceError('CONTEXT_TOO_LARGE', 'Для прототипа допускается до 6000 символов.');
  }
  return value.trim();
}

export function humanError(error) {
  const code = error?.code || '';
  if (code === 'MODEL_NOT_CACHED' || code === 'CANCELLED') return error.message;
  if (code === 'EMPTY_PROMPT' || code === 'CONTEXT_TOO_LARGE') return error.message;
  const msg = typeof error?.message === 'string' ? error.message : String(error);
  if (/GPU|adapter|WebGPU/i.test(msg)) return 'WebGPU недоступен или модель не поместилась в память. Проверьте настройки браузера и GPU.';
  if (/quota|storage/i.test(msg)) return 'Недостаточно места в хранилище браузера.';
  if (/network|fetch|offline/i.test(msg)) return 'Не удалось получить обязательные файлы модели. Повторите после восстановления сети или кеша.';
  return 'Не удалось завершить операцию. Подробности доступны в консоли разработчика.';
}

// Build only the small, data-only schema used by the original form assistant.
// Use WebLLM's existing JSON grammar compiler; no model-selected authority,
// arbitrary caller-provided grammar, second inference engine or new Store.
export function formResponseFormat(fields) {
  if(fields===undefined)return undefined;
  const invalid=()=>{throw new BrowserInferenceError("FORM_SCHEMA_INVALID","Не удалось подготовить выбранные поля формы.");};
  if(!Array.isArray(fields)||fields.length<1||fields.length>10)invalid();
  const properties=Object.create(null);
  for(const field of fields){
    if(!field||typeof field!=="object"||!/^field_(?:[1-9]|10)$/.test(field.key)||
       Object.hasOwn(properties,field.key)||
       Object.keys(field).some(k=>k!=="key"&&k!=="choices"))invalid();
    if(field.choices===undefined){properties[field.key]={type:"string"};continue;}
    if(!Array.isArray(field.choices)||field.choices.length<1||field.choices.length>30||
       field.choices.some(v=>typeof v!=="string"||!v.length||v.length>2000)||
       new Set(field.choices).size!==field.choices.length)invalid();
    properties[field.key]={type:"string",enum:[...field.choices]};
  }
  // Every inner property remains optional, so {} is a valid answer when
  // the user did not supply enough information. Do NOT require all keys.
  const schema=JSON.stringify({type:"object",properties:{
    fields:{type:"object",properties,additionalProperties:false}
  },required:["fields"],additionalProperties:false});
  if(schema.length>16000)invalid();
  return {type:"json_object",schema};
}

// The pinned WebLLM Worker serializes exceptions with err.toString() and
// rejects the caller with a STRING, not an Error carrying .name/.code.
// Convert only known classes/messages to bounded diagnostics. Never expose
// arbitrary engine errors (they can include the request or model output).
export function classifyInferenceFailure(error) {
  if(error instanceof BrowserInferenceError&&["CANCELLED","WORKER_FAILED","GENERATION_TIMEOUT","EMPTY_GENERATION"].includes(error.code))
    return error;
  const name=typeof error?.name==="string"?error.name:"";
  const detail=typeof error==="string"?error:typeof error?.message==="string"?error.message:"";
  const raw=(name+" "+detail).slice(0,8192);
  const known=(code,message)=>new BrowserInferenceError(code,message);
  if(/ContextWindowSizeExceededError|Prompt tokens exceed context window size/i.test(raw))
    return known("CONTEXT_WINDOW_EXCEEDED","Вопрос вместе с контекстом слишком длинный для этой модели. Сократите его и запустите модель из кеша.");
  if(/DeviceLostError|(?:WebGPU )?device (?:was |is |has been )?lost|device\.lost|GPUDeviceLost/i.test(raw))
    return known("GPU_DEVICE_LOST","Графический ускоритель остановил вычисления. Попробуйте запустить более лёгкую модель.");
  if(/out of memory|GPUOutOfMemoryError|allocation failed|failed to allocate|insufficient memory/i.test(raw))
    return known("GPU_MEMORY_EXHAUSTED","Не хватило памяти для вычислений. Выберите более лёгкую модель.");
  if(/ModelNotLoadedError|WorkerEngineModelNotLoadedError|EngineNotLoadedError|Model not loaded before trying|is not loaded with a model|Engine not yet loaded/i.test(raw))
    return known("MODEL_SESSION_LOST","Модель больше не запущена. Её можно снова открыть из сохранённых файлов.");
  if(/GrammarMatcherInitError|InvalidResponseFormat(?:Grammar)?Error|Failed to initialize the grammar matcher/i.test(raw))
    return known("FORM_GRAMMAR_FAILED","Не удалось подготовить ответ для этой формы. Запустите модель снова или воспользуйтесь подсказками без модели.");
  return known("LOCAL_INFERENCE_FAILED","Не удалось завершить вычисления. Модель остановлена; сохранённые файлы доступны для повторного запуска.");
}
