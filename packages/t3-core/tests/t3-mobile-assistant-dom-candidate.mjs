// Candidate-only DOM contract check. Uses the exact original private
// assistant and actual shared public catalog/runtime staged by CI; device
// hints and CacheStorage are simulated, no inference or model download.
import {JSDOM} from "jsdom";
import {readFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
const root=resolve(process.argv[2]);
const pack=readFileSync(process.argv[3],"utf8");
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
];
for(const [i,c] of scenarios.entries()){
  const dom=new JSDOM('<!doctype html><main><div data-iwxa-domain-assistant data-assistant-skills="/assets/club-assistant-skills.json" data-assistant-label="Помощник Club"></div></main>',{url:origin+"/tools/personal-economy/",pretendToBeVisual:true});
  const win=dom.window,nav=win.navigator;
  let probes=0,devices=0,workers=0,modelRequests=0,skillRequests=0;
  const confirms=[];
  try{
    define("window",win);define("document",win.document);define("location",win.location);
    define("navigator",nav);define("Option",win.Option);define("Event",win.Event);
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
    assert(probes===0&&workers===0&&modelRequests===0,"INITIAL_NO_ENGINE");
    at("launcher").click();
    await until(()=>!at("skill-all").disabled,"SKILLS_LOADED");
    at("skill-all").click();
    at("skill-choice").value="personal-economy";
    at("skill-choice").dispatchEvent(new win.Event("change"));
    assert(at("skill-guidance").querySelector("a")?.getAttribute("href")==="/tools/personal-economy/","REAL_CLUB_GUIDANCE");
    assert(probes===0&&workers===0&&modelRequests===0&&skillRequests===1,"SKILLS_NO_ENGINE");
    at("model-settings").open=true;
    at("model-settings").dispatchEvent(new win.Event("toggle"));
    await until(()=>!at("device-probe").disabled&&at("device-status").textContent!=="Проверка не скачивает модель и не запускает вычисления.","DEVICE_PROBE");
    if(!c.gpu){
      assert(at("install").disabled&&at("device-recommend").disabled,"NO_GPU_FALLBACK");
      assert(at("skill-guidance").querySelector("a"),"NO_GPU_SKILLS_RETAINED");
    }else{
      assert(!at("install").disabled,"MODEL_INSTALL_AVAILABLE");
      assert(at("model-detail").textContent.includes(c.vram+" МБ"),"F16_OR_F32_VARIANT");
      assert(at("model-detail").textContent.includes("300 МБ"),"LIGHT_DOWNLOAD_ESTIMATE");
      const recommendation=[...at("model").options].find(o=>o.textContent.includes("предложена"));
      assert(recommendation?.value===c.recommend,"DEVICE_PROFILE_RECOMMENDATION");
      if(c.select){
        at("model").value=c.select;at("model").dispatchEvent(new win.Event("change"));
        assert(at("model").value===c.select,"MANUAL_PROFILE_SELECTION");
        assert(at("model-detail").textContent.includes(c.download),"DOWNLOAD_ESTIMATE");
        at("install").click();
        assert(confirms.length===1&&confirms[0].includes("huggingface.co")&&confirms[0].includes("raw.githubusercontent.com")&&confirms[0].includes(c.download),"EXPLICIT_SOURCE_CONSENT");
        assert(at("status").textContent==="Установка отменена.","CANCELLED_WITHOUT_LOAD");
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
