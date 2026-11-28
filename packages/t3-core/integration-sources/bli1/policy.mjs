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

// Optional transport to the existing Agent-owned model port. It never loads
// browser weights, discovers arbitrary servers or falls back to a hosted API.
const AGENT_MODEL_SCHEMA="iwxa.agent-local-model/1";
function parseAgentConnection(code){
  const m=/^iwxa-local-v1:([1-9][0-9]{0,4}):([A-Za-z0-9_-]{43})$/.exec(typeof code==="string"?code.trim():"");
  if(!m||Number(m[1])>65535)throw new BrowserInferenceError("AGENT_LOCAL_CODE_INVALID","Проверьте код подключения из Personal Agent.");
  return {base:"http://127.0.0.1:"+m[1]+"/api/t3-local-model/",token:m[2]};
}
function requireAgentFormOutput(text,format){
  if(!format)return;
  const schema=JSON.parse(format.schema).properties.fields.properties;
  let data;
  try{data=JSON.parse(text);}catch{}
  const object=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
  if(!object(data)||Object.keys(data).length!==1||!Object.hasOwn(data,"fields")||!object(data.fields)||
     Object.entries(data.fields).some(([key,value])=>!Object.hasOwn(schema,key)||typeof value!=="string"||
       (schema[key].enum&&!schema[key].enum.includes(value))))
    throw new BrowserInferenceError("FORM_GRAMMAR_FAILED","Модель Agent не вернула допустимые значения выбранных полей.");
}
export class AgentLocalModelAdapter{
  #base;
  #token;
  #identity=null;
  #controller=null;
  #disposed=false;
  constructor(code){
    const connection=parseAgentConnection(code);
    this.#base=connection.base;this.#token=connection.token;
  }
  get ready(){return !this.#disposed&&this.#identity!==null;}
  async #post(action,body,timeout){
    if(this.#disposed)throw new BrowserInferenceError("AGENT_LOCAL_UNAVAILABLE","Подключение завершено.");
    if(this.#controller)throw new BrowserInferenceError("BUSY","Предыдущий запрос ещё выполняется.");
    const controller=new AbortController();this.#controller=controller;
    let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeout);
    try{
      const response=await fetch(this.#base+action,{
        method:"POST",mode:"cors",credentials:"omit",cache:"no-store",redirect:"error",
        referrerPolicy:"no-referrer",signal:controller.signal,
        headers:{"Content-Type":"application/json","X-IWXA-Model-Token":this.#token},
        body:JSON.stringify(body)
      });
      if(!response.ok)throw new BrowserInferenceError("AGENT_LOCAL_UNAVAILABLE","Agent не подтвердил доступ к локальной модели.");
      const result=await response.json();
      if(controller.signal.aborted)throw Error("aborted");
      if(!result||result.schema!==AGENT_MODEL_SCHEMA)throw new BrowserInferenceError("AGENT_LOCAL_UNAVAILABLE","Ответ локального Agent не подтверждён.");
      return result;
    }catch(error){
      if(controller.signal.aborted)throw new BrowserInferenceError(timedOut?"AGENT_LOCAL_UNAVAILABLE":"CANCELLED",timedOut?"Agent не ответил вовремя.":"Ожидание ответа Agent остановлено.");
      if(error instanceof BrowserInferenceError)throw error;
      throw new BrowserInferenceError("AGENT_LOCAL_UNAVAILABLE","Не удалось связаться с локальным Agent.");
    }finally{
      clearTimeout(timer);if(this.#controller===controller)this.#controller=null;
    }
  }
  async connect(){
    this.#identity=null;
    const r=await this.#post("status",{},20000);
    if(this.#disposed||r.ready!==true||typeof r.model!=="string"||!r.model.trim()||r.model.length>200||
       !/^[a-f0-9]{64}$/.test(r.model_identity||""))
      throw new BrowserInferenceError("AGENT_LOCAL_UNAVAILABLE","Выбранная модель Agent не подтверждена.");
    this.#identity=r.model_identity;
    return {model:r.model};
  }
  async invoke(prompt,{maxTokens=256,formFields,onChunk=()=>{}}={}){
    if(!this.ready)throw new BrowserInferenceError("AGENT_LOCAL_UNAVAILABLE","Подключите локальную модель Agent.");
    const content=requirePrompt(prompt),format=formResponseFormat(formFields);
    if(!Number.isInteger(maxTokens)||maxTokens<1||maxTokens>1024)throw new BrowserInferenceError("AGENT_LOCAL_TOKEN_LIMIT","Недопустимый предел ответа.");
    const identity=this.#identity;
    try{
      const r=await this.#post("invoke",{prompt:content,max_tokens:maxTokens,model_identity:identity},220000);
      if(this.#disposed||r.model_identity!==identity||r.remote_fallback!==false||typeof r.text!=="string"||!r.text.trim()||r.text.length>2000000)
        throw new BrowserInferenceError("AGENT_LOCAL_UNAVAILABLE","Ответ не связан с выбранной локальной моделью.");
      // Agent's native port returns text, not WebLLM's constrained decoder.
      // Only an exact valid field object proceeds to the existing proposal checks.
      requireAgentFormOutput(r.text,format);
      onChunk(r.text);
      return r.text;
    }catch(error){
      if(!["CANCELLED","FORM_GRAMMAR_FAILED","BUSY"].includes(error?.code))this.#identity=null;
      throw error;
    }
  }
  cancel(){this.#controller?.abort();}
  async unload(){this.dispose();}
  dispose(){this.cancel();this.#disposed=true;this.#identity=null;this.#token="";}
}
