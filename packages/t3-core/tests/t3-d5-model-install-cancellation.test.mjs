import assert from "node:assert/strict";
import test from "node:test";
import {MODEL} from "../integration-sources/bli1/catalog.mjs";
import {readFileSync} from "node:fs";
import {requireCatalogModel} from "../integration-sources/bli1/catalog.mjs";

// The public baseline Node suite intentionally does not install WebLLM.
// Execute the production SW-lease implementation with only the separately
// pinned upstream model-catalog record injected, not an alternative installer.
const production=readFileSync(new URL(
  "../integration-sources/bli1/domain-model-install.mjs",import.meta.url),"utf8");
const imports=[
  'import {prebuiltAppConfig} from "@mlc-ai/web-llm";',
  'import {MODEL,requireCatalogModel} from "./catalog.mjs";',
];
for(const line of imports)
  assert.equal(production.split(line).length,2,"production model install imports changed");
const source=production.replace(imports[0],"").replace(imports[1],"")
  .replace("export async function beginDomainModelInstallation",
    "async function beginDomainModelInstallation");
const beginDomainModelInstallation=new Function(
  "MODEL","requireCatalogModel","prebuiltAppConfig",
  source+"\nreturn beginDomainModelInstallation;",
)(MODEL,requireCatalogModel,{
  model_list:[{model_id:MODEL.id,model:MODEL.modelSource,
    model_lib:"https://example.invalid/pinned-webllm.wasm"}],
});

// One focused source regression: Stop may arrive while the ORIGINAL
// Service Worker is preparing installation, before WebLLM Worker exists.
// A late lease must be closed, never handed to an inference engine.
test("D5 abort during original SW model-install BEGIN closes the late lease",async()=>{
  const originalDocument=Object.getOwnPropertyDescriptor(globalThis,"document");
  const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,"navigator");
  const calls=[];
  const originalController={
    scriptURL:"https://iwxa.example/t3-sw.js",
    postMessage(data,ports){
      calls.push(data.type);
      const port=ports[0];
      queueMicrotask(()=>{
        port.postMessage(data.type==="T3_MODEL_INSTALL_BEGIN"
          ?{type:"MODEL_INSTALL_ALLOWED",token:"original-sw-lease"}
          :{type:"MODEL_INSTALL_ENDED"});
        port.close();
      });
    },
  };
  Object.defineProperty(globalThis,"document",{configurable:true,value:{
    documentElement:{hasAttribute:name=>name==="data-iwxa-t3-autonomous"},
  }});
  Object.defineProperty(globalThis,"navigator",{configurable:true,value:{
    serviceWorker:{controller:originalController},
  }});
  try{
    const stopped=new AbortController();
    stopped.abort();
    await assert.rejects(beginDomainModelInstallation(MODEL.id,{
      signal:stopped.signal,
    }),{code:"T3_D5_MODEL_LOAD_CANCELLED"});
    assert.deepEqual(calls,[],"no lease is requested after Stop");

    const active=new AbortController();
    const pending=beginDomainModelInstallation(MODEL.id,{signal:active.signal});
    active.abort(); // BEGIN has been sent, but its token is not yet delivered.
    await assert.rejects(pending,{code:"T3_D5_MODEL_LOAD_CANCELLED"});
    assert.deepEqual(calls,[
      "T3_MODEL_INSTALL_BEGIN","T3_MODEL_INSTALL_END",
    ],"late original lease must be revoked without starting model load");
  }finally{
    if(originalDocument)Object.defineProperty(globalThis,"document",originalDocument);
    else delete globalThis.document;
    if(originalNavigator)Object.defineProperty(globalThis,"navigator",originalNavigator);
    else delete globalThis.navigator;
  }
});
