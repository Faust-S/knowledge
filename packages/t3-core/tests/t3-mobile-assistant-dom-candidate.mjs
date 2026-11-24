// Candidate-only DOM contract check. Uses the exact original private
// assistant and actual shared public catalog/runtime staged by CI; device
// hints and CacheStorage are simulated, no inference or model download.
import {JSDOM} from "jsdom";
import {readFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import {resolve,dirname} from "node:path";
const root=resolve(process.argv[2]);
const pack=readFileSync(process.argv[3],"utf8");
const realPage=readFileSync(resolve(dirname(process.argv[3]),"../tools/personal-economy/index.html"),"utf8");
const formMarkup=realPage.match(/<form\b[^>]*data-cash-calendar-entry[^>]*>[\s\S]*?<\/form>/)?.[0];
if(!formMarkup)throw Error("ACTUAL_CLUB_CASH_FORM_REQUIRED");
const origin="https://club.iwxa.ru";
const assert=(value,code)=>{if(!value)throw Error(code);};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,code){
  for(let i=0;i<150;i++){if(fn())return;await delay(10);}
  throw Error(code);
}
function define(name,value){Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});}
const scenarios=[
 {id:"no-webgpu",gpu:false,ram:4,mobile:true,recommend:null},
 {id:"entry-android",gpu:true,f16:false,ram:4,mobile:true,recommend:"light",vram:1061,select:"balanced",download:"900 МБ"},
 {id:"strong-android",gpu:true,f16:true,ram:8,mobile:true,recommend:"balanced",vram:945,select:"balanced",download:"900 МБ"},
 {id:"unknown-safari-memory",gpu:true,f16:true,mobile:true,recommend:"light",vram:945},
 {id:"desktop",gpu:true,f16:true,ram:16,mobile:false,recommend:"extended",vram:945,select:"extended",download:"4,4 ГБ"},
 {id:"restored-profile",gpu:true,f16:true,ram:4,mobile:true,recommend:"light",stored:"balanced",vram:1630,initialSize:"900 МБ"},
];
for(const [i,c] of scenarios.entries()){
  const dom=new JSDOM('<!doctype html><main>'+formMarkup+'<div data-iwxa-domain-assistant data-assistant-skills="/assets/club-assistant-skills.json" data-assistant-label="Помощник Club"></div></main>',{url:origin+"/tools/personal-economy/",pretendToBeVisual:true});
  const win=dom.window,nav=win.navigator;
  // JSDOM has no layout. Test the real form DOM and native validity, not
  // a claim that actual mobile browser geometry has been observed.
  win.HTMLElement.prototype.getClientRects=function(){return this.closest("[hidden],[aria-hidden=true]")?[]:[{}];};
  let probes=0,devices=0,workers=0,modelRequests=0,skillRequests=0;
  const confirms=[];
  try{
    define("window",win);define("document",win.document);define("location",win.location);
    define("navigator",nav);define("Option",win.Option);define("Event",win.Event);define("HTMLInputElement",win.HTMLInputElement);define("HTMLTextAreaElement",win.HTMLTextAreaElement);define("HTMLSelectElement",win.HTMLSelectElement);
    define("localStorage",win.localStorage);
    if(c.stored)win.localStorage.setItem("iwxa.t3.assistant.model-profile.v1",c.stored);
    define("isSecureContext",true);define("matchMedia",()=>({matches:c.mobile}));
    if(c.ram!==undefined)Object.defineProperty(nav,"deviceMemory",{value:c.ram,configurable:true});
    Object.defineProperty(nav,"gpu",{configurable:true,value:c.gpu?{requestAdapter:async()=>{
      probes++;
      return {features:new Set(c.f16?["shader-f16"]:[]),requestDevice(){devices++;throw Error("GPU_DEVICE_NOT_ALLOWED_IN_PROBE");}};
    }}:undefined});
    Object.defineProperty(nav,"storage",{configurable:true,value:{estimate:async()=>({quota:20e9,usage:1e6})}});
    define("Worker",class{constructor(){workers++;throw Error("WORKER_NOT_ALLOWED_IN_PROBE");}});
    const empty={match:async()=>undefined,keys:async()=>[]};
    define("caches",{match:async()=>undefined,open:async()=>empty,keys:async()=>[]});
    define("fetch",async url=>{
      const u=typeof url==="string"?url:url.url;
      if(u===origin+"/assets/club-assistant-skills.json"){
        skillRequests++;return new Response(pack,{status:200});
      }
      modelRequests++;throw Error("MODEL_NETWORK_NOT_ALLOWED_IN_PROBE");
    });
    win.confirm=message=>{confirms.push(message);return false;};
    await import(pathToFileURL(resolve(root,"domain-assistant/main.mjs")).href+"?candidateCase="+i);
    const shadow=win.document.getElementById("iwxa-t3-assistant").shadowRoot;
    const at=id=>shadow.getElementById(id);
    assert([...at("model").options].map(o=>o.value).join(",")==="light,balanced,extended","THREE_PROFILES");
    assert(at("model-settings").open===false,"SETTINGS_CLOSED");
    assert(at("model").value===(c.stored??"light"),"STABLE_PROFILE_RESTORED");
    assert(at("model-transfer").hidden&&at("stop-model").disabled,"PROGRESS_IDLE");
    assert(probes===0&&workers===0&&modelRequests===0,"INITIAL_NO_ENGINE");
    at("launcher").click();
    await until(()=>!at("skill-all").disabled,"SKILLS_LOADED");
    at("skill-all").click();
    at("skill-choice").value="personal-economy";
    at("skill-choice").dispatchEvent(new win.Event("change"));
    assert(at("skill-guidance").querySelector("a")?.getAttribute("href")==="/tools/personal-economy/","REAL_CLUB_GUIDANCE");
    assert(probes===0&&workers===0&&modelRequests===0&&skillRequests===1,"SKILLS_NO_ENGINE");
    if(c.id==="no-webgpu"){
      const form=win.document.querySelector("[data-cash-calendar-entry]");
      const date=form.elements.namedItem("date"),amount=form.elements.namedItem("amountRUB");
      let invalid=0,submits=0;form.addEventListener("invalid",()=>invalid++,true);
      form.addEventListener("submit",event=>{event.preventDefault();submits++;});
      at("scan-forms").click();
      at("form-choice").value="form_1";at("form-choice").dispatchEvent(new win.Event("change"));
      assert(!at("form-check").disabled&&at("suggest").disabled,"FORM_HELP_WITHOUT_MODEL");
      at("form-check").click();
      assert(at("form-check-list").children.length===2,"ACTUAL_REQUIRED_FIELDS_DETECTED");
      assert(date.value===""&&amount.value===""&&invalid===0&&submits===0,"NO_FORM_VALUE_OR_EVENT_SIDE_EFFECT");
      at("form-check-list").querySelector("button").click();
      assert(at("drawer").hidden&&win.document.activeElement===date,"FOCUS_ACTUAL_FORM_FIELD");
      date.value="2026-11-25";date.dispatchEvent(new win.Event("input",{bubbles:true}));
      assert(at("form-check-guidance").hidden,"STALE_FORM_CHECK_CLEARED");
      amount.value="10000001";amount.dispatchEvent(new win.Event("input",{bubbles:true}));
      at("launcher").click();at("form-check").click();
      assert(at("form-check-list").children.length===1&&at("form-check-list").textContent.includes("10000000"),"ACTUAL_FIELD_RANGE");
      amount.value="-1240";amount.dispatchEvent(new win.Event("input",{bubbles:true}));
      at("form-check").click();
      assert(at("form-check-list").children.length===0&&at("form-check-status").textContent.includes("ошибок не найдено"),"ACTUAL_VALID_FORM");
      assert(invalid===0&&submits===0&&amount.value==="-1240"&&workers===0&&modelRequests===0,"FORM_GUIDANCE_NO_MODEL_OR_SAVE");
      date.value="";amount.value="";
      assert(!at("explicit-values").disabled,"EXPLICIT_FORM_AVAILABLE_WITHOUT_MODEL");
      at("prompt").value="Заплатил за продукты 730 рублей 14.02.2028.";
      at("explicit-values").click();
      assert(at("preview").children.length===4,"EXPLICIT_FOUR_FACTS");
      assert(date.value===""&&amount.value===""&&submits===0,"EXPLICIT_PREVIEW_NO_WRITE");
      at("apply").click();
      assert(date.value==="2028-02-14"&&amount.value==="-730"&&submits===0,"EXPLICIT_CONFIRM_NATIVE_FIELDS_NO_SAVE");
      date.value="";amount.value="";
      at("prompt").value="Сумма неизвестна, не помню дату.";
      at("explicit-values").click();
      assert(at("preview").children.length===0&&at("apply").hidden&&date.value===""&&amount.value===""&&submits===0,"UNKNOWN_NOT_INVENTED");
      assert(workers===0&&modelRequests===0,"EXPLICIT_NO_MODEL");
    }
    at("model-settings").open=true;
    at("model-settings").dispatchEvent(new win.Event("toggle"));
    await until(()=>!at("device-probe").disabled&&at("device-status").textContent!=="Проверка не скачивает модель и не запускает вычисления.","DEVICE_PROBE");
    if(!c.gpu){
      assert(at("install").disabled&&at("device-recommend").disabled,"NO_GPU_FALLBACK");
      assert(at("skill-guidance").querySelector("a"),"NO_GPU_SKILLS_RETAINED");
    }else{
      assert(!at("install").disabled,"MODEL_INSTALL_AVAILABLE");
      assert(at("model-detail").textContent.includes(c.vram+" МБ"),"F16_OR_F32_VARIANT");
      assert(at("model-detail").textContent.includes(c.initialSize??"300 МБ"),"INITIAL_DOWNLOAD_ESTIMATE");
      const recommendation=[...at("model").options].find(o=>o.textContent.includes("предложена"));
      assert(recommendation?.value===c.recommend,"DEVICE_PROFILE_RECOMMENDATION");
      if(c.select){
        at("model").value=c.select;at("model").dispatchEvent(new win.Event("change"));
        assert(at("model").value===c.select,"MANUAL_PROFILE_SELECTION");
        assert(win.localStorage.getItem("iwxa.t3.assistant.model-profile.v1")===c.select,"PROFILE_PREFERENCE_ONLY");
        assert(at("model-detail").textContent.includes(c.download),"DOWNLOAD_ESTIMATE");
        at("install").click();
        assert(confirms.length===1&&confirms[0].includes("huggingface.co")&&confirms[0].includes("raw.githubusercontent.com")&&confirms[0].includes(c.download),"EXPLICIT_SOURCE_CONSENT");
        assert(at("status").textContent==="Установка отменена.","CANCELLED_WITHOUT_LOAD");
        assert(at("model-progress").textContent==="Установка отменена.","CANCEL_VISIBLE_IN_SETTINGS");
        if(c.id==="entry-android"){
          // Stop a consented installation while browser persistence is pending.
          // The original code must abort before requesting SW authority or a Worker.
          let finishPersistence;
          nav.storage.persist=()=>new Promise(resolve=>{finishPersistence=resolve;});
          win.confirm=()=>true;
          at("install").click();
          await until(()=>typeof finishPersistence==="function","PERSISTENCE_PENDING");
          assert(!at("model-transfer").hidden&&!at("stop-model").disabled,"MOBILE_PROGRESS_AND_STOP_VISIBLE");
          at("stop-model").click();finishPersistence(true);
          await until(()=>at("model-transfer").hidden&&at("stop-model").disabled,"ABORT_FINISHED");
          assert(at("model-progress").textContent.includes("Загрузка остановлена"),"ABORT_VISIBLE");
          // Simulate loss of the adapter after it passed the initial probe.
          // A failed launch offers a lower level, never a silent download.
          nav.storage.persist=async()=>true;
          nav.gpu.requestAdapter=async()=>null;
          at("install").click();
          await until(()=>!at("try-lighter").hidden,"FAILED_START_LOWER_PROFILE");
          assert(at("model-progress").textContent.includes("Не удалось запустить вычисления"),"HUMAN_FAILURE_MESSAGE");
          at("try-lighter").click();
          assert(at("model").value==="light"&&win.localStorage.getItem("iwxa.t3.assistant.model-profile.v1")==="light","EXPLICIT_LIGHTER_PROFILE");
          assert(at("try-lighter").hidden&&workers===0&&modelRequests===0,"NO_FALLBACK_AUTO_DOWNLOAD");
          Object.defineProperty(nav,"onLine",{configurable:true,value:false});win.dispatchEvent(new win.Event("offline"));
          assert(at("install").disabled,"NO_DOWNLOAD_WHILE_OFFLINE");
          Object.defineProperty(nav,"onLine",{configurable:true,value:true});win.dispatchEvent(new win.Event("online"));
          assert(!at("install").disabled,"INSTALL_AVAILABLE_AFTER_RECONNECT");
        }
      }
    }
    await delay(100);
    assert(workers===0&&devices===0&&modelRequests===0,"NO_DOWNLOAD_OR_GPU_ALLOCATION");
    console.log("T3_MOBILE_DOM_CASE_PASS",c.id);
  }catch(e){
    // Never output private source or full exception stack into public logs.
    const code=typeof e?.message==="string"&&/^[A-Z0-9_]+$/.test(e.message)?e.message:"UNEXPECTED_RUNTIME_ERROR";
    console.log("T3_MOBILE_DOM_CASE_FAIL",c.id,code);
    process.exitCode=1;
  }finally{
    win.dispatchEvent(new win.Event("pagehide"));win.close();
    await delay(30);
  }
}
if(!process.exitCode)console.log("T3_MOBILE_DOM_CONTRACT_PASS",scenarios.length);
