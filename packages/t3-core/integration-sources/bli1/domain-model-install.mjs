// D5: a separately confirmed model download inside the existing domain T3
// Service Worker. Normal autonomous site requests remain cache-only.
// This is not an inference engine, cache writer, or additional Host.
import {prebuiltAppConfig} from "@mlc-ai/web-llm";
import {MODEL,requireCatalogModel} from "./catalog.mjs";

function send(worker, type, extra = {}) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      channel.port1.close();
      reject(Error("T3_D5_MODEL_INSTALL_WORKER_TIMEOUT"));
    }, 10000);
    channel.port1.onmessage = ({data}) => {
      clearTimeout(timeout);
      channel.port1.close();
      if (data?.type === "FAILED") reject(Error(data.message || "T3_D5_MODEL_INSTALL_DENIED"));
      else resolve(data);
    };
    try {worker.postMessage({type,...extra},[channel.port2]);}
    catch (e) {clearTimeout(timeout);channel.port1.close();reject(e);}
  });
}

function cancelled() {
  return Object.assign(Error("T3_D5_MODEL_LOAD_CANCELLED"),
    {code:"T3_D5_MODEL_LOAD_CANCELLED"});
}

export async function beginDomainModelInstallation(modelId=MODEL.id,{signal}={}) {
  if (signal?.aborted) throw cancelled();
  const chosen=requireCatalogModel(modelId);
  const model=prebuiltAppConfig.model_list.find(row => row.model_id === chosen.id);
  if (!model || model.model!==chosen.modelSource)
    throw Error("T3_D5_MODEL_NOT_IN_WEBLLM_CATALOG");
  if (!document.documentElement.hasAttribute("data-iwxa-t3-autonomous")) {
    return async () => {}; // Ordinary online site, still requires user consent.
  }
  if (signal?.aborted) throw cancelled();
  const worker = navigator.serviceWorker?.controller;
  if (!worker || new URL(worker.scriptURL).pathname !== "/t3-sw.js") {
    throw Error("T3_D5_AUTONOMOUS_WORKER_REQUIRED");
  }
  const reply = await send(worker,"T3_MODEL_INSTALL_BEGIN",{
    model_url:model.model,wasm_url:model.model_lib,
  });
  if (reply?.type !== "MODEL_INSTALL_ALLOWED" ||
      typeof reply.token !== "string") throw Error("T3_D5_MODEL_INSTALL_NOT_ALLOWED");
  let ended = false;
  const finish = async () => {
    if (ended) return;
    // Mark the lease closed only after the original SW acknowledges it.
    await send(worker,"T3_MODEL_INSTALL_END",{token:reply.token});
    ended = true;
  };
  if (signal?.aborted) {
    // Stop may happen while the SW is still granting a lease. Once its
    // authentic token arrives, revoke it BEFORE exposing a WebLLM Worker.
    await finish();
    throw cancelled();
  }
  return finish;
}
