import assert from "node:assert/strict";
import test from "node:test";
import {MODEL} from "../integration-sources/bli1/catalog.mjs";
import {beginDomainModelInstallation}
  from "../integration-sources/bli1/domain-model-install.mjs";

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
