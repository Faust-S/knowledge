/** Read-only, network-free check of the pinned WebLLM Cache API backend.
 * Weights alone are NOT enough to restart an already installed model:
 * WebLLM also needs its chat config, tokenizer and compiled WebGPU WASM.
 * The upstream runtime remains the sole cache writer and model authority.
 */
export async function inspectWebLlmOfflineCache({model, weightsPresent, cacheStorage}) {
  if (!model || typeof model.model !== "string" ||
      typeof model.model_lib !== "string") throw Error("BLI_MODEL_RECORD_REQUIRED");
  const missing=[];
  if (weightsPresent !== true) missing.push("веса модели");
  if (!cacheStorage || typeof cacheStorage.match !== "function") {
    return Object.freeze({ready:false,missing:Object.freeze([...missing,"Cache Storage"])});
  }
  let base=model.model.endsWith("/") ? model.model : model.model+"/";
  if (!/\/resolve\/[^/]+\//.test(base)) base+="resolve/main/";
  const artifacts=[
    ["конфигурация модели",new URL("mlc-chat-config.json",base).href],
    ["WebGPU WASM",model.model_lib],
  ];
  if (model.model_manifest) {
    artifacts.push(["манифест модели",new URL(model.model_manifest,base).href]);
  }
  for(const [name,url] of artifacts) {
    try {
      if(!await cacheStorage.match(url)) missing.push(name);
    } catch {missing.push(name);}
  }
  const tokenizerURLs=[
    new URL("tokenizer.json",base).href,
    new URL("tokenizer.model",base).href,
  ];
  let tokenizerFound=false;
  for(const url of tokenizerURLs) {
    try {if(await cacheStorage.match(url)){tokenizerFound=true;break;}}
    catch { /* Try alternate tokenizer below. */ }
  }
  if(!tokenizerFound)missing.push("токенизатор");
  return Object.freeze({ready:missing.length===0,missing:Object.freeze(missing)});
}
