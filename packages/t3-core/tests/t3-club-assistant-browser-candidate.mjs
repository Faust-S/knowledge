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
// Derive the exact current scope from the private canonical projection.
const pack=JSON.parse(readFileSync(join(site,"assets/club-assistant-skills.json"),"utf8"));
const routes=new Map();
for(const hint of pack.formHints){
 const skill=pack.skills.find(s=>s.id===hint.skillId);
 assert.ok(skill&&/^data-[a-z0-9-]+$/.test(hint.marker),"T3_CLUB_COVERAGE_HINT");
 const path=skill.route.split("#")[0];
 assert.match(path,/^\/(?:[a-z0-9-]+\/)+$/);
 if(!routes.has(path))routes.set(path,[]);
 routes.get(path).push(hint);
}
assert.equal(pack.formHints.length,21);
assert.equal(routes.size,6);
const paths=new Set(routes.keys());
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
  let modelRequests=0,workers=0,phase="INIT";
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
   phase="NAVIGATION";
   await page.goto(origin+"/tools/personal-economy/",{waitUntil:"domcontentloaded"});
   phase="LAUNCHER_SCAN";
   const calendar=page.locator("#club-money-calendar");
   const recurring=page.locator("details.club-cash-repeat");
   if(await calendar.evaluate(e=>e.open))await calendar.locator(":scope > summary").click();
   await at("launcher").click();
   await at("skill-choice").locator("option").nth(1).waitFor({state:"attached"});
   await at("scan-forms").click();
   const closedOpts=await at("form-choice").locator("option").allTextContents();
   check(closedOpts.some(o=>o.startsWith("Месячный бюджет и финансовый резерв ·"))&&!closedOpts.some(o=>o.startsWith("Денежный календарь:")||o.startsWith("Регулярный денежный платёж ·")),"COLLAPSED_FORM_EXCLUDED");
   await at("close").click();
   phase="OPEN_NATIVE_DISCLOSURES";
   await calendar.locator(":scope > summary").click();
   if(!await recurring.evaluate(e=>e.open))await recurring.locator(":scope > summary").click();
   const budgetShortcut=page.locator('form[data-pe-form] button[data-iwxa-assistant-form-open]');
   const cashShortcut=page.locator('form[data-cash-calendar-entry] button[data-iwxa-assistant-form-open]');
   check(await budgetShortcut.count()===1&&await cashShortcut.count()===1,"CONTEXT_SHORTCUT_COUNT");
   check(await budgetShortcut.evaluate(b=>b.type==="button"&&!b.hidden),"CONTEXT_SHORTCUT_TYPE");
   phase="BUDGET_SHORTCUT";
   await budgetShortcut.click();
   const waitForm=title=>page.waitForFunction(t=>{const root=document.querySelector("#iwxa-t3-assistant")?.shadowRoot;return root?.getElementById("form-choice")?.selectedOptions[0]?.textContent?.startsWith(t)&&root.getElementById("status")?.textContent?.startsWith("Выбрана форма:");},title);
   await waitForm("Месячный бюджет и финансовый резерв ·");
   const opts=await at("form-choice").locator("option").evaluateAll(o=>o.map(x=>({value:x.value,text:x.textContent})));
   const budget=opts.find(o=>o.text.startsWith("Месячный бюджет и финансовый резерв ·"));
   check(budget&&opts.some(o=>o.text.startsWith("Денежный календарь: доход или расход ·"))&&opts.some(o=>o.text.startsWith("Регулярный денежный платёж ·")),"DISTINCT_FORM_TITLES");
   await at("prompt").fill("Незавершённый запрос");
   phase="CASH_SHORTCUT_CANCEL";
   let cancelled=false;
   page.once("dialog",async d=>{cancelled=true;await d.dismiss();});
   await cashShortcut.click();
   check(cancelled,"CONTEXT_CANCEL_DIALOG");
   check(await at("prompt").inputValue()==="Незавершённый запрос"&&await at("form-choice").inputValue()===budget.value,"CONTEXT_SWITCH_CANCEL");
   phase="CASH_SHORTCUT_CONFIRM";
   let confirmed=false;
   page.once("dialog",async d=>{confirmed=true;await d.accept();});
   await cashShortcut.click();
   check(confirmed,"CONTEXT_CONFIRM_DIALOG");
   await waitForm("Денежный календарь: доход или расход ·");
   check(await at("prompt").inputValue()==="","CONTEXT_SWITCH_CLEAR");
   phase="CASH_RETURN_FOCUS";
   await at("close").click();
   check(await cashShortcut.evaluate(b=>document.activeElement===b),"CONTEXT_RETURN_FOCUS");
   phase="COLLAPSED_PREVIEW_REJECT";
   await cashShortcut.click();
   await waitForm("Денежный календарь: доход или расход ·");
   await at("prompt").fill("Заплатил за продукты 730 рублей 14.02.2028.");
   await at("explicit-values").click();
   check(await at("preview").locator("li").count()>0,"CASH_PREVIEW_PRESENT");
   await calendar.locator(":scope > summary").click();
   const applyButton=at("apply");
   if(await applyButton.isVisible()&&await applyButton.isEnabled())await applyButton.click();
   check(await page.locator('form[data-cash-calendar-entry] [name="date"]').inputValue()==="","COLLAPSED_PREVIEW_NOT_APPLIED");
   await at("close").click();
   check(await at("launcher").evaluate(b=>b.getRootNode().activeElement===b),"HIDDEN_RETURN_FALLS_BACK");
   phase="BUDGET_RETURN";
   // The pending cash request belongs to a different form; confirm its
   // replacement just as a real user must.
   page.once("dialog",d=>d.accept());
   await budgetShortcut.click();
   await waitForm("Месячный бюджет и финансовый резерв ·");
   phase="EXPLICIT_FORM";
   await at("prompt").fill("Валюта RUB. Регулярный доход 55000 рублей, обязательные расходы 32000 рублей.");
   await at("explicit-values").click();
   check(await at("preview").locator("li").count()===3,"EXPLICIT_PREVIEW");
   const form=page.locator("form[data-pe-form]");
   const income=form.locator('[name="regularIncome"]'),expenses=form.locator('[name="mandatoryExpenses"]');
   check(await income.inputValue()===""&&await expenses.inputValue()==="","NO_EARLY_WRITE");
   await page.evaluate(()=>{window.__clubCandidateSubmits=0;document.querySelector("[data-pe-form]").addEventListener("submit",e=>{e.preventDefault();window.__clubCandidateSubmits++;},true);});
   phase="GEOMETRY";
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
   phase="NATIVE_APPLY";
   await at("apply").click();
   check(await income.inputValue()==="55000"&&await expenses.inputValue()==="32000","NATIVE_FORM_APPLY");
   check(await page.evaluate(()=>window.__clubCandidateSubmits)===0,"NO_FORM_SUBMIT");
   phase="MODELLESS_SETTINGS";
   await at("model-settings").locator("summary").first().click();
   await page.waitForFunction(()=>{const r=document.querySelector("#iwxa-t3-assistant")?.shadowRoot;return r?.getElementById("device-status")?.textContent?.includes("не готов");});
   check(await at("install").isDisabled()&&await at("cached").isDisabled(),"MODELLESS_PHONE_FALLBACK");
   check(workers===0&&modelRequests===0,"NO_MODEL_ACTIVITY");
   phase="FINAL_CLOSE";
   await at("close").click();
   check(await at("drawer").isHidden(),"CLOSE");
   // A real calculation in the original form, not a seeded result or a
   // model-generated replacement. Context is selected, previewed, then
   // explicitly included. No additional calculation or model starts.
   phase="EMPTY_RESULT_SHORTCUT";
   // Native calendar handlers replace the initial HTML with other empty-state
   // messages. Verify readiness, not a hard-coded placeholder string.
   if(!await calendar.evaluate(e=>e.open))await calendar.locator(":scope > summary").click();
   for(const marker of ["data-cash-payday-result","data-cash-calendar-summary","data-family-options-results"]){
    const result=page.locator("["+marker+"]"),button=page.locator("["+marker+"] + button[data-iwxa-assistant-result-open]");
    check(await result.getAttribute("data-iwxa-assistant-state")==="empty","INITIAL_DOMAIN_RESULT_NOT_READY");
    check(await button.count()===1&&await button.isHidden(),"INITIAL_DOMAIN_RESULT_ACTION_HIDDEN");
   }
   const output=page.locator("[data-pe-result]");
   const resultAction=page.locator("[data-pe-result] + button[data-iwxa-assistant-result-open]");
   check(await resultAction.getAttribute("aria-label")==="Разобрать результат: Расчёт личной экономики","RESULT_ACTION_ACCESSIBLE_NAME");
   check(await resultAction.count()===1&&await resultAction.isHidden(),"EMPTY_RESULT_ACTION_HIDDEN");
   phase="NATIVE_RESULT_CALCULATION";
   await form.getByRole("button",{name:"Рассчитать",exact:true}).click();
   await resultAction.waitFor({state:"visible"});
   const before=await output.innerText();
   check(before.includes("Свободный остаток")&&before.includes("Базовый доход")&&await output.getAttribute("data-iwxa-assistant-state")==="ready","REAL_CALCULATION_PRESENT");
   check(await page.evaluate(()=>window.__clubCandidateSubmits)===1,"ONE_NATIVE_CALCULATION");
   const oldPrompt=await at("prompt").inputValue();
   phase="RESULT_SWITCH_CANCEL";
   let resultCancelled=false;
   page.once("dialog",async d=>{resultCancelled=true;await d.dismiss();});
   await resultAction.click();
   check(resultCancelled&&await at("drawer").isHidden()&&await at("prompt").inputValue()===oldPrompt,"RESULT_CANCEL_PRESERVES_REQUEST");
   phase="RESULT_SWITCH_CONFIRM";
   let resultConfirmed=false;
   page.once("dialog",async d=>{resultConfirmed=true;await d.accept();});
   await resultAction.click();
   await at("result-preview").waitFor({state:"visible"});
   check(resultConfirmed&&await at("result-preview").inputValue()===before.trim(),"EXACT_RESULT_PREVIEW");
   check(await at("result-reading").isVisible()&&(await at("result-meaning").textContent())===pack.resultHints.find(h=>h.marker==="data-pe-result").meaning,"SPECIFIC_READING_WITHOUT_MODEL");
   check(await at("prompt").inputValue()===""&&await at("form-choice").inputValue()==="","NO_AUTOMATIC_CONTEXT_OR_FORM");
   check(await page.evaluate(()=>window.__clubCandidateSubmits)===1,"RESULT_OPEN_NO_CALCULATION");
   const actionSize=await resultAction.evaluate(b=>{const r=b.getBoundingClientRect();return {height:r.height,right:r.right,left:r.left,vw:window.innerWidth};});
   check(actionSize.height>=43&&actionSize.left>=0&&actionSize.right<=actionSize.vw+1,"RESULT_ACTION_GEOMETRY");
   phase="STALE_RESULT_PREVIEW";
   await income.fill("56000");
   await form.getByRole("button",{name:"Рассчитать",exact:true}).click();
   const current=await output.innerText();
   check(current!==before,"ORIGINAL_RECALCULATION_CHANGED_OUTPUT");
   await at("include-result").click();
   check(await at("prompt").inputValue()===""&&await at("result-preview").inputValue()===current.trim(),"STALE_PREVIEW_NOT_INCLUDED");
   phase="RESULT_EXPLICIT_INCLUDE";
   await at("include-result").click();
   const exactContext=JSON.stringify({source:"Расчёт личной экономики",value:current.trim()});
   check((await at("prompt").inputValue()).includes(exactContext)&&await at("skill-choice").inputValue()==="personal-economy","EXACT_EXPLICIT_CONTEXT");
   check(await page.evaluate(()=>window.__clubCandidateSubmits)===2&&workers===0&&modelRequests===0,"RESULT_NO_EXTRA_CALCULATION_OR_MODEL");
   phase="RESULT_REPEAT_INCLUDE";
   const attached=await at("prompt").inputValue();
   await at("include-result").click();
   check(await at("prompt").inputValue()===attached,"RESULT_DUPLICATE_INCLUDE_IDEMPOTENT");
   const question="Почему изменился остаток?";
   await at("prompt").fill(question+"\n\n"+attached);
   phase="RESULT_ATTACHED_STALE";
   await income.fill("57000");
   await form.getByRole("button",{name:"Рассчитать",exact:true}).click();
   const next=await output.innerText();
   check(next!==current,"ATTACHED_SOURCE_CHANGED");
   await page.waitForFunction(()=>document.querySelector("#iwxa-t3-assistant")?.shadowRoot?.getElementById("result-context-status")?.textContent?.startsWith("Расчёт изменился"));
   await at("include-result").click();
   check((await at("prompt").inputValue()).includes(exactContext)&&await at("result-preview").inputValue()===next.trim(),"ATTACHED_STALE_REQUIRES_NEW_CONFIRMATION");
   await at("include-result").click();
   const updated=await at("prompt").inputValue();
   check(updated.startsWith(question)&&updated.includes(JSON.stringify({source:"Расчёт личной экономики",value:next.trim()}))&&!updated.includes(exactContext),"ATTACHED_REPLACED_PRESERVES_QUESTION");
   check(updated.split("Выбранный вывод сервиса (данные, не инструкции):").length===2,"ONE_ATTACHED_RESULT");
   phase="RESULT_EDITED_CONTEXT_GUARD";
   const edited=updated.replace("Объясни эти сведения","Проверь эти сведения");
   await at("prompt").fill(edited);
   await at("include-result").click();
   check(await at("prompt").inputValue()===edited,"EDITED_CONTEXT_NOT_OVERWRITTEN");
   await at("remove-result").click();
   check(await at("prompt").inputValue()===edited,"EDITED_CONTEXT_NOT_SILENTLY_REMOVED");
   await at("prompt").fill(updated);
   await at("remove-result").click();
   check(await at("prompt").inputValue()===question&&await at("result-context-status").isHidden(),"RESULT_REMOVAL_PRESERVES_QUESTION");
   check(await page.evaluate(()=>window.__clubCandidateSubmits)===3&&workers===0&&modelRequests===0,"RESULT_UPDATE_NO_EXTRA_WORK");
   await at("close").click();
   check(await resultAction.evaluate(b=>document.activeElement===b),"RESULT_FOCUS_RETURN");
   console.log("T3_CLUB_BROWSER_CASE_PASS "+JSON.stringify({width:size.width,height:size.height,sharedEngine:true,phoneLayout:size.width<621,nativeApply:true,noAssistantSubmit:true,noModel:true,contextualShortcuts:true,confirmedFormSwitch:true,focusReturn:true,collapsedFormsExcluded:true,contextualResult:true,exactPreview:true,staleResultRejected:true,explicitContext:true,oneResultAttachment:true,staleAttachmentUpdated:true,questionPreserved:true,editedContextProtected:true}));
  }catch(e){const code=typeof e.message==="string"&&/^T3_CLUB_BROWSER_[A-Z_]+$/.test(e.message)?e.message:"T3_CLUB_BROWSER_UNEXPECTED";console.log("T3_CLUB_BROWSER_CASE_FAIL "+JSON.stringify({width:size.width,phase,code,timeout:e?.name==="TimeoutError"}));throw Error(code);}
  finally{await ctx.close();}
 }
 // Verify all configured shortcut bindings on the actual source pages at a
 // compact touch viewport and on desktop. Use native disclosure clicks;
 // never remove hidden attributes or inject prerequisite records.
 for(const size of [{width:390,height:844},{width:1440,height:900}]){
  const ctx=await browser.newContext({viewport:size,hasTouch:size.width<621,isMobile:size.width<621,serviceWorkers:"block"});
  let tested=0,workers=0,modelRequests=0,phase="INIT",index=0;
  try{
   await ctx.addInitScript(()=>{
    Object.defineProperty(navigator,"gpu",{configurable:true,value:undefined});
    window.__clubCoverageSubmits=0;
    document.addEventListener("submit",()=>window.__clubCoverageSubmits++,true);
   });
   await ctx.route("**/*",route=>{
    const url=new URL(route.request().url());
    if(url.origin===origin)return route.continue();
    if(/huggingface|hf\.co|raw\.githubusercontent/i.test(url.hostname))modelRequests++;
    return route.abort();
   });
   const page=await ctx.newPage();page.on("worker",()=>workers++);
   page.setDefaultTimeout(15000);
   const at=id=>page.locator("#iwxa-t3-assistant").locator("#"+id);
   const check=(v,c)=>{if(!v)throw Error("T3_CLUB_COVERAGE_"+c);};
   for(const [path,hints] of routes){
    phase="NAVIGATION";
    await page.goto(origin+path,{waitUntil:"domcontentloaded"});
    await at("launcher").waitFor({state:"visible"});
    // A real driver route is a prerequisite to the native shift journal.
    // First prove the unavailable shift form is absent from scan choices.
    const driver=hints.find(h=>h.marker==="data-driver-form");
    if(driver){
     phase="DRIVER_PREREQUISITE";
     const native=page.locator("form[data-driver-form]");
     check(!await native.isVisible(),"DRIVER_INITIALLY_HIDDEN");
     await at("launcher").click();
     await at("skill-choice").locator("option").nth(1).waitFor({state:"attached"});
     await at("scan-forms").click();
     check(!(await at("form-choice").locator("option").allTextContents()).some(s=>s.startsWith(driver.title+" ·")),"DRIVER_HIDDEN_EXCLUDED");
     await at("close").click();
     const route=page.locator("form[data-ar-form]");
     await route.locator('[name="targetValue"]').fill("Дополнительный доход 20000 рублей");
     await route.locator('[name="driverComparison"]').selectOption("yes");
     await route.locator('button[type="submit"]').click();
     await native.waitFor({state:"visible"});
    }
    for(const hint of hints){
     index++;
     phase="NATIVE_FORM";
     const form=page.locator("form["+hint.marker+"]");
     check(await form.count()===1,"UNIQUE_FORM");
     // Discover outer native disclosures from the original DOM and open
     // in ancestor order. IDs remain private; no markup is logged.
     const disclosures=await form.evaluate(f=>{
      const ids=[];
      for(let p=f.parentElement;p;p=p.parentElement)if(p.tagName==="DETAILS"&&!p.open)ids.unshift(p.id);
      return ids;
     });
     for(const id of disclosures){
      check(/^[a-zA-Z0-9_-]+$/.test(id),"DISCLOSURE_ID");
      const detail=page.locator("#"+id);
      if(!await detail.evaluate(e=>e.open))await detail.locator(":scope > summary").click();
     }
     const button=form.locator('button[data-iwxa-assistant-form-open="'+hint.marker+'"]');
     check(await button.count()===1,"UNIQUE_SHORTCUT");
     await button.waitFor({state:"visible"});
     check(await button.evaluate(b=>b.type==="button"&&b.offsetHeight>=43),"SHORTCUT_TOUCH");
     const state=()=>form.evaluate(f=>Array.from(f.elements).filter(e=>e.name).map(e=>[e.name,e.value,e.checked??null,e.disabled]));
     const before=JSON.stringify(await state());
     const submits=await page.evaluate(()=>window.__clubCoverageSubmits);
     phase="CONTEXT_SELECTION";
     await button.click();
     await page.waitForFunction(({title,skillId})=>{
      const r=document.querySelector("#iwxa-t3-assistant")?.shadowRoot;
      return r?.getElementById("form-choice")?.selectedOptions[0]?.textContent?.startsWith(title+" ·")&&r.getElementById("skill-choice")?.value===skillId&&r.getElementById("status")?.textContent?.startsWith("Выбрана форма:");
     },{title:hint.title,skillId:hint.skillId});
     check(await at("prompt").evaluate(e=>e.getRootNode().activeElement===e),"PROMPT_FOCUS");
     check(JSON.stringify(await state())===before,"OPEN_NO_FORM_MUTATION");
     check(await page.evaluate(()=>window.__clubCoverageSubmits)===submits,"OPEN_NO_SUBMIT");
     phase="RETURN_FOCUS";
     await at("close").click();
     check(await button.evaluate(b=>document.activeElement===b),"RETURN_FOCUS");
     tested++;
    }
   }
   check(tested===pack.formHints.length,"ALL_FORMS");
   check(workers===0&&modelRequests===0,"NO_MODEL_ACTIVITY");
   console.log("T3_CLUB_ALL_FORM_SHORTCUTS_PASS "+JSON.stringify({width:size.width,height:size.height,forms:tested,routes:routes.size,nativeDriverPrerequisite:true,formMutation:false,autoSubmit:false,modelActivity:false}));
  }catch(e){
   const code=typeof e?.message==="string"&&/^T3_CLUB_COVERAGE_[A-Z_]+$/.test(e.message)?e.message:"T3_CLUB_COVERAGE_UNEXPECTED";
   console.log("T3_CLUB_ALL_FORM_SHORTCUTS_FAIL "+JSON.stringify({width:size.width,tested,index,phase,code,timeout:e?.name==="TimeoutError"}));
   throw Error(code);
  }finally{await ctx.close();}
 }
 // Execute every result surface via the site's original user-facing forms.
 // Use fresh tabs for the four pages, no injected records or simulated result.
 assert.equal(pack.resultHints.length,13);
 for(const size of [{width:390,height:844},{width:1440,height:900}]){
  const ctx=await browser.newContext({viewport:size,hasTouch:size.width<621,isMobile:size.width<621,serviceWorkers:"block"});
  let phase="INIT",tested=0,workers=0,modelRequests=0;
  const done=new Set();
  try{
   await ctx.addInitScript(()=>{
    Object.defineProperty(navigator,"gpu",{configurable:true,value:undefined});
    window.__clubResultSubmits=0;
    document.addEventListener("submit",()=>window.__clubResultSubmits++,true);
   });
   await ctx.route("**/*",route=>{
    const url=new URL(route.request().url());
    if(url.origin===origin)return route.continue();
    if(/huggingface|hf\.co|raw\.githubusercontent/i.test(url.hostname))modelRequests++;
    return route.abort();
   });
   let page;
   const at=id=>page.locator("#iwxa-t3-assistant").locator("#"+id);
   const check=(v,c)=>{if(!v)throw Error("T3_CLUB_RESULT_"+c);};
   const output=marker=>page.locator("["+marker+"]");
   const action=marker=>page.locator("["+marker+"] + button[data-iwxa-assistant-result-open]");
   async function visit(path){
    if(page)await page.close();
    page=await ctx.newPage();page.on("worker",()=>workers++);page.setDefaultTimeout(15000);
    await page.goto(origin+path,{waitUntil:"domcontentloaded"});
    await at("launcher").waitFor({state:"visible"});
   }
   async function open(id){
    const details=page.locator("#"+id);
    if(!await details.evaluate(e=>e.open))await details.locator(":scope > summary").click();
    check(await details.evaluate(e=>e.open),"NATIVE_DISCLOSURE");
   }
   const form=marker=>page.locator("form["+marker+"]");
   async function fill(marker,values){
    for(const [key,value] of Object.entries(values)){
     const field=form(marker).locator('[name="'+key+'"]');
     if(await field.evaluate(el=>el.tagName==="SELECT"))await field.selectOption(String(value));
     else await field.fill(String(value));
    }
   }
   async function submit(marker){await form(marker).locator('button[type="submit"]').click();}
   async function state(marker,expected){
    await page.waitForFunction(({marker,expected})=>document.querySelector("["+marker+"]")?.getAttribute("data-iwxa-assistant-state")===expected,{marker,expected},{timeout:15000});
   }
   async function initial(marker){
    await state(marker,"empty");check(await action(marker).count()===1&&await action(marker).isHidden(),"EMPTY_OR_INSTRUCTION_HIDDEN");
   }
   const snapshot=()=>page.evaluate(()=>({session:sessionStorage.getItem("ru.iwxa.club.session.v1"),submits:window.__clubResultSubmits}));
   async function verify(marker){
    phase="VERIFY_"+(tested+1);
    const hint=pack.resultHints.find(h=>h.marker===marker);
    check(hint&&!done.has(marker),"CANONICAL_RESULT_HINT");
    await state(marker,"ready");
    await action(marker).waitFor({state:"visible"});
    const exact=(await output(marker).innerText()).trim();
    check(exact.length>0,"NONEMPTY_REAL_OUTPUT");
    const before=JSON.stringify(await snapshot());
    await action(marker).click();
    await at("result-preview").waitFor({state:"visible"});
    check(await at("result-preview").inputValue()===exact,"EXACT_OUTPUT");
    check(await at("result-reading").isVisible()&&await at("result-meaning").textContent()===hint.meaning,"EXACT_RESULT_READING");
    check(JSON.stringify(await at("result-checks").locator("li").allTextContents())===JSON.stringify(hint.checks),"EXACT_RESULT_CHECKS");
    check((await at("result-question").textContent())?.includes(hint.question),"EXACT_SUGGESTED_QUESTION");
    check(await at("skill-choice").inputValue()===hint.skillId,"EXACT_SERVICE");
    check(await at("prompt").inputValue()==="","NO_IMPLICIT_ATTACHMENT");
    await at("include-result").click();
    const attached=await at("prompt").inputValue();
    check(attached.includes(JSON.stringify({source:hint.title,value:exact})),"EXPLICIT_EXACT_ATTACHMENT");
    await at("remove-result").click();
    check(await at("prompt").inputValue()==="","REMOVE_EXACT_ATTACHMENT");
    await at("close").click();
    check(await action(marker).evaluate(el=>document.activeElement===el),"RESULT_FOCUS");
    check(JSON.stringify(await snapshot())===before,"READING_DOES_NOT_WRITE_OR_SUBMIT");
    done.add(marker);tested++;
   }

   phase="MONEY_INITIAL";
   await visit("/tools/personal-economy/");
   await open("club-money-calendar");
   await open("club-money-decisions");
   for(const marker of ["data-pe-result","data-cash-payday-result","data-cash-calendar-summary","data-family-options-results"])await initial(marker);
   phase="MONEY_CALCULATE";
   await fill("data-pe-form",{regularIncome:55000,mandatoryExpenses:32000,reserve:6000});
   await submit("data-pe-form");await verify("data-pe-result");
   phase="CASH_SETUP";
   await fill("data-cash-calendar-setup",{startDate:"2026-11-24",endDate:"2026-12-08",openingAvailableRUB:15000,minimumBufferRUB:4000});
   await submit("data-cash-calendar-setup");
   await state("data-cash-calendar-summary","ready");
   phase="CASH_ENTRIES";
   await fill("data-cash-calendar-entry",{date:"2026-11-25",amountRUB:-8000,category:"rent",status:"planned"});
   await submit("data-cash-calendar-entry");
   await page.waitForFunction(()=>document.querySelector("[data-cash-calendar-summary]")?.innerText?.includes("В журнале 1 операций"));
   await fill("data-cash-calendar-entry",{date:"2026-12-01",amountRUB:35000,category:"payroll",status:"planned"});
   await submit("data-cash-calendar-entry");
   await page.waitForFunction(()=>document.querySelector("[data-cash-calendar-summary]")?.innerText?.includes("В журнале 2 операций"));
   await verify("data-cash-calendar-summary");
   phase="PAYDAY";
   await page.locator("[data-cash-payday-date]").fill("2026-11-24");
   await page.locator("[data-cash-payday-run]").click();
   await verify("data-cash-payday-result");
   phase="FAMILY_COMPARISON";
   const rent=form("data-family-options-form").locator('[name="rentEntry"]');
   await page.waitForFunction(()=>document.querySelector('[data-family-options-form] [name="rentEntry"]')?.options.length>1);
   const rentId=await rent.locator("option").nth(1).getAttribute("value");
   await fill("data-family-options-form",{asOfDate:"2026-11-24",rentEntry:rentId,rentNewDate:"2026-12-02"});
   await submit("data-family-options-form");
   await verify("data-family-options-results");
   await fill("data-family-options-form",{rentNewDate:"2026-12-03"});
   await state("data-family-options-results","empty");
   check(await action("data-family-options-results").isHidden(),"CHANGED_COMPARISON_NOT_RESULT");

   phase="INCOME_INITIAL";
   await visit("/tools/additional-income/");
   await open("club-income-ledger");
   await open("warehouse-payroll");
   await open("club-income-contact-group");
   await open("club-income-pvz-group");
   for(const marker of ["data-ai-result","data-work-ledger-summary","data-warehouse-payroll-result","data-contact-preview","data-work-ledger-pvz-summary"])await initial(marker);
   phase="INCOME_CALCULATE";
   await fill("data-ai-form",{targetNetIncome:12000,hoursPerWeek:10,price:500,direct:80,commission:10,mandatory:6});
   await submit("data-ai-form");await verify("data-ai-result");
   phase="LEDGER_SETUP";
   await fill("data-work-ledger-setup",{startDate:"2026-11-24",endDate:"2026-12-08",openingSalaryReceivableRUB:0});
   await submit("data-work-ledger-setup");await state("data-work-ledger-summary","ready");
   phase="WAREHOUSE_CALCULATE";
   await fill("data-warehouse-payroll-form",{date:"2026-11-24"});
   await submit("data-warehouse-payroll-form");await verify("data-warehouse-payroll-result");
   phase="WAREHOUSE_INVALIDATE";
   await fill("data-warehouse-payroll-form",{hourlyRUB:480});
   await state("data-warehouse-payroll-result","stale");
   check(await action("data-warehouse-payroll-result").isHidden(),"CHANGED_WAREHOUSE_NOT_RESULT");
   await submit("data-warehouse-payroll-form");await state("data-warehouse-payroll-result","ready");
   phase="LEDGER_NATIVE_SHIFT";
   await submit("data-work-ledger-shift");
   await page.waitForFunction(()=>document.querySelector('[data-work-ledger-pvz] [name="shiftId"]')?.options.length>1);
   await verify("data-work-ledger-summary");
   phase="PVZ_NATIVE_OPERATION";
   const shift=form("data-work-ledger-pvz").locator('[name="shiftId"]');
   const shiftId=await shift.locator("option").nth(1).getAttribute("value");
   await fill("data-work-ledger-pvz",{shiftId,state:"final",received:90,issued:80,returned:5,discrepancies:1,claimRUB:0,claimState:"none"});
   await submit("data-work-ledger-pvz");await verify("data-work-ledger-pvz-summary");
   phase="CONTACT_CALCULATE";
   await fill("data-contact-work-form",{date:"2026-11-25",offeredCalls:90,handledCalls:84,resolvedCalls:66,escalatedCalls:10,followupCalls:8});
   await verify("data-contact-preview");
   await fill("data-contact-work-form",{handledCalls:95});
   await page.waitForFunction(()=>document.querySelector("[data-contact-preview]")?.getAttribute("data-iwxa-assistant-state")!=="ready");
   check(await action("data-contact-preview").isHidden(),"INVALID_CONTACT_NOT_RESULT");

   phase="RESOURCE_INITIAL";
   await visit("/tools/resources-and-skills/");await initial("data-rs-result");
   await fill("data-rs-form",{skills:"ремонт техники, диагностика",experience:"Проверено три прибора",hoursPerWeek:5,budget:1000,resources:"Ручные инструменты"});
   await submit("data-rs-form");await verify("data-rs-result");

   phase="ROUTE_INITIAL";
   await visit("/tools/action-route/");
   for(const marker of ["data-ar-result","data-driver-summary","data-club-week-summary"])await initial(marker);
   await fill("data-ar-form",{targetValue:"Дополнительный доход 12000 рублей",maxHoursPerWeek:5,driverComparison:"yes"});
   await submit("data-ar-form");await verify("data-ar-result");
   phase="DRIVER_INITIAL_AFTER_ROUTE";
   await initial("data-driver-summary");
   phase="DRIVER_NATIVE_SHIFT";
   await fill("data-driver-form",{date:"2026-11-24",mode:"taxi",actualHours:6,kmDriven:110,grossRUB:4200,tipsRUB:100,platformFeeRUB:600,taxRUB:200,fuelRUB:700,wearReserveRUB:450});
   await submit("data-driver-form");await verify("data-driver-summary");
   phase="WEEK_NATIVE_TASK";
   await fill("data-club-week-form",{title:"Проверить запас времени",start:"10:00",durationMinutes:60,kind:"personal"});
   await submit("data-club-week-form");await verify("data-club-week-summary");
   check(tested===pack.resultHints.length&&done.size===tested,"ALL_RESULTS");
   check(workers===0&&modelRequests===0,"NO_MODEL_ACTIVITY");
   console.log("T3_CLUB_ALL_RESULT_HINTS_PASS "+JSON.stringify({width:size.width,height:size.height,results:tested,exactReading:true,exactContext:true,nativeOperations:true,emptyStatesExcluded:true,staleStatesExcluded:true,noModel:true,noAssistantWrite:true}));
  }catch(e){
   const code=typeof e.message==="string"&&/^T3_CLUB_RESULT_[A-Z_]+$/.test(e.message)?e.message:"T3_CLUB_RESULT_UNEXPECTED";
   console.log("T3_CLUB_ALL_RESULT_HINTS_FAIL "+JSON.stringify({width:size.width,tested,phase,code,timeout:e?.name==="TimeoutError"}));
   throw Error(code);
  }finally{await ctx.close();}
 }
 console.log("T3_CLUB_BROWSER_CANDIDATE_PASS 4 viewports, actual compiled assistant and native form, 13 result hints on 2 viewports, not physical devices");
}finally{await browser?.close();await new Promise(ok=>server.close(ok));}
