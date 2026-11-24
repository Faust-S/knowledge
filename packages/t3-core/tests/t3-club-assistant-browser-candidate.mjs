// Real browser layout and form workflow of the exact compiled candidate.
// Disposable loopback view of original Club source pages, mounted by the
// original product assembler. Not a complete deployed dist or a phone test.
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFileSync,statSync} from "node:fs";
import {join,resolve,relative,extname,isAbsolute} from "node:path";
import {pathToFileURL} from "node:url";
import {chromium} from "playwright";
const [siteArg,compiledArg]=process.argv.slice(2);
assert.ok(siteArg&&compiledArg,"T3_CLUB_BROWSER_ARGS");
const site=resolve(siteArg),compiled=resolve(compiledArg);
const {mountDomainAssistant,mountOriginalControl}=await import(pathToFileURL(join(site,"scripts/assemble-club-t3-dist.mjs")).href);
const manifest=JSON.parse(readFileSync(join(compiled,".vite/manifest.json"),"utf8"));
const entry=manifest["candidate-domain-assistant/main.mjs"];
const panel=manifest["src/modules/t3-local-inference/LocalInferencePanel.tsx"];
const engine="src/modules/t3-local-inference/engine.mjs";
assert.ok(entry?.isEntry&&entry.dynamicImports?.includes(engine)&&panel?.dynamicImports?.includes(engine),"T3_CLUB_BROWSER_SHARED_ENGINE");
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".ico":"image/x-icon",".webmanifest":"application/manifest+json"};
const paths=new Set(["/tools/personal-economy/","/tools/action-route/","/projects/"]);
const inside=(root,file)=>{const r=relative(root,file);return r!==""&&!r.startsWith("..")&&!isAbsolute(r);};
const server=createServer((req,res)=>{
 try{
  const p=new URL(req.url,"http://127.0.0.1").pathname;
  let data,ext;
  if(paths.has(p)){
   const file=join(site,p.slice(1),"index.html");
   data=mountDomainAssistant(mountOriginalControl(readFileSync(file,"utf8")),entry.file);ext=".html";
  }else{
   const root=p.startsWith("/workspace/assets/")?compiled:site;
   const rel=p.startsWith("/workspace/assets/")?p.slice("/workspace/".length):p.slice(1);
   if(!/^(?:assets\/|_iwxa\/|favicon|site\.webmanifest|og-image)/.test(rel)||rel.includes("..")||!/^[-a-zA-Z0-9_./]+$/.test(rel)){res.writeHead(404).end();return;}
   const file=resolve(root,rel);
   if(!inside(root,file)||!statSync(file).isFile()){res.writeHead(404).end();return;}
   data=readFileSync(file);ext=extname(file);
  }
  res.writeHead(200,{"Content-Type":mime[ext]||"application/octet-stream","Cache-Control":"no-store"}).end(data);
 }catch{res.writeHead(404).end();}
});
await new Promise((ok,no)=>{server.once("error",no);server.listen(0,"127.0.0.1",ok);});
const origin="http://127.0.0.1:"+server.address().port;
let browser;
try{
 browser=await chromium.launch({headless:true,args:["--disable-gpu"]});
 for(const size of [{width:320,height:568},{width:390,height:844},{width:820,height:1024},{width:1440,height:900}]){
  const ctx=await browser.newContext({viewport:size,hasTouch:size.width<621,isMobile:size.width<621,serviceWorkers:"block"});
  let modelRequests=0,workers=0;
  try{
   await ctx.addInitScript(()=>{Object.defineProperty(navigator,"gpu",{configurable:true,value:undefined});});
   await ctx.route("**/*",route=>{
    const url=new URL(route.request().url());
    if(url.origin===origin)return route.continue();
    if(/huggingface|hf\.co|raw\.githubusercontent/i.test(url.hostname))modelRequests++;
    return route.abort();
   });
   const page=await ctx.newPage();page.on("worker",()=>workers++);
   const at=id=>page.locator("#iwxa-t3-assistant").locator("#"+id);
   const check=(v,c)=>{if(!v)throw Error("T3_CLUB_BROWSER_"+c);};
   await page.goto(origin+"/tools/personal-economy/",{waitUntil:"domcontentloaded"});
   await at("launcher").click();
   await at("skill-choice").locator("option").nth(1).waitFor({state:"attached"});
   await at("scan-forms").click();
   const opts=await at("form-choice").locator("option").evaluateAll(o=>o.map(x=>({value:x.value,text:x.textContent})));
   const budget=opts.find(o=>o.text.startsWith("Месячный бюджет и финансовый резерв ·"));
   check(budget&&opts.some(o=>o.text.startsWith("Денежный календарь: доход или расход ·"))&&opts.some(o=>o.text.startsWith("Регулярный денежный платёж ·")),"DISTINCT_FORM_TITLES");
   await at("form-choice").selectOption(budget.value);
   await at("prompt").fill("Валюта RUB. Регулярный доход 55000 рублей, обязательные расходы 32000 рублей.");
   await at("explicit-values").click();
   check(await at("preview").locator("li").count()===3,"EXPLICIT_PREVIEW");
   const form=page.locator("form[data-pe-form]");
   const income=form.locator('[name="regularIncome"]'),expenses=form.locator('[name="mandatoryExpenses"]');
   check(await income.inputValue()===""&&await expenses.inputValue()==="","NO_EARLY_WRITE");
   await page.evaluate(()=>{window.__clubCandidateSubmits=0;document.querySelector("[data-pe-form]").addEventListener("submit",e=>{e.preventDefault();window.__clubCandidateSubmits++;},true);});
   const geometry=await at("drawer").evaluate(drawer=>{
    const bounds=drawer.getBoundingClientRect(),host=drawer.getRootNode().host.getBoundingClientRect(),vw=window.innerWidth;
    const nodes=[...drawer.querySelectorAll("select,button,input,textarea")].filter(el=>el.getClientRects().length);
    return {viewport:vw,drawerWidth:bounds.width,hostWidth:host.width,
      overflow:drawer.scrollWidth>drawer.clientWidth+1||bounds.left<0||bounds.right>vw+1,
      controlOverflow:nodes.some(el=>{const r=el.getBoundingClientRect();return r.left<bounds.left-1||r.right>bounds.right+1;}),
      smallTouch:nodes.filter(el=>!el.disabled&&!["checkbox","radio"].includes(el.type)).some(el=>el.getBoundingClientRect().height<43),
      smallText:[...drawer.querySelectorAll("select,textarea,input:not([type=checkbox]):not([type=radio])")].filter(el=>el.getClientRects().length).some(el=>parseFloat(getComputedStyle(el).fontSize)<16)};
   });
   check(!geometry.overflow&&!geometry.controlOverflow,"ASSISTANT_HORIZONTAL_OVERFLOW");
   if(size.width<621)check(!geometry.smallTouch&&!geometry.smallText,"PHONE_TOUCH_TARGETS");
   await at("apply").click();
   check(await income.inputValue()==="55000"&&await expenses.inputValue()==="32000","NATIVE_FORM_APPLY");
   check(await page.evaluate(()=>window.__clubCandidateSubmits)===0,"NO_FORM_SUBMIT");
   await at("model-settings").locator("summary").first().click();
   await page.waitForFunction(()=>{const r=document.querySelector("#iwxa-t3-assistant")?.shadowRoot;return r?.getElementById("device-status")?.textContent?.includes("не готов");});
   check(await at("install").isDisabled()&&await at("cached").isDisabled(),"MODELLESS_PHONE_FALLBACK");
   check(workers===0&&modelRequests===0,"NO_MODEL_ACTIVITY");
   await at("close").click();
   check(await at("drawer").isHidden(),"CLOSE");
   console.log("T3_CLUB_BROWSER_CASE_PASS "+JSON.stringify({width:size.width,height:size.height,sharedEngine:true,phoneLayout:size.width<621,nativeApply:true,noSubmit:true,noModel:true}));
  }catch(e){const code=typeof e.message==="string"&&/^T3_CLUB_BROWSER_[A-Z_]+$/.test(e.message)?e.message:"T3_CLUB_BROWSER_UNEXPECTED";console.log("T3_CLUB_BROWSER_CASE_FAIL "+JSON.stringify({width:size.width,code}));throw Error(code);}
  finally{await ctx.close();}
 }
 console.log("T3_CLUB_BROWSER_CANDIDATE_PASS 4 viewports, actual compiled assistant and native form, not physical devices");
}finally{await browser?.close();await new Promise(ok=>server.close(ok));}
