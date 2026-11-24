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
   const output=page.locator("[data-pe-result]");
   const resultAction=page.locator("[data-pe-result] + button[data-iwxa-assistant-result-open]");
   check(await resultAction.getAttribute("aria-label")==="Разобрать результат: Расчёт личной экономики","RESULT_ACTION_ACCESSIBLE_NAME");
   check(await resultAction.count()===1&&await resultAction.isHidden(),"EMPTY_RESULT_ACTION_HIDDEN");
   phase="NATIVE_RESULT_CALCULATION";
   await form.getByRole("button",{name:"Рассчитать",exact:true}).click();
   await resultAction.waitFor({state:"visible"});
   const before=await output.innerText();
   check(before.includes("Свободный остаток")&&before.includes("Базовый доход"),"REAL_CALCULATION_PRESENT");
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
 console.log("T3_CLUB_BROWSER_CANDIDATE_PASS 4 viewports, actual compiled assistant and native form, not physical devices");
}finally{await browser?.close();await new Promise(ok=>server.close(ok));}
