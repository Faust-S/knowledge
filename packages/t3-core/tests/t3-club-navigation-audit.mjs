// Actual built Club pages and actual anchor clicks at both viewports.
// Public QA harness only: never upload site bytes, screenshots or private logs.
import assert from "node:assert/strict";
import {readFile,stat} from "node:fs/promises";
import {spawn} from "node:child_process";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {chromium} from "playwright";
async function main(){
 const [siteArg,distArg]=process.argv.slice(2);
 assert.ok(siteArg&&distArg,"NAV_ARGUMENTS");
 const site=resolve(siteArg),dist=resolve(distArg),port=55480,origin="http://localhost:"+port;
 const routes=JSON.parse(await readFile(join(site,"scripts/prerender-routes.json"),"utf8"));
 assert.equal(routes.length,40);assert.equal(new Set(routes).size,40);
 const paths=[...routes,"/workspace/exchange/","/workspace/lifecycle/","/404.html"];
 const known=new Set(paths);
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const check=(ok,code)=>{if(!ok)throw Error("NAV_"+code)};
 const canonical=p=>p.replace(/\/index\.html$/,"/").replace(/\/+$/,"")||"/";
 const sameRoute=(actual,expected)=>{
  if(actual.origin!==expected.origin||canonical(actual.pathname)!==canonical(expected.pathname))return false;
  for(const [k,v] of expected.searchParams)if(actual.searchParams.get(k)!==v)return false;
  if(!expected.hash)return true;
  if(expected.hash.startsWith("#/"))return actual.hash.split("?")[0]===expected.hash.split("?")[0];
  return actual.hash===expected.hash;
 };
 assert.ok(sameRoute(new URL(origin+"/workspace/#/domain?workspace_id=example"),new URL(origin+"/workspace/#/domain")));
 assert.ok(!sameRoute(new URL(origin+"/404.html"),new URL(origin+"/projects/")));
 assert.ok(!sameRoute(new URL(origin+"/projects/#different"),new URL(origin+"/projects/#club-goal-map")));
 const totals={pageInventory:0,pageLoads:0,links:0,internalClicked:0,casePrefilled:0,caseRepeated:0,keyboardSkip:0,workspaceResumed:0,assistantSkills:0,externalActionable:0,contactActionable:0,conditional:0,notRun:0,missingRouteChecks:0,externalOK:0,externalBroken:0,externalUnverified:0};
 const failures=[],external=new Set(),conditionalKinds={};
 const safeTarget=(href,source="/")=>{
  try{const u=new URL(href,origin+source);if(u.origin!==origin)return u.protocol==="http:"||u.protocol==="https:"?u.hostname:u.protocol;
   return (known.has(u.pathname)?u.pathname:"unregistered-local-path")+( /^#[a-z0-9-]+$/i.test(u.hash)?u.hash:"");
  }catch{return "invalid-url"}
 };
 const report=(task,stage,href,error)=>{
  const code=/^NAV_[A-Z0-9_]+$/.test(error?.message||"")?error.message:error?.name==="TimeoutError"?"NAV_TIMEOUT":"NAV_UNEXPECTED";
  failures.push({mode:task.mode,state:task.state,source:task.path,stage,target:safeTarget(href,task.path),code});
 };
 function monitor(page){
  const state={errors:0,resources:0,navStatus:null};
  page.on("pageerror",()=>state.errors++);
  page.on("response",res=>{
   if(!res.url().startsWith(origin+"/"))return;
   if(res.request().isNavigationRequest()){
    try{if(res.request().frame()===page.mainFrame())state.navStatus=res.status()}catch{}
   }else if(res.status()>=400)state.resources++;
  });
  page.on("requestfailed",req=>{
   if(req.url().startsWith(origin+"/")&&!req.isNavigationRequest()&&!/ERR_ABORTED/.test(req.failure()?.errorText||""))state.resources++;
  });
  return state;
 }
 const reset=obs=>{obs.errors=0;obs.resources=0;obs.navStatus=null};
 async function ready(page,obs,expected,{errorPage=false}={}){
  await page.waitForLoadState("load",{timeout:16000});
  await page.locator("body").waitFor({state:"visible"});
  if(expected.pathname.startsWith("/workspace/"))await page.waitForFunction(()=>{
   const root=document.getElementById("root");return root&&root.children.length>0&&root.innerText.trim().length>0;
  },null,{timeout:16000});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const v=await page.evaluate(()=>{
   const main=document.querySelector("main,#root");
   return {title:document.title.trim(),main:!!main&&!!main.getClientRects().length&&main.innerText.trim().length>0,
    width:Math.max(document.documentElement.scrollWidth,document.body?.scrollWidth||0),viewport:innerWidth,
    fallback:document.querySelector("main h1")?.textContent?.trim()==="Страница не найдена"};
  });
  check(v.title&&v.main,"PAGE_CONTENT");
  check(v.fallback===errorPage,"PAGE_NOT_FOUND");
  if(errorPage)check(obs.navStatus===200||obs.navStatus===404||obs.navStatus===null,"ERROR_PAGE_HTTP");
  else check(obs.navStatus===null||obs.navStatus<400,"PAGE_HTTP");
  check(v.width<=v.viewport+2,"PAGE_OVERFLOW");
  check(obs.errors===0,"PAGE_JS_ERROR");check(obs.resources===0,"PAGE_RESOURCE_FAILURE");
  totals.pageLoads++;
 }
 async function nav(page){
  const toggle=page.locator("[data-nav-toggle]").first();
  if(await toggle.isVisible()&&await toggle.getAttribute("aria-expanded")!=="true")await toggle.click({timeout:5000});
 }
 async function disclosures(page){
  // Real summary clicks only. Do not enable model downloads, consent, or save data.
  for(let pass=0;pass<5;pass++){
   let opened=0;
   for(const summary of await page.locator("details:not([open]) > summary").elementHandles()){
    if(!await summary.isVisible())continue;
    if(await summary.evaluate(el=>el.parentElement.open))continue;
    await summary.click({timeout:5000});
    if(await summary.evaluate(el=>el.parentElement.open))opened++;
   }
   if(!opened)break;
  }
 }
 async function openSource(page,obs,task){
  // A fragment-only change may return null from goto. Use a new document for every occurrence.
  await page.goto("about:blank",{waitUntil:"commit",timeout:8000});
  reset(obs);
  const resp=await page.goto(origin+task.path,{waitUntil:"load",timeout:20000});
  check(resp&&resp.status()<400,"SOURCE_HTTP");
  await ready(page,obs,new URL(origin+task.path),{errorPage:task.path==="/404.html"});
  if(task.path==="/workspace/"){
   const resume=page.getByTestId("club-workspace-resume-one"),overview=page.getByTestId("club-native-project-overview");
   if(task.state==="created"){
    // The original Host requires an explicit focus after a fresh entry.
    // Use the real resume button, not private APIs or injected storage.
    await resume.or(overview).first().waitFor({state:"visible",timeout:16000});
    if(await resume.isVisible()){await resume.click();totals.workspaceResumed++}
    await overview.waitFor({state:"visible",timeout:16000});
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   }else if(task.state==="saved-unfocused"){
    await resume.waitFor({state:"visible",timeout:16000});
   }else await page.getByTestId("club-create-personal-space").waitFor({state:"visible",timeout:16000});
  }
 }
 async function snapshot(page){
  // Summary clicks outside the mobile menu close it. Inventory after both are revealed.
  await disclosures(page);await nav(page);
  return await page.locator("a[href]").evaluateAll(links=>{
   const seen=new Map();
   return links.map(a=>{
    const href=a.getAttribute("href"),ordinal=seen.get(href)||0;seen.set(href,ordinal+1);
    const s=getComputedStyle(a);
    const skip=a.classList.contains("skip-link")&&href==="#main-content";
    const visible=skip||!!a.getClientRects().length&&s.visibility!=="hidden"&&s.visibility!=="collapse";
    const conditional=a.closest("dialog:not([open])")?"closed-dialog":a.getRootNode() instanceof ShadowRoot?"assistant-state":
     a.closest("details:not([open])")?"closed-details":a.closest("[hidden]")?"hidden-state":a.closest("[data-nav]")?"closed-menu":"other-state";
    return {href,ordinal,target:a.target,visible,skip,conditional,download:a.hasAttribute("download")};
   });
  });
 }
 async function reveal(page,row){
  const selector="a[href="+JSON.stringify(row.href)+"]",link=page.locator(selector).nth(row.ordinal);
  if(row.skip)return link;
  if(!await link.isVisible())await disclosures(page);
  if(!await link.isVisible())await nav(page);
  await link.waitFor({state:"visible",timeout:6000});return link;
 }
 const caseSources=new Map();
 async function projectedCase(caseId,u){
  const suffix=caseId.slice(-2);
  if(!caseSources.has(caseId)){
   const model=JSON.parse(await readFile(join(site,"assets","club-case-"+suffix+".json"),"utf8"));
   const mod=await import(pathToFileURL(join(site,"assets","club-case-"+suffix+"-form-projection.mjs")).href);
   caseSources.set(caseId,{model,mod});
  }
  const {model,mod}=caseSources.get(caseId),params=new URLSearchParams(u.hash.slice(1));
  const key={"/tools/personal-economy/":caseId==="CLUB-IND-01"?"financial":"personalEconomy",
   "/tools/additional-income/":"additionalIncome","/tools/resources-and-skills/":"resources","/tools/action-route/":"actionRoute"}[u.pathname];
  let forms;
  if(caseId==="CLUB-IND-01")forms=mod.projectInd01IntoClubForms(model);
  if(caseId==="CLUB-IND-02"){
   let selected=model;
   if(key==="actionRoute"&&(params.has("fuelRUBPerL")||params.has("courierFactor"))){
    check(params.has("fuelRUBPerL")&&params.has("courierFactor"),"CASE_SCENARIO_INCOMPLETE");
    const {createClubInd02Scenario}=await import(pathToFileURL(join(site,"assets","club-case-02-scenario.mjs")).href);
    selected=createClubInd02Scenario(model,{fuelRUBPerL:Number(params.get("fuelRUBPerL")),courierFactor:Number(params.get("courierFactor"))});
   }
   forms=mod.projectClubInd02IntoExistingForms(selected);
  }
  if(caseId==="CLUB-IND-03"){
   let scenario={};
   if(params.has("platformFactor")||params.has("extraSavingRUBPerDay")){
    check(params.has("platformFactor")&&params.has("extraSavingRUBPerDay"),"CASE_SCENARIO_INCOMPLETE");
    scenario={platformFactor:Number(params.get("platformFactor")),extraSavingRUBPerDay:Number(params.get("extraSavingRUBPerDay"))};
   }
   forms=mod.projectClubInd03IntoExistingForms(model,scenario);
  }
  const values=forms?.[key];
  check(values&&Object.keys(values).length>0,"CASE_PROJECTION_MISSING");return Object.entries(values);
 }
 async function verifyCase(page,u){
  const caseId=new URLSearchParams(u.hash.slice(1)).get("club_example");
  const buttons={"CLUB-IND-01":"Подставить значения кейса","CLUB-IND-02":"Подставить условия Павла","CLUB-IND-03":"Подставить условия Ольги"};
  const selectors={"/tools/personal-economy/":"[data-pe-form]","/tools/additional-income/":"[data-ai-form]","/tools/resources-and-skills/":"[data-rs-form]","/tools/action-route/":"[data-ar-form]"};
  check(buttons[caseId]&&selectors[u.pathname],"CASE_ROUTE_UNKNOWN");
  const fields=await projectedCase(caseId,u),form=page.locator(selectors[u.pathname]),button=page.getByRole("button",{name:buttons[caseId],exact:true});
  await button.waitFor({state:"visible",timeout:12000});
  const valuesMatch=()=>form.evaluate((el,fields)=>fields.every(([name,expected])=>{
   const field=el.elements.namedItem(name);if(!field||!("value" in field))return false;
   const actual=String(field.value),wanted=String(expected);
   return actual===wanted||field.type==="number"&&actual!==""&&wanted!==""&&Number.isFinite(Number(actual))&&Number(actual)===Number(wanted);
  }),fields);
  const readObjects=()=>page.evaluate(()=>{
   const raw=sessionStorage.getItem("ru.iwxa.club.session.v1");
   return JSON.stringify(raw?JSON.parse(raw).objects||[]:[]);
  });
  const wasSame=await valuesMatch(),before=await readObjects();
  // Reapplying an identical example is valid. Require successful completion,
  // every projected field and unchanged completed Results, not just a value delta.
  await button.click();
  await page.waitForFunction(label=>{
   const b=Array.from(document.querySelectorAll("button")).find(x=>x.textContent.trim()===label);
   const status=b?.parentElement?.querySelector('[role="status"]');
   return b&&!b.disabled&&status?.textContent?.trim().length>0;
  },buttons[caseId],{timeout:20000});
  const message=await button.locator("..").locator('[role="status"]').first().textContent();
  check(/^(Значения перенесены|Подготовлены|Подставлен)/.test(message?.trim()||""),"CASE_PREFILL_STATUS");
  check(await valuesMatch(),"CASE_FIELD_PROJECTION");
  check(await readObjects()===before,"CASE_UNEXPECTED_SAVED_RESULT");
  if(wasSame)totals.caseRepeated++;
  totals.casePrefilled++;
 }
 async function verifyFragment(page,u){
  if(!u.hash||u.hash==="#")return;
  if(u.hash.startsWith("#/"))return; // exact original Host route was already checked
  if(new URLSearchParams(u.hash.slice(1)).has("club_example"))return verifyCase(page,u);
  let id;try{id=decodeURIComponent(u.hash.slice(1))}catch{throw Error("NAV_FRAGMENT_ENCODING")}
  // HTML fragment lookup stays in the document tree. The assistant shadow root
  // has its own status ID and must not be mistaken for a duplicate article ID.
  const count=await page.evaluate(id=>Array.from(document.querySelectorAll("[id]")).filter(el=>el.id===id).length,id);
  check(count===1,"FRAGMENT_ID");
  await page.waitForFunction(id=>{
   const el=document.getElementById(id);if(!el||!el.getClientRects().length)return false;
   let d=el.closest("details");while(d){if(!d.open)return false;d=d.parentElement?.closest("details")}
   const r=el.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;
  },id,{timeout:10000});
 }
 async function auditTask(browser,task){
  const ctx=await browser.newContext({viewport:task.viewport,acceptDownloads:true});
  const page=await ctx.newPage(),obs=monitor(page);page.setDefaultTimeout(8000);
  let rows=[];
  try{
   if(task.state==="created"||task.state==="saved-unfocused"){
    const initial={...task,state:"clean"};await openSource(page,obs,initial);
    await page.getByTestId("club-create-personal-space").click();
    await page.getByTestId("club-native-project-overview").waitFor({state:"visible",timeout:20000});
    if(task.state==="saved-unfocused")await openSource(page,obs,task);
   }else await openSource(page,obs,task);
   rows=await snapshot(page);
   await ready(page,obs,new URL(origin+task.path),{errorPage:task.path==="/404.html"});
   totals.pageInventory++;totals.links+=rows.length;
   check(rows.length>0,"EMPTY_LINK_INVENTORY");
   let scope=null;
   if(task.state==="created"){
    scope=rows.map(row=>new URL(row.href,origin).searchParams.get("workspace_id")).find(Boolean);
    check(scope,"CREATED_WORKSPACE_SCOPE");
   }
   for(const [index,row] of rows.entries()){
    if(!row.visible){totals.conditional++;conditionalKinds[row.conditional]=(conditionalKinds[row.conditional]||0)+1;continue}
    let u,phase="source";
    try{
     check(row.href.trim()!==""&&row.href!=="#","PLACEHOLDER_LINK");
     await openSource(page,obs,task);
     phase="reveal";
     u=new URL(row.href,page.url());
     const link=await reveal(page,row);
     if(row.skip){
      phase="keyboard-skip";
      const before=page.url();await link.focus();await link.press("Enter");
      await page.waitForFunction(()=>document.activeElement===document.getElementById("main-content"),null,{timeout:8000});
      check(page.url()===before,"SKIP_ROUTE_CHANGED");
      await ready(page,obs,new URL(before));
      check(await page.evaluate(()=>document.activeElement===document.getElementById("main-content")),"SKIP_FOCUS_LOST");
      totals.keyboardSkip++;totals.internalClicked++;continue;
     }
     if(u.protocol==="mailto:"||u.protocol==="tel:"){
      check(u.pathname.length>0,"CONTACT_TARGET");await link.click({trial:true});totals.contactActionable++;continue;
     }
     if(u.protocol==="http:"||u.protocol==="https:"){
      if(u.origin!==origin){
       check(u.origin!=="https://club.iwxa.ru","ABSOLUTE_PRODUCTION_ESCAPE");
       await link.click({trial:true});external.add(u.href);totals.externalActionable++;continue;
      }
     }else if(u.protocol!=="blob:")throw Error("NAV_UNSUPPORTED_SCHEME");
     if(row.download||u.protocol==="blob:"){
      const download=page.waitForEvent("download",{timeout:12000});
      await link.click();
      const file=await (await download).path();
      check(file&&(await stat(file)).size>0,"DOWNLOAD_EMPTY");
      totals.internalClicked++;continue;
     }
     reset(obs);
     phase="click";
     let dest=page,targetObs=obs;
     if(row.target==="_blank"){
      const popup=page.waitForEvent("popup",{timeout:12000});
      await link.click();dest=await popup;targetObs=monitor(dest);
     }else await link.click({timeout:8000});
     phase="route";
     await dest.waitForURL(value=>sameRoute(value,u),{timeout:12000});
     if(scope&&row.href.startsWith("/")&&u.pathname.endsWith("/"))
      check(new URL(dest.url()).searchParams.get("workspace_id")===scope,"WORKSPACE_SCOPE_LOST");
     phase="content";await ready(dest,targetObs,u,{errorPage:u.pathname==="/404.html"});
     phase="fragment";await verifyFragment(dest,u);
     check(targetObs.errors===0&&targetObs.resources===0,"LINK_TARGET_RUNTIME");
     if(dest!==page)await dest.close();
     totals.internalClicked++;
    }catch(e){
     report(task,"link-"+(index+1)+"-"+phase,row.href,e);
     for(const popup of ctx.pages())if(popup!==page)await popup.close().catch(()=>{});
    }
   }
  }catch(e){report(task,"inventory",task.path,e);totals.notRun+=rows.length}
  finally{await ctx.close();console.log("CLUB_NAV_PAGE "+JSON.stringify({mode:task.mode,state:task.state,source:task.path,links:rows.length,failures:failures.filter(f=>f.mode===task.mode&&f.state===task.state&&f.source===task.path).length}))}
 }
 async function auditAssistant(browser,mode,viewport){
  // The catalog dynamically creates one link per selected skill. Exercise all
  // choices from the actual mounted assistant, with no model installation.
  const task={mode,viewport,path:"/",state:"assistant"};
  const pack=JSON.parse(await readFile(join(site,"assets/club-assistant-skills.json"),"utf8"));
  check(Array.isArray(pack.skills)&&pack.skills.length>0,"SKILL_PACK");
  const ctx=await browser.newContext({viewport}),page=await ctx.newPage(),obs=monitor(page);
  try{
   for(const [i,skill] of pack.skills.entries()){
    let phase="source";
    try{
     await openSource(page,obs,task);
     const assistant=page.locator("#iwxa-t3-assistant"),launcher=assistant.locator("#launcher");
     phase="assistant-open";await launcher.click({timeout:12000});
     await assistant.locator("#skill-all").click({timeout:15000});
     const choice=assistant.locator("#skill-choice");
     const ids=await choice.locator("option").evaluateAll(options=>options.map(o=>o.value).filter(Boolean));
     check(ids.length===pack.skills.length&&new Set(ids).size===pack.skills.length&&pack.skills.every(s=>ids.includes(s.id)),"SKILL_CHOICES");
     phase="skill-select";await choice.selectOption(skill.id);
     const link=assistant.locator("#skill-guidance a[href]");
     check(await link.count()===1,"SKILL_LINK_COUNT");
     check(await link.getAttribute("href")===skill.route,"SKILL_ROUTE_PIN");
     const u=new URL(skill.route,origin);
     check(u.origin===origin,"SKILL_EXTERNAL_ROUTE");
     phase="skill-click";reset(obs);await link.click({timeout:8000});
     await page.waitForURL(value=>sameRoute(value,u),{timeout:12000});
     phase="skill-content";await ready(page,obs,u);await verifyFragment(page,u);
     totals.assistantSkills++;
    }catch(e){report(task,"skill-"+(i+1)+"-"+phase,skill.route,e)}
   }
  }finally{await ctx.close()}
  console.log("CLUB_NAV_ASSISTANT "+JSON.stringify({mode,skills:pack.skills.length}));
 }
 async function checkExternal(raw){
  try{
   let u=new URL(raw);
   for(let i=0;i<5;i++){
    check((u.protocol==="https:"||u.protocol==="http:")&&!u.username&&!u.password&&u.hostname.includes(".")&&!/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/i.test(u.hostname),"EXTERNAL_TARGET");
    const r=await fetch(u,{redirect:"manual",signal:AbortSignal.timeout(12000),headers:{"user-agent":"Club-IWXA-Link-Check/1.0","accept":"text/html,*/*;q=0.1"}});
    if(r.body)await r.body.cancel();
    if(r.status>=200&&r.status<300){totals.externalOK++;return}
    if(r.status>=300&&r.status<400&&r.headers.has("location")){u=new URL(r.headers.get("location"),u);continue}
    if(r.status===404||r.status===410){totals.externalBroken++;console.log("CLUB_NAV_EXTERNAL_BROKEN "+JSON.stringify({host:u.hostname,status:r.status}));return}
    totals.externalUnverified++;console.log("CLUB_NAV_EXTERNAL_UNVERIFIED "+JSON.stringify({host:u.hostname,status:r.status}));return;
   }
  }catch{}
  totals.externalUnverified++;console.log("CLUB_NAV_EXTERNAL_UNVERIFIED "+JSON.stringify({host:safeTarget(raw),status:"network-or-redirect"}));
 }
 let server,browser;
 try{
  server=spawn(process.execPath,[join(site,"scripts/serve-current-static.mjs"),dist,"--t3-loopback"],{cwd:site,env:{...process.env,PORT:String(port)},stdio:"ignore"});
  let available=false;
  for(let i=0;i<60;i++){try{const r=await fetch(origin+"/t3-offline-manifest.json");if(r.ok&&(await r.json()).complete_static_tree===true){available=true;break}}catch{}await pause(500)}
  check(available,"SERVER_READY");
  browser=await chromium.launch({headless:true,args:["--disable-gpu"]});
  const tasks=[];
  for(const [mode,viewport] of [["desktop",{width:1280,height:900}],["phone",{width:390,height:844}]]){
   for(const path of paths)tasks.push({mode,viewport,path,state:"clean"});
   tasks.push({mode,viewport,path:"/workspace/",state:"created"});
   tasks.push({mode,viewport,path:"/workspace/",state:"saved-unfocused"});
   const ctx=await browser.newContext({viewport});const p=await ctx.newPage(),obs=monitor(p);
   try{const url=new URL(origin+"/__club_navigation_missing__/");const r=await p.goto(url.href,{waitUntil:"load"});check(r?.status()===404,"UNKNOWN_ROUTE_STATUS");await ready(p,obs,url,{errorPage:true});totals.missingRouteChecks++}
   catch(e){report({mode,state:"clean",path:"/404.html"},"unknown-route","/404.html",e)}finally{await ctx.close()}
  }
  let next=0;await Promise.all(Array.from({length:4},async()=>{while(next<tasks.length){const task=tasks[next++];await auditTask(browser,task)}}));
  for(const [mode,viewport] of [["desktop",{width:1280,height:900}],["phone",{width:390,height:844}]])await auditAssistant(browser,mode,viewport);
  const urls=[...external];next=0;await Promise.all(Array.from({length:4},async()=>{while(next<urls.length)await checkExternal(urls[next++])}));
  const grouped=new Map();for(const f of failures){const key=JSON.stringify(f);grouped.set(key,(grouped.get(key)||0)+1)}
  for(const [key,count] of [...grouped].slice(0,160))console.log("CLUB_NAV_FAILURE "+JSON.stringify({...JSON.parse(key),count}));
  console.log("CLUB_NAV_SUMMARY "+JSON.stringify({...totals,expectedPageInventories:tasks.length,externalDistinct:urls.length,conditionalKinds,failures:failures.length}));
  check(totals.pageInventory===tasks.length&&totals.missingRouteChecks===2,"INCOMPLETE_PAGES");
  const pack=JSON.parse(await readFile(join(site,"assets/club-assistant-skills.json"),"utf8"));
  check(totals.assistantSkills===2*pack.skills.length,"INCOMPLETE_SKILL_NAVIGATION");
  check(totals.keyboardSkip>=6&&totals.workspaceResumed>0,"INCOMPLETE_HOST_ACCESSIBILITY_OR_RESUME");
  check(!conditionalKinds["closed-menu"],"MENU_LINKS_UNCHECKED");
  check(totals.links===totals.internalClicked+totals.externalActionable+totals.contactActionable+totals.conditional,"INCOMPLETE_LINK_ACCOUNTING");
  check(!failures.length&&!totals.notRun,"USER_NAVIGATION_FAILURE");
  check(!totals.externalBroken,"BROKEN_EXTERNAL_LINK");
  console.log("CLUB_NAV_INTERNAL=PASS");
  console.log("CLUB_NAV_EXTERNAL="+(totals.externalUnverified?"PARTIAL":"PASS"));
 }finally{if(browser)await browser.close();if(server&&server.exitCode===null)server.kill("SIGTERM")}
}
await main();
