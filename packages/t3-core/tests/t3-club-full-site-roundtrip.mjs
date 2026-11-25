// Product-owned dist only. Real UI operations and original Kernel / Exchange.
// No staged source pages, seeded store, simulated model, direct write or mock SW.
// Disposable local profiles and synthetic data. Never upload archive or logs.
import assert from "node:assert/strict";
import {isDeepStrictEqual} from "node:util";
import {spawn} from "node:child_process";
import {mkdtemp,rm,stat,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {chromium} from "playwright";

const [siteArg,distArg]=process.argv.slice(2);
assert.ok(siteArg&&distArg,"CLUB_DIST_ARGUMENTS");
const site=resolve(siteArg),dist=resolve(distArg);
const port=55479,origin="http://localhost:"+port;
const root=await mkdtemp(join(tmpdir(),"club-full-site-"));
const archive=join(root,"profile.iwxa");
let alias="Сосед Т3";
const goals="Освоить ремонт бытовой техники и помогать соседям.";
let phase="START_SERVER",server,context;
const check=(ok,code)=>assert.ok(ok,"CLUB_DIST_"+code);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const log=(code)=>console.log("CLUB_DIST_"+code+"=PASS");
// JSON objects have no semantic property order. Keep all keys, types, exact
// values and array order; a real changed event must still fail the check.
function verifyHistory(actual,expected,prefix){
 const equal=isDeepStrictEqual(actual,expected);
 if(!equal){
  const rootKeys=["schema","status","events"];
  const eventKeys=["from","to","previousUpdatedAt","recordedAt","reason","reviewDate","assessment"];
  const differences=rootKeys.filter(k=>k!=="events"&&!isDeepStrictEqual(actual?.[k],expected?.[k]));
  const a=actual?.events,e=expected?.events;
  if(!Array.isArray(a)||!Array.isArray(e)||a.length!==e.length)differences.push("events.length_or_type");
  if(Array.isArray(a)&&Array.isArray(e))for(let i=0;i<Math.min(a.length,e.length);i++){
   if(isDeepStrictEqual(a[i],e[i]))continue;
   const fields=eventKeys.filter(k=>!isDeepStrictEqual(a[i]?.[k],e[i]?.[k]));
   differences.push("events["+i+"]:"+(fields.join(",")||"other_own_keys"));
  }
  console.log("CLUB_DIST_LIFECYCLE_SEMANTIC_MISMATCH "+JSON.stringify({prefix,differences:differences.length?differences:["other_own_keys"]}));
 }
 check(equal,prefix+"_EXACT_HISTORY");
 if(JSON.stringify(actual)!==JSON.stringify(expected))log(prefix+"_OBJECT_KEY_ORDER_ONLY");
 log(prefix+"_EXACT_HISTORY");
}
check(isDeepStrictEqual({status:"active",events:[{from:"deferred",to:"active"}]},
 {events:[{to:"active",from:"deferred"}],status:"active"}),"HISTORY_OBJECT_ORDER_INDEPENDENT");
check(!isDeepStrictEqual({events:[{to:"deferred"},{to:"active"}]},{events:[{to:"active"},{to:"deferred"}]})&&
 !isDeepStrictEqual({events:[{to:"active",reason:"one"}]},{events:[{to:"active",reason:"two"}]}),
 "HISTORY_EVENT_ORDER_AND_VALUES_STRICT");
async function poll(fn,code,ms=60000){
 const deadline=Date.now()+ms;
 let value;
 do{
  value=await fn();
  if(value)return value;
  await delay(300);
 }while(Date.now()<deadline);
 throw Error("CLUB_DIST_"+code);
}
const desktop={width:1280,height:900},phone={width:390,height:844};
async function launch(dir,viewport=desktop){
 context=await chromium.launchPersistentContext(join(root,dir),{
  headless:true,viewport,acceptDownloads:true,
  args:["--disable-gpu"]
 });
 const page=context.pages()[0]||await context.newPage();
 page.setDefaultTimeout(45000);
 return page;
}
async function close(){
 if(context){await context.close();context=null;}
}
async function visit(page,path){
 await page.goto(origin+path,{waitUntil:"domcontentloaded",timeout:60000});
}
// One responsive sweep of the actual assembled product, not a second build.
// The separate disposable profile never enters the functional roundtrip.
async function fitViewport(page,code){
 const sizes=await page.evaluate(()=>({viewport:window.innerWidth,
  width:Math.max(document.documentElement.scrollWidth,document.body?.scrollWidth||0)}));
 if(sizes.width>sizes.viewport+2){
  console.log("CLUB_DIST_LAYOUT_FAIL "+JSON.stringify({phase,viewport:sizes.viewport,document:sizes.width}));
  throw Error("CLUB_DIST_"+code);
 }
}
async function auditResponsive(){
 const routes=JSON.parse(await readFile(join(site,"scripts/prerender-routes.json"),"utf8"));
 check(routes.length===40&&new Set(routes).size===routes.length,"RESPONSIVE_ROUTE_REGISTRY");
 const paths=[...routes,"/workspace/exchange/","/workspace/lifecycle/"];
 const page=await launch("responsive");
 let errors=0,failures=0;
 page.on("pageerror",()=>{errors++});
 // The routes, fragment links and menu checks are independent. Collect
 // their actual failures in the same browser profile and still qualify
 // the separate native functional route. Never turn a failed check into PASS.
 const attempt=async(href,run)=>{
  try{await run();return true}
  catch(e){
   if(page.isClosed())throw e;
   failures++;
   const safeHref=typeof href==="string"&&/^\/[a-z0-9\/-]*(?:#[a-z0-9-]+)?$/.test(href)?href:"unexpected-route";
   const id=safeHref.includes("#")?safeHref.split("#")[1]:"";
   let observed={};
   try{observed=await page.evaluate(id=>{
    const target=id?document.getElementById(id):null;
    let details=target?.closest("details"),closed=0;
    while(details){if(!details.open)closed++;details=details.parentElement?.closest("details")}
    return {viewport:window.innerWidth,documentWidth:Math.max(document.documentElement.scrollWidth,document.body?.scrollWidth||0),
     targetPresent:!!target,targetHidden:target?.hidden??null,
     targetLayout:!!target?.getClientRects().length,closedDisclosures:closed,
     navExpanded:document.querySelector("[data-nav-toggle]")?.getAttribute("aria-expanded")==="true",
     navLinks:document.querySelectorAll("[data-nav] a").length};
   },id)}catch{}
   const code=typeof e?.message==="string"&&/^CLUB_DIST_[A-Z_]+$/.test(e.message)?e.message:"CLUB_DIST_UNEXPECTED";
   console.log("CLUB_DIST_RESPONSIVE_FAILURE "+JSON.stringify({phase,href:safeHref,code,timeout:e?.name==="TimeoutError",observed}));
   return false;
  }
 };
 try{
  for(const [mode,viewport] of [["DESKTOP",desktop],["PHONE",phone]]){
   await page.setViewportSize(viewport);
   const beforeGroup=failures;
   for(const [index,path] of paths.entries()){
    phase="RESPONSIVE_"+mode+"_ROUTE_"+String(index+1).padStart(2,"0");
    await attempt(path,async()=>{
     const before=errors;
     await visit(page,path);
     await page.locator("[data-nav]").waitFor({state:"attached"});
     await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
     check(await page.evaluate(()=>document.title.trim().length>0&&!!document.querySelector("main,#root")),"RESPONSIVE_REAL_PAGE");
     check(errors===before,"RESPONSIVE_UNCAUGHT_PAGE_ERROR");
     await fitViewport(page,"RESPONSIVE_HORIZONTAL_OVERFLOW");
    });
   }
   if(failures===beforeGroup)log("RESPONSIVE_"+mode+"_ALL_"+paths.length+"_ROUTES");
  }
  // Test every catalogue anchor and all six discoverable helpers on the
  // narrow viewport. A hidden anchor is a failure, not a successful load.
  phase="RESPONSIVE_PHONE_CATALOG";
  let links=[];
  const catalogueOK=await attempt("/tools/",async()=>{
   await visit(page,"/tools/");
   const cards=await page.evaluate(()=>Array.from(document.querySelectorAll("[data-tool-level]"))
    .map(card=>({href:card.querySelector("a[href]")?.getAttribute("href")||null})));
   check(cards.length===25&&cards.filter(x=>x.href).length===22,"RESPONSIVE_CATALOG_22_AVAILABLE");
   const catalogLinks=cards.map(x=>x.href).filter(x=>x&&x.includes("#"));
   const helperLinks=await page.locator(".club-support-tools a[href]").evaluateAll(links=>links.map(a=>a.getAttribute("href")));
   check(helperLinks.length===6,"RESPONSIVE_SUPPORT_TOOLS");
   links=[...new Set([...catalogLinks,...helperLinks,"/tools/personal-economy/#club-cash-until-payday",
    "/tools/personal-economy/#club-money-calendar-start","/tools/personal-economy/#club-cash-entry","/tools/action-route/#club-week-plan"])];
  });
  const beforeAnchors=failures;
  for(const [index,href] of links.entries()){
   phase="RESPONSIVE_PHONE_ANCHOR_"+String(index+1).padStart(2,"0");
   await attempt(href,async()=>{
    const before=errors;
    await visit(page,href);
    const id=new URL(origin+href).hash.slice(1);
    check(/^[a-z0-9-]+$/.test(id),"RESPONSIVE_ANCHOR_ID");
    await page.locator("#"+id).waitFor({state:"visible"});
    await poll(async()=>await page.locator("#"+id).evaluate(el=>{
     let parent=el.closest("details");while(parent){if(!parent.open)return false;parent=parent.parentElement?.closest("details")}
     return el.getClientRects().length>0;
    }),"RESPONSIVE_OPEN_EXACT_DISCLOSURE",10000);
    check(errors===before,"RESPONSIVE_UNCAUGHT_PAGE_ERROR");
    await fitViewport(page,"RESPONSIVE_OPEN_FORM_OVERFLOW");
   });
  }
  if(catalogueOK&&failures===beforeAnchors)log("RESPONSIVE_PHONE_ALL_"+links.length+"_FUNCTION_ANCHORS");
  const beforeMenus=failures;
  for(const [index,viewport] of [{width:320,height:568},{width:667,height:320}].entries()){
   await page.setViewportSize(viewport);
   for(const [routeIndex,path] of ["/","/tools/","/workspace/","/workspace/exchange/"].entries()){
    phase="RESPONSIVE_MENU_"+index+"_"+routeIndex;
    await attempt(path,async()=>{
     await visit(page,path);
     const toggle=page.locator("[data-nav-toggle]"),nav=page.locator("[data-nav]");
     await toggle.click();
     await nav.waitFor({state:"visible"});
     check(await nav.locator("a").count()===5,"RESPONSIVE_MENU_ALL_ACTIONS");
     const last=nav.locator("a").last();
     await last.scrollIntoViewIfNeeded();
     const rect=await last.boundingBox(),size=page.viewportSize();
     check(!!rect&&rect.x>=-1&&rect.y>=-1&&rect.x+rect.width<=size.width+1&&rect.y+rect.height<=size.height+1,"RESPONSIVE_LAST_MENU_ACTION_REACHABLE");
     await page.keyboard.press("Escape");
     await poll(async()=>await toggle.getAttribute("aria-expanded")==="false","RESPONSIVE_MENU_ESCAPE");
     check(await toggle.evaluate(el=>document.activeElement===el),"RESPONSIVE_MENU_FOCUS");
     await fitViewport(page,"RESPONSIVE_SMALL_SCREEN_OVERFLOW");
    });
   }
  }
  if(failures===beforeMenus)log("RESPONSIVE_SMALL_AND_LANDSCAPE_MENU");
 }finally{await close()}
 return failures;
}
async function openExisting(page){
 await page.getByRole("heading",{name:"Моё в Клубе",exact:true}).waitFor({state:"visible"});
 const resume=page.getByTestId("club-workspace-resume-one");
 const work=page.getByTestId("club-native-project-overview");
 await poll(async()=>await work.isVisible()||await resume.isVisible(),"WORKSPACE_AVAILABLE");
 if(await resume.isVisible())await resume.click();
 await work.waitFor({state:"visible"});
}
async function readProfile(page,stage,expectedWorkspace){
 phase=stage+"_NAVIGATE";
 await visit(page,"/workspace/");
 phase=stage+"_OPEN_WORKSPACE";
 await openExisting(page);
 phase=stage+"_INVENTORY";
 const progress=page.getByTestId("club-workspace-progress");
 await poll(async()=>await progress.count()===1&&(await progress.textContent({timeout:1000}))?.trim()==="Сохранённых записей: 1","KERNEL_OBJECT_COUNT");
 log(stage+"_INVENTORY");
 if(expectedWorkspace){
  phase=stage+"_WORKSPACE_SCOPE_DISCLOSURE";
  const scope=page.getByTestId("club-workspace-data-actions");
  await scope.waitFor({state:"visible"});
  if(!await scope.evaluate(e=>e.open))await scope.locator(":scope > summary").click();
  await poll(async()=>await scope.evaluate(e=>e.open),"WORKSPACE_SCOPE_DISCLOSURE_OPEN");
  phase=stage+"_WORKSPACE_SCOPE_VALUE";
  // The visible combobox is nested in a native label containing option
  // text. Do not rely on an exact accessible-name match for that label.
  const select=scope.getByRole("combobox");
  await select.waitFor({state:"visible"});
  check(await select.count()===1,"WORKSPACE_SCOPE_SINGLE_SELECT");
  check(await select.inputValue()===expectedWorkspace,"SAME_RECEIPT_WORKSPACE");
  log(stage+"_SAME_RECEIPT_WORKSPACE");
 }
 phase=stage+"_DISCLOSURE";
 const all=page.getByTestId("club-workspace-all-families");
 // A native disclosure may be closed. Assert that the summary click
 // genuinely opened it before looking for its contained Result.
 await all.waitFor({state:"visible"});
 if(!await all.evaluate(e=>e.open))await all.locator(":scope > summary").click();
 await poll(async()=>await all.evaluate(e=>e.open),"PROFILE_DISCLOSURE_OPEN");
 const family=page.getByTestId("club-family-participation-profile");
 const latest=page.getByTestId("club-family-latest-participation-profile");
 phase=stage+"_PROFILE_PREVIEW";
 await latest.waitFor({state:"visible"});
 check((await latest.getAttribute("aria-label"))?.includes(alias),"KERNEL_ALIAS_PREVIEW");
 log(stage+"_PROFILE_PREVIEW");
 phase=stage+"_SELECT_RESULT";
 await family.getByRole("button",{name:"Просмотреть",exact:true}).click();
 const selected=page.getByTestId("club-workspace-selected-detail");
 await selected.waitFor({state:"visible"});
 phase=stage+"_RESULT_DETAIL_VALUES";
 const detail=selected.getByTestId("club-result-detail");
 await detail.waitFor({state:"visible"});
 check((await detail.textContent())?.includes(alias),"KERNEL_DETAIL_ALIAS");
 check((await detail.textContent())?.includes(goals),"KERNEL_DETAIL_GOALS");
 log(stage+"_RESULT_DETAIL_VALUES");
 const editor=page.getByTestId("club-profile-native-editor");
 phase=stage+"_OPEN_EDITOR";
 await editor.getByRole("button",{name:"Редактировать профиль здесь",exact:true}).click();
 const card=page.getByTestId("club-profile-host-card");
 await card.waitFor({state:"visible"});
 phase=stage+"_EDITOR_LOAD";
 await poll(async()=>{
  const state=await card.getAttribute("data-profile-load-state");
  check(state!=="error","KERNEL_NATIVE_EDITOR_LOAD_ERROR");
  return state==="ready";
 },"KERNEL_NATIVE_EDITOR_READY");
 check((await card.getByTestId("club-profile-load-message").textContent())?.includes("Сохранённый профиль загружен"),"KERNEL_NATIVE_EDITOR_LOADED_EXISTING");
 phase=stage+"_EDITOR_READBACK";
 const a=card.locator('form input[name="alias"]'),g=card.locator('form textarea[name="goals"]');
 check(await a.count()===1&&await g.count()===1,"KERNEL_NATIVE_EDITOR_FIELDS");
 check(await a.inputValue()===alias,"KERNEL_NATIVE_EDITOR_ALIAS");
 check(await g.inputValue()===goals,"KERNEL_NATIVE_EDITOR_GOALS");
 log(stage+"_EDITOR_VALUES");
 phase=stage+"_EDITOR_ACCESSIBILITY";
 check(await card.getByLabel("Как к вам обращаться",{exact:true}).count()===1,"KERNEL_NATIVE_ALIAS_LABEL");
 check(await card.getByLabel("Цели",{exact:true}).count()===1,"KERNEL_NATIVE_GOALS_LABEL");
 log(stage+"_EDITOR_ACCESSIBILITY");
}
async function stopServer(){
 if(server&&server.exitCode===null&&server.signalCode===null){
  const exited=new Promise(r=>server.once("exit",r));
  server.kill("SIGTERM");await exited;
 }
 server=null;
}
try{
 server=spawn(process.execPath,[join(site,"scripts/serve-current-static.mjs"),dist,"--t3-loopback"],
  {cwd:site,env:{...process.env,PORT:String(port)},stdio:"ignore"});
 await poll(async()=>{
  try{const r=await fetch(origin+"/t3-offline-manifest.json");
   if(!r.ok)return false;
   const m=await r.json();return m.domain_origin===origin&&m.complete_static_tree===true;
  }catch{return false;}
 },"ORIGINAL_PREVIEW_READY");
 const responsiveFailures=await auditResponsive();
 phase="FIRST_USE_PHONE_LAUNCH";
 let page=await launch("source",phone);
 await visit(page,"/workspace/");
 phase="FIRST_USE_CREATE";
 await page.getByTestId("club-create-personal-space").click();
 phase="FIRST_USE_FOCUS";
 await page.getByTestId("club-native-project-overview").waitFor({state:"visible"});
 log("ORIGINAL_PERSONAL_WORKSPACE_CREATED");
 phase="FIRST_USE_PROFILE_ENTRY";
 // The original Club intentionally presents the first task in its
 // empty-workspace section. The regular shortcut appears only after
 // a completed Result exists; use the actual visible entry in either case.
 const firstProfile=page.getByTestId("club-empty-tasks").getByRole("link",{name:"Мой профиль",exact:true});
 const regularProfile=page.getByTestId("club-workspace-profile-shortcut");
 await poll(async()=>await firstProfile.isVisible()||await regularProfile.isVisible(),"PROFILE_TASK_AVAILABLE");
 if(await firstProfile.isVisible())await firstProfile.click();
 else await regularProfile.click();
 const form=page.locator("form[data-profile-form]");
 await form.waitFor({state:"visible"});
 await fitViewport(page,"PHONE_PROFILE_FORM_OVERFLOW");
 phase="ASSISTANT_NATIVE_FORM";
 check(await form.locator('[name="alias"]').inputValue()==="","FRESH_PROFILE");
 const shortcut=form.locator('button[data-iwxa-assistant-form-open]');
 await shortcut.click();
 const at=id=>page.locator("#iwxa-t3-assistant").locator("#"+id);
 await poll(async()=>await at("form-choice").locator("option:checked").textContent().then(t=>t?.startsWith("Личный профиль ·")),"PROFILE_CONTEXT_SELECTED");
 await at("prompt").fill("Называйте меня «"+alias+"».");
 await at("explicit-values").click();
 await poll(async()=>await at("preview").locator("li").count()>0,"EXPLICIT_PREVIEW");
 check(await form.locator('[name="alias"]').inputValue()==="","PREVIEW_NOT_WRITTEN");
 await at("apply").click();
 check(await form.locator('[name="alias"]').inputValue()===alias,"ASSISTANT_NATIVE_ALIAS");
 const saved=()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem("ru.iwxa.club.session.v1")||"null")?.objects?.filter(o=>o.objectType==="participation-profile"&&o.status==="completed").length||0);
 check(await saved()===0,"NO_AUTO_RESULT");
 await at("close").click();
 check(await shortcut.evaluate(b=>document.activeElement===b),"FOCUS_RETURN");
 await form.locator('[name="goals"]').fill(goals);
 await form.getByRole("button",{name:"Сохранить профиль",exact:true}).click();
 await poll(async()=>await saved()===1,"EXPLICIT_SITE_SAVE");
 phase="SITE_SAVED_VALUES";
 const savedValues=await page.evaluate(({alias,goals})=>{
  const data=JSON.parse(sessionStorage.getItem("ru.iwxa.club.session.v1")||"null")?.objects?.find(o=>o.objectType==="participation-profile"&&o.status==="completed")?.data;
  return {alias:data?.alias===alias,goals:data?.goals===goals};
 },{alias,goals});
 check(savedValues.alias&&savedValues.goals,"SITE_PROFILE_VALUES");
 log("SITE_SAVED_PROFILE_VALUES");
 phase="KERNEL_RECEIPT";
 await page.getByRole("link",{name:"Открыть подтверждение сохранения результата на этом устройстве",exact:true}).click();
 await page.getByLabel("Подтверждаю сохранение выбранных результатов на этом устройстве.",{exact:true}).check();
 await page.getByRole("button",{name:"Сохранить выбранное",exact:true}).click();
 await page.getByText(/^Профиль участия: Сохранено/).waitFor({state:"visible"});
 const savedWitness=page.getByTestId("club-t0-import-created-result");
 await savedWitness.waitFor({state:"visible"});
 const savedScope=await savedWitness.getAttribute("data-t2-workspace-id");
 check(!!savedScope&&(await savedWitness.getAttribute("data-t2-schema-id"))==="ru.iwxa.club.participation-profile"&&Number(await savedWitness.getAttribute("data-t2-revision"))>0&&!!(await savedWitness.getAttribute("data-t2-kernel-event-id")),"ORIGINAL_KERNEL_WITNESS");
 await fitViewport(page,"PHONE_PROFILE_RECEIPT_OVERFLOW");
 log("PHONE_PROFILE_ASSISTANT_AND_ORIGINAL_KERNEL_RECEIPT");
 log("ASSISTANT_TO_ORIGINAL_KERNEL_RECEIPT");
 // Separate immediate and cold readback. Both use the original visible
 // inventory and profile editor, not the transient form/session.
 await readProfile(page,"SOURCE_IMMEDIATE_READBACK",savedScope);
 log("SOURCE_IMMEDIATE_KERNEL_READBACK");
 phase="SOURCE_COLD_READBACK";
 await close();page=await launch("source",phone);
 await readProfile(page,"SOURCE_COLD_READBACK",savedScope);
 log("SOURCE_COLD_KERNEL_READBACK");
 phase="EXPORT";
 await visit(page,"/workspace/exchange/#/home");
 await page.getByTestId("packages-tab-export").click();
 const exp=page.getByTestId("export-view");
 const workboxes=exp.locator("fieldset").filter({has:page.getByText("Рабочие области",{exact:true})}).locator('input[type="checkbox"]');
 await poll(async()=>await workboxes.count()===1,"EXPORT_WORKSPACE_COUNT");
 if(!await workboxes.first().isChecked())await workboxes.first().check();
 await page.getByTestId("export-preview").click();
 const preview=page.getByTestId("export-preview-result");
 await preview.waitFor({state:"visible"});
 check(Number(await preview.getByText("Объектов",{exact:true}).locator("xpath=following-sibling::dd[1]").textContent())>=1,"EXPORT_OBJECTS");
 await page.getByTestId("export-ack-sensitive").check();
 await page.getByTestId("export-package").click();
 const downloading=page.waitForEvent("download",{timeout:60000});
 await page.getByTestId("export-download").click();
 const download=await downloading;
 check(download.suggestedFilename().endsWith(".iwxa"),"ORIGINAL_IWXA_FILENAME");
 await download.saveAs(archive);
 check((await stat(archive)).size>0,"PHYSICAL_ARCHIVE");
 await page.getByTestId("export-confirm-saved-file").check();
 await page.getByTestId("export-confirm").click();
 await page.getByTestId("export-receipt").waitFor({state:"visible"});
 await fitViewport(page,"PHONE_EXCHANGE_EXPORT_OVERFLOW");
 log("PHONE_PHYSICAL_IWXA_EXPORT");
 log("ORIGINAL_IWXA_PHYSICAL_EXPORT");
 await close();
 phase="INDEPENDENT_IMPORT";
 page=await launch("recipient");
 await visit(page,"/workspace/");
 await page.getByTestId("club-create-personal-space").waitFor({state:"visible"});
 check(!await page.getByTestId("club-native-project-overview").isVisible(),"RECIPIENT_STARTS_EMPTY");
 await visit(page,"/workspace/exchange/#/home");
 await page.getByTestId("packages-tab-import").click();
 const file=page.getByTestId("import-file");
 await poll(async()=>await file.isEnabled(),"IMPORT_FILE_ENABLED");
 await file.setInputFiles(archive);
 await page.getByTestId("import-preview").waitFor({state:"visible"});
 const commit=page.getByTestId("import-commit");
 await poll(async()=>await commit.isEnabled(),"IMPORT_PLAN_READY");
 check((await commit.textContent())?.includes("(1)"),"IMPORT_ONE_WORKSPACE");
 await commit.click();
 const receipt=page.getByTestId("import-receipt");
 await receipt.waitFor({state:"visible"});
 check(await page.getByTestId("import-view").getAttribute("data-import-state")==="committed","IMPORT_COMMITTED");
 check(Number(await receipt.getByText("Объектов создано",{exact:true}).locator("xpath=following-sibling::dd[1]").textContent())>=1,"IMPORT_RECEIPT_COUNT");
 log("ORIGINAL_IWXA_INDEPENDENT_COMMIT");
 phase="RECIPIENT_COLD_READBACK";
 await close();page=await launch("recipient");
 await readProfile(page,"RECIPIENT_COLD_READBACK");
 log("RECIPIENT_COLD_KERNEL_READBACK");
 phase="OFFLINE_INSTALL";
 const toggle=page.locator("#iwxa-t3-domain-switch");
 const details=page.locator("details").filter({has:page.locator("summary").filter({hasText:"T3: автономный режим"})}).first();
 if(!await toggle.isVisible())await details.locator("summary").first().click();
 let consent=false;
 page.once("dialog",async d=>{consent=d.type()==="confirm";await d.accept();});
 await toggle.check();
 await poll(async()=>{
  try{return await page.evaluate(()=>document.documentElement.hasAttribute("data-iwxa-t3-autonomous")&&Boolean(navigator.serviceWorker.controller));}catch{return false;}
 },"ORIGINAL_OFFLINE_CONTROLLER",180000);
 check(consent,"OFFLINE_EXPLICIT_CONSENT");
 log("ORIGINAL_OFFLINE_INSTALL");
 phase="COLD_SERVER_STOPPED";
 await close();await stopServer();
 let reachable=false;
 try{await fetch(origin+"/workspace/",{signal:AbortSignal.timeout(2000)});reachable=true;}catch{}
 check(!reachable,"SERVER_STOPPED");
 page=await launch("recipient");
 await context.setOffline(true);
 await readProfile(page,"RECIPIENT_COLD_OFFLINE_READBACK");
 check(await page.evaluate(()=>navigator.onLine===false&&document.documentElement.hasAttribute("data-iwxa-t3-autonomous")),"OFFLINE_MODE");
 phase="OFFLINE_CONTINUE_PROFILE_CLICK";
 const continueProfile=page.getByTestId("club-workspace-profile-resume");
 await continueProfile.waitFor({state:"visible"});
 check(!await page.getByTestId("club-workspace-profile-shortcut").isVisible(),"NO_BLANK_PROFILE_SHORTCUT");
 await continueProfile.click();
 phase="OFFLINE_RESTORE_CARD_VISIBLE";
 const restore=page.getByTestId("club-t2-restore-card");
 await restore.waitFor({state:"visible"});
 phase="OFFLINE_RESTORE_PRESELECT";
 const profileChoice=restore.getByRole("checkbox",{name:"Профиль участия",exact:true});
 await poll(async()=>await profileChoice.count()===1&&await profileChoice.isChecked(),"EXACT_PROFILE_PRESELECTED");
 check(await restore.locator('input[type="checkbox"]:checked').count()===1,"NO_UNRELATED_RESULTS_PRESELECTED");
 log("RECIPIENT_OFFLINE_EXACT_PROFILE_PRESELECTED");
 phase="OFFLINE_RESTORE_READY";
 const restoreButton=restore.getByRole("button",{name:"Открыть выбранные записи",exact:true});
 await poll(async()=>await restoreButton.isEnabled(),"PROFILE_RESTORE_READY");
 phase="OFFLINE_RESTORE_CONFIRM";
 // The original restore bridge asks for a SECOND human confirmation before
 // any tab-session write. Playwright otherwise automatically dismisses it.
 let restoreConsent=false;
 page.once("dialog",async d=>{
  restoreConsent=d.type()==="confirm"&&d.message().includes("Загрузить 1 новых");
  if(restoreConsent)await d.accept();else await d.dismiss();
 });
 await restoreButton.click();
 await poll(async()=>restoreConsent,"ORIGINAL_RESTORE_EXPLICIT_CONSENT");
 log("RECIPIENT_OFFLINE_RESTORE_CONSENT");
 phase="OFFLINE_RESTORE_COMPLETED";
 const completed=page.getByTestId("club-t2-restore-completed");
 await completed.waitFor({state:"visible"});
 log("RECIPIENT_OFFLINE_ORIGINAL_RESTORE_COMPLETED");
 phase="OFFLINE_RESTORE_OPEN_FORM";
 await completed.getByRole("link",{name:"Открыть мой профиль",exact:true}).click();
 const restoredForm=page.locator("form[data-profile-form]");
 await restoredForm.waitFor({state:"visible"});
 phase="OFFLINE_RESTORED_FORM_VALUES";
 check(await restoredForm.locator('[name="alias"]').inputValue()===alias,"RESTORED_SITE_PROFILE_ALIAS");
 check(await restoredForm.locator('[name="goals"]').inputValue()===goals,"RESTORED_SITE_PROFILE_GOALS");
 log("RECIPIENT_OFFLINE_PROFILE_CONTINUED_IN_ORIGINAL_FORM");
 phase="OFFLINE_CONTEXT_ASSISTANT";
 await restoredForm.locator('button[data-iwxa-assistant-form-open]').click();
 await poll(async()=>await page.locator("#iwxa-t3-assistant").locator("#form-choice").locator("option:checked").textContent().then(t=>t?.startsWith("Личный профиль ·")),"OFFLINE_CONTEXT_ASSISTANT");
 check(await restoredForm.locator('[name="alias"]').inputValue()===alias&&await restoredForm.locator('[name="goals"]').inputValue()===goals,"OFFLINE_ASSISTANT_OPEN_PRESERVES_RESTORED_VALUES");
 log("RECIPIENT_COLD_OFFLINE_KERNEL_AND_ASSISTANT");

 // Continue on the original offline form. A real user may edit a verified
 // imported Result instead of creating a duplicate or another workspace.
 // Read the tab's existing Kernel binding solely as a receipt witness.
 phase="OFFLINE_UPDATE_BASE_BINDING";
 const localProfile=()=>page.evaluate(()=>{
  const rows=JSON.parse(sessionStorage.getItem("ru.iwxa.club.session.v1")||"null")?.objects?.filter(o=>o.objectType==="participation-profile"&&o.status==="completed")||[];
  if(rows.length!==1)return null;
  const o=rows[0];
  return {id:o.objectId,alias:o.data?.alias,goals:o.data?.goals,
   revision:o.kernelSource?.revision,scope:o.kernelSource?.workspaceId,
   synced:o.kernelSource?.syncedUpdatedAt===o.updatedAt};
 });
 const base=await localProfile();
 check(!!base?.scope&&!!base.id&&Number.isSafeInteger(base.revision)&&base.revision>0&&base.synced&&base.alias===alias&&base.goals===goals,"OFFLINE_IMPORTED_BINDING");
 phase="OFFLINE_UPDATE_ASSISTANT_PREVIEW";
 const newAlias="Мастер по соседству";
 await at("prompt").fill("Называйте меня «"+newAlias+"».");
 await at("explicit-values").click();
 await poll(async()=>await at("preview").locator("li").count()>0,"OFFLINE_UPDATE_PREVIEW");
 check(await restoredForm.locator('[name="alias"]').inputValue()===alias,"OFFLINE_UPDATE_NO_PREMATURE_FORM_WRITE");
 check((await localProfile())?.revision===base.revision&&(await localProfile())?.alias===alias,"OFFLINE_UPDATE_NO_PREMATURE_STORE_WRITE");
 phase="OFFLINE_UPDATE_REPLACEMENT_REVIEW";
 const replacement=at("preview").locator("li").filter({has:page.getByRole("checkbox",{name:"Заменить: Как к вам обращаться",exact:true})});
 check(await replacement.count()===1,"OFFLINE_UPDATE_ONE_REPLACEMENT");
 const selection=replacement.getByRole("checkbox",{name:"Заменить: Как к вам обращаться",exact:true});
 check(!await selection.isChecked(),"OFFLINE_UPDATE_REPLACEMENT_REQUIRES_CHOICE");
 check(await replacement.locator("[data-assistant-previous-value]").textContent()===alias,"OFFLINE_UPDATE_REVIEW_OLD_VALUE");
 check(await replacement.getByRole("textbox",{name:"Как к вам обращаться",exact:true}).inputValue()===newAlias,"OFFLINE_UPDATE_REVIEW_NEW_VALUE");
 await at("apply").click();
 check(await replacement.count()===1&&await restoredForm.locator('[name="alias"]').inputValue()===alias,"OFFLINE_UPDATE_UNSELECTED_PRESERVED");
 await selection.check();
 check((await at("proposal-summary").textContent())?.includes("Выбрано 1 из 1"),"OFFLINE_UPDATE_SELECTION_SUMMARY");
 log("RECIPIENT_OFFLINE_REPLACEMENT_EXPLICITLY_SELECTED");
 phase="OFFLINE_UPDATE_ASSISTANT_APPLY";
 await at("apply").click();
 check(await restoredForm.locator('[name="alias"]').inputValue()===newAlias,"OFFLINE_UPDATE_APPLIED_ALIAS");
 check(await restoredForm.locator('[name="goals"]').inputValue()===goals,"OFFLINE_UPDATE_OTHER_VALUES_PRESERVED");
 check((await localProfile())?.alias===alias,"OFFLINE_ASSISTANT_APPLY_NOT_SAVE");
 await at("close").click();
 phase="OFFLINE_UPDATE_NATIVE_FORM_SAVE";
 await restoredForm.getByRole("button",{name:"Сохранить профиль",exact:true}).click();
 await poll(async()=>{
  const row=await localProfile();
  return row?.id===base.id&&row?.scope===base.scope&&row?.revision===base.revision&&row?.alias===newAlias&&row?.goals===goals&&!row.synced;
 },"OFFLINE_UPDATE_LOCAL_DIRTY_SAME_BINDING");
 phase="OFFLINE_UPDATE_KERNEL_CONFIRM";
 await page.getByRole("link",{name:"Открыть подтверждение сохранения результата на этом устройстве",exact:true}).click();
 const importCard=page.getByTestId("club-t0-import-card");
 await importCard.getByLabel("Подтверждаю сохранение изменений. При конфликте прежняя запись останется без изменений.",{exact:true}).check();
 const updateButton=importCard.getByRole("button",{name:"Сохранить изменения",exact:true});
 await poll(async()=>await updateButton.isEnabled(),"OFFLINE_UPDATE_KERNEL_READY");
 await updateButton.click();
 phase="OFFLINE_UPDATE_RECEIPT";
 await poll(async()=>{
  const row=await localProfile();
  return row?.id===base.id&&row?.scope===base.scope&&row?.revision===base.revision+1&&row?.alias===newAlias&&row?.goals===goals&&row.synced;
 },"OFFLINE_UPDATE_EXACT_NEXT_REVISION");
 log("RECIPIENT_OFFLINE_SAME_PROFILE_NEXT_REVISION_RECEIPT");
 alias=newAlias;
 await readProfile(page,"RECIPIENT_OFFLINE_UPDATED_IMMEDIATE",base.scope);
 log("RECIPIENT_OFFLINE_UPDATED_KERNEL_READBACK");
 phase="OFFLINE_UPDATED_COLD";
 await close();page=await launch("recipient");await context.setOffline(true);
 await readProfile(page,"RECIPIENT_OFFLINE_UPDATED_COLD",base.scope);
 check(await page.evaluate(()=>navigator.onLine===false),"OFFLINE_UPDATED_COLD_MODE");
 log("RECIPIENT_OFFLINE_UPDATED_COLD_KERNEL_READBACK");

 // Actual dated commitments in the original weekly Result. Extend the
 // already verified offline recipient profile, with no direct Store writes.
 await page.setViewportSize(phone);
 phase="OFFLINE_GOAL_CREATE";
 const goalTitle="Купить инструменты для ремонта";
 const goalStep="Проверить документы сегодня";
 const localGoal=()=>page.evaluate(()=>{
  const rows=JSON.parse(sessionStorage.getItem("ru.iwxa.club.session.v1")||"null")?.objects?.filter(o=>o.objectType==="project-draft"&&o.objectId.startsWith("goal-"))||[];
  return rows.length===1?rows[0]:null;
 });
 await visit(page,"/projects/?workspace_id="+encodeURIComponent(base.scope)+"#club-goal-map");
 const goalForm=page.locator("[data-club-goal-form]");
 await goalForm.waitFor({state:"visible"});
 await fitViewport(page,"PHONE_GOAL_FORM_OVERFLOW");
 for(const [key,value] of Object.entries({title:goalTitle,outcome:"Есть набор для начала практики",nextStep:goalStep,successCriteria:"Проверена комплектность и пригодность набора"}))
  await goalForm.locator('[name="'+key+'"]').fill(value);
 await goalForm.locator("[data-club-goal-save]").click();
 await poll(async()=> (await localGoal())?.data?.title===goalTitle,"GOAL_CREATED_IN_ORIGINAL_EDITOR");
 const goalId=(await localGoal()).objectId;
 await page.locator("[data-club-goal-list]").getByRole("link",{name:"Сохранить в IWXA",exact:true}).click();
 const goalImport=page.getByTestId("club-t0-import-card");
 await goalImport.getByTestId("club-t0-import-preview").waitFor({state:"visible"});
 const goalScope=goalImport.getByTestId("club-t0-import-workspace-choice").filter({visible:true});
 await poll(async()=>await goalScope.count()===1,"GOAL_SCOPE_AVAILABLE");
 check(await goalScope.getAttribute("data-workspace-id")===base.scope,"GOAL_ORIGINAL_SCOPE");
 if(await goalScope.getAttribute("aria-pressed")!=="true")await goalScope.click();
 await poll(async()=>await goalScope.getAttribute("aria-pressed")==="true","GOAL_SCOPE_FOCUSED");
 const goalSaveConsentControl=goalImport.getByTestId("club-t0-import-consent");
 const goalSaveReadinessPanel=goalImport.getByTestId("club-t0-import-preview");
 const goalSave=goalImport.getByRole("button",{name:"Сохранить выбранное",exact:true});
 await poll(async()=>await goalSaveReadinessPanel.getAttribute("data-club-save-readiness")==="READY"&&await goalSaveConsentControl.isEnabled(),"GOAL_INSPECTION_BEFORE_CONSENT");
 check(!await goalSaveConsentControl.isChecked()&&!await goalSave.isEnabled(),"GOAL_EXPLICIT_CONSENT_REQUIRED");
 await goalSaveConsentControl.check();
 await poll(async()=>await goalSaveConsentControl.isChecked()&&await goalSave.isEnabled(),"GOAL_KERNEL_READY");
 log("OFFLINE_GOAL_INSPECTED_EXPLICIT_CONFIRMATION");
 await goalSave.click();
 await poll(async()=>{
  const g=await localGoal();return g?.kernelSource?.workspaceId===base.scope&&g.kernelSource.revision>0&&g.kernelSource.syncedUpdatedAt===g.updatedAt;
 },"GOAL_KERNEL_RECEIPT");
 await fitViewport(page,"PHONE_GOAL_RECEIPT_OVERFLOW");
 log("PHONE_OFFLINE_GOAL_CREATED_AND_SAVED");
 log("OFFLINE_GOAL_ORIGINAL_KERNEL_RECEIPT");
 phase="OFFLINE_AGENDA_CREATE";
 await visit(page,"/projects/?workspace_id="+encodeURIComponent(base.scope)+"&club_goal="+encodeURIComponent(goalId)+"#club-goal-map");
 await page.locator("[data-club-goal-list]").getByRole("link",{name:"Запланировать шаг",exact:true}).click();
 const weekForm=page.locator("form[data-club-week-form]");
 const weekSummary=page.locator("[data-club-week-summary]");
 await weekForm.waitFor({state:"visible"});
 await fitViewport(page,"PHONE_WEEK_FORM_OVERFLOW");
 await poll(async()=>await weekForm.locator('[name="title"]').inputValue()===goalStep,"GOAL_STEP_PREFILLED");
 check(await weekForm.locator('[name="projectId"]').inputValue()===goalId,"GOAL_EXACT_WEEK_LINK");
 check(!(await page.evaluate(()=>JSON.parse(sessionStorage.getItem("ru.iwxa.club.session.v1")||"null")?.objects?.some(o=>o.objectId==="club-week-plan"))),"GOAL_PREFILL_NO_WRITE");
 const dates=await page.evaluate(()=>{
  const now=new Date(),local=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
  const past=new Date(now),future=new Date(now);past.setDate(past.getDate()-10);future.setDate(future.getDate()+2);
  return {today:local(now),past:local(past),future:local(future),weekday:(now.getDay()+6)%7};
 });
 const titles=["Проверить документы сегодня","Забрать заказ прошлой недели","Уточнить время встречи"];
 const localWeek=()=>page.evaluate(()=>{
  const rows=JSON.parse(sessionStorage.getItem("ru.iwxa.club.session.v1")||"null")?.objects?.filter(o=>o.objectId==="club-week-plan")||[];
  return rows.length===1?rows[0]:null;
 });
 for(const [i,date] of [dates.today,dates.past,dates.future].entries()){
  await weekForm.locator('[name="title"]').fill(titles[i]);
  await weekForm.locator('[name="date"]').fill(date);
  await weekForm.locator('[name="start"]').fill("10:00");
  await weekForm.locator('[name="durationMinutes"]').fill(i===0?"90":"30");
  await weekForm.locator('[name="projectId"]').selectOption(i===0?goalId:"");
  if(i===0){
   phase="OFFLINE_WEEK_CHANGE_PREVIEW_CREATE";
   const before=await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"));
   const preview=weekForm.locator("[data-club-week-change-preview]");
   const checkButton=weekForm.locator("[data-club-week-check-change]");
   await checkButton.click();
   await poll(async()=>await preview.getAttribute("data-iwxa-assistant-state")==="ready","PREVIEW_CREATE_READY");
   check((await preview.textContent()).includes("0 мин. / 90 мин."),"PREVIEW_CREATE_EXACT_DEMAND");
   check((await preview.textContent()).includes("Журнал не открыт"),"PREVIEW_CREATE_MISSING_JOURNAL_DISCLOSED");
   await weekForm.locator('[name="durationMinutes"]').fill("120");
   await poll(async()=>await preview.getAttribute("data-iwxa-assistant-state")==="empty","PREVIEW_EDIT_INVALIDATES");
   await checkButton.click();
   await poll(async()=>await preview.getAttribute("data-iwxa-assistant-state")==="ready","PREVIEW_SECOND_VARIANT_READY");
   check((await preview.textContent()).includes("0 мин. / 120 мин."),"PREVIEW_SECOND_VARIANT_EXACT");
   check(await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"))===before&&!(await localWeek()),"PREVIEW_CREATE_NO_WRITE");
   await weekForm.locator('[name="durationMinutes"]').fill("90");
   log("OFFLINE_WEEK_CREATE_TWO_VARIANTS_NO_WRITE");
   phase="OFFLINE_AGENDA_CREATE";
  }
  await weekForm.locator("[data-club-week-save]").click();
  await poll(async()=> (await localWeek())?.data?.personalWeekPlan?.slots?.length===i+1,"AGENDA_CREATE_SLOT");
 }
 const cap=page.locator("details").filter({has:page.locator("summary").filter({hasText:"Сколько времени я могу занять делами"})});
 await cap.locator("summary").click();
 await cap.locator('[data-club-day-capacity="'+dates.weekday+'"]').fill("1");
 await cap.locator("[data-club-capacity-save]").click();
 await poll(async()=> (await localWeek())?.data?.personalWeekPlan?.dailyCapacityMinutes?.[dates.weekday]===60,"AGENDA_CAPACITY");
 const weekBefore=await localWeek();
 check(weekBefore.data.personalWeekPlan.slots.length===3,"AGENDA_THREE_SLOTS");
 check(weekBefore.data.personalWeekPlan.slots[0].projectId===goalId&&weekBefore.data.personalWeekPlan.slots.slice(1).every(s=>!s.projectId),"AGENDA_EXPLICIT_GOAL_LINK_ONLY");
 log("OFFLINE_AGENDA_ORIGINAL_FORM_CREATED");
 phase="OFFLINE_AGENDA_HOME";
 await visit(page,"/");
 const homeAgenda=page.locator("[data-club-today-actions]");
 await homeAgenda.getByText(titles[1],{exact:true}).waitFor({state:"visible"});
 check((await homeAgenda.textContent()).includes(titles[0])&&(await homeAgenda.textContent()).includes(titles[2]),"HOME_AGENDA_THREE_GROUPS");
 const oldSlot=weekBefore.data.personalWeekPlan.slots.find(s=>s.title===titles[1]);
 const oldCard=homeAgenda.locator("article").filter({has:page.getByText(titles[1],{exact:true})});
 await oldCard.getByRole("link",{name:"Открыть дело",exact:true}).click();
 await poll(async()=>await weekForm.locator('[name="title"]').inputValue()===titles[1],"HOME_AGENDA_EXACT_SLOT");
 check(await weekForm.locator('[name="date"]').inputValue()===dates.past,"HOME_AGENDA_EXACT_DATE");
 check((await localWeek()).updatedAt===weekBefore.updatedAt,"AGENDA_OPEN_NO_WRITE");
 check(new URL(page.url()).searchParams.get("club_week_slot")===oldSlot.id,"HOME_AGENDA_EXACT_ID");
 log("OFFLINE_AGENDA_HOME_EXACT_OVERDUE_EDITOR");
 phase="OFFLINE_WEEK_CHANGE_PREVIEW_MOVE";
 const movedPreview=weekForm.locator("[data-club-week-change-preview]");
 const beforeMove=await localWeek();
 await weekForm.locator('[name="date"]').fill(dates.future);
 await weekForm.locator("[data-club-week-check-change]").click();
 await poll(async()=>await movedPreview.getAttribute("data-iwxa-assistant-state")==="ready","PREVIEW_MOVE_READY");
 const moveText=await movedPreview.textContent();
 check(moveText.includes(dates.past+" (исходная дата)")&&moveText.includes(dates.future+" (новая дата)"),"PREVIEW_MOVE_BOTH_EXACT_DATES");
 check(moveText.includes("30 мин. / 0 мин.")&&moveText.includes("30 мин. / 60 мин."),"PREVIEW_MOVE_REPLACES_ONE_TASK");
 check(moveText.includes("Известные пересечения этого дела: 1"),"PREVIEW_MOVE_KNOWN_CONFLICT");
 check(isDeepStrictEqual(await localWeek(),beforeMove),"PREVIEW_MOVE_NO_WRITE");
 await weekForm.locator('[name="date"]').fill(dates.past);
 log("OFFLINE_WEEK_MOVE_EXACT_CONFLICT_NO_WRITE");
 phase="OFFLINE_AGENDA_KERNEL_SAVE";
 await weekSummary.getByRole("link",{name:"Сохранить план в рабочей области",exact:true}).click();
 const weekImport=page.getByTestId("club-t0-import-card");
 phase="OFFLINE_AGENDA_KERNEL_PREVIEW";
 await weekImport.getByTestId("club-t0-import-preview").waitFor({state:"visible"});
 phase="OFFLINE_AGENDA_KERNEL_SCOPE";
 const choice=weekImport.getByTestId("club-t0-import-workspace-choice").filter({visible:true});
 await poll(async()=>await choice.count()===1,"AGENDA_SINGLE_PERSONAL_SCOPE");
 check(await choice.getAttribute("data-workspace-id")===base.scope,"AGENDA_ORIGINAL_SCOPE");
 // The previous visit to / was intentionally unscoped. Choosing the
 // original personal data is a human operation, not a default grant.
 if(await choice.getAttribute("aria-pressed")!=="true")await choice.click();
 await poll(async()=>await choice.getAttribute("aria-pressed")==="true","AGENDA_ORIGINAL_SCOPE_FOCUSED");
 phase="OFFLINE_AGENDA_KERNEL_INSPECTION";
 const rowChoice=weekImport.getByTestId("club-t0-import-object-checkbox");
 await poll(async()=>await rowChoice.count()===1&&await rowChoice.isEnabled()&&await rowChoice.isChecked(),"AGENDA_TARGET_NEW");
 phase="OFFLINE_AGENDA_KERNEL_CONSENT";
 await weekImport.getByLabel("Подтверждаю сохранение выбранных результатов на этом устройстве.",{exact:true}).check();
 const weekSave=weekImport.getByRole("button",{name:"Сохранить выбранное",exact:true});
 await poll(async()=>await weekSave.isEnabled(),"AGENDA_KERNEL_SAVE_READY",15000);
 phase="OFFLINE_AGENDA_KERNEL_COMMIT";
 await weekSave.click();
 await poll(async()=>{
  const w=await localWeek();return w?.kernelSource?.workspaceId===base.scope&&w.kernelSource.revision>0&&w.kernelSource.syncedUpdatedAt===w.updatedAt;
 },"AGENDA_KERNEL_RECEIPT");
 await fitViewport(page,"PHONE_WEEK_RECEIPT_OVERFLOW");
 log("PHONE_OFFLINE_WEEK_CREATED_AND_SAVED");
 log("OFFLINE_AGENDA_ORIGINAL_KERNEL_RECEIPT");
 phase="OFFLINE_AGENDA_COLD_READBACK";
 await close();page=await launch("recipient");await context.setOffline(true);
 await visit(page,"/workspace/");await openExisting(page);
 const nativeToday=page.getByTestId("club-native-today");
 await nativeToday.waitFor({state:"visible"});
 for(const title of titles)await nativeToday.getByText(title,{exact:true}).waitFor({state:"visible"});
 check((await nativeToday.textContent()).includes("Просроченные дела: 1"),"AGENDA_NATIVE_OVERDUE");
 check((await nativeToday.textContent()).includes("Сегодня: 1")&&(await nativeToday.textContent()).includes("Следующие 7 дней: 1"),"AGENDA_NATIVE_DATE_GROUPS");
 check((await nativeToday.textContent()).includes("Возможное превышение предела: 0,5 ч"),"AGENDA_NATIVE_CAPACITY");
 check(!(await localWeek()),"AGENDA_COLD_NO_TAB_RESULT");
 log("OFFLINE_AGENDA_COLD_NATIVE_READBACK");
 phase="OFFLINE_AGENDA_RESTORE_SELECTION";
 await nativeToday.getByRole("button",{name:"Открыть дело: "+titles[1],exact:true}).click();
 const weekRestore=page.getByTestId("club-t2-restore-card");
 await weekRestore.waitFor({state:"visible"});
 await poll(async()=>await weekRestore.locator('input[type="checkbox"]:checked').count()===1,"AGENDA_EXACT_RESTORE_CHOICE");
 const weekRestoreButton=weekRestore.getByRole("button",{name:"Открыть выбранные записи",exact:true});
 await poll(async()=>await weekRestoreButton.isEnabled(),"AGENDA_RESTORE_READY");
 phase="OFFLINE_AGENDA_RESTORE_CONSENT";
 let weekConsent=false;
 page.once("dialog",async d=>{
  weekConsent=d.type()==="confirm"&&d.message().includes("Загрузить 1 новых");
  if(weekConsent)await d.accept();else await d.dismiss();
 });
 await weekRestoreButton.click();
 await poll(async()=>weekConsent,"AGENDA_RESTORE_CONSENT");
 phase="OFFLINE_AGENDA_RESTORE_DESTINATION";
 const openSlot=page.getByTestId("club-t2-restore-completed").getByRole("link",{name:"Открыть выбранное дело",exact:true});
 await openSlot.waitFor({state:"visible"});
 const target=new URL(await openSlot.getAttribute("href"),page.url());
 check(target.searchParams.get("club_week_slot")===oldSlot.id,"AGENDA_RESTORE_EXACT_ID");
 check(target.searchParams.get("workspace_id")===base.scope,"AGENDA_RESTORE_EXACT_SCOPE");
 await openSlot.click();
 phase="OFFLINE_AGENDA_RESTORE_EDITOR";
 // A locator created before close() belongs to the closed browser page.
 const reopenedWeekForm=page.locator("form[data-club-week-form]");
 await reopenedWeekForm.waitFor({state:"visible"});
 const restoredWeek=await localWeek();
 check(restoredWeek?.kernelSource?.workspaceId===base.scope&&restoredWeek.data.personalWeekPlan.slots.length===3,"AGENDA_RESTORED_EXACT_RESULT");
 await poll(async()=>await reopenedWeekForm.locator('[name="title"]').inputValue()===titles[1],"AGENDA_RESTORED_EXACT_OVERDUE");
 check(await reopenedWeekForm.locator('[name="date"]').inputValue()===dates.past,"AGENDA_RESTORED_EXACT_DATE");
 check(await page.evaluate(()=>navigator.onLine===false),"AGENDA_OFFLINE_MODE");
 log("OFFLINE_AGENDA_RESTORED_AND_CONTINUED");
 phase="OFFLINE_AGENDA_SERIES_PREVIEW";
 await reopenedWeekForm.locator("[data-club-week-new]").click();
 await reopenedWeekForm.locator('[name="title"]').fill("Ежедневная проверка документов");
 await reopenedWeekForm.locator('[name="date"]').fill(dates.future);
 await reopenedWeekForm.locator('[name="start"]').fill("12:00");
 await reopenedWeekForm.locator('[name="durationMinutes"]').fill("30");
 await reopenedWeekForm.locator("details").filter({has:page.locator("summary").filter({hasText:"Повторяющееся дело"})}).locator("summary").click();
 await reopenedWeekForm.locator("[data-club-week-frequency]").selectOption("daily");
 await reopenedWeekForm.locator("[data-club-week-repeat-count]").fill("3");
 await reopenedWeekForm.locator("[data-club-week-save]").click();
 const seriesConfirm=reopenedWeekForm.locator("[data-club-week-series-confirm]");
 await poll(async()=>await seriesConfirm.isEnabled(),"AGENDA_SERIES_CONFIRM_READY");
 check((await localWeek()).data.personalWeekPlan.slots.length===3,"AGENDA_SERIES_PREVIEW_NO_WRITE");
 phase="OFFLINE_AGENDA_SERIES_CONFIRM";
 await seriesConfirm.click();
 await poll(async()=> (await localWeek())?.data?.personalWeekPlan?.slots?.length===6,"AGENDA_SERIES_ADDED");
 const repeated=(await localWeek()).data.personalWeekPlan.slots.filter(s=>s.title==="Ежедневная проверка документов");
 check(repeated.length===3&&new Set(repeated.map(s=>s.id)).size===3&&repeated.every(s=>s.durationMinutes===30),"AGENDA_SERIES_INDIVIDUAL_SLOTS");
 log("OFFLINE_AGENDA_SERIES_EXPLICIT_CONFIRMATION");
 phase="OFFLINE_AGENDA_SERIES_KERNEL_UPDATE";
 const beforeSeriesSave=await localWeek();
 const seriesBase=beforeSeriesSave.kernelSource?.revision;
 check(seriesBase>0&&beforeSeriesSave.kernelSource.syncedUpdatedAt!==beforeSeriesSave.updatedAt,"AGENDA_SERIES_EXISTING_BASE");
 await page.locator("[data-club-week-summary]").getByRole("link",{name:"Сохранить план в рабочей области",exact:true}).click();
 const seriesImport=page.getByTestId("club-t0-import-card");
 await seriesImport.getByTestId("club-t0-import-preview").waitFor({state:"visible"});
 const seriesScope=seriesImport.getByTestId("club-t0-import-workspace-choice").filter({visible:true});
 await poll(async()=>await seriesScope.count()===1,"AGENDA_SERIES_SCOPE_AVAILABLE");
 check(await seriesScope.getAttribute("data-workspace-id")===base.scope,"AGENDA_SERIES_ORIGINAL_SCOPE");
 if(await seriesScope.getAttribute("aria-pressed")!=="true")await seriesScope.click();
 await poll(async()=>await seriesScope.getAttribute("aria-pressed")==="true","AGENDA_SERIES_SCOPE_FOCUSED");
 const seriesChoice=seriesImport.getByTestId("club-t0-import-object-checkbox");
 await poll(async()=>await seriesChoice.count()===1&&await seriesChoice.isChecked(),"AGENDA_SERIES_TARGET_ONLY");
 await seriesImport.getByLabel("Подтверждаю сохранение изменений. При конфликте прежняя запись останется без изменений.",{exact:true}).check();
 const seriesSave=seriesImport.getByRole("button",{name:"Сохранить изменения",exact:true});
 await poll(async()=>await seriesSave.isEnabled(),"AGENDA_SERIES_SAVE_READY");
 await seriesSave.click();
 await poll(async()=>{
  const w=await localWeek();return w?.kernelSource?.workspaceId===base.scope&&w.kernelSource.revision===seriesBase+1&&
   w.kernelSource.syncedUpdatedAt===w.updatedAt&&w.data.personalWeekPlan.slots.length===6;
 },"AGENDA_SERIES_UPDATED_KERNEL_RECEIPT");
 log("OFFLINE_AGENDA_SERIES_PERSISTED");
 phase="OFFLINE_GOAL_REOPEN";
 await visit(page,"/workspace/");await openExisting(page);
 const goalsPanel=page.getByTestId("club-native-goals");
 await goalsPanel.getByRole("button",{name:"Открыть цель: "+goalTitle,exact:true}).click();
 const restoreGoal=page.getByTestId("club-t2-restore-card");
 await restoreGoal.waitFor({state:"visible"});
 await poll(async()=>await restoreGoal.locator('input[type="checkbox"]:checked').count()===1,"GOAL_RESTORE_EXACT");
 const openGoalButton=restoreGoal.getByRole("button",{name:"Открыть выбранные записи",exact:true});
 await poll(async()=>await openGoalButton.isEnabled(),"GOAL_RESTORE_READY");
 let goalConsent=false;
 page.once("dialog",async d=>{
  goalConsent=d.type()==="confirm"&&d.message().includes("Загрузить 1 новых");
  if(goalConsent)await d.accept();else await d.dismiss();
 });
 await openGoalButton.click();
 await poll(async()=>goalConsent,"GOAL_RESTORE_CONSENT");
 const openGoal=page.getByTestId("club-t2-restore-completed").getByRole("link",{name:"Открыть выбранную цель",exact:true});
 await openGoal.waitFor({state:"visible"});
 const goalUrl=new URL(await openGoal.getAttribute("href"),page.url());
 check(goalUrl.searchParams.get("club_goal")===goalId&&goalUrl.searchParams.get("workspace_id")===base.scope,"GOAL_EXACT_DESTINATION");
 await openGoal.click();
 await poll(async()=>await page.locator("[data-club-goal-form] [name=title]").inputValue()===goalTitle,"GOAL_EXACT_EDITOR");
 check((await localGoal()).objectId===goalId,"GOAL_RESTORE_SAME_RESULT");
 log("OFFLINE_GOAL_EXACT_COLD_REOPEN");
 phase="OFFLINE_GOAL_ASSESSMENT_CREATE";
 const localProof=()=>page.evaluate(()=>{
  const rows=JSON.parse(sessionStorage.getItem("ru.iwxa.club.session.v1")||"null")?.objects?.filter(o=>o.objectType==="project-draft"&&o.objectId.startsWith("proof-"))||[];
  return rows.length===1?rows[0]:null;
 });
 const goalRevision=(await localGoal()).updatedAt;
 const proofResult="Выбран набор инструментов, комплектность ещё не проверена";
 const proofBasis="Список инструментов и предложение продавца";
 const proofCheck="Сверить комплектность с перечнем работ";
 await page.locator("[data-club-goal-list]").getByRole("button",{name:"Оценить результат",exact:true}).click();
 const proofForm=page.locator("form[data-club-proof-form]");
 await proofForm.waitFor({state:"visible"});
 check(await proofForm.locator("[data-club-proof-source]").inputValue()===goalId,"ASSESSMENT_EXACT_SOURCE");
 check(await proofForm.locator('[name="goalAssessment"]').inputValue()===""&&await proofForm.locator('[name="basis"]').inputValue()==="","ASSESSMENT_NO_IMPLICIT_DECISION");
 check((await proofForm.locator("[data-club-proof-source-note]").textContent()).includes("Проверена комплектность"),"ASSESSMENT_ORIGINAL_CRITERION");
 check((await proofForm.locator("[data-club-proof-source-note]").textContent()).includes("Есть набор для начала практики"),"ASSESSMENT_ORIGINAL_EXPECTED_RESULT");
 check(!(await localProof()),"ASSESSMENT_OPEN_NO_WRITE");
 await proofForm.locator('[name="goalAssessment"]').selectOption("partial");
 for(const [key,value] of Object.entries({result:proofResult,basis:proofBasis,check:proofCheck}))
  await proofForm.locator('[name="'+key+'"]').fill(value);
 await proofForm.locator("[data-club-proof-save]").click();
 await poll(async()=> (await localProof())?.data?.personalEvidence?.goalAssessment==="partial","ASSESSMENT_ORIGINAL_FORM_WRITTEN");
 const proofBefore=await localProof(),proofId=proofBefore.objectId;
 check(proofBefore.data.personalEvidence.source.objectId===goalId&&proofBefore.data.personalEvidence.source.updatedAt===goalRevision,"ASSESSMENT_EXACT_GOAL_REVISION");
 check(proofBefore.data.personalEvidence.result===proofResult&&proofBefore.data.personalEvidence.basis===proofBasis&&
  proofBefore.data.personalEvidence.check===proofCheck&&proofBefore.data.personalEvidence.verification==="SELF_RECORDED","ASSESSMENT_SELF_RECORDED_BASIS");
 check((await localGoal()).updatedAt===goalRevision,"ASSESSMENT_DOES_NOT_REWRITE_GOAL");
 await poll(async()=>(await page.locator("[data-club-goal-list]").textContent()).includes("По моей оценке: достигнута частично"),"ASSESSMENT_MAP_UPDATED");
 log("OFFLINE_GOAL_ASSESSMENT_EXPLICIT_EVIDENCE");
 phase="OFFLINE_GOAL_ASSESSMENT_KERNEL";
 await page.locator("[data-club-proof-list]").getByRole("link",{name:"Сохранить в IWXA",exact:true}).click();
 const proofImport=page.getByTestId("club-t0-import-card");
 await proofImport.getByTestId("club-t0-import-preview").waitFor({state:"visible"});
 const proofScope=proofImport.getByTestId("club-t0-import-workspace-choice").filter({visible:true});
 await poll(async()=>await proofScope.count()===1,"ASSESSMENT_SCOPE_AVAILABLE");
 check(await proofScope.getAttribute("data-workspace-id")===base.scope,"ASSESSMENT_ORIGINAL_SCOPE");
 if(await proofScope.getAttribute("aria-pressed")!=="true")await proofScope.click();
 await poll(async()=>await proofScope.getAttribute("aria-pressed")==="true","ASSESSMENT_SCOPE_FOCUSED");
 const proofChoice=proofImport.getByTestId("club-t0-import-object-checkbox");
 await poll(async()=>await proofChoice.count()===1&&await proofChoice.isChecked(),"ASSESSMENT_TARGET_ONLY");
 await proofImport.getByLabel("Подтверждаю сохранение выбранных результатов на этом устройстве.",{exact:true}).check();
 const proofSave=proofImport.getByRole("button",{name:"Сохранить выбранное",exact:true});
 await poll(async()=>await proofSave.isEnabled(),"ASSESSMENT_KERNEL_READY");
 await proofSave.click();
 await poll(async()=>{
  const p=await localProof();return p?.objectId===proofId&&p.kernelSource?.workspaceId===base.scope&&p.kernelSource.revision>0&&p.kernelSource.syncedUpdatedAt===p.updatedAt;
 },"ASSESSMENT_KERNEL_RECEIPT");
 log("OFFLINE_GOAL_ASSESSMENT_ORIGINAL_KERNEL_RECEIPT");
 await visit(page,"/projects/?workspace_id="+encodeURIComponent(base.scope)+"&club_goal="+encodeURIComponent(goalId)+"#club-goal-map");
 await page.setViewportSize(phone);
 phase="OFFLINE_CASH_SETUP";
 await page.locator("[data-club-goal-list]").getByRole("link",{name:"Записать деньги по цели",exact:true}).click();
 const calendarGroup=page.locator("#club-money-calendar");
 if(!await calendarGroup.evaluate(el=>el.open))await calendarGroup.locator(":scope > summary").click();
 const cashSetup=page.locator("[data-cash-calendar-setup]");
 const cashEntry=page.locator("[data-cash-calendar-entry]");
 await fitViewport(page,"PHONE_CASH_FORM_OVERFLOW");
 const cashDates=await page.evaluate(()=>{
  const today=new Date();
  const offset=n=>{const d=new Date(today);d.setDate(d.getDate()+n);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)};
  return {first:offset(-4),salary:offset(-3),expense:offset(-2),close:offset(-1),today:offset(0),future:offset(3),end:offset(10),nextEnd:offset(30)};
 });
 const localCash=()=>page.evaluate(()=>{
  const rows=JSON.parse(sessionStorage.getItem("ru.iwxa.club.session.v1")||"null")?.objects?.filter(o=>o.objectId==="personal-economy")||[];
  return rows.length===1?rows[0]:null;
 });
 for(const [field,value] of Object.entries({startDate:cashDates.first,endDate:cashDates.end,openingAvailableRUB:"12000",minimumBufferRUB:"5000"}))
  await cashSetup.locator('[name="'+field+'"]').fill(value);
 await cashSetup.getByRole("button",{name:"Рассчитать период",exact:true}).click();
 await poll(async()=> (await localCash())?.data?.cashCalendar?.openingAvailableRUB===12000,"CASH_CALENDAR_SETUP");
 phase="OFFLINE_CASH_ENTRIES";
 const entries=[
  {date:cashDates.salary,amountRUB:"25000",status:"actual",category:"payroll",note:"Полученная зарплата",goalId:""},
  {date:cashDates.salary,amountRUB:"-16000",status:"planned",category:"other",note:"Оплачен набор инструментов",goalId},
  {date:cashDates.future,amountRUB:"-3000",status:"planned",category:"utilities",note:"Будущий платёж",goalId:""}
 ];
 for(const [i,entry] of entries.entries()){
  for(const [field,value] of Object.entries(entry)){
   const control=cashEntry.locator('[name="'+field+'"]');
   if(field==="status"||field==="category"||field==="goalId")await control.selectOption(value);else await control.fill(value);
  }
  await cashEntry.locator("[data-cash-calendar-save]").click();
  await poll(async()=> (await localCash())?.data?.cashCalendar?.entries?.length===i+1,"CASH_ENTRY_WRITTEN");
 }
 phase="OFFLINE_CASH_PLAN_TO_FACT";
 const estimateBefore=await localCash(),plannedTool=estimateBefore.data.cashCalendar.entries.find(e=>e.note==="Оплачен набор инструментов");
 check(plannedTool.status==="planned"&&plannedTool.amountRUB===-16000&&!plannedTool.planBasis,"CASH_PLAN_WITHOUT_INVENTED_FACT");
 const toolRow=page.locator("[data-cash-calendar-entries] tbody tr").filter({hasText:"Оплачен набор инструментов"});
 await toolRow.getByRole("button",{name:"Изменить",exact:true}).click();
 check(await cashEntry.getAttribute("data-edit-id")===plannedTool.id,"CASH_PLAN_TO_FACT_SAME_ID");
 await cashEntry.locator('[name="date"]').fill(cashDates.expense);
 await cashEntry.locator('[name="amountRUB"]').fill("-17000");
 await cashEntry.locator('[name="status"]').selectOption("actual");
 await cashEntry.locator("[data-cash-calendar-save]").click();
 await poll(async()=> (await localCash())?.data?.cashCalendar?.entries?.find(e=>e.id===plannedTool.id)?.status==="actual","CASH_FACT_RECORDED");
 const settledCash=await localCash(),settledTool=settledCash.data.cashCalendar.entries.find(e=>e.id===plannedTool.id);
 const expectedCashBasis={date:cashDates.salary,amountRUB:-16000,goalId};
 check(settledTool.amountRUB===-17000&&settledTool.date===cashDates.expense&&settledTool.goalId===goalId&&
  isDeepStrictEqual(settledTool.planBasis,expectedCashBasis)&&settledCash.data.cashCalendar.entries.length===3&&
  isDeepStrictEqual(settledCash.data.cashCalendar.entries.filter(e=>e.id!==plannedTool.id),estimateBefore.data.cashCalendar.entries.filter(e=>e.id!==plannedTool.id)),"CASH_PLAN_FACT_EXACT_SINGLE_ENTRY");
 check(/План:.*16[\s\u00a0]000.*\+1[\s\u00a0]000.*1 дн\. позже/.test(await toolRow.textContent()),"CASH_PLAN_FACT_VISIBLE");
 log("OFFLINE_CASH_EXACT_PLAN_TO_FACT");
 const priorCash=await localCash();
 phase="OFFLINE_CASH_ROLLOVER_PREVIEW";
 const cashHistory=page.locator("#club-cash-history");
 if(!await cashHistory.evaluate(el=>el.open))await cashHistory.locator(":scope > summary").click();
 const advance=cashHistory.locator("[data-cash-calendar-advance]");
 await advance.locator('[name="throughDate"]').fill(cashDates.close);
 await advance.locator('[name="nextEndDate"]').fill(cashDates.nextEnd);
 await advance.getByRole("button",{name:"Проверить перенос остатка",exact:true}).click();
 await advance.locator("[data-cash-calendar-advance-preview]").getByText(/20[\s\u00a0]000/).first().waitFor({state:"visible"});
 const confirmAdvance=advance.locator("[data-cash-calendar-advance-confirm]");
 check(!(await confirmAdvance.isEnabled()),"CASH_CLOSE_REQUIRES_CONFIRMATION");
 check((await localCash()).updatedAt===priorCash.updatedAt,"CASH_PREVIEW_NO_WRITE");
 await advance.locator('[name="confirmedClosingRUB"]').fill("19999");
 check(!(await confirmAdvance.isEnabled()),"CASH_WRONG_BALANCE_REJECTED");
 await advance.locator('[name="confirmedClosingRUB"]').fill("20000");
 await poll(async()=>await confirmAdvance.isEnabled(),"CASH_CORRECT_BALANCE_READY");
 phase="OFFLINE_CASH_ROLLOVER_CONFIRM";
 await confirmAdvance.click();
 await poll(async()=> (await localCash())?.data?.cashCalendar?.closedPeriods?.length===1,"CASH_PERIOD_CLOSED");
 const rolled=await localCash(),cal=rolled.data.cashCalendar;
 check(cal.startDate===cashDates.today&&cal.openingAvailableRUB===20000&&cal.entries.length===1&&cal.entries[0].status==="planned","CASH_EXACT_CARRY");
 check(cal.closedPeriods[0].entries.length===2&&cal.closedPeriods[0].closingAvailableRUB===20000,"CASH_HISTORY_RETAINED");
 check(cal.closedPeriods[0].entries.find(e=>e.note==="Оплачен набор инструментов")?.goalId===goalId&&
  !cal.closedPeriods[0].entries.find(e=>e.note==="Полученная зарплата")?.goalId,"GOAL_CASH_EXPLICIT_LINK_CLOSED");
 log("OFFLINE_GOAL_CASH_HISTORY_LINK");
 check(isDeepStrictEqual(cal.closedPeriods[0].entries.find(e=>e.id===plannedTool.id),settledTool),"CASH_CLOSED_EXACT_PLAN_FACT");
 await cashHistory.locator("[data-cash-calendar-history-detail]").getByText("Полученная зарплата",{exact:true}).waitFor({state:"visible"});
 check(/План:.*16[\s\u00a0]000/.test(await cashHistory.locator("[data-cash-calendar-history-detail]").textContent()),"CASH_CLOSED_ESTIMATE_VISIBLE");
 log("OFFLINE_CASH_PLAN_FACT_IN_CLOSED_PERIOD");
 log("OFFLINE_CASH_RECONCILED_PERIOD_HISTORY");
 async function verifyExpenseAlternatives(prefix){
  phase=prefix;
  const group=page.locator("#club-money-decisions");
  if(!await group.evaluate(el=>el.open))await group.locator(":scope > summary").click();
  const panel=group.locator("[data-club-expense-options]");
  const form=panel.locator("[data-club-expense-options-form]");
  const result=panel.locator("[data-club-expense-options-result]");
  const run=form.locator("[data-club-expense-options-run]");
  await poll(async()=>await run.isEnabled(),prefix+"_SOURCE_READY");
  const before=await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"));
  const exactCash=await localCash();
  const metric=async(title,label)=>{
   const card=result.locator("article").filter({has:page.getByRole("heading",{name:title,exact:true})});
   check(await card.count()===1,prefix+"_EXACT_CARD");
   const row=card.locator("p.club-review-line").filter({has:page.getByText(label,{exact:true})});
   check(await row.count()===1,prefix+"_EXACT_METRIC");
   return Number((await row.locator("strong").textContent()).replace(/[^0-9-]/g,""));
  };
  await form.locator('[name="entryId"]').selectOption("");
  for(const [k,v] of Object.entries({dateA:cashDates.today,amountA:"15000",dateB:cashDates.future,amountB:"11000"}))
   await form.locator('[name="'+k+'"]').fill(v);
  await run.click();
  await poll(async()=>await result.getAttribute("data-iwxa-assistant-state")==="ready",prefix+"_COMPARE_READY");
  check(await metric("Исходный календарь","Прогноз к концу периода")===17000,prefix+"_BASELINE");
  check(await metric("Вариант А","Прогноз к концу периода")===2000,prefix+"_A_END");
  check(await metric("Вариант Б","Прогноз к концу периода")===6000,prefix+"_B_END");
  check(await metric("Вариант А","Не хватает на эти платежи и запас")===3000,prefix+"_A_SHORTFALL");
  check(await metric("Вариант Б","Остаток сверх них по записанным деньгам")===1000,prefix+"_B_RESERVE");
  await form.locator('[name="amountA"]').fill("14000");
  await poll(async()=>await result.getAttribute("data-iwxa-assistant-state")==="empty",prefix+"_DRAFT_INVALIDATES");
  const plan=exactCash.data.cashCalendar.entries[0];
  await form.locator('[name="entryId"]').selectOption(plan.id);
  check(await form.locator('[name="dateA"]').inputValue()===plan.date&&
   await form.locator('[name="amountA"]').inputValue()==="3000",prefix+"_EXACT_PLAN_PREFILL");
  await form.locator('[name="dateB"]').fill(cashDates.nextEnd);
  await form.locator('[name="amountB"]').fill("4000");
  await run.click();
  await poll(async()=>await result.getAttribute("data-iwxa-assistant-state")==="ready",prefix+"_REPLACE_READY");
  check(await metric("Вариант А","Прогноз к концу периода")===17000,prefix+"_EXISTING_NOT_DUPLICATED");
  check(await metric("Вариант Б","Прогноз к концу периода")===16000,prefix+"_ONE_REPLACEMENT");
  check(await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"))===before&&
   isDeepStrictEqual(await localCash(),exactCash),prefix+"_NO_SOURCE_WRITE");
  await group.locator(":scope > summary").click();
  log(prefix);
 }
 await verifyExpenseAlternatives("OFFLINE_EXPENSE_TWO_INDEPENDENT_ALTERNATIVES");
 phase="OFFLINE_CASH_KERNEL_SAVE";
 await page.locator("[data-cash-calendar-persist]").getByRole("link",{name:"Сохранить календарь на устройстве",exact:true}).click();
 const cashImport=page.getByTestId("club-t0-import-card");
 await cashImport.getByTestId("club-t0-import-preview").waitFor({state:"visible"});
 const cashScope=cashImport.getByTestId("club-t0-import-workspace-choice").filter({visible:true});
 await poll(async()=>await cashScope.count()===1,"CASH_SINGLE_PERSONAL_SCOPE");
 check(await cashScope.getAttribute("data-workspace-id")===base.scope,"CASH_ORIGINAL_SCOPE");
 if(await cashScope.getAttribute("aria-pressed")!=="true")await cashScope.click();
 await poll(async()=>await cashScope.getAttribute("aria-pressed")==="true","CASH_SCOPE_FOCUSED");
 const cashChoice=cashImport.getByTestId("club-t0-import-object-checkbox");
 await poll(async()=>await cashChoice.count()===1&&await cashChoice.isEnabled()&&await cashChoice.isChecked(),"CASH_TARGET_ONLY");
 await cashImport.getByLabel("Подтверждаю сохранение выбранных результатов на этом устройстве.",{exact:true}).check();
 const cashSave=cashImport.getByRole("button",{name:"Сохранить выбранное",exact:true});
 await poll(async()=>await cashSave.isEnabled(),"CASH_KERNEL_SAVE_READY");
 await cashSave.click();
 await poll(async()=>{
  const c=await localCash();return c?.kernelSource?.workspaceId===base.scope&&c.kernelSource.revision>0&&c.kernelSource.syncedUpdatedAt===c.updatedAt;
 },"CASH_KERNEL_RECEIPT");
 await fitViewport(page,"PHONE_CASH_RECEIPT_OVERFLOW");
 log("PHONE_OFFLINE_CASH_CREATED_AND_SAVED");
 log("OFFLINE_CASH_ORIGINAL_KERNEL_RECEIPT");
 await page.setViewportSize(desktop);
 phase="OFFLINE_SAVED_HORIZON_FRESH_TAB";
 // A fresh tab must calculate from original saved Results before the
 // person restores any of them. Keep the main scenario tab untouched.
 const horizonOriginalPage=page,horizonOriginalGoal=await localGoal(),horizonOriginalWeek=await localWeek(),horizonOriginalCash=await localCash();
 const horizonOriginalSlot=horizonOriginalWeek.data.personalWeekPlan.slots.find(s=>s.projectId===goalId&&s.status==="planned");
 const horizonOriginalSession=await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"));
 check(!!horizonOriginalSlot,"NATIVE_HORIZON_ORIGINAL_SLOT");
 page=await context.newPage();page.setDefaultTimeout(45000);
 await visit(page,"/workspace/");await openExisting(page);
 check(!(await localGoal())&&!(await localWeek())&&!(await localCash()),"NATIVE_HORIZON_FRESH_TAB_NO_RESULTS");
 const savedHorizon=page.getByTestId("club-native-goal-horizon");
 await savedHorizon.waitFor({state:"visible"});
 const savedHorizonBefore=await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"));
 if(!await savedHorizon.evaluate(el=>el.open))await savedHorizon.locator(":scope > summary").click();
 const savedHorizonResult=savedHorizon.locator("[data-club-goal-horizon-result]");
 await poll(async()=>(await savedHorizonResult.textContent()).includes("По сохранённым записям выбранной рабочей области"),"NATIVE_HORIZON_SAVED_SCOPE");
 const savedRisk=savedHorizonResult.locator("[data-club-goal-horizon-cash-risk]");
 const savedRiskMetric=async label=>{
  const row=savedRisk.locator("p.club-review-line").filter({has:page.getByText(label,{exact:true})});
  check(await row.count()===1,"NATIVE_HORIZON_CASH_METRIC");
  return Number((await row.locator("strong").textContent()).replace(/[^0-9-]/g,""));
 };
 check(await savedRiskMetric("Остаток по записанным фактам на сегодня")===20000&&
  await savedRiskMetric("Прогноз к концу охваченных дат")===17000,"NATIVE_HORIZON_EXACT_CASH");
 await savedHorizon.locator("[data-club-goal-horizon-period]").selectOption("30");
 await poll(async()=>(await savedHorizonResult.textContent()).includes("из 30 дней"),"NATIVE_HORIZON_MONTH");
 check(await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"))===savedHorizonBefore,"NATIVE_HORIZON_NO_TAB_WRITE");
 const savedGroups=savedHorizonResult.locator("details").filter({has:page.locator("summary").filter({hasText:/^Обязательства по целям/})});
 await savedGroups.locator(":scope > summary").click();
 const savedGoalCard=savedGroups.locator("article").filter({has:page.getByRole("heading",{name:goalTitle,exact:true})});
 check(await savedGoalCard.count()===1,"NATIVE_HORIZON_EXACT_GOAL");
 await savedGoalCard.getByRole("button",{name:"Сравнить это дело",exact:true}).click();
 const savedHorizonRestore=page.getByTestId("club-t2-restore-card");
 await savedHorizonRestore.waitFor({state:"visible"});
 const selectedHorizonIds=()=>savedHorizonRestore.locator('input[data-club-restore-object-id]:checked').evaluateAll(els=>els.map(el=>el.getAttribute("data-club-restore-object-id")));
 await poll(async()=>{const ids=await selectedHorizonIds();return [goalId,"club-week-plan","personal-economy"].every(id=>ids.includes(id))&&
  (await savedHorizonRestore.textContent()).includes("Для сравнения отмечены сохранённые цели");},"NATIVE_HORIZON_RELATED_SELECTION");
 const horizonIds=await selectedHorizonIds();
 check(new Set(horizonIds).size===horizonIds.length&&await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"))===savedHorizonBefore,"NATIVE_HORIZON_PRESELECT_READ_ONLY");
 const savedHorizonOpen=savedHorizonRestore.getByRole("button",{name:"Открыть выбранные записи",exact:true});
 await poll(async()=>await savedHorizonOpen.isEnabled(),"NATIVE_HORIZON_CONFIRM_READY");
 let savedHorizonConsent=false;
 page.once("dialog",async d=>{
  savedHorizonConsent=d.type()==="confirm"&&d.message().includes("Загрузить "+horizonIds.length+" новых");
  if(savedHorizonConsent)await d.accept();else await d.dismiss();
 });
 await savedHorizonOpen.click();await poll(async()=>savedHorizonConsent,"NATIVE_HORIZON_EXPLICIT_CONSENT");
 const savedHorizonLink=page.getByTestId("club-t2-restore-completed").getByRole("link",{name:"Сравнить выбранное обязательство",exact:true});
 await savedHorizonLink.waitFor({state:"visible"});
 const savedHorizonUrl=new URL(await savedHorizonLink.getAttribute("href"),page.url());
 check(savedHorizonUrl.searchParams.get("club_compare_slot")===horizonOriginalSlot.id&&
  savedHorizonUrl.searchParams.get("club_compare_goal_rev")===horizonOriginalGoal.updatedAt&&
  savedHorizonUrl.searchParams.get("club_compare_source_rev")===horizonOriginalWeek.updatedAt&&
  savedHorizonUrl.searchParams.get("workspace_id")===base.scope,"NATIVE_HORIZON_EXACT_CONTINUATION");
 await savedHorizonLink.click();
 const savedHorizonForm=page.locator("[data-club-goal-resource-form]");
 await savedHorizonForm.waitFor({state:"visible"});
 await poll(async()=>await savedHorizonForm.locator('[name="slotId"]').inputValue()===horizonOriginalSlot.id&&
  !new URL(page.url()).searchParams.has("club_compare_slot"),"NATIVE_HORIZON_EXACT_EDITOR");
 check(await savedHorizonForm.locator('[name="entryId"]').inputValue()===""&&
  await savedHorizonForm.locator('[name="minutesA"]').inputValue()===String(horizonOriginalSlot.durationMinutes),"NATIVE_HORIZON_OTHER_CHOICE_EXPLICIT");
 check(await savedHorizonForm.locator('[name="focus"]').inputValue()==="week"&&
  !(await savedHorizonForm.locator('[name="entryId"]').isEnabled()),"NATIVE_HORIZON_FOCUSED_TIME");
 const focusedHorizonBefore=await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"));
 await savedHorizonForm.locator('[name="minutesB"]').fill("60");
 await savedHorizonForm.locator("[data-club-goal-resource-run]").click();
 await poll(async()=>await page.locator("[data-club-goal-resource-result]").getAttribute("data-iwxa-assistant-state")==="ready","NATIVE_HORIZON_TIME_ONLY_READY");
 check((await page.locator("[data-club-goal-resource-result]").textContent()).includes("Денежные последствия не рассчитаны")&&
  await page.locator("[data-club-goal-resource-result]").getByRole("button",{name:/Подготовить платёж/}).count()===0,"NATIVE_HORIZON_NO_ARTIFICIAL_EXPENSE");
 check(await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"))===focusedHorizonBefore,"NATIVE_HORIZON_FOCUSED_READ_ONLY");
 check([await localGoal(),await localWeek(),await localCash()].every((row,i)=>row?.kernelSource?.workspaceId===base.scope&&
  row.updatedAt===[horizonOriginalGoal,horizonOriginalWeek,horizonOriginalCash][i].updatedAt&&
  row.kernelSource.syncedUpdatedAt===row.updatedAt),"NATIVE_HORIZON_ORIGINAL_REVISIONS");
 await page.close();page=horizonOriginalPage;
 check(await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"))===horizonOriginalSession,"NATIVE_HORIZON_MAIN_TAB_UNCHANGED");
 log("OFFLINE_SAVED_HORIZON_EXACT_COMPARISON");
 phase="OFFLINE_GOAL_RESOURCE_COMPARE";
 // The same browser tab has explicitly restored and saved these three
 // original Results. Comparing alternatives must not write any of them.
 await visit(page,"/projects/?workspace_id="+encodeURIComponent(base.scope)+"&club_goal="+encodeURIComponent(goalId)+"#club-goal-map");
 const goalResourceTask=(await localWeek())?.data?.personalWeekPlan?.slots?.find(s=>s.projectId===goalId&&s.status==="planned");
 check(!!goalResourceTask&&goalResourceTask.date===dates.today&&goalResourceTask.durationMinutes===90,"GOAL_RESOURCE_ORIGINAL_TASK");
 check((await localGoal())?.objectId===goalId&&(await localCash())?.data?.cashCalendar?.openingAvailableRUB===20000,"GOAL_RESOURCE_ORIGINAL_SOURCES");
 const horizonPanel=page.locator("[data-club-goal-horizon]");
 const horizonResult=horizonPanel.locator("[data-club-goal-horizon-result]");
 const horizonBefore=await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"));
 await horizonPanel.locator(":scope > summary").click();
 await poll(async()=>["ready","error"].includes(await horizonResult.getAttribute("data-iwxa-assistant-state")),"GOAL_HORIZON_PROJECTION");
 const horizonGroups=horizonResult.locator("details").filter({has:page.locator("summary").filter({hasText:/^Обязательства по целям/})});
 check(await horizonGroups.count()===1,"GOAL_HORIZON_GROUP_LIST");
 await horizonGroups.locator(":scope > summary").click();
 const horizonGoal=horizonGroups.locator("article").filter({has:page.getByRole("heading",{name:goalTitle,exact:true})});
 check(await horizonGoal.count()===1,"GOAL_HORIZON_EXACT_GOAL");
 await horizonGoal.getByRole("button",{name:"Сравнить это дело",exact:true}).click();
 const exactHorizonForm=page.locator("[data-club-goal-resource-form]");
 await exactHorizonForm.waitFor({state:"visible"});
 check(await exactHorizonForm.locator('[name="slotId"]').inputValue()===goalResourceTask.id&&await exactHorizonForm.locator('[name="entryId"]').inputValue()==="","GOAL_HORIZON_PRESELECT_ONE_SOURCE");
 check(await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"))===horizonBefore,"GOAL_HORIZON_NO_SOURCE_WRITE");
 await horizonPanel.locator("[data-club-goal-horizon-period]").selectOption("30");
 await poll(async()=> (await horizonResult.textContent()).includes("из 30 дней"),"GOAL_HORIZON_MONTH_COVERAGE");
 check(await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"))===horizonBefore,"GOAL_HORIZON_MONTH_READ_ONLY");
 if(!await horizonGroups.evaluate(e=>e.open))await horizonGroups.locator(":scope > summary").click();
 const horizonDirect= horizonGoal.getByRole("link",{name:"Открыть дело",exact:true});
 const horizonDirectURL=new URL(await horizonDirect.getAttribute("href"),page.url());
 check(horizonDirectURL.searchParams.get("club_week_slot")===goalResourceTask.id&&
  horizonDirectURL.searchParams.get("club_week_rev")===(await localWeek()).updatedAt&&
  horizonDirectURL.searchParams.get("club_goal_horizon_days")==="30"&&
  !horizonDirectURL.searchParams.has("club_activity_period"),"GOAL_HORIZON_DIRECT_FUTURE_ROUTE");
 await horizonDirect.click();
 const horizonDirectEditor=page.locator("form[data-club-week-form]");
 await poll(async()=>await horizonDirectEditor.locator("[data-club-week-save]").isEnabled()&&
  await horizonDirectEditor.locator('[name="title"]').inputValue()===goalResourceTask.title,"GOAL_HORIZON_DIRECT_EDITOR_READY");
 check(await horizonDirectEditor.locator('[name="durationMinutes"]').inputValue()===String(goalResourceTask.durationMinutes),"GOAL_HORIZON_DIRECT_EXACT_TASK");
 await page.getByRole("button",{name:"Вернуться к обязательствам",exact:true}).click();
 await poll(async()=>new URL(page.url()).searchParams.get("club_goal_horizon_days")==="30"&&new URL(page.url()).hash==="#club-goal-horizon","GOAL_HORIZON_DIRECT_RETURN");
 check(await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"))===horizonBefore,"GOAL_HORIZON_DIRECT_NO_WRITE");
 await poll(async()=>await horizonPanel.evaluate(e=>e.open)&&await horizonPanel.locator("[data-club-goal-horizon-period]").inputValue()==="30","GOAL_HORIZON_DIRECT_PERIOD_RETAINED");
 await horizonPanel.locator(":scope > summary").click();
 log("OFFLINE_GOAL_HORIZON_EXACT_COMPARISON_READ_ONLY");
 const resourceOpen=page.locator("[data-club-goal-list]").getByRole("button",{name:"Проверить следующий шаг",exact:true});
 await resourceOpen.click();
 const resourcePanel=page.locator("[data-club-goal-resource-review]");
 const resourceForm=resourcePanel.locator("[data-club-goal-resource-form]");
 const resourceResult=resourcePanel.locator("[data-club-goal-resource-result]");
 const resourceRun=resourceForm.locator("[data-club-goal-resource-run]");
 await resourceForm.waitFor({state:"visible"});
 await poll(async()=>await resourceRun.isEnabled(),"GOAL_RESOURCE_SOURCE_READY");
 const resourceBefore=await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"));
 const expenseChoices=await resourceForm.locator('[name="entryId"] option').evaluateAll(nodes=>nodes.map(x=>x.value));
 check(isDeepStrictEqual(expenseChoices,["","new"]),"GOAL_RESOURCE_NO_UNLINKED_EXPENSE_SELECTION");
 await resourceForm.locator('[name="slotId"]').selectOption(goalResourceTask.id);
 check(await resourceForm.locator('[name="minutesA"]').inputValue()==="90","GOAL_RESOURCE_EXACT_PREFILL");
 await resourceForm.locator('[name="entryId"]').selectOption("new");
 for(const [k,v] of Object.entries({dateA:dates.today,startA:"10:00",minutesA:"90",expenseDateA:cashDates.today,expenseA:"15000",
  dateB:dates.future,startB:"10:00",minutesB:"60",expenseDateB:cashDates.future,expenseB:"11000"}))
  await resourceForm.locator('[name="'+k+'"]').fill(v);
 await resourceRun.click();
 await poll(async()=>await resourceResult.getAttribute("data-iwxa-assistant-state")==="ready","GOAL_RESOURCE_COMPARE_READY");
 const goalResourceA=resourceResult.locator("article").filter({has:page.getByRole("heading",{name:"Вариант А",exact:true})});
 const goalResourceB=resourceResult.locator("article").filter({has:page.getByRole("heading",{name:"Вариант Б",exact:true})});
 check(await goalResourceA.count()===1&&await goalResourceB.count()===1,"GOAL_RESOURCE_TWO_CARDS");
 const resourceMetric=async(card,label)=>{
  const row=card.locator("p.club-review-line").filter({has:page.getByText(label,{exact:true})});
  check(await row.count()===1,"GOAL_RESOURCE_EXACT_METRIC");
  return Number((await row.locator("strong").textContent()).replace(/[^0-9-]/g,""));
 };
 check(await resourceMetric(goalResourceA,"Превышение предела")===30,"GOAL_RESOURCE_A_OVER_CAPACITY");
 check(await resourceMetric(goalResourceB,"Известные пересечения дела")===1,"GOAL_RESOURCE_B_CONFLICT");
 check(await resourceMetric(goalResourceA,"Прогноз к концу периода")===2000&&
  await resourceMetric(goalResourceB,"Прогноз к концу периода")===6000,"GOAL_RESOURCE_INDEPENDENT_CASH");
 for(const card of [goalResourceA,goalResourceB]){
  const context=card.locator("[data-club-resource-decision-context]");
  check(await context.count()===1&&(await context.textContent()).includes("Изменение нагрузки"),"GOAL_RESOURCE_INCREMENTAL_EFFECT_VISIBLE");
 }
 const focusedCashMode=resourceForm.locator('[name="focus"]');
 await focusedCashMode.selectOption("cash");
 check(!(await resourceForm.locator('[name="slotId"]').isEnabled()),"GOAL_RESOURCE_CASH_ONLY_FIELDS");
 await resourceRun.click();
 await poll(async()=>await resourceResult.getAttribute("data-iwxa-assistant-state")==="ready","GOAL_RESOURCE_CASH_ONLY_READY");
 check((await resourceResult.textContent()).includes("Последствия для времени и срока цели не рассчитаны")&&
  await resourceResult.getByRole("button",{name:/Подготовить дело/}).count()===0,"GOAL_RESOURCE_NO_ARTIFICIAL_TASK");
 check(await resourceMetric(goalResourceA,"Прогноз к концу периода")===2000&&await resourceMetric(goalResourceB,"Прогноз к концу периода")===6000,"GOAL_RESOURCE_CASH_ONLY_SAME_FORECAST");
 check(await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"))===resourceBefore,"GOAL_RESOURCE_CASH_ONLY_READ_ONLY");
 await focusedCashMode.selectOption("both");
 await resourceRun.click();
 await poll(async()=>await resourceResult.getAttribute("data-iwxa-assistant-state")==="ready","GOAL_RESOURCE_COMBINED_RESTORED");
 const resourceHistoryWindow=resourceForm.locator('[name="historyDays"]');
 check(await resourceHistoryWindow.inputValue()==="30","GOAL_RESOURCE_HISTORY_DEFAULT");
 await resourceHistoryWindow.selectOption("90");
 await poll(async()=>await resourceResult.getAttribute("data-iwxa-assistant-state")==="empty","GOAL_RESOURCE_HISTORY_INVALIDATES");
 await resourceRun.click();
 await poll(async()=>await resourceResult.getAttribute("data-iwxa-assistant-state")==="ready","GOAL_RESOURCE_HISTORY_90_READY");
 check((await resourceResult.textContent()).includes("Опыт этой цели за последние 90 дней"),"GOAL_RESOURCE_HISTORY_90_EVIDENCE");
 await resourceHistoryWindow.selectOption("30");
 await resourceRun.click();
 await poll(async()=>await resourceResult.getAttribute("data-iwxa-assistant-state")==="ready","GOAL_RESOURCE_HISTORY_30_RESTORED");
 check(await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"))===resourceBefore,"GOAL_RESOURCE_HISTORY_READ_ONLY");
 log("OFFLINE_GOAL_RESOURCE_INCREMENTAL_EFFECTS_HISTORY_READ_ONLY");
 phase="OFFLINE_GOAL_RESOURCE_OBSERVED_RESERVE";
 check(await resourceMetric(resourceResult,"Наибольшее превышение расходов")===1000,"GOAL_RESOURCE_RECENT_EXACT_CASH_BASIS");
 const reserveOutput=goalResourceA.locator("[data-club-resource-reserve-output]");
 check((await reserveOutput.textContent()).trim()==="","GOAL_RESOURCE_RESERVE_EXPLICIT");
 await goalResourceA.getByRole("button",{name:"Проверить с запасом (вариант А)",exact:true}).click();
 await reserveOutput.getByRole("heading",{name:"Дополнительная проверка с запасом",exact:true}).waitFor({state:"visible"});
 check(await resourceMetric(reserveOutput,"Добавочный расход")===1000&&
  await resourceMetric(reserveOutput,"Расход с запасом")===16000&&
  await resourceMetric(reserveOutput,"Прогноз с запасом к концу периода")===1000,"GOAL_RESOURCE_RESERVE_EXACT_REPEAT");
 check(await resourceMetric(goalResourceA,"Прогноз к концу периода")===2000&&
  await resourceMetric(goalResourceB,"Прогноз к концу периода")===6000&&
  await resourceForm.locator('[name="expenseA"]').inputValue()==="15000"&&
  await resourceForm.locator('[name="minutesA"]').inputValue()==="90","GOAL_RESOURCE_RESERVE_ORIGINALS_RETAINED");
 check(await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"))===resourceBefore,"GOAL_RESOURCE_RESERVE_NO_WRITE");
 log("OFFLINE_GOAL_RESOURCE_OBSERVED_RESERVE_READ_ONLY");
 const originalTaskHref=await resourceResult.getByRole("link",{name:"Открыть исходное дело",exact:true}).getAttribute("href");
 check(new URL(originalTaskHref,page.url()).searchParams.get("club_week_slot")===goalResourceTask.id,"GOAL_RESOURCE_EXACT_TASK_EDITOR");
 check(await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"))===resourceBefore,"GOAL_RESOURCE_NO_WRITE");
 await resourceForm.locator('[name="minutesB"]').fill("75");
 await poll(async()=>await resourceResult.getAttribute("data-iwxa-assistant-state")==="empty","GOAL_RESOURCE_INVALIDATED");
 log("OFFLINE_GOAL_RESOURCE_TIME_AND_CASH_ALTERNATIVES");
 const localDrafts=()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem("ru.iwxa.club.session.v1")||"null")?.drafts||[]);
 const editorDrafts=async()=> (await localDrafts()).filter(x=>x.draftId==="goal-resource-editor-handoff");
 const localObjects=()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem("ru.iwxa.club.session.v1")||"null")?.objects||[]);
 const openComparison=async(slot,entry,values)=>{
  await visit(page,"/projects/?workspace_id="+encodeURIComponent(base.scope)+"&club_goal="+encodeURIComponent(goalId)+"#club-goal-map");
  await resourceOpen.click();await resourceForm.waitFor({state:"visible"});
  await poll(async()=>await resourceRun.isEnabled(),"PREPARED_VARIANT_SOURCE_READY");
  await resourceForm.locator('[name="slotId"]').selectOption(slot);
  await resourceForm.locator('[name="entryId"]').selectOption(entry);
  for(const [key,value] of Object.entries(values))await resourceForm.locator('[name="'+key+'"]').fill(value);
  await resourceRun.click();
  await poll(async()=>await resourceResult.getAttribute("data-iwxa-assistant-state")==="ready","PREPARED_VARIANT_COMPARE_READY");
 };
 const preparedTaskEditor=page.locator("form[data-club-week-form]");
 phase="OFFLINE_GOAL_NEW_TASK_DRAFT";
 const newTaskBefore=await localWeek(),newTaskObjects=await localObjects();
 await openComparison("new","new",{dateA:dates.today,startA:"11:30",minutesA:"30",expenseA:"0",
  dateB:dates.future,startB:"12:30",minutesB:"45",expenseB:"0"});
 check(await goalResourceA.getByRole("button",{name:"Подготовить платёж (вариант А)",exact:true}).count()===0&&
  await goalResourceB.getByRole("button",{name:"Подготовить платёж (вариант Б)",exact:true}).count()===0,"GOAL_ZERO_EXPENSE_NO_PAYMENT_ACTION");
 check(isDeepStrictEqual(await localObjects(),newTaskObjects)&&(await editorDrafts()).length===0,"GOAL_NEW_TASK_COMPARE_READ_ONLY");
 await goalResourceB.getByRole("button",{name:"Подготовить дело (вариант Б)",exact:true}).click();
 await preparedTaskEditor.waitFor({state:"visible"});
 await poll(async()=>await preparedTaskEditor.locator("[data-club-week-save]").isEnabled()&&
  await preparedTaskEditor.locator('[name="title"]').inputValue()===goalStep,"GOAL_NEW_TASK_PREFILLED");
 const newTaskUrl=new URL(page.url());
 check(newTaskUrl.searchParams.get("club_week_slot")==="new"&&newTaskUrl.searchParams.get("workspace_id")===base.scope&&
  newTaskUrl.searchParams.has("club_review_draft")&&!newTaskUrl.searchParams.has("title"),"GOAL_NEW_TASK_EXACT_DRAFT_ROUTE");
 check(await preparedTaskEditor.locator('[name="date"]').inputValue()===dates.future&&
  await preparedTaskEditor.locator('[name="start"]').inputValue()==="12:30"&&
  await preparedTaskEditor.locator('[name="durationMinutes"]').inputValue()==="45"&&
  await preparedTaskEditor.locator('[name="projectId"]').inputValue()===goalId&&
  !(await preparedTaskEditor.locator("[data-club-week-frequency]").isEnabled()),"GOAL_NEW_TASK_PREPARED_FIELDS");
 check(isDeepStrictEqual(await localObjects(),newTaskObjects)&&(await editorDrafts()).length===1,"GOAL_NEW_TASK_OPEN_ONLY_DRAFT");
 // The user can adjust a prepared form. Create once, then explicitly remove
 // this additional trial record to preserve the existing lifecycle fixture.
 const newTrialTitle="Отдельный пробный шаг";
 await preparedTaskEditor.locator('[name="title"]').fill(newTrialTitle);
 await preparedTaskEditor.locator("[data-club-week-save]").click();
 await poll(async()=> (await localWeek())?.data?.personalWeekPlan?.slots?.length===newTaskBefore.data.personalWeekPlan.slots.length+1,"GOAL_NEW_TASK_EXPLICIT_CREATE");
 const newTrial=(await localWeek()).data.personalWeekPlan.slots.find(x=>x.title===newTrialTitle);
 check(!!newTrial&&newTrial.status==="planned"&&newTrial.projectId===goalId&&newTrial.start==="12:30"&&newTrial.durationMinutes===45&&
  !newTrial.fact&&isDeepStrictEqual((await localWeek()).data.personalWeekPlan.slots.filter(x=>x.id!==newTrial.id),newTaskBefore.data.personalWeekPlan.slots),"GOAL_NEW_TASK_ONE_RECORD");
 await poll(async()=>!new URL(page.url()).searchParams.has("club_review_draft")&&(await editorDrafts()).length===0,"GOAL_NEW_TASK_DRAFT_CONSUMED");
 const newTrialRow=page.locator(".club-week-entry").filter({has:page.getByText(newTrialTitle,{exact:true})});
 await newTrialRow.waitFor({state:"visible"});
 page.once("dialog",async d=>{if(d.type()==="confirm")await d.accept();else await d.dismiss()});
 await newTrialRow.getByRole("button",{name:"Удалить",exact:true}).click();
 await poll(async()=>isDeepStrictEqual((await localWeek())?.data?.personalWeekPlan?.slots,newTaskBefore.data.personalWeekPlan.slots),"GOAL_NEW_TASK_EXPLICIT_REMOVAL");
 await visit(page,"/projects/");
 await visit(page,newTaskUrl.pathname+newTaskUrl.search+newTaskUrl.hash);
 await preparedTaskEditor.waitFor({state:"visible"});
 await poll(async()=>!(await preparedTaskEditor.locator("[data-club-week-save]").isEnabled()),"GOAL_NEW_TASK_CONSUMED_LINK_BLOCKED");
 await preparedTaskEditor.evaluate(form=>form.dispatchEvent(new Event("submit",{cancelable:true,bubbles:true})));
 check(isDeepStrictEqual((await localWeek()).data.personalWeekPlan.slots,newTaskBefore.data.personalWeekPlan.slots),"GOAL_NEW_TASK_NO_REPLAY");
 log("OFFLINE_GOAL_NEW_TASK_PREPARE_EXPLICIT_CREATE_NO_REPLAY");
 phase="OFFLINE_GOAL_TASK_EXACT_ROUTE";
 const goalTaskPlanBefore=await localWeek();
 // Keep the original capacity/conflict checks. Select a revised start time
 // without changing the original task date, title or planned minutes.
 const taskVariantFields={dateA:dates.today,startA:"10:15",minutesA:"90",expenseDateA:cashDates.today,expenseA:"15000",
  dateB:dates.future,startB:"10:00",minutesB:"75",expenseDateB:cashDates.future,expenseB:"11000"};
 await openComparison(goalResourceTask.id,"new",taskVariantFields);
 const exactTaskLink=resourceResult.getByRole("link",{name:"Открыть исходное дело",exact:true});
 const exactTaskUrl=new URL(await exactTaskLink.getAttribute("href"),page.url());
 check(exactTaskUrl.searchParams.get("club_week_slot")===goalResourceTask.id&&
  exactTaskUrl.searchParams.get("club_week_goal")===goalId&&
  exactTaskUrl.searchParams.get("club_week_rev")===goalTaskPlanBefore.updatedAt&&
  exactTaskUrl.searchParams.get("workspace_id")===base.scope&&
  exactTaskUrl.hash==="#club-week-plan","GOAL_TASK_EXACT_REVISION_ROUTE");
 check(isDeepStrictEqual(await localWeek(),goalTaskPlanBefore),"GOAL_TASK_COMPARE_NO_WRITE");
 await exactTaskLink.click();
 const exactTaskEditor=page.locator("form[data-club-week-form]");
 await exactTaskEditor.waitFor({state:"visible"});
 await poll(async()=>await exactTaskEditor.locator('[name="title"]').inputValue()===goalResourceTask.title&&
  await exactTaskEditor.locator("[data-club-week-save]").isEnabled(),"GOAL_TASK_EDITOR_READY");
 check(await exactTaskEditor.locator('[name="date"]').inputValue()===goalResourceTask.date&&
  await exactTaskEditor.locator('[name="start"]').inputValue()===goalResourceTask.start&&
  await exactTaskEditor.locator('[name="durationMinutes"]').inputValue()==="90"&&
  await exactTaskEditor.locator('[name="projectId"]').inputValue()===goalId,"GOAL_TASK_ORIGINAL_FIELDS");
 check(isDeepStrictEqual(await localWeek(),goalTaskPlanBefore),"GOAL_TASK_OPEN_NO_WRITE");
 phase="OFFLINE_GOAL_TASK_SELECTED_DRAFT";
 const taskDraftSources=await localObjects();
 await openComparison(goalResourceTask.id,"new",taskVariantFields);
 await goalResourceA.getByRole("button",{name:"Подготовить дело (вариант А)",exact:true}).click();
 await exactTaskEditor.waitFor({state:"visible"});
 await poll(async()=>await exactTaskEditor.locator('[name="start"]').inputValue()==="10:15"&&
  await exactTaskEditor.locator("[data-club-week-save]").isEnabled(),"GOAL_TASK_SELECTED_FIELDS");
 const taskDraftUrl=new URL(page.url());
 check(taskDraftUrl.searchParams.has("club_review_draft")&&taskDraftUrl.searchParams.get("club_week_slot")===goalResourceTask.id&&
  taskDraftUrl.searchParams.get("club_week_rev")===goalTaskPlanBefore.updatedAt&&taskDraftUrl.searchParams.get("workspace_id")===base.scope,
  "GOAL_TASK_SELECTED_ROUTE");
 check(await exactTaskEditor.locator('[name="date"]').inputValue()===goalResourceTask.date&&
  await exactTaskEditor.locator('[name="title"]').inputValue()===goalResourceTask.title&&
  await exactTaskEditor.locator('[name="note"]').inputValue()===goalResourceTask.note&&
  await exactTaskEditor.locator('[name="durationMinutes"]').inputValue()==="90"&&
  await exactTaskEditor.locator('[name="projectId"]').inputValue()===goalId,"GOAL_TASK_SELECTED_PRESERVES_ORIGINAL_FIELDS");
 check(isDeepStrictEqual(await localObjects(),taskDraftSources)&&(await editorDrafts()).length===1,"GOAL_TASK_SELECTED_OPEN_DRAFT_ONLY");
 await exactTaskEditor.locator("[data-club-week-save]").click();
 await poll(async()=> (await localWeek())?.data?.personalWeekPlan?.slots?.find(s=>s.id===goalResourceTask.id)?.start==="10:15","GOAL_TASK_SAME_ID_UPDATED");
 const goalTaskPlanAfter=await localWeek();
 const expectedGoalTask={...goalResourceTask,start:"10:15"};
 check(goalTaskPlanAfter.data.personalWeekPlan.slots.length===goalTaskPlanBefore.data.personalWeekPlan.slots.length&&
  isDeepStrictEqual(goalTaskPlanAfter.data.personalWeekPlan.slots.find(s=>s.id===goalResourceTask.id),expectedGoalTask)&&
  isDeepStrictEqual(goalTaskPlanAfter.data.personalWeekPlan.slots.filter(s=>s.id!==goalResourceTask.id),goalTaskPlanBefore.data.personalWeekPlan.slots.filter(s=>s.id!==goalResourceTask.id)),"GOAL_TASK_ONE_CHANGE_NO_DUPLICATE");
 log("OFFLINE_GOAL_TASK_EXACT_EDITOR_ONE_CHANGE");
 await poll(async()=>["club_review_draft","club_week_slot","club_week_goal","club_week_rev"].every(key=>!new URL(page.url()).searchParams.has(key))&&
  (await editorDrafts()).length===0,"GOAL_TASK_SELECTED_DRAFT_CONSUMED");
 check(new URL(page.url()).searchParams.get("workspace_id")===base.scope&&new URL(page.url()).hash===exactTaskUrl.hash,"GOAL_TASK_ROUTE_CONTEXT_RETAINED");
 log("OFFLINE_GOAL_TASK_SELECTED_DRAFT_ONE_CHANGE");
 phase="OFFLINE_GOAL_TASK_RETURN_COMPARISON";
 const taskResumeObjects=await localObjects();
 const taskReturn=page.locator("[data-club-week-return-review]");
 await taskReturn.waitFor({state:"visible"});await taskReturn.click();
 await resourceForm.waitFor({state:"visible"});
 const resumeInput=resourcePanel.locator("[data-club-goal-resource-resume]");
 await resumeInput.waitFor({state:"visible"});
 await poll(async()=>!new URL(page.url()).searchParams.has("club_review_resume")&&await resourceRun.isEnabled(),"GOAL_TASK_RESUME_ROUTE_CONSUMED");
 check(await resourceForm.locator('[name="slotId"]').inputValue()===goalResourceTask.id&&
  await resourceForm.locator('[name="entryId"]').inputValue()===""&&
  await resourceForm.locator('[name="startA"]').inputValue()==="10:15"&&
  await resourceForm.locator('[name="startB"]').inputValue()==="10:15"&&
  await resourceForm.locator('[name="minutesA"]').inputValue()==="90"&&
  await resourceForm.locator('[name="minutesB"]').inputValue()==="90"&&
  await resourceResult.getAttribute("data-iwxa-assistant-state")==="empty","GOAL_TASK_RESUME_EXACT_APPLIED_RECORD");
 check(isDeepStrictEqual(await localObjects(),taskResumeObjects),"GOAL_TASK_RESUME_NO_RESULT_WRITE");
 await resourceForm.locator('[name="entryId"]').selectOption("new");
 await resumeInput.click();
 check(await resourceForm.locator('[name="startA"]').inputValue()==="10:15"&&
  await resourceForm.locator('[name="minutesA"]').inputValue()==="90"&&
  await resourceForm.locator('[name="minutesB"]').inputValue()==="75"&&
  await resourceForm.locator('[name="expenseA"]').inputValue()==="15000"&&
  await resourceForm.locator('[name="expenseB"]').inputValue()==="11000"&&
  await resourceResult.getAttribute("data-iwxa-assistant-state")==="empty","GOAL_TASK_RESUME_OLD_INPUTS_NOT_RESULT");
 await resourceRun.click();
 await poll(async()=>await resourceResult.getAttribute("data-iwxa-assistant-state")==="ready","GOAL_TASK_RESUME_RECALCULATED");
 check(isDeepStrictEqual(await localObjects(),taskResumeObjects)&&(await localDrafts()).every(x=>x.draftId!=="goal-resource-review-resume"),"GOAL_TASK_RESUME_RECALC_NO_WRITE");
 log("OFFLINE_GOAL_TASK_RETURN_FRESH_COMPARISON");
 phase="OFFLINE_GOAL_TASK_STALE_ROUTE";
 // A consumed link is removed from the current URL; revisit from a different
 // document so the stale-link test cannot be satisfied by same-document navigation.
 // The return button has navigated to a new comparison; consumption and
 // context were checked before return, and the original stale link is still tested.
 await visit(page,"/projects/");
 await visit(page,exactTaskUrl.pathname+exactTaskUrl.search+exactTaskUrl.hash);
 await exactTaskEditor.waitFor({state:"visible"});
 await poll(async()=>await exactTaskEditor.locator("[data-club-week-target]").isVisible()&&
  (await exactTaskEditor.locator("[data-club-week-target]").textContent()).includes("изменились"),"GOAL_TASK_STALE_NOTICE");
 check(!(await exactTaskEditor.locator("[data-club-week-save]").isEnabled())&&
  !(await exactTaskEditor.locator("[data-club-week-check-change]").isEnabled()),"GOAL_TASK_STALE_BLOCKED");
 await exactTaskEditor.evaluate(form=>form.dispatchEvent(new Event("submit",{cancelable:true,bubbles:true})));
 check(isDeepStrictEqual(await localWeek(),goalTaskPlanAfter),"GOAL_TASK_STALE_NO_WRITE");
 log("OFFLINE_GOAL_TASK_STALE_LINK_NO_DUPLICATE");
 phase="OFFLINE_GOAL_TASK_KERNEL_SAVE";
 await page.locator("[data-club-week-summary]").getByRole("link",{name:"Сохранить план в рабочей области",exact:true}).click();
 const taskImport=page.getByTestId("club-t0-import-card");
 await taskImport.getByTestId("club-t0-import-preview").waitFor({state:"visible"});
 const taskScope=taskImport.getByTestId("club-t0-import-workspace-choice").filter({visible:true});
 await poll(async()=>await taskScope.count()===1,"GOAL_TASK_KERNEL_SCOPE_AVAILABLE");
 check(await taskScope.getAttribute("data-workspace-id")===base.scope,"GOAL_TASK_KERNEL_EXACT_SCOPE");
 if(await taskScope.getAttribute("aria-pressed")!=="true")await taskScope.click();
 await poll(async()=>await taskScope.getAttribute("aria-pressed")==="true","GOAL_TASK_KERNEL_SCOPE_FOCUSED");
 await taskImport.getByLabel("Подтверждаю сохранение изменений. При конфликте прежняя запись останется без изменений.",{exact:true}).check();
 const taskSave=taskImport.getByRole("button",{name:"Сохранить изменения",exact:true});
 await poll(async()=>await taskSave.isEnabled(),"GOAL_TASK_KERNEL_READY");
 await taskSave.click();
 await poll(async()=>{
  const w=await localWeek();return w?.kernelSource?.workspaceId===base.scope&&
   w.kernelSource.revision===goalTaskPlanBefore.kernelSource.revision+1&&w.kernelSource.syncedUpdatedAt===w.updatedAt;
 },"GOAL_TASK_KERNEL_NEXT_REVISION");
 log("OFFLINE_GOAL_TASK_ORIGINAL_KERNEL_RECEIPT");
 phase="OFFLINE_GOAL_NEW_PAYMENT_DRAFT";
 const newCashBefore=await localCash(),newCashObjects=await localObjects();
 await openComparison("new","new",{dateA:dates.today,startA:"11:30",minutesA:"30",expenseDateA:cashDates.today,expenseA:"1000",
  dateB:dates.future,startB:"12:30",minutesB:"45",expenseDateB:cashDates.future,expenseB:"2000"});
 check(isDeepStrictEqual(await localObjects(),newCashObjects)&&(await editorDrafts()).length===0,"GOAL_NEW_PAYMENT_COMPARE_READ_ONLY");
 await goalResourceB.getByRole("button",{name:"Подготовить платёж (вариант Б)",exact:true}).click();
 await cashEntry.waitFor({state:"visible"});
 await poll(async()=>await cashEntry.locator("[data-cash-calendar-save]").isEnabled()&&
  await cashEntry.locator('[name="amountRUB"]').inputValue()==="-2000","GOAL_NEW_PAYMENT_PREFILLED");
 const newCashUrl=new URL(page.url());
 check(newCashUrl.searchParams.get("club_cash_entry")==="new"&&newCashUrl.searchParams.get("workspace_id")===base.scope&&
  newCashUrl.searchParams.has("club_review_draft")&&!newCashUrl.searchParams.has("amountRUB"),"GOAL_NEW_PAYMENT_EXACT_ROUTE");
 check(await cashEntry.locator('[name="date"]').inputValue()===cashDates.future&&
  await cashEntry.locator('[name="status"]').inputValue()==="planned"&&
  await cashEntry.locator('[name="goalId"]').inputValue()===goalId&&!await cashEntry.getAttribute("data-edit-id"),"GOAL_NEW_PAYMENT_PREPARED_FIELDS");
 check(isDeepStrictEqual(await localObjects(),newCashObjects)&&(await editorDrafts()).length===1,"GOAL_NEW_PAYMENT_OPEN_DRAFT_ONLY");
 const newPaymentNote="Отдельный пробный расход";
 await cashEntry.locator('[name="note"]').fill(newPaymentNote);
 await cashEntry.locator("[data-cash-calendar-save]").click();
 await poll(async()=> (await localCash())?.data?.cashCalendar?.entries?.length===newCashBefore.data.cashCalendar.entries.length+1,"GOAL_NEW_PAYMENT_EXPLICIT_CREATE");
 const newPayment=(await localCash()).data.cashCalendar.entries.find(e=>e.note===newPaymentNote);
 check(!!newPayment&&newPayment.status==="planned"&&newPayment.goalId===goalId&&newPayment.amountRUB===-2000&&
  isDeepStrictEqual((await localCash()).data.cashCalendar.entries.filter(e=>e.id!==newPayment.id),newCashBefore.data.cashCalendar.entries),"GOAL_NEW_PAYMENT_ONE_PLAN");
 await poll(async()=>!new URL(page.url()).searchParams.has("club_review_draft")&&(await editorDrafts()).length===0,"GOAL_NEW_PAYMENT_DRAFT_CONSUMED");
 const newPaymentRow=page.locator("[data-cash-calendar-entries] tbody tr").filter({hasText:newPaymentNote});
 await newPaymentRow.waitFor({state:"visible"});
 page.once("dialog",async d=>{if(d.type()==="confirm")await d.accept();else await d.dismiss()});
 await newPaymentRow.getByRole("button",{name:"Удалить",exact:true}).click();
 await poll(async()=>isDeepStrictEqual((await localCash())?.data?.cashCalendar?.entries,newCashBefore.data.cashCalendar.entries),"GOAL_NEW_PAYMENT_EXPLICIT_REMOVAL");
 check(isDeepStrictEqual((await localCash()).data.cashCalendar.closedPeriods,newCashBefore.data.cashCalendar.closedPeriods),"GOAL_NEW_PAYMENT_HISTORY_UNCHANGED");
 await visit(page,"/projects/");
 await visit(page,newCashUrl.pathname+newCashUrl.search+newCashUrl.hash);
 await cashEntry.waitFor({state:"visible"});
 await poll(async()=>!(await cashEntry.locator("[data-cash-calendar-save]").isEnabled()),"GOAL_NEW_PAYMENT_CONSUMED_LINK_BLOCKED");
 await cashEntry.evaluate(form=>form.dispatchEvent(new Event("submit",{cancelable:true,bubbles:true})));
 check(isDeepStrictEqual((await localCash()).data.cashCalendar.entries,newCashBefore.data.cashCalendar.entries),"GOAL_NEW_PAYMENT_NO_REPLAY");
 log("OFFLINE_GOAL_NEW_PAYMENT_PREPARE_EXPLICIT_CREATE_NO_REPLAY");
 phase="OFFLINE_GOAL_PAYMENT_LINK";
 // Keep the preceding unlinked commitment assertion. Now explicitly link
 // that same outstanding payment to the goal, through its original editor.
 const originalCashBeforeTarget=await localCash();
 const originalPayment=originalCashBeforeTarget.data.cashCalendar.entries[0];
 check(originalPayment.status==="planned"&&originalPayment.amountRUB===-3000&&!originalPayment.goalId,"GOAL_PAYMENT_ORIGINAL_UNLINKED");
 await visit(page,"/tools/personal-economy/?workspace_id="+encodeURIComponent(base.scope)+"#club-money-calendar");
 await cashEntry.waitFor({state:"visible"});
 const paymentRow=page.locator("[data-cash-calendar-entries] tbody tr").filter({hasText:"Будущий платёж"});
 await paymentRow.getByRole("button",{name:"Изменить",exact:true}).click();
 check(await cashEntry.getAttribute("data-edit-id")===originalPayment.id,"GOAL_PAYMENT_MANUAL_ID");
 await cashEntry.locator('[name="goalId"]').selectOption(goalId);
 await cashEntry.locator("[data-cash-calendar-save]").click();
 await poll(async()=> (await localCash())?.data?.cashCalendar?.entries?.find(e=>e.id===originalPayment.id)?.goalId===goalId,"GOAL_PAYMENT_LINK_WRITTEN");
 const linkedPaymentCash=await localCash();
 check(linkedPaymentCash.data.cashCalendar.entries.length===1&&
  isDeepStrictEqual(linkedPaymentCash.data.cashCalendar.closedPeriods,originalCashBeforeTarget.data.cashCalendar.closedPeriods),"GOAL_PAYMENT_LINK_NO_DUPLICATE_OR_HISTORY_CHANGE");
 phase="OFFLINE_GOAL_PAYMENT_COMPARE";
 await visit(page,"/projects/?workspace_id="+encodeURIComponent(base.scope)+"&club_goal="+encodeURIComponent(goalId)+"#club-goal-map");
 await resourceOpen.click();
 await resourceForm.waitFor({state:"visible"});
 await poll(async()=>await resourceRun.isEnabled(),"GOAL_PAYMENT_SOURCE_READY");
 const linkedChoices=await resourceForm.locator('[name="entryId"] option').evaluateAll(nodes=>nodes.map(x=>x.value));
 check(isDeepStrictEqual(linkedChoices,["","new",originalPayment.id]),"GOAL_PAYMENT_EXACT_LINKED_CHOICE");
 await resourceForm.locator('[name="slotId"]').selectOption(goalResourceTask.id);
 await resourceForm.locator('[name="entryId"]').selectOption(originalPayment.id);
 check(await resourceForm.locator('[name="expenseDateA"]').inputValue()===originalPayment.date&&
  await resourceForm.locator('[name="expenseA"]').inputValue()==="3000","GOAL_PAYMENT_EXACT_PREFILL");
 await resourceForm.locator('[name="expenseDateB"]').fill(cashDates.nextEnd);
 await resourceRun.click();
 await poll(async()=>await resourceResult.getAttribute("data-iwxa-assistant-state")==="ready","GOAL_PAYMENT_COMPARE_READY");
 check(await resourceMetric(goalResourceA,"Прогноз к концу периода")===17000&&
  await resourceMetric(goalResourceB,"Прогноз к концу периода")===17000,"GOAL_PAYMENT_REPLACEMENT_NOT_ADDITION");
 const paymentLink=resourceResult.getByRole("link",{name:"Открыть исходный платёж",exact:true});
 const exactPaymentUrl=new URL(await paymentLink.getAttribute("href"),page.url());
 check(exactPaymentUrl.searchParams.get("club_cash_entry")===originalPayment.id&&
  exactPaymentUrl.searchParams.get("club_cash_goal")===goalId&&
  exactPaymentUrl.searchParams.get("club_cash_rev")===linkedPaymentCash.updatedAt&&
  exactPaymentUrl.searchParams.get("workspace_id")===base.scope&&
  exactPaymentUrl.hash==="#club-money-calendar","GOAL_PAYMENT_EXACT_TARGET");
 check(isDeepStrictEqual(await localCash(),linkedPaymentCash),"GOAL_PAYMENT_COMPARE_NO_WRITE");
 await paymentLink.click();
 phase="OFFLINE_GOAL_PAYMENT_TARGET_EDITOR";
 await cashEntry.waitFor({state:"visible"});
 await poll(async()=>await cashEntry.getAttribute("data-edit-id")===originalPayment.id&&await cashEntry.locator("[data-cash-calendar-save]").isEnabled(),"GOAL_PAYMENT_EDITOR_READY");
 check(await cashEntry.locator('[name="date"]').inputValue()===originalPayment.date&&
  await cashEntry.locator('[name="amountRUB"]').inputValue()==="-3000"&&
  await cashEntry.locator('[name="status"]').inputValue()==="planned"&&
  await cashEntry.locator('[name="goalId"]').inputValue()===goalId&&
  await cashEntry.locator('[name="note"]').inputValue()===originalPayment.note,"GOAL_PAYMENT_ORIGINAL_FIELDS");
 check(isDeepStrictEqual(await localCash(),linkedPaymentCash),"GOAL_PAYMENT_OPEN_NO_WRITE");
 phase="OFFLINE_GOAL_PAYMENT_SELECTED_DRAFT";
 const paymentDraftSources=await localObjects();
 await openComparison(goalResourceTask.id,originalPayment.id,{expenseDateB:cashDates.nextEnd});
 await goalResourceB.getByRole("button",{name:"Подготовить платёж (вариант Б)",exact:true}).click();
 await cashEntry.waitFor({state:"visible"});
 await poll(async()=>await cashEntry.locator('[name="date"]').inputValue()===cashDates.nextEnd&&
  await cashEntry.locator("[data-cash-calendar-save]").isEnabled(),"GOAL_PAYMENT_SELECTED_FIELDS");
 const paymentDraftUrl=new URL(page.url());
 check(paymentDraftUrl.searchParams.has("club_review_draft")&&paymentDraftUrl.searchParams.get("club_cash_entry")===originalPayment.id&&
  paymentDraftUrl.searchParams.get("club_cash_rev")===linkedPaymentCash.updatedAt&&paymentDraftUrl.searchParams.get("workspace_id")===base.scope,"GOAL_PAYMENT_SELECTED_ROUTE");
 check(await cashEntry.getAttribute("data-edit-id")===originalPayment.id&&await cashEntry.locator('[name="amountRUB"]').inputValue()==="-3000"&&
  await cashEntry.locator('[name="status"]').inputValue()==="planned"&&await cashEntry.locator('[name="goalId"]').inputValue()===goalId&&
  await cashEntry.locator('[name="category"]').inputValue()===originalPayment.category&&
  await cashEntry.locator('[name="note"]').inputValue()===originalPayment.note,"GOAL_PAYMENT_SELECTED_PRESERVES_ORIGINAL_FIELDS");
 check(isDeepStrictEqual(await localObjects(),paymentDraftSources)&&(await editorDrafts()).length===1,"GOAL_PAYMENT_SELECTED_OPEN_DRAFT_ONLY");
 await cashEntry.locator("[data-cash-calendar-save]").click();
 await poll(async()=> (await localCash())?.data?.cashCalendar?.entries?.find(e=>e.id===originalPayment.id)?.date===cashDates.nextEnd,"GOAL_PAYMENT_EXACT_EDIT_WRITTEN");
 const editedPaymentCash=await localCash();
 const expectedEditedPayment={...originalPayment,goalId,date:cashDates.nextEnd};
 check(editedPaymentCash.data.cashCalendar.entries.length===1&&
  isDeepStrictEqual(editedPaymentCash.data.cashCalendar.entries[0],expectedEditedPayment)&&
  isDeepStrictEqual(editedPaymentCash.data.cashCalendar.closedPeriods,originalCashBeforeTarget.data.cashCalendar.closedPeriods),"GOAL_PAYMENT_SAME_ID_AND_HISTORY");
 log("OFFLINE_GOAL_PAYMENT_EXACT_EDITOR_ONE_CHANGE");
 await poll(async()=>["club_review_draft","club_cash_entry","club_cash_goal","club_cash_rev"].every(key=>!new URL(page.url()).searchParams.has(key))&&
  (await editorDrafts()).length===0,"GOAL_PAYMENT_SELECTED_DRAFT_CONSUMED");
 check(new URL(page.url()).searchParams.get("workspace_id")===base.scope&&new URL(page.url()).hash===exactPaymentUrl.hash,"GOAL_PAYMENT_ROUTE_CONTEXT_RETAINED");
 log("OFFLINE_GOAL_PAYMENT_SELECTED_DRAFT_ONE_CHANGE");
 phase="OFFLINE_GOAL_PAYMENT_RETURN_COMPARISON";
 const paymentResumeObjects=await localObjects();
 const paymentReturn=page.locator("[data-cash-calendar-return-review]");
 await paymentReturn.waitFor({state:"visible"});await paymentReturn.click();
 await resourceForm.waitFor({state:"visible"});await resumeInput.waitFor({state:"visible"});
 await poll(async()=>!new URL(page.url()).searchParams.has("club_review_resume")&&await resourceRun.isEnabled(),"GOAL_PAYMENT_RESUME_ROUTE_CONSUMED");
 check(await resourceForm.locator('[name="slotId"]').inputValue()===""&&await resourceForm.locator('[name="entryId"]').inputValue()===originalPayment.id&&
  await resourceForm.locator('[name="expenseDateA"]').inputValue()===cashDates.nextEnd&&
  await resourceForm.locator('[name="expenseDateB"]').inputValue()===cashDates.nextEnd&&
  await resourceForm.locator('[name="expenseA"]').inputValue()==="3000"&&
  await resourceForm.locator('[name="expenseB"]').inputValue()==="3000"&&
  await resourceResult.getAttribute("data-iwxa-assistant-state")==="empty","GOAL_PAYMENT_RESUME_EXACT_APPLIED_RECORD");
 check(isDeepStrictEqual(await localObjects(),paymentResumeObjects),"GOAL_PAYMENT_RESUME_NO_RESULT_WRITE");
 await resourceForm.locator('[name="slotId"]').selectOption(goalResourceTask.id);
 await resumeInput.click();
 check(await resourceForm.locator('[name="expenseDateA"]').inputValue()===originalPayment.date&&
  await resourceForm.locator('[name="expenseDateB"]').inputValue()===cashDates.nextEnd&&
  await resourceForm.locator('[name="expenseA"]').inputValue()==="3000"&&
  await resourceForm.locator('[name="expenseB"]').inputValue()==="3000"&&
  await resourceResult.getAttribute("data-iwxa-assistant-state")==="empty","GOAL_PAYMENT_RESUME_OLD_INPUTS_NOT_RESULT");
 await resourceRun.click();
 await poll(async()=>await resourceResult.getAttribute("data-iwxa-assistant-state")==="ready","GOAL_PAYMENT_RESUME_RECALCULATED");
 check(isDeepStrictEqual(await localObjects(),paymentResumeObjects)&&(await localDrafts()).every(x=>x.draftId!=="goal-resource-review-resume"),"GOAL_PAYMENT_RESUME_RECALC_NO_WRITE");
 log("OFFLINE_GOAL_PAYMENT_RETURN_FRESH_COMPARISON");
 phase="OFFLINE_GOAL_PAYMENT_STALE_LINK";
 // A consumed link is removed from the current URL; revisit from a different
 // document so the stale-link test cannot be satisfied by same-document navigation.
 await visit(page,"/projects/");
 await visit(page,exactPaymentUrl.pathname+exactPaymentUrl.search+exactPaymentUrl.hash);
 await cashEntry.waitFor({state:"visible"});
 await poll(async()=>await page.locator("[data-cash-calendar-target]").isVisible()&&
  (await page.locator("[data-cash-calendar-target]").textContent()).includes("изменились"),"GOAL_PAYMENT_STALE_NOTICE");
 check(!(await cashEntry.locator("[data-cash-calendar-save]").isEnabled())&&
  !(await cashEntry.getAttribute("data-edit-id")),"GOAL_PAYMENT_STALE_EDIT_BLOCKED");
 // Even a submit event must not bypass the disabled button.
 await cashEntry.evaluate(form=>form.dispatchEvent(new Event("submit",{cancelable:true,bubbles:true})));
 check(isDeepStrictEqual(await localCash(),editedPaymentCash),"GOAL_PAYMENT_STALE_NO_WRITE");
 log("OFFLINE_GOAL_PAYMENT_STALE_LINK_NO_DUPLICATE");
 phase="OFFLINE_GOAL_PAYMENT_KERNEL_SAVE";
 await page.locator("[data-cash-calendar-persist]").getByRole("link",{name:"Сохранить календарь на устройстве",exact:true}).click();
 const paymentImport=page.getByTestId("club-t0-import-card");
 await paymentImport.getByTestId("club-t0-import-preview").waitFor({state:"visible"});
 const paymentScope=paymentImport.getByTestId("club-t0-import-workspace-choice").filter({visible:true});
 await poll(async()=>await paymentScope.count()===1,"GOAL_PAYMENT_KERNEL_SCOPE_AVAILABLE");
 check(await paymentScope.getAttribute("data-workspace-id")===base.scope,"GOAL_PAYMENT_KERNEL_EXACT_SCOPE");
 if(await paymentScope.getAttribute("aria-pressed")!=="true")await paymentScope.click();
 await poll(async()=>await paymentScope.getAttribute("aria-pressed")==="true","GOAL_PAYMENT_KERNEL_SCOPE_FOCUSED");
 await paymentImport.getByLabel("Подтверждаю сохранение изменений. При конфликте прежняя запись останется без изменений.",{exact:true}).check();
 const paymentSave=paymentImport.getByRole("button",{name:"Сохранить изменения",exact:true});
 await poll(async()=>await paymentSave.isEnabled(),"GOAL_PAYMENT_KERNEL_READY");
 await paymentSave.click();
 await poll(async()=>{
  const c=await localCash();return c?.kernelSource?.workspaceId===base.scope&&
   c.kernelSource.revision===originalCashBeforeTarget.kernelSource.revision+1&&c.kernelSource.syncedUpdatedAt===c.updatedAt;
 },"GOAL_PAYMENT_KERNEL_NEXT_REVISION");
 log("OFFLINE_GOAL_PAYMENT_ORIGINAL_KERNEL_RECEIPT");

 phase="OFFLINE_CASH_COLD_READBACK";
 await close();page=await launch("recipient");await context.setOffline(true);
 await visit(page,"/workspace/");await openExisting(page);
 const cashToday=page.getByTestId("club-native-today");
 await cashToday.waitFor({state:"visible"});
 await poll(async()=>/12[\s\u00a0]000/.test(await cashToday.textContent()),"CASH_NATIVE_AVAILABLE_AFTER_BILL_AND_BUFFER");
 check(!(await localCash()),"CASH_COLD_NO_TAB_RESULT");
 check(await page.evaluate(()=>navigator.onLine===false),"CASH_OFFLINE_MODE");
 log("OFFLINE_CASH_COLD_NATIVE_READBACK");
 phase="OFFLINE_AGENDA_QUICK_COMPLETE";
 check(!(await localWeek()),"AGENDA_QUICK_COLD_NO_TAB");
 const doneButton=cashToday.getByRole("button",{name:"Отметить выполненным: "+titles[0],exact:true});
 await doneButton.waitFor({state:"visible"});
 await doneButton.click();
 await page.getByTestId("club-week-quick-status").getByText("Дело отмечено выполненным и сохранено на устройстве.",{exact:true}).waitFor({state:"visible"});
 await poll(async()=>await cashToday.isVisible()&&(await cashToday.textContent()).includes("Отмечено выполненными: 1"),"AGENDA_QUICK_REVIEW");
 check(!(await localWeek()),"AGENDA_QUICK_NO_TAB_MUTATION");
 log("OFFLINE_AGENDA_QUICK_COMPLETION_RECEIPT");
 phase="OFFLINE_AGENDA_QUICK_COLD";
 await close();page=await launch("recipient");await context.setOffline(true);
 await visit(page,"/workspace/");await openExisting(page);
 const finalToday=page.getByTestId("club-native-today");
 await finalToday.waitFor({state:"visible"});
 await poll(async()=>(await finalToday.textContent()).includes("Отмечено выполненными: 1"),"AGENDA_QUICK_COLD_DONE");
 check(await finalToday.getByRole("button",{name:"Отметить выполненным: "+titles[0],exact:true}).count()===0,"AGENDA_QUICK_NO_REPEAT_ACTION");
 check(await finalToday.getByText(titles[1],{exact:true}).count()===1,"AGENDA_OTHER_TASK_RETAINED");
 check(!(await localWeek()),"AGENDA_QUICK_COLD_NO_TAB_RESULT");
 log("OFFLINE_AGENDA_QUICK_COLD_READBACK");
 phase="OFFLINE_CASH_RESTORE_SELECTION";
 await finalToday.getByRole("button",{name:"Открыть денежные записи",exact:true}).click();
 const cashRestore=page.getByTestId("club-t2-restore-card");
 await cashRestore.waitFor({state:"visible"});
 await poll(async()=>await cashRestore.locator('input[type="checkbox"]:checked').count()===1,"CASH_RESTORE_EXACT_SELECTION");
 const cashRestoreButton=cashRestore.getByRole("button",{name:"Открыть выбранные записи",exact:true});
 await poll(async()=>await cashRestoreButton.isEnabled(),"CASH_RESTORE_READY");
 let cashConsent=false;
 page.once("dialog",async d=>{
  cashConsent=d.type()==="confirm"&&d.message().includes("Загрузить 1 новых");
  if(cashConsent)await d.accept();else await d.dismiss();
 });
 await cashRestoreButton.click();
 await poll(async()=>cashConsent,"CASH_RESTORE_CONSENT");
 phase="OFFLINE_CASH_RESTORE_HISTORY";
 const openCash=page.getByTestId("club-t2-restore-completed").getByRole("link",{name:"Открыть денежный календарь",exact:true});
 await openCash.waitFor({state:"visible"});
 const cashTarget=new URL(await openCash.getAttribute("href"),page.url());
 check(cashTarget.hash==="#club-money-calendar"&&cashTarget.searchParams.get("workspace_id")===base.scope,"CASH_RESTORE_EXACT_ROUTE");
 await openCash.click();
 await page.locator("[data-cash-calendar-setup]").waitFor({state:"visible"});
 const restoredCash=await localCash();
 check(restoredCash?.kernelSource?.workspaceId===base.scope&&restoredCash.data.cashCalendar.closedPeriods.length===1,"CASH_RESTORED_HISTORICAL_RESULT");
 const history=page.locator("#club-cash-history");
 if(!await history.evaluate(el=>el.open))await history.locator(":scope > summary").click();
 await history.locator("[data-cash-calendar-history-detail]").getByText("Полученная зарплата",{exact:true}).waitFor({state:"visible"});
 check(await page.evaluate(()=>navigator.onLine===false),"CASH_RESTORED_OFFLINE");
 log("OFFLINE_CASH_HISTORY_RESTORED_AND_CONTINUED");
 check(restoredCash.data.cashCalendar.entries.length===1&&isDeepStrictEqual(restoredCash.data.cashCalendar.entries[0],expectedEditedPayment),"GOAL_PAYMENT_COLD_EXACT_ENTRY");
 check(isDeepStrictEqual(restoredCash.data.cashCalendar.closedPeriods,originalCashBeforeTarget.data.cashCalendar.closedPeriods),"GOAL_PAYMENT_COLD_EXACT_HISTORY");
 log("OFFLINE_GOAL_PAYMENT_COLD_EXACT_ENTRY");
 check(isDeepStrictEqual(restoredCash.data.cashCalendar.closedPeriods[0].entries.find(e=>e.id===plannedTool.id),settledTool),"CASH_COLD_EXACT_PLAN_FACT");
 log("OFFLINE_CASH_PLAN_FACT_KERNEL_READBACK");

 await verifyExpenseAlternatives("OFFLINE_RESTORED_EXPENSE_ALTERNATIVES");
 phase="OFFLINE_FACT_RESTORE_WEEK";
 await visit(page,"/workspace/");await openExisting(page);
 const factToday=page.getByTestId("club-native-today");
 await factToday.getByRole("button",{name:"Открыть дела недели",exact:true}).click();
 const factRestore=page.getByTestId("club-t2-restore-card");
 await factRestore.waitFor({state:"visible"});
 await poll(async()=>await factRestore.locator('input[type="checkbox"]:checked').count()===1,"FACT_EXACT_WEEK");
 const restoreFactButton=factRestore.getByRole("button",{name:"Открыть выбранные записи",exact:true});
 await poll(async()=>await restoreFactButton.isEnabled(),"FACT_RESTORE_READY");
 let factConsent=false;
 page.once("dialog",async d=>{
  factConsent=d.type()==="confirm"&&d.message().includes("Загрузить 1 новых");
  if(factConsent)await d.accept();else await d.dismiss();
 });
 await restoreFactButton.click();
 await poll(async()=>factConsent,"FACT_RESTORE_CONSENT");
 await page.getByTestId("club-t2-restore-completed").getByRole("link",{name:"Открыть мою неделю",exact:true}).click();
 const factPlan=await localWeek();
 check(factPlan?.kernelSource?.workspaceId===base.scope&&factPlan.data.personalWeekPlan.slots.length===6,"FACT_WEEK_SIX_SLOTS");
 const originalDone=factPlan.data.personalWeekPlan.slots.find(s=>s.title===titles[0]);
 check(originalDone?.status==="done"&&originalDone.fact===undefined,"FACT_UNKNOWN_ON_SIMPLE_COMPLETE");
 check(originalDone.id===goalResourceTask.id&&originalDone.start==="10:15"&&originalDone.date===goalResourceTask.date&&
  originalDone.durationMinutes===90&&originalDone.projectId===goalId,"GOAL_TASK_COLD_EXACT_EDIT");
 log("OFFLINE_GOAL_TASK_COLD_EXACT_ENTRY");
 phase="OFFLINE_FACT_RECORD";
 const factCard=page.locator(".club-week-entry").filter({has:page.getByText(titles[0],{exact:true})});
 await factCard.waitFor({state:"visible"});
 const factDetails=factCard.locator("details").filter({has:page.getByText("Записать фактическое время",{exact:true})});
 await factDetails.locator(":scope > summary").click();
 await factDetails.getByLabel("Дата, когда вы занимались делом",{exact:true}).fill(dates.today);
 await factDetails.getByLabel("Фактически потрачено минут",{exact:true}).fill("110");
 await factDetails.getByRole("button",{name:"Записать время",exact:true}).click();
 await poll(async()=>{
  const w=await localWeek(),slot=w?.data?.personalWeekPlan?.slots?.find(s=>s.id===originalDone.id);
  return slot?.fact?.minutes===110&&slot.fact.plannedMinutes===90&&slot.durationMinutes===90&&slot.status==="done";
 },"FACT_EXPLICIT_MINUTES");
 await page.locator("[data-club-week-summary]").getByText(/На 20 мин\. больше плана/).waitFor({state:"visible"});
 const withFact=await localWeek();
 check(withFact.data.personalWeekPlan.slots.length===6&&withFact.kernelSource.revision===factPlan.kernelSource.revision,"FACT_ONLY_LOCAL_REVISION");
 log("OFFLINE_FACT_PLAN_COMPARISON");
 phase="OFFLINE_FACT_KERNEL_UPDATE";
 await page.locator("[data-club-week-summary]").getByRole("link",{name:"Сохранить план в рабочей области",exact:true}).click();
 const factImport=page.getByTestId("club-t0-import-card");
 await factImport.getByTestId("club-t0-import-preview").waitFor({state:"visible"});
 const factScope=factImport.getByTestId("club-t0-import-workspace-choice").filter({visible:true});
 await poll(async()=>await factScope.count()===1,"FACT_SCOPE_AVAILABLE");
 check(await factScope.getAttribute("data-workspace-id")===base.scope,"FACT_ORIGINAL_SCOPE");
 if(await factScope.getAttribute("aria-pressed")!=="true")await factScope.click();
 await poll(async()=>await factScope.getAttribute("aria-pressed")==="true","FACT_SCOPE_FOCUSED");
 await factImport.getByLabel("Подтверждаю сохранение изменений. При конфликте прежняя запись останется без изменений.",{exact:true}).check();
 const factSave=factImport.getByRole("button",{name:"Сохранить изменения",exact:true});
 await poll(async()=>await factSave.isEnabled(),"FACT_KERNEL_READY");
 await factSave.click();
 await poll(async()=>{
  const w=await localWeek();return w?.kernelSource?.revision===factPlan.kernelSource.revision+1&&w.kernelSource.syncedUpdatedAt===w.updatedAt;
 },"FACT_KERNEL_RECEIPT");
 log("OFFLINE_FACT_ORIGINAL_KERNEL_RECEIPT");
 phase="OFFLINE_FACT_COLD";
 await close();page=await launch("recipient");await context.setOffline(true);
 await visit(page,"/workspace/");await openExisting(page);
 const factCold=page.getByTestId("club-native-today");
 await factCold.waitFor({state:"visible"});
 await poll(async()=>(await factCold.textContent()).includes("план 90 мин., факт 110 мин."),"FACT_NATIVE_MATCHED_COMPARISON");
 check(!(await localWeek()),"FACT_COLD_NO_TAB_RESULT");
 log("OFFLINE_FACT_COLD_NATIVE_READBACK");
 phase="OFFLINE_GOAL_COMBINED_READBACK";
 const goalCold=page.getByTestId("club-native-goals");
 await goalCold.waitFor({state:"visible"});
 check((await goalCold.textContent()).includes(goalTitle),"GOAL_SAVED_TITLE");
 await poll(async()=>(await goalCold.textContent()).includes("Записано времени по делам: 110 мин."),"GOAL_SAVED_ACTUAL_MINUTES");
 check(/Расходы: 17[\s\u00a0]000/.test(await goalCold.textContent()),"GOAL_SAVED_CLOSED_EXPENSE");
 check(/Связанные поступления: 0/.test(await goalCold.textContent())&&!/25[\s\u00a0]000/.test(await goalCold.textContent()),"GOAL_EXCLUDES_UNLINKED_SALARY");
 check(!(await localGoal()),"GOAL_COLD_NO_TAB_RESULT");
 log("OFFLINE_GOAL_LINKED_ACTIVITY_AND_FINANCE_READBACK");
 phase="OFFLINE_GOAL_ASSESSMENT_COLD";
 check(!(await localProof()),"ASSESSMENT_COLD_NO_TAB_RESULT");
 await poll(async()=>(await goalCold.getByTestId("club-native-goal-assessment").textContent()).includes("достигнута частично"),"ASSESSMENT_COLD_NATIVE_READBACK");
 check((await goalCold.textContent()).includes(proofResult),"ASSESSMENT_COLD_RESULT");
 async function restoreAssessment(prefix){
  const goals=page.getByTestId("club-native-goals");
  await goals.getByRole("button",{name:"Открыть основание цели: "+goalTitle,exact:true}).click();
  const card=page.getByTestId("club-t2-restore-card");
  await card.waitFor({state:"visible"});
  await poll(async()=>await card.locator('input[type="checkbox"]:checked').count()===2,prefix+"_RELATED_SOURCE_SELECTION");
  const button=card.getByRole("button",{name:"Открыть выбранные записи",exact:true});
  await poll(async()=>await button.isEnabled(),prefix+"_READY");
  let consent=false;
  page.once("dialog",async d=>{
   consent=d.type()==="confirm"&&d.message().includes("Загрузить 2 новых");
   if(consent)await d.accept();else await d.dismiss();
  });
  await button.click();await poll(async()=>consent,prefix+"_CONSENT");
  const link=page.getByTestId("club-t2-restore-completed").getByRole("link",{name:"Открыть выбранное основание",exact:true});
  await link.waitFor({state:"visible"});
  check(new URL(await link.getAttribute("href"),page.url()).searchParams.get("club_proof")===proofId,prefix+"_EXACT_PROOF");
  await link.click();
  const form=page.locator("form[data-club-proof-form]");
  await form.waitFor({state:"visible"});
  await poll(async()=>await form.locator('[name="result"]').inputValue()===proofResult,prefix+"_RESULT");
  check(await form.locator('[name="basis"]').inputValue()===proofBasis&&
   await form.locator('[name="check"]').inputValue()===proofCheck&&
   await form.locator('[name="goalAssessment"]').inputValue()==="partial",prefix+"_BASIS_AND_CHECK");
  check(await form.locator("[data-club-proof-source]").inputValue()===goalId&&
   await form.locator("[data-club-proof-source]").isDisabled(),prefix+"_EXACT_LOCKED_SOURCE");
  check(await form.locator('[name="goalAssessment"]').isDisabled(),prefix+"_ORIGINAL_DECISION_LOCKED");
  const p=await localProof(),g=await localGoal();
  check(p?.objectId===proofId&&g?.objectId===goalId&&
   p.data.personalEvidence.source.updatedAt===goalRevision&&p.kernelSource.workspaceId===g.kernelSource.workspaceId,prefix+"_EXACT_LINK_READBACK");
  if(g.updatedAt!==goalRevision){
   const events=g.data.goalLifecycle?.events;
   check(Array.isArray(events)&&events.length===3&&events[0].previousUpdatedAt===goalRevision&&events.at(-1).recordedAt===g.updatedAt,prefix+"_ORIGINAL_LIFECYCLE_CHAIN");
  }
 }
 await restoreAssessment("ASSESSMENT_COLD");
 log("OFFLINE_GOAL_ASSESSMENT_EXACT_SOURCE_REOPEN");
 phase="OFFLINE_GOAL_REVIEW_NEW_ASSESSMENT_CONTEXT";
 await visit(page,"/projects/?workspace_id="+encodeURIComponent(base.scope)+"&club_goal="+encodeURIComponent(goalId)+"#club-goal-map");
 const reviewBefore=await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"));
 await page.locator("[data-club-goal-list]").getByRole("button",{name:"Оценить результат",exact:true}).click();
 const reviewProofForm=page.locator("form[data-club-proof-form]");
 await reviewProofForm.waitFor({state:"visible"});
 const reviewNote=await reviewProofForm.locator("[data-club-proof-source-note]").textContent();
 check(reviewNote.includes("Предыдущий записанный результат: "+proofResult)&&reviewNote.includes("Проверена комплектность"),"GOAL_REVIEW_PREVIOUS_RESULT_AND_CRITERION");
 check(await reviewProofForm.locator('[name="result"]').inputValue()===""&&await reviewProofForm.locator('[name="basis"]').inputValue()===""&&
  await reviewProofForm.locator('[name="goalAssessment"]').inputValue()==="","GOAL_REVIEW_NEW_ASSESSMENT_NOT_COPIED");
 check(await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"))===reviewBefore,"GOAL_REVIEW_NEW_ASSESSMENT_NO_WRITE");
 log("OFFLINE_GOAL_REVIEW_PREVIOUS_RESULT_CONTEXT");
 async function changeGoalState(status,reason,reviewDate=null){
  phase="OFFLINE_GOAL_LIFECYCLE_"+status.toUpperCase();
  await visit(page,"/projects/?workspace_id="+encodeURIComponent(base.scope)+"&club_goal="+encodeURIComponent(goalId)+"#club-goal-map");
  const form=page.locator("[data-club-goal-form]");
  await form.locator("[data-club-goal-lifecycle]").waitFor({state:"visible"});
  const before=await localGoal(),oldProof=await localProof();
  check(before?.objectId===goalId&&before.kernelSource?.syncedUpdatedAt===before.updatedAt,"LIFECYCLE_PREVIOUS_RECEIPT");
  await form.locator("[data-club-goal-life-state]").selectOption(status);
  await form.locator("[data-club-goal-life-reason]").fill(reason);
  if(reviewDate)await form.locator("[data-club-goal-life-review]").fill(reviewDate);
  if(status==="completed"){
   await form.locator("[data-club-goal-life-apply]").click();
   check((await localGoal()).updatedAt===before.updatedAt,"LIFECYCLE_COMPLETION_NO_ACK_NO_WRITE");
   await form.locator("[data-club-goal-life-ack]").check();
  }
  await form.locator("[data-club-goal-life-apply]").click();
  await poll(async()=> (await localGoal())?.data?.goalLifecycle?.status===status,"LIFECYCLE_LOCAL_STATE");
  const changed=await localGoal(),history=changed.data.goalLifecycle.events;
  check(history.at(-1).previousUpdatedAt===before.updatedAt&&history.at(-1).recordedAt===changed.updatedAt&&changed.data.updatedAt===changed.updatedAt,"LIFECYCLE_EXACT_REVISION_CHAIN");
  check(JSON.stringify(await localProof())===JSON.stringify(oldProof),"LIFECYCLE_DOES_NOT_REWRITE_PROOF");
  await poll(async()=>(await page.locator("[data-club-goal-list]").textContent()).includes("По моей оценке: достигнута частично"),"LIFECYCLE_ASSESSMENT_STILL_APPLIES");
  if(status==="deferred"){
   const beforeFilter=await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"));
   const filter=page.locator("[data-club-goal-filter]");
   await filter.selectOption("attention");
   const panel=page.locator("[data-club-goal-list]"),reason=panel.locator("[data-club-goal-review-issues]");
   check(await panel.getByRole("heading",{name:goalTitle,exact:true}).count()===1,"GOAL_REVIEW_FILTER_EXACT_GOAL");
   check(await reason.evaluate(el=>el.open)&&
    (await reason.textContent()).includes("Наступила выбранная дата возврата: "+reviewDate),"GOAL_REVIEW_FILTER_EXPLICIT_DATE");
   await filter.selectOption("all");
   check(await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"))===beforeFilter,"GOAL_REVIEW_FILTER_NO_WRITE");
   log("OFFLINE_GOAL_REVIEW_FILTER_EXPLICIT_DATE");
  }
  const saveLink=page.locator("[data-club-goal-list]").getByRole("link",{name:"Сохранить в IWXA",exact:true});
  await saveLink.click();
  const card=page.getByTestId("club-t0-import-card");
  await card.getByTestId("club-t0-import-preview").waitFor({state:"visible"});
  const scope=card.getByTestId("club-t0-import-workspace-choice").filter({visible:true});
  await poll(async()=>await scope.count()===1,"LIFECYCLE_SCOPE_AVAILABLE");
  check(await scope.getAttribute("data-workspace-id")===base.scope,"LIFECYCLE_EXACT_SCOPE");
  if(await scope.getAttribute("aria-pressed")!=="true")await scope.click();
  await poll(async()=>await scope.getAttribute("aria-pressed")==="true","LIFECYCLE_SCOPE_FOCUSED");
  await card.getByLabel("Подтверждаю сохранение изменений. При конфликте прежняя запись останется без изменений.",{exact:true}).check();
  const save=card.getByRole("button",{name:"Сохранить изменения",exact:true});
  await poll(async()=>await save.isEnabled(),"LIFECYCLE_KERNEL_READY");
  await save.click();
  await poll(async()=>{const g=await localGoal();return g?.objectId===goalId&&g.kernelSource?.revision===before.kernelSource.revision+1&&g.kernelSource.syncedUpdatedAt===g.updatedAt&&g.data.goalLifecycle.status===status},"LIFECYCLE_KERNEL_RECEIPT");
 }
 await changeGoalState("deferred","Сначала завершить текущие обязательства",dates.today);
 await changeGoalState("active","Появилось время для пересмотра результата");
 await changeGoalState("completed","Завершаю работу с частично достигнутым результатом");
 const lifecycleBeforeExport=(await localGoal()).data.goalLifecycle;
 check(lifecycleBeforeExport.events.length===3&&lifecycleBeforeExport.events[2].assessment.proofId===proofId&&lifecycleBeforeExport.events[2].assessment.status==="partial","LIFECYCLE_THREE_HUMAN_DECISIONS");
 log("OFFLINE_GOAL_LIFECYCLE_THREE_ORIGINAL_KERNEL_REVISIONS");
 phase="OFFLINE_GOAL_LIFECYCLE_COLD";
 await close();page=await launch("recipient");await context.setOffline(true);
 await visit(page,"/workspace/");await openExisting(page);
 const lifecycleCold=page.getByTestId("club-native-goals");
 await poll(async()=>(await lifecycleCold.getByTestId("club-native-goal-lifecycle").textContent()).includes("Завершена"),"LIFECYCLE_COLD_STATE");
 check((await lifecycleCold.getByTestId("club-native-goal-assessment").textContent()).includes("достигнута частично"),"LIFECYCLE_COLD_PARTIAL_ASSESSMENT");
 check((await lifecycleCold.textContent()).includes("Записано времени по делам: 110 мин.")&&/Расходы: 17[\s\u00a0]000/.test(await lifecycleCold.textContent()),"LIFECYCLE_COLD_FACTS_PRESERVED");
 async function verifyGoalReview(prefix,panel){
  phase=prefix;
  const before=await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"));
  await poll(async()=>(await panel.getByTestId("club-native-goal-review-count").textContent()).includes("К проверке по сохранённым записям: 1"),prefix+"_COUNT");
  const detail=panel.getByTestId("club-native-goal-review");
  if(!await detail.evaluate(el=>el.open))await detail.locator(":scope > summary").click();
  check((await detail.textContent()).includes("Остались обязательства: дел 0, денежных планов 1"),prefix+"_INACTIVE_OBLIGATIONS");
  check(!(await detail.textContent()).includes("В открытом недельном плане нет незавершённого дела"),prefix+"_NO_AUTOMATIC_NEXT_STEP");
  await detail.locator(":scope > summary").click();
  check(await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"))===before,prefix+"_NO_WRITE");
  log(prefix);
 }
 await verifyGoalReview("OFFLINE_NATIVE_GOAL_REVIEW_READ_ONLY",lifecycleCold);
 const reviewStart=dates.past<cashDates.first?dates.past:cashDates.first;
 const reviewThrough=await page.evaluate(()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)});
 async function verifyPeriodReview(prefix){
  phase=prefix;
  const panel=page.getByTestId("club-native-activity-review");
  await panel.waitFor({state:"visible"});
  const tabBefore=await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"));
  if(!await panel.evaluate(el=>el.open))await panel.locator(":scope > summary").click();
  const select=panel.locator("[data-club-review-period]");
  await select.waitFor({state:"visible"});
  await select.selectOption("custom");
  await panel.locator("[data-club-review-start]").fill(reviewStart);
  await panel.locator("[data-club-review-end]").fill(reviewThrough);
  await panel.locator("[data-club-review-apply]").click();
  const result=panel.locator("[data-club-activity-review-result]");
  const cards=result.locator(":scope > .club-review-grid > article");
  await poll(async()=>await cards.count()===4,prefix+"_FOUR_SEPARATE_SOURCES");
  const value=async(index,label)=>{
   const row=cards.nth(index).locator("p.club-review-line").filter({hasText:label});
   check(await row.count()===1,prefix+"_EXACT_METRIC");
   return Number((await row.locator("strong").textContent()).replace(/[^0-9]/g,""));
  };
  check(await value(0,"Фактическое время")===110,prefix+"_DATED_FACT_TIME");
  check(await value(0,"План для этих фактов")===90,prefix+"_MATCHED_PLAN");
  check(await value(1,"Записанные поступления")===25000,prefix+"_INCOME_NO_CARRIED_BALANCE");
  check(await value(1,"Записанные расходы")===17000,prefix+"_CLOSED_EXPENSE");
  check(await value(1,"Плановых операций")===0,prefix+"_FUTURE_PLANS_EXCLUDED");
  check(/Сумма абсолютных отклонений времени: 20 мин/.test(await cards.nth(0).textContent()),prefix+"_TIME_ABSOLUTE_ESTIMATE");
  const cashReviewText=await cards.nth(1).textContent();
  check(/Расходы с известным планом: 1\. План: 16[\s\u00a0]000 руб\.; факт: 17[\s\u00a0]000 руб\.; отклонение: \+1[\s\u00a0]000 руб/.test(cashReviewText)&&
   /Дата раньше: 0; по плану: 0; позже: 1/.test(cashReviewText)&&
   /Факты без сохранённого плана: 1/.test(cashReviewText),prefix+"_CASH_MATCHED_ESTIMATE_ONLY");
  check(await value(3,"Решений о завершении")===1,prefix+"_ONE_COMPLETION");
  check(await value(3,"Записано оценок")===1,prefix+"_ONE_PERSONAL_ASSESSMENT");
  check((await cards.nth(3).textContent()).includes("частично: 1"),prefix+"_PARTIAL_NOT_ACHIEVED");
  check((await result.textContent()).includes("По сохранённым записям этой рабочей области"),prefix+"_SAVED_SCOPE");
  check((await cards.nth(1).textContent()).includes("из"),prefix+"_COVERAGE_DISCLOSED");
  const follow=result.locator("[data-club-review-followup]");
  await follow.locator(":scope > summary").click();
  const overdue=follow.locator('[data-club-review-followup-code="overdue-personal"]');
  await overdue.getByRole("button",{name:"Открыть дело",exact:true}).waitFor({state:"visible"});
  const estimate=follow.locator('[data-club-review-followup-code="review-estimates"]');
  check((await estimate.textContent()).includes("20 мин."),prefix+"_MATCHED_DEVIATION_FOLLOWUP");
  await follow.locator('[data-club-review-followup-code="cash-coverage"]').getByRole("button",{name:"Открыть денежный календарь",exact:true}).waitFor({state:"visible"});
  const cashEstimateFollow=follow.locator('[data-club-review-followup-code="review-cash-estimates"]');
  await cashEstimateFollow.getByRole("button",{name:"Открыть денежный календарь",exact:true}).waitFor({state:"visible"});
  check((await cashEstimateFollow.textContent()).includes("Сумма отличалась от плана у 1, дата у 1"),prefix+"_CASH_ESTIMATE_FOLLOWUP");
  log(prefix+"_FOLLOWUP_SOURCE_ACTIONS");
  const goalGroup=result.locator("details").filter({has:page.getByText("По личным целям (1)",{exact:true})});
  await goalGroup.locator(":scope > summary").click();
  const linked=goalGroup.locator("article").filter({has:page.getByRole("heading",{name:goalTitle,exact:true})});
  check(await linked.count()===1,prefix+"_EXACT_GOAL");
  check(/17[\s\u00a0]000/.test(await linked.textContent())&&!/25[\s\u00a0]000/.test(await linked.textContent()),prefix+"_NO_UNLINKED_SALARY");
  check(/Расходы с известным планом: 1\. План: 16[\s\u00a0]000 руб/.test(await linked.textContent())&&
   !/Поступления с известным планом/.test(await linked.textContent()),prefix+"_GOAL_EXACT_CASH_ESTIMATE");
  check(await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"))===tabBefore,prefix+"_NO_TAB_MUTATION");
  await panel.locator(":scope > summary").click();
  log(prefix);
 }
 await verifyPeriodReview("OFFLINE_NATIVE_PERIOD_REVIEW");
 await restoreAssessment("LIFECYCLE_COLD_RESTORE");
 verifyHistory((await localGoal()).data.goalLifecycle,lifecycleBeforeExport,"LIFECYCLE_COLD");
 log("OFFLINE_GOAL_LIFECYCLE_COLD_READBACK");
 phase="OFFLINE_FULL_PERSONAL_EXPORT";
 await visit(page,"/workspace/exchange/#/home");
 await page.getByTestId("packages-tab-export").click();
 const fullExport=page.getByTestId("export-view");
 const fullWorkboxes=fullExport.locator("fieldset").filter({has:page.getByText("Рабочие области",{exact:true})}).locator('input[type="checkbox"]');
 await poll(async()=>await fullWorkboxes.count()===1,"PERSONAL_EXPORT_ONE_WORKSPACE");
 if(!await fullWorkboxes.first().isChecked())await fullWorkboxes.first().check();
 await page.getByTestId("export-preview").click();
 const fullPreview=page.getByTestId("export-preview-result");
 await fullPreview.waitFor({state:"visible"});
 check(Number(await fullPreview.getByText("Объектов",{exact:true}).locator("xpath=following-sibling::dd[1]").textContent())>=5,"PERSONAL_EXPORT_FIVE_RESULTS");
 await page.getByTestId("export-ack-sensitive").check();
 await page.getByTestId("export-package").click();
 const fullDownloading=page.waitForEvent("download",{timeout:60000});
 await page.getByTestId("export-download").click();
 const fullDownload=await fullDownloading,personalArchive=join(root,"personal-activity.iwxa");
 check(fullDownload.suggestedFilename().endsWith(".iwxa"),"PERSONAL_IWXA_EXTENSION");
 await fullDownload.saveAs(personalArchive);
 check((await stat(personalArchive)).size>0,"PERSONAL_IWXA_PHYSICAL");
 await page.getByTestId("export-confirm-saved-file").check();
 await page.getByTestId("export-confirm").click();
 await page.getByTestId("export-receipt").waitFor({state:"visible"});
 log("OFFLINE_PERSONAL_PROFILE_WEEK_FINANCE_IWXA_EXPORT");
 phase="INDEPENDENT_FULL_PERSONAL_IMPORT";
 await close();
 // A new profile has not installed this site's offline application. Serve
 // the identical dist for initial use; the archive itself contains Results.
 server=spawn(process.execPath,[join(site,"scripts/serve-current-static.mjs"),dist,"--t3-loopback"],
  {cwd:site,env:{...process.env,PORT:String(port)},stdio:"ignore"});
 await poll(async()=>{
  try{return (await fetch(origin+"/t3-offline-manifest.json")).ok}catch{return false}
 },"PERSONAL_RECIPIENT_PREVIEW_READY");
 page=await launch("personal-recipient");
 await visit(page,"/workspace/");
 await page.getByTestId("club-create-personal-space").waitFor({state:"visible"});
 check(!await page.getByTestId("club-native-project-overview").isVisible(),"PERSONAL_RECIPIENT_EMPTY");
 await visit(page,"/workspace/exchange/#/home");
 await page.getByTestId("packages-tab-import").click();
 const fullFile=page.getByTestId("import-file");
 await poll(async()=>await fullFile.isEnabled(),"PERSONAL_IMPORT_FILE_ENABLED");
 await fullFile.setInputFiles(personalArchive);
 await page.getByTestId("import-preview").waitFor({state:"visible"});
 const fullCommit=page.getByTestId("import-commit");
 await poll(async()=>await fullCommit.isEnabled(),"PERSONAL_IMPORT_PLAN_READY");
 await fullCommit.click();
 const fullReceipt=page.getByTestId("import-receipt");
 await fullReceipt.waitFor({state:"visible"});
 check(Number(await fullReceipt.getByText("Объектов создано",{exact:true}).locator("xpath=following-sibling::dd[1]").textContent())>=5,"PERSONAL_IMPORT_FIVE_RESULTS");
 log("INDEPENDENT_PERSONAL_PROFILE_WEEK_FINANCE_IWXA_IMPORT");
 phase="INDEPENDENT_FULL_PERSONAL_READBACK";
 await close();page=await launch("personal-recipient");
 await visit(page,"/workspace/");await openExisting(page);
 const transferred=page.getByTestId("club-native-today");
 await transferred.waitFor({state:"visible"});
 await poll(async()=>(await transferred.textContent()).includes("план 90 мин., факт 110 мин."),"PERSONAL_TRANSFER_MATCHED_FACT");
 check(/12[\s\u00a0]000/.test(await transferred.textContent()),"PERSONAL_TRANSFER_CASH_BALANCE");
 check((await transferred.textContent()).includes(titles[1]),"PERSONAL_TRANSFER_OVERDUE");
 const transferredGoal=page.getByTestId("club-native-goals");
 await poll(async()=>(await transferredGoal.textContent()).includes("Записано времени по делам: 110 мин."),"PERSONAL_TRANSFER_GOAL_TIME");
 check(/Расходы: 17[\s\u00a0]000/.test(await transferredGoal.textContent()),"PERSONAL_TRANSFER_GOAL_CLOSED_EXPENSE");
 check((await transferredGoal.textContent()).includes(goalTitle),"PERSONAL_TRANSFER_GOAL_TITLE");
 check(!(await localWeek())&&!(await localCash())&&!(await localGoal())&&!(await localProof()),"PERSONAL_TRANSFER_NO_TAB_RESULTS");
 log("INDEPENDENT_GOAL_LINKS_IWXA_READBACK");
 await verifyGoalReview("INDEPENDENT_GOAL_REVIEW_IWXA",transferredGoal);
 await verifyPeriodReview("INDEPENDENT_PERIOD_REVIEW_IWXA");
 phase="INDEPENDENT_GOAL_ASSESSMENT_READBACK";
 await poll(async()=>(await transferredGoal.getByTestId("club-native-goal-assessment").textContent()).includes("достигнута частично"),"ASSESSMENT_INDEPENDENT_NATIVE_READBACK");
 await restoreAssessment("ASSESSMENT_INDEPENDENT");
 log("INDEPENDENT_GOAL_ASSESSMENT_BASIS_IWXA_READBACK");
 phase="INDEPENDENT_GOAL_LIFECYCLE_HISTORY";
 verifyHistory((await localGoal()).data.goalLifecycle,lifecycleBeforeExport,"LIFECYCLE_INDEPENDENT");
 check((await localGoal()).data.goalLifecycle.status==="completed","LIFECYCLE_INDEPENDENT_COMPLETED");
 log("INDEPENDENT_GOAL_LIFECYCLE_IWXA_READBACK");
 phase="INDEPENDENT_GOAL_TASK_READBACK";
 await visit(page,"/workspace/");await openExisting(page);
 const recipientWeekToday=page.getByTestId("club-native-today");
 await recipientWeekToday.getByRole("button",{name:"Открыть дела недели",exact:true}).click();
 const recipientWeekRestore=page.getByTestId("club-t2-restore-card");
 await recipientWeekRestore.waitFor({state:"visible"});
 await poll(async()=>await recipientWeekRestore.locator('input[type="checkbox"]:checked').count()===1,"GOAL_TASK_INDEPENDENT_RESTORE_SELECTION");
 const recipientWeekOpen=recipientWeekRestore.getByRole("button",{name:"Открыть выбранные записи",exact:true});
 await poll(async()=>await recipientWeekOpen.isEnabled(),"GOAL_TASK_INDEPENDENT_RESTORE_READY");
 let recipientWeekConsent=false;
 page.once("dialog",async d=>{
  recipientWeekConsent=d.type()==="confirm"&&d.message().includes("Загрузить 1 новых");
  if(recipientWeekConsent)await d.accept();else await d.dismiss();
 });
 await recipientWeekOpen.click();await poll(async()=>recipientWeekConsent,"GOAL_TASK_INDEPENDENT_RESTORE_CONSENT");
 const recipientWeekLink=page.getByTestId("club-t2-restore-completed").getByRole("link",{name:"Открыть мою неделю",exact:true});
 await recipientWeekLink.waitFor({state:"visible"});await recipientWeekLink.click();
 const recipientWeekRecord=await localWeek();
 const recipientGoalTask=recipientWeekRecord?.data?.personalWeekPlan?.slots?.find(s=>s.id===goalResourceTask.id);
 check(recipientWeekRecord?.data?.personalWeekPlan?.slots?.length===6&&recipientGoalTask?.start==="10:15"&&
  recipientGoalTask.date===goalResourceTask.date&&recipientGoalTask.durationMinutes===90&&recipientGoalTask.projectId===goalId&&
  recipientGoalTask.status==="done"&&recipientGoalTask.fact?.minutes===110&&recipientGoalTask.fact?.plannedMinutes===90,"GOAL_TASK_INDEPENDENT_EXACT_ENTRY");
 log("INDEPENDENT_GOAL_TASK_EXACT_IWXA_READBACK");
 phase="INDEPENDENT_GOAL_PAYMENT_READBACK";
 await visit(page,"/workspace/");await openExisting(page);
 const recipientCashToday=page.getByTestId("club-native-today");
 await recipientCashToday.getByRole("button",{name:"Открыть денежные записи",exact:true}).click();
 const recipientCashRestore=page.getByTestId("club-t2-restore-card");
 await recipientCashRestore.waitFor({state:"visible"});
 await poll(async()=>await recipientCashRestore.locator('input[type="checkbox"]:checked').count()===1,"GOAL_PAYMENT_INDEPENDENT_RESTORE_SELECTION");
 const recipientCashOpen=recipientCashRestore.getByRole("button",{name:"Открыть выбранные записи",exact:true});
 await poll(async()=>await recipientCashOpen.isEnabled(),"GOAL_PAYMENT_INDEPENDENT_RESTORE_READY");
 let recipientCashConsent=false;
 page.once("dialog",async d=>{
  recipientCashConsent=d.type()==="confirm"&&d.message().includes("Загрузить 1 новых");
  if(recipientCashConsent)await d.accept();else await d.dismiss();
 });
 await recipientCashOpen.click();await poll(async()=>recipientCashConsent,"GOAL_PAYMENT_INDEPENDENT_RESTORE_CONSENT");
 const recipientCashLink=page.getByTestId("club-t2-restore-completed").getByRole("link",{name:"Открыть денежный календарь",exact:true});
 await recipientCashLink.waitFor({state:"visible"});await recipientCashLink.click();
 await page.locator("[data-cash-calendar-setup]").waitFor({state:"visible"});
 const recipientCashRecord=await localCash();
 check(recipientCashRecord?.data?.cashCalendar?.entries?.length===1&&isDeepStrictEqual(recipientCashRecord.data.cashCalendar.entries[0],expectedEditedPayment),"GOAL_PAYMENT_INDEPENDENT_EXACT_ENTRY");
 check(isDeepStrictEqual(recipientCashRecord.data.cashCalendar.closedPeriods,originalCashBeforeTarget.data.cashCalendar.closedPeriods),"GOAL_PAYMENT_INDEPENDENT_EXACT_HISTORY");
 log("INDEPENDENT_GOAL_PAYMENT_EXACT_IWXA_READBACK");
 check(isDeepStrictEqual(recipientCashRecord.data.cashCalendar.closedPeriods[0].entries.find(e=>e.id===plannedTool.id),settledTool),"CASH_PLAN_FACT_INDEPENDENT_EXACT_ENTRY");
 log("INDEPENDENT_CASH_PLAN_FACT_IWXA_READBACK");

 // A cold review must keep the exact saved sources that explain the
 // reason for review. The ordinary one-record editor routes remain tested above.
 {
 phase="INDEPENDENT_GOAL_REVIEW_CONTEXT_INSTALL";
 // An imported Exchange archive contains Results, not the site's offline
 // application. The independent recipient must explicitly install it first.
 const switchControl=page.locator("#iwxa-t3-domain-switch");
 const offlineDetails=page.locator("details").filter({has:page.locator("summary").filter({hasText:"T3: автономный режим"})}).first();
 if(!await switchControl.isVisible())await offlineDetails.locator("summary").first().click();
 check(!await switchControl.isChecked(),"GOAL_REVIEW_RECIPIENT_INITIAL_ONLINE");
 let installConsent=false;
 page.once("dialog",async d=>{installConsent=d.type()==="confirm";if(installConsent)await d.accept();else await d.dismiss();});
 await switchControl.check();
 await poll(async()=>{try{return await page.evaluate(()=>document.documentElement.hasAttribute("data-iwxa-t3-autonomous")&&Boolean(navigator.serviceWorker.controller));}catch{return false}},"GOAL_REVIEW_RECIPIENT_OFFLINE_CONTROLLER",180000);
 check(installConsent,"GOAL_REVIEW_RECIPIENT_INSTALL_CONSENT");
 log("INDEPENDENT_GOAL_REVIEW_RECIPIENT_OFFLINE_INSTALLED");
 phase="INDEPENDENT_GOAL_REVIEW_CONTEXT_COLD";
 await close();await stopServer();
 let reachable=false;
 try{await fetch(origin+"/workspace/",{signal:AbortSignal.timeout(2000)});reachable=true}catch{}
 check(!reachable,"GOAL_REVIEW_RECIPIENT_SERVER_STOPPED");
 page=await launch("personal-recipient");await context.setOffline(true);
 await visit(page,"/workspace/");await openExisting(page);
 check(await page.evaluate(()=>navigator.onLine===false&&document.documentElement.hasAttribute("data-iwxa-t3-autonomous")),"GOAL_REVIEW_RECIPIENT_OFFLINE_MODE");
 phase="INDEPENDENT_GOAL_REVIEW_CONTEXT_RESTORE";
 const reviewPanel=page.getByTestId("club-native-goals");
 const reviewDetail=reviewPanel.getByTestId("club-native-goal-review");
 await reviewDetail.waitFor({state:"visible"});
 if(!await reviewDetail.evaluate(el=>el.open))await reviewDetail.locator(":scope > summary").click();
 check(!(await localGoal())&&!(await localProof())&&!(await localWeek())&&!(await localCash()),"GOAL_REVIEW_CONTEXT_COLD");
 const reviewBefore=await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"));
 await reviewDetail.getByRole("button",{name:"Открыть цель с данными для проверки: "+goalTitle,exact:true}).click();
 const reviewRestore=page.getByTestId("club-t2-restore-card");
 await reviewRestore.waitFor({state:"visible"});
 const expectedReviewIds=[goalId,proofId,"club-week-plan","personal-economy"].sort();
 const chosenReviewIds=()=>reviewRestore.locator('input[data-club-restore-object-id]:checked').evaluateAll(els=>els.map(el=>el.getAttribute("data-club-restore-object-id")).sort());
 await poll(async()=>isDeepStrictEqual(await chosenReviewIds(),expectedReviewIds),"GOAL_REVIEW_CONTEXT_EXACT_SELECTION");
 check((await reviewRestore.textContent()).includes("Недельный план и денежный календарь открываются целиком"),"GOAL_REVIEW_CONTEXT_FULL_JOURNAL_DISCLOSURE");
 check(await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"))===reviewBefore,"GOAL_REVIEW_CONTEXT_PRESELECT_NO_WRITE");
 const reviewOpen=reviewRestore.getByRole("button",{name:"Открыть выбранные записи",exact:true});
 await poll(async()=>await reviewOpen.isEnabled(),"GOAL_REVIEW_CONTEXT_READY");
 let reviewConsent=false;
 page.once("dialog",async d=>{
  reviewConsent=d.type()==="confirm"&&d.message().includes("Загрузить 4 новых");
  if(reviewConsent)await d.accept();else await d.dismiss();
 });
 await reviewOpen.click();await poll(async()=>reviewConsent,"GOAL_REVIEW_CONTEXT_EXPLICIT_CONSENT");
 const reviewLink=page.getByTestId("club-t2-restore-completed").getByRole("link",{name:"Открыть выбранную цель",exact:true});
 await reviewLink.waitFor({state:"visible"});await reviewLink.click();
 await page.locator("[data-club-goal-form]").waitFor({state:"visible"});
 check(new URL(page.url()).searchParams.get("club_goal")===goalId,"GOAL_REVIEW_CONTEXT_EXACT_EDITOR");
 const restoredGoal=await localGoal(),restoredProof=await localProof(),restoredWeek=await localWeek(),restoredCash=await localCash();
 check(restoredGoal?.objectId===goalId&&restoredProof?.objectId===proofId&&restoredWeek?.objectId==="club-week-plan"&&restoredCash?.objectId==="personal-economy","GOAL_REVIEW_CONTEXT_ORIGINAL_IDS");
 check([restoredGoal,restoredProof,restoredWeek,restoredCash].every(o=>o.kernelSource?.syncedUpdatedAt===o.updatedAt&&o.kernelSource?.workspaceId===restoredGoal.kernelSource?.workspaceId),"GOAL_REVIEW_CONTEXT_KERNEL_BINDINGS");
 check(restoredWeek.data.personalWeekPlan.slots.find(s=>s.id===goalResourceTask.id)?.fact?.minutes===110&&isDeepStrictEqual(restoredCash.data.cashCalendar.closedPeriods[0].entries.find(e=>e.id===plannedTool.id),settledTool),"GOAL_REVIEW_CONTEXT_ORIGINAL_FACTS");
 phase="INDEPENDENT_GOAL_REVIEW_CONTEXT_PROJECTED";
 // Recalculate from the actual restored original Results before checking
 // rendering. This separates a projection failure from an unmounted view.
 const projected=await page.evaluate(async id=>{
  const {collectClubGoalPortfolio}=await import("/assets/club-goal-portfolio.mjs");
  const now=new Date(),day=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
  const g=collectClubGoalPortfolio(JSON.parse(sessionStorage.getItem("ru.iwxa.club.session.v1")),{day}).goals.find(x=>x.objectId===id);
  return g?{state:g.lifecycle.status,work:g.activity.plannedCount,money:g.money.plannedCount,
   timeStatus:g.experience.timeStatus,cashStatus:g.experience.cashStatus,issues:g.review.issues.map(x=>x.code)}:null;
 },goalId);
 check(projected?.state==="completed"&&projected.work===0&&projected.money===1&&projected.issues.includes("inactive-obligations"),"GOAL_REVIEW_CONTEXT_PROJECTION_PRESERVED");
 const restoredList=page.locator("[data-club-goal-list]");
 await poll(async()=>await restoredList.getAttribute("data-iwxa-assistant-state")==="ready"&&
  (await restoredList.textContent()).includes("Остались обязательства: дел 0, денежных планов 1"),"GOAL_REVIEW_CONTEXT_REASON_PRESERVED");
 log("INDEPENDENT_GOAL_REVIEW_CONTEXT_RESTORED_OFFLINE");
 phase="INDEPENDENT_GOAL_FACT_OBSERVATIONS";
 const factOverviewBefore=await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"));
 const experiencePanel=restoredList.locator("details").filter({has:page.locator("summary").filter({hasText:/^План и факт: чему учат мои записи$/})});
 await experiencePanel.locator(":scope > summary").click();
 const exactFacts=experiencePanel.locator("[data-club-goal-fact-observations]");
 await exactFacts.locator(":scope > summary").click();
 const exactFactsText=await exactFacts.textContent();
 check(/план на момент записи: 90 мин\. · факт: 110 мин\. · отклонение: \+20 мин/.test(exactFactsText),"GOAL_FACT_FROZEN_TIME");
 check(/План: 16[\s\u00a0]000 руб\./.test(exactFactsText)&&exactFactsText.includes("Закрытый период: факт доступен для просмотра, не для изменения"),"GOAL_FACT_CLOSED_CASH");
 const exactTimeLink=exactFacts.locator("a[data-club-goal-fact-source]").filter({hasText:"Открыть запись времени"});
 check(await exactTimeLink.count()===1&&new URL(await exactTimeLink.getAttribute("href"),page.url()).searchParams.get("club_week_slot")===goalResourceTask.id,"GOAL_FACT_ORIGINAL_TIME_LINK");
 check(await page.evaluate(()=>sessionStorage.getItem("ru.iwxa.club.session.v1"))===factOverviewBefore,"GOAL_FACT_DETAILS_READ_ONLY");
 log("INDEPENDENT_GOAL_FACT_ORIGINAL_OBSERVATIONS");
 phase="INDEPENDENT_GOAL_REVIEW_EXACT_CASH";
 const reviewWorklist=restoredList.locator("[data-club-goal-review-worklist]");
 await reviewWorklist.waitFor({state:"visible"});
 if(!await reviewWorklist.evaluate(el=>el.open))await reviewWorklist.locator(":scope > summary").click();
 const reviewCashLink=reviewWorklist.locator("a[data-club-goal-review-source]");
 await poll(async()=>await reviewCashLink.count()===1,"GOAL_REVIEW_ONE_UNRESOLVED_ENTRY");
 const cashUrl=new URL(await reviewCashLink.getAttribute("href"),page.url());
 check(cashUrl.searchParams.get("club_cash_entry")===expectedEditedPayment.id&&cashUrl.searchParams.get("club_cash_goal")===goalId&&
  cashUrl.searchParams.get("club_cash_rev")===restoredCash.updatedAt&&cashUrl.searchParams.get("workspace_id")===restoredCash.kernelSource.workspaceId&&
  cashUrl.searchParams.get("club_cash_review")==="1","GOAL_REVIEW_EXACT_CASH_LINK");
 await reviewCashLink.click();
 const reviewCashForm=page.locator("[data-cash-calendar-entry]");
 await reviewCashForm.waitFor({state:"visible"});
 await poll(async()=>await reviewCashForm.getAttribute("data-edit-id")===expectedEditedPayment.id&&
  await reviewCashForm.locator("[data-cash-calendar-save]").isEnabled(),"GOAL_REVIEW_CASH_ORIGINAL_EDITOR_READY");
 check(await reviewCashForm.locator('[name="date"]').inputValue()===expectedEditedPayment.date&&
  await reviewCashForm.locator('[name="amountRUB"]').inputValue()===String(expectedEditedPayment.amountRUB)&&
  await reviewCashForm.locator('[name="status"]').inputValue()==="planned","GOAL_REVIEW_CASH_ORIGINAL_FIELDS");
 check(isDeepStrictEqual(await localCash(),restoredCash),"GOAL_REVIEW_CASH_OPEN_NO_WRITE");
 // In the isolated recipient, the person explicitly records settlement of
 // the one original payment. The exported archive and source stay unchanged.
 await reviewCashForm.locator('[name="date"]').fill(cashDates.today);
 await reviewCashForm.locator('[name="status"]').selectOption("actual");
 await reviewCashForm.locator("[data-cash-calendar-save]").click();
 await poll(async()=>(await localCash())?.data?.cashCalendar?.entries?.[0]?.status==="actual","GOAL_REVIEW_CASH_ONE_EXPLICIT_FACT");
 const corrected=await localCash(),correctedEntry=corrected.data.cashCalendar.entries[0];
 check(corrected.data.cashCalendar.entries.length===1&&correctedEntry.id===expectedEditedPayment.id&&
  correctedEntry.date===cashDates.today&&correctedEntry.goalId===goalId&&correctedEntry.amountRUB===expectedEditedPayment.amountRUB&&
  isDeepStrictEqual(correctedEntry.planBasis,{date:expectedEditedPayment.date,amountRUB:expectedEditedPayment.amountRUB,goalId}),"GOAL_REVIEW_CASH_EXACT_PLAN_TO_FACT");
 check(isDeepStrictEqual(corrected.data.cashCalendar.closedPeriods,restoredCash.data.cashCalendar.closedPeriods)&&
  isDeepStrictEqual(await localGoal(),restoredGoal)&&isDeepStrictEqual(await localProof(),restoredProof)&&isDeepStrictEqual(await localWeek(),restoredWeek),"GOAL_REVIEW_UNRELATED_RESULTS_UNCHANGED");
 const backToGoal=page.getByRole("button",{name:"Вернуться к проверке цели",exact:true});
 await backToGoal.waitFor({state:"visible"});await backToGoal.click();
 await poll(async()=>await page.locator("[data-club-goal-list]").getAttribute("data-iwxa-assistant-state")==="ready","GOAL_REVIEW_RETURN_READY");
 check(new URL(page.url()).searchParams.get("club_goal")===goalId,"GOAL_REVIEW_RETURN_EXACT_GOAL");
 check(!(await page.locator("[data-club-goal-list]").textContent()).includes("Остались обязательства:")&&
  await page.locator("[data-club-goal-review-worklist] a[data-club-goal-review-source]").count()===0,"GOAL_REVIEW_RESOLVED_OBLIGATION_REMOVED");
 log("INDEPENDENT_GOAL_REVIEW_EXACT_CASH_AND_RETURN");
 phase="INDEPENDENT_GOAL_REVIEW_SAVE_CORRECTION";
 const journalSaves=page.locator("[data-club-goal-journal-saves]");
 await poll(async()=>(await journalSaves.textContent()).includes("Денежный календарь: изменения пока в этой вкладке"),"GOAL_REVIEW_LOCAL_CORRECTION_VISIBLE");
 const saveJournal=journalSaves.getByRole("link",{name:"Сохранить денежный календарь",exact:true});
 const saveUrl=new URL(await saveJournal.getAttribute("href"),page.url());
 check(saveUrl.pathname==="/workspace/"&&saveUrl.searchParams.get("save")==="personal-economy"&&
  saveUrl.searchParams.get("workspace_id")===restoredCash.kernelSource.workspaceId&&
  saveUrl.searchParams.get("club_goal_review_return")===goalId,"GOAL_REVIEW_SAVE_EXACT_JOURNAL_SCOPE");
 phase="INDEPENDENT_GOAL_REVIEW_SAVE_OPEN_PREVIEW";
 await saveJournal.click();
 const correctionImport=page.getByTestId("club-t0-import-card");
 await correctionImport.getByTestId("club-t0-import-preview").waitFor({state:"visible"});
 phase="INDEPENDENT_GOAL_REVIEW_SAVE_SELECT_SCOPE";
 const correctionScope=correctionImport.getByTestId("club-t0-import-workspace-choice").filter({visible:true});
 await poll(async()=>await correctionScope.count()===1,"GOAL_REVIEW_SAVE_SCOPE_AVAILABLE");
 check(await correctionScope.getAttribute("data-workspace-id")===restoredCash.kernelSource.workspaceId,"GOAL_REVIEW_SAVE_SCOPE");
 if(await correctionScope.getAttribute("aria-pressed")!=="true")await correctionScope.click();
 await poll(async()=>await correctionScope.getAttribute("aria-pressed")==="true","GOAL_REVIEW_SAVE_SCOPE_FOCUSED");
 phase="INDEPENDENT_GOAL_REVIEW_SAVE_CONFIRM";
 await correctionImport.getByLabel("Подтверждаю сохранение изменений. При конфликте прежняя запись останется без изменений.",{exact:true}).check();
 const correctionSave=correctionImport.getByRole("button",{name:"Сохранить изменения",exact:true});
 await poll(async()=>await correctionSave.isEnabled(),"GOAL_REVIEW_SAVE_READY");
 phase="INDEPENDENT_GOAL_REVIEW_SAVE_KERNEL_RECEIPT";
 await correctionSave.click();
 await poll(async()=>{const row=await localCash();return row?.objectId===restoredCash.objectId&&
  row.kernelSource?.workspaceId===restoredCash.kernelSource.workspaceId&&
  row.kernelSource?.revision===restoredCash.kernelSource.revision+1&&row.kernelSource.syncedUpdatedAt===row.updatedAt;
 },"GOAL_REVIEW_SAVE_EXACT_NEXT_REVISION");
 check(isDeepStrictEqual((await localCash()).data,corrected.data)&&isDeepStrictEqual(await localGoal(),restoredGoal)&&
  isDeepStrictEqual(await localProof(),restoredProof)&&isDeepStrictEqual(await localWeek(),restoredWeek),"GOAL_REVIEW_SAVE_OTHER_RESULTS_UNCHANGED");
 phase="INDEPENDENT_GOAL_REVIEW_SAVE_VISIBLE_CONTINUATION";
 const savedGoalReturn=page.locator("[data-workspace-t2-handoff-status]").getByRole("link",{name:"Вернуться к проверке цели",exact:true});
 await savedGoalReturn.waitFor({state:"visible"});
 check(await savedGoalReturn.evaluate(el=>!el.closest("dialog:not([open])")&&el.getClientRects().length>0),"GOAL_REVIEW_SAVED_RETURN_ACCESSIBLE");
 const savedGoalUrl=new URL(await savedGoalReturn.getAttribute("href"),page.url());
 check(savedGoalUrl.pathname==="/projects/"&&savedGoalUrl.searchParams.get("club_goal")===goalId&&
  savedGoalUrl.searchParams.get("workspace_id")===restoredCash.kernelSource.workspaceId&&savedGoalUrl.hash==="#club-goal-map","GOAL_REVIEW_SAVED_RETURN_EXACT");
 phase="INDEPENDENT_GOAL_REVIEW_SAVE_RETURN";
 await savedGoalReturn.click();
 await poll(async()=>(await page.locator("[data-club-goal-journal-saves]").textContent()).includes("Денежный календарь: текущая версия сохранена"),"GOAL_REVIEW_SAVED_CORRECTION_VISIBLE");
 check(await page.locator("[data-club-goal-journal-saves]").getByRole("link",{name:"Сохранить денежный календарь",exact:true}).count()===0,"GOAL_REVIEW_NO_REDUNDANT_SAVE");
 log("INDEPENDENT_GOAL_REVIEW_CORRECTION_SAME_KERNEL_REVISION_SAVED");

 phase="INDEPENDENT_WEEKLY_REVIEW_TIME_CORRECTION";
 // The already independently restored, offline recipient explicitly removes
 // one fact, then finds and corrects the same original completed task.
 const beforeTime=await localWeek(),cashAfterCorrection=await localCash();
 const timeSlot=beforeTime.data.personalWeekPlan.slots.find(x=>x.id===goalResourceTask.id);
 check(timeSlot?.status==="done"&&timeSlot.fact?.minutes===110,"WEEKLY_REVIEW_ORIGINAL_FACT");
 const timeScope=beforeTime.kernelSource.workspaceId;
 await visit(page,"/tools/action-route/?workspace_id="+encodeURIComponent(timeScope)+"&club_week_slot="+encodeURIComponent(timeSlot.id)+"#club-week-plan");
 const originalTimeCard=page.locator(".club-week-entry").filter({has:page.getByText(titles[0],{exact:true})});
 await originalTimeCard.waitFor({state:"visible"});
 const oldFactDetail=originalTimeCard.locator("details").filter({has:page.getByText("Изменить фактическое время",{exact:true})});
 if(!await oldFactDetail.evaluate(el=>el.open))await oldFactDetail.locator(":scope > summary").click();
 let clearTimeConsent=false;
 page.once("dialog",async d=>{clearTimeConsent=d.type()==="confirm"&&d.message().includes("Убрать фактическое время");if(clearTimeConsent)await d.accept();else await d.dismiss()});
 await oldFactDetail.getByRole("button",{name:"Убрать запись времени",exact:true}).click();
 await poll(async()=>clearTimeConsent&&!(await localWeek())?.data?.personalWeekPlan?.slots?.find(x=>x.id===timeSlot.id)?.fact,"WEEKLY_REVIEW_CLEAR_EXPLICIT");
 const missingTime=await localWeek();
 check(missingTime.kernelSource.revision===beforeTime.kernelSource.revision&&
  isDeepStrictEqual(missingTime.data.personalWeekPlan.slots.filter(x=>x.id!==timeSlot.id),beforeTime.data.personalWeekPlan.slots.filter(x=>x.id!==timeSlot.id)),"WEEKLY_REVIEW_ONLY_ONE_LOCAL_FACT");
 await visit(page,"/projects/?workspace_id="+encodeURIComponent(timeScope)+"&club_activity_period=week#club-activity-review");
 const periodReview=page.locator("[data-club-activity-review-public]");
 const missingTimeRow=periodReview.locator('[data-club-review-record-id="'+timeSlot.id+'"]');
 await missingTimeRow.waitFor({state:"visible"});
 check(isDeepStrictEqual(await localWeek(),missingTime),"WEEKLY_REVIEW_OPEN_NO_WRITE");
 await missingTimeRow.getByRole("button",{name:"Записать время",exact:true}).click();
 const exactTime=page.locator("[data-club-week-review-fact]");
 await exactTime.waitFor({state:"visible"});
 check(isDeepStrictEqual(await localWeek(),missingTime),"WEEKLY_REVIEW_EXACT_EDITOR_NO_WRITE");
 const exactReviewUrl=new URL(page.url());
 check(exactReviewUrl.searchParams.get("club_week_slot")===timeSlot.id&&
  exactReviewUrl.searchParams.get("club_week_rev")===missingTime.updatedAt&&
  exactReviewUrl.searchParams.get("club_week_period")==="fact"&&
  exactReviewUrl.searchParams.get("workspace_id")===timeScope&&
  exactReviewUrl.searchParams.get("club_activity_period")==="week","WEEKLY_REVIEW_EXACT_SOURCE_REVISION");

 await exactTime.getByLabel("Дата, когда вы занимались делом",{exact:true}).fill(timeSlot.fact.date);
 await exactTime.getByLabel("Фактически потрачено минут",{exact:true}).fill("115");
 await exactTime.getByRole("button",{name:"Записать время",exact:true}).click();
 await poll(async()=>{const row=(await localWeek())?.data?.personalWeekPlan?.slots?.find(x=>x.id===timeSlot.id);return row?.fact?.minutes===115&&row.fact.plannedMinutes===timeSlot.durationMinutes&&row.status==="done"},"WEEKLY_REVIEW_RECORD_EXACT_TIME");
 const correctedTime=await localWeek();
 check(isDeepStrictEqual(correctedTime.data.personalWeekPlan.slots.filter(x=>x.id!==timeSlot.id),beforeTime.data.personalWeekPlan.slots.filter(x=>x.id!==timeSlot.id))&&
  correctedTime.kernelSource.revision===beforeTime.kernelSource.revision,"WEEKLY_REVIEW_CORRECTED_LOCAL_ONLY");
 await page.getByRole("button",{name:"Вернуться к итогам",exact:true}).click();
 await poll(async()=>new URL(page.url()).searchParams.get("club_activity_period")==="week"&&new URL(page.url()).hash==="#club-activity-review","WEEKLY_REVIEW_RETURN_EXACT_PERIOD");
 const periodSaves=page.locator("[data-club-period-journal-saves]");
 const timeSaveLink=periodSaves.getByRole("link",{name:"Сохранить план недели",exact:true});
 await timeSaveLink.waitFor({state:"visible"});
 check(await page.locator('[data-club-review-record-id="'+timeSlot.id+'"]').count()===0,"WEEKLY_REVIEW_RESOLVED_REASON_REMOVED");
 const timeSaveUrl=new URL(await timeSaveLink.getAttribute("href"),page.url());
 check(timeSaveUrl.searchParams.get("save")==="club-week-plan"&&timeSaveUrl.searchParams.get("workspace_id")===timeScope&&
  timeSaveUrl.searchParams.get("club_activity_period")==="week","WEEKLY_REVIEW_SAVE_SCOPE_PERIOD");
 await timeSaveLink.click();
 const timeImport=page.getByTestId("club-t0-import-card");
 await timeImport.getByTestId("club-t0-import-preview").waitFor({state:"visible"});
 const timeChoice=timeImport.getByTestId("club-t0-import-workspace-choice").filter({visible:true});
 await poll(async()=>await timeChoice.count()===1,"WEEKLY_REVIEW_SAVE_SCOPE_AVAILABLE");
 check(await timeChoice.getAttribute("data-workspace-id")===timeScope,"WEEKLY_REVIEW_SAVE_SCOPE");
 if(await timeChoice.getAttribute("aria-pressed")!=="true")await timeChoice.click();
 await poll(async()=>await timeChoice.getAttribute("aria-pressed")==="true","WEEKLY_REVIEW_SAVE_SCOPE_FOCUSED");
 await timeImport.getByLabel("Подтверждаю сохранение изменений. При конфликте прежняя запись останется без изменений.",{exact:true}).check();
 const timeSave=timeImport.getByRole("button",{name:"Сохранить изменения",exact:true});
 await poll(async()=>await timeSave.isEnabled(),"WEEKLY_REVIEW_SAVE_READY");
 await timeSave.click();
 await poll(async()=>{const row=await localWeek();return row?.objectId===beforeTime.objectId&&row.kernelSource?.workspaceId===timeScope&&
  row.kernelSource?.revision===beforeTime.kernelSource.revision+1&&row.kernelSource.syncedUpdatedAt===row.updatedAt},"WEEKLY_REVIEW_SAVE_NEXT_REVISION");
 check(isDeepStrictEqual((await localWeek()).data,correctedTime.data)&&isDeepStrictEqual(await localGoal(),restoredGoal)&&
  isDeepStrictEqual(await localProof(),restoredProof)&&isDeepStrictEqual(await localCash(),cashAfterCorrection),"WEEKLY_REVIEW_SAVE_OTHER_RESULTS_UNCHANGED");
 const savedTimeReturn=page.locator("[data-workspace-t2-handoff-status]").getByRole("link",{name:"Вернуться к итогам",exact:true});
 await savedTimeReturn.waitFor({state:"visible"});
 const savedTimeUrl=new URL(await savedTimeReturn.getAttribute("href"),page.url());
 check(savedTimeUrl.searchParams.get("club_activity_period")==="week"&&savedTimeUrl.searchParams.get("workspace_id")===timeScope&&
  savedTimeUrl.hash==="#club-activity-review","WEEKLY_REVIEW_SAVED_RETURN_EXACT");
 await savedTimeReturn.click();
 await poll(async()=>(await page.locator("[data-club-period-journal-saves]").textContent()).includes("План недели: текущая версия сохранена"),"WEEKLY_REVIEW_SAVED_STATE");
 check(await page.locator("[data-club-period-journal-saves]").getByRole("link",{name:"Сохранить план недели",exact:true}).count()===0,"WEEKLY_REVIEW_NO_REDUNDANT_SAVE");
 log("INDEPENDENT_WEEKLY_REVIEW_TIME_CORRECTION_SAME_RESULT_SAVED");
 phase="INDEPENDENT_SAVED_PERIOD_REVIEW";
 const completeReviewLink=page.locator("[data-club-activity-review-result]").getByRole("link",{name:"Все сохранённые итоги",exact:true});
 await completeReviewLink.waitFor({state:"visible"});
 const completeReviewUrl=new URL(await completeReviewLink.getAttribute("href"),page.url());
 check(completeReviewUrl.pathname==="/workspace/"&&completeReviewUrl.searchParams.get("workspace_id")===timeScope&&
  completeReviewUrl.searchParams.get("club_activity_period")==="week"&&completeReviewUrl.hash==="#/domain","SAVED_REVIEW_LINK_EXACT_SCOPE_PERIOD");
 const savedReviewWeek=await localWeek();
 await completeReviewLink.click();
 await openExisting(page);
 const savedReview=page.getByTestId("club-native-activity-review");
 await savedReview.waitFor({state:"visible"});
 await poll(async()=>await savedReview.evaluate(e=>e.open)&&await savedReview.locator("[data-club-review-period]").count()===1,"SAVED_REVIEW_OPEN");
 check(await savedReview.locator("[data-club-review-period]").inputValue()==="week","SAVED_REVIEW_PERIOD_RETAINED");
 await poll(async()=>(await savedReview.locator("[data-club-activity-review-result]").textContent()).includes("По сохранённым записям этой рабочей области."),"SAVED_REVIEW_WORKSPACE_SOURCE");
 check(await savedReview.getByRole("link",{name:"Все сохранённые итоги",exact:true}).count()===0&&
  await savedReview.locator("[data-club-period-journal-saves]").count()===0,"SAVED_REVIEW_READ_ONLY");
 check(isDeepStrictEqual(await localWeek(),savedReviewWeek)&&isDeepStrictEqual(await localCash(),cashAfterCorrection),"SAVED_REVIEW_NO_TAB_WRITE");
 log("INDEPENDENT_SAVED_REVIEW_SCOPE_PERIOD_AND_NO_WRITE");
 phase="INDEPENDENT_SAVED_HORIZON_LINK";
 await visit(page,"/projects/?workspace_id="+encodeURIComponent(timeScope)+"&club_goal_horizon_days=30#club-goal-horizon");
 const fullHorizonLink=page.getByRole("link",{name:"Все сохранённые обязательства",exact:true});
 await fullHorizonLink.waitFor({state:"visible"});
 const fullHorizonUrl=new URL(await fullHorizonLink.getAttribute("href"),page.url());
 check(fullHorizonUrl.pathname==="/workspace/"&&fullHorizonUrl.hash==="#/domain"&&
  fullHorizonUrl.searchParams.get("workspace_id")===timeScope&&fullHorizonUrl.searchParams.get("club_goal_horizon_days")==="30","SAVED_HORIZON_LINK_EXACT_SCOPE_PERIOD");
 await fullHorizonLink.click();
 await openExisting(page);
 const fullHorizon=page.getByTestId("club-native-goal-horizon");
 await fullHorizon.waitFor({state:"visible"});
 await poll(async()=>await fullHorizon.evaluate(e=>e.open)&&await fullHorizon.locator("[data-club-goal-horizon-period]").count()===1,"SAVED_HORIZON_OPEN");
 check(await fullHorizon.locator("[data-club-goal-horizon-period]").inputValue()==="30","SAVED_HORIZON_PERIOD_RETAINED");
 await poll(async()=>(await fullHorizon.locator("[data-club-goal-horizon-result]").textContent()).includes("По сохранённым записям выбранной рабочей области"),"SAVED_HORIZON_WORKSPACE_SOURCE");
 check(await fullHorizon.getByRole("link",{name:"Все сохранённые обязательства",exact:true}).count()===0&&
  await fullHorizon.locator("[data-club-horizon-journal-saves]").count()===0,"SAVED_HORIZON_READ_ONLY");
 check(isDeepStrictEqual(await localWeek(),savedReviewWeek)&&isDeepStrictEqual(await localCash(),cashAfterCorrection),"SAVED_HORIZON_NO_TAB_WRITE");
 log("INDEPENDENT_SAVED_HORIZON_SCOPE_PERIOD_AND_NO_WRITE");


 }
 log("INDEPENDENT_PERSONAL_FULL_KERNEL_READBACK");
 log("FUNCTIONAL_ROUNDTRIP");
 phase="RESPONSIVE_FINAL_GATE";
 check(responsiveFailures===0,"RESPONSIVE_QUALIFICATION");
 console.log("CLUB_DIST_ROUNDTRIP=PASS original full dist; offline same Result update; no local model inference; no physical-phone claim");
}catch(e){
 const code=typeof e?.message==="string"&&/^CLUB_DIST_[A-Z_]+$/.test(e.message)?e.message:"CLUB_DIST_UNEXPECTED";
 const page=context?.pages()[0];
 let flags={};
 if(page)try{flags=await page.evaluate(()=>({
  weekForm:!!document.querySelector("form[data-club-week-form]"),
  cashForm:!!document.querySelector("[data-cash-calendar-setup]"),
  firstUse:!!document.querySelector('[data-testid="club-create-personal-space"]'),
  work:!!document.querySelector('[data-testid="club-native-project-overview"]'),
  emptyTasks:!!document.querySelector('[data-testid="club-empty-tasks"]'),
  inventory:(()=>{const t=document.querySelector('[data-testid="club-workspace-progress"]')?.textContent?.trim()||"";return /^Сохранённых записей: [0-9]+$/.test(t)?Number(t.split(":")[1]):t==="Пока нет сохранённых записей"?"empty":t.startsWith("Часть результатов")?"family-error":t.startsWith("Загружаем")?"loading":"absent";})(),
  scopeDisclosure:document.querySelector('[data-testid="club-workspace-data-actions"]')?.open===true,
  scopeSelect:!!document.querySelector('[data-testid="club-workspace-data-actions"] select'),
  familyDisclosure:document.querySelector('[data-testid="club-workspace-all-families"]')?.open===true,
  profileLatest:!!document.querySelector('[data-testid="club-family-latest-participation-profile"]'),
  selectedDetail:!!document.querySelector('[data-testid="club-workspace-selected-detail"]'),
  nativeEditor:!!document.querySelector('[data-testid="club-profile-native-editor"]'),
  editorForm:!!document.querySelector('[data-testid="club-profile-host-card"]'),
  editorState:(()=>{const state=document.querySelector('[data-testid="club-profile-host-card"]')?.getAttribute("data-profile-load-state");return ["idle","loading","ready","error"].includes(state)?state:"absent";})(),
  editorAliasPresent:!!document.querySelector('[data-testid="club-profile-host-card"] form input[name="alias"]'),
  editorGoalsPresent:!!document.querySelector('[data-testid="club-profile-host-card"] form textarea[name="goals"]'),
  profileResume:!!document.querySelector('[data-testid="club-workspace-profile-resume"]'),
  weekSavePending:document.documentElement.hasAttribute("data-club-t2-save-pending"),
  importCard:!!document.querySelector('[data-testid="club-t0-import-card"]'),
  importPreviewVisible:!!document.querySelector('[data-testid="club-t0-import-preview"]')?.getClientRects().length,
  importPreviewMounted:!!document.querySelector('[data-testid="club-t0-import-preview"]'),
  saveStatusMounted:!!document.querySelector("[data-workspace-t2-handoff-status]"),
  saveStatusVisible:!!document.querySelector("[data-workspace-t2-handoff-status]")?.getClientRects().length,
  saveStatusInsideClosedDialog:!!document.querySelector("[data-workspace-t2-handoff-status]")?.closest("dialog:not([open])"),
  saveContinuationLinks:document.querySelectorAll("[data-workspace-t2-handoff-status] a").length,
  directSaveHint:new URL(location.href).searchParams.has("save"),
  importScopeChoices:document.querySelectorAll('[data-testid="club-t0-import-workspace-choice"]').length,
  importScopeFocused:document.querySelectorAll('[data-testid="club-t0-import-workspace-choice"][aria-pressed="true"]').length,
  importRowCount:document.querySelectorAll('[data-testid="club-t0-import-object-checkbox"]').length,
  importRowDisabled:document.querySelectorAll('[data-testid="club-t0-import-object-checkbox"]:disabled').length,
  importConfirmDisabled:document.querySelector('[data-testid="club-t0-import-confirm"]')?.disabled??null,
  importConsentChecked:document.querySelector('[data-testid="club-t0-import-consent"]')?.checked??null,
  importConsentDisabled:document.querySelector('[data-testid="club-t0-import-consent"]')?.disabled??null,
  importReadiness:(()=>{const s=document.querySelector('[data-testid="club-t0-import-preview"]')?.getAttribute("data-club-save-readiness");
   return ["READY","BUSY","WORKSPACE","SELECTION","UPDATE_SCOPE","INSPECTION_FAILED","INSPECTION_PENDING","TARGET_CONFLICT","AUTHORITY","SOURCE_MISSING"].includes(s)?s:"absent";})(),
  nativeToday:!!document.querySelector('[data-testid="club-native-today"]'),
  restoreCard:!!document.querySelector('[data-testid="club-t2-restore-card"]'),
  restoreCheckboxes:document.querySelectorAll('[data-testid="club-t2-restore-card"] input[type="checkbox"]').length,
  restoreChecked:document.querySelectorAll('[data-testid="club-t2-restore-card"] input[type="checkbox"]:checked').length,
  restoreTransferOpen:document.querySelector('details[data-club-transfer-panels]')?.open===true,
  restoreSelectedScope:!!document.querySelector('[data-testid="club-t2-restore-card"] select')?.value,
  restoreStatus:(()=>{const t=document.querySelector('[data-testid="club-t2-restore-card"] p[aria-live="polite"]')?.textContent||"";return t.startsWith("Здесь пока нет")?"empty":t.startsWith("Не удалось проверить")?"inventory-error":t.startsWith("Не удалось завершить")?"apply-error":t.startsWith("Нужный результат отмечен")?"preselected":t.startsWith("Выбранная запись не найдена")?"missing":t.startsWith("Выберите нужные записи")?"choose":t.startsWith("Выберите сохранённую запись")?"pending":"other";})(),
  restoreCompleted:!!document.querySelector('[data-testid="club-t2-restore-completed"]'),
  profile:!!document.querySelector('[data-profile-form]'),
  assistant:!!document.querySelector('#iwxa-t3-assistant'),
  exchange:!!document.querySelector('[data-testid="packages-view"]'),
  importPreview:!!document.querySelector('[data-testid="import-preview"]'),
  importError:!!document.querySelector('[data-testid="import-error"]'),
  importPlanIssues:!!document.querySelector('[data-testid="import-plan-issues"]'),
  exportReceipt:!!document.querySelector('[data-testid="export-receipt"]')
 }));}catch{}
 console.log("CLUB_DIST_ROUNDTRIP_FAIL "+JSON.stringify({phase,code,timeout:e?.name==="TimeoutError",flags}));
 process.exitCode=1;
}finally{
 await close().catch(()=>{});await stopServer().catch(()=>{});await rm(root,{recursive:true,force:true});
}
