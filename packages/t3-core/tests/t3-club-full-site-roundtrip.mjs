// Product-owned dist only. Real UI operations and original Kernel / Exchange.
// No staged source pages, seeded store, simulated model, direct write or mock SW.
// Disposable local profiles and synthetic data. Never upload archive or logs.
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtemp,rm,stat} from "node:fs/promises";
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
async function launch(dir){
 context=await chromium.launchPersistentContext(join(root,dir),{
  headless:true,viewport:{width:1280,height:900},acceptDownloads:true,
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
 phase="FIRST_USE_LAUNCH";
 let page=await launch("source");
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
 log("ASSISTANT_TO_ORIGINAL_KERNEL_RECEIPT");
 // Separate immediate and cold readback. Both use the original visible
 // inventory and profile editor, not the transient form/session.
 await readProfile(page,"SOURCE_IMMEDIATE_READBACK",savedScope);
 log("SOURCE_IMMEDIATE_KERNEL_READBACK");
 phase="SOURCE_COLD_READBACK";
 await close();page=await launch("source");
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
 await goalImport.getByLabel("Подтверждаю сохранение выбранных результатов на этом устройстве.",{exact:true}).check();
 const goalSave=goalImport.getByRole("button",{name:"Сохранить выбранное",exact:true});
 await poll(async()=>await goalSave.isEnabled(),"GOAL_KERNEL_READY");
 await goalSave.click();
 await poll(async()=>{
  const g=await localGoal();return g?.kernelSource?.workspaceId===base.scope&&g.kernelSource.revision>0&&g.kernelSource.syncedUpdatedAt===g.updatedAt;
 },"GOAL_KERNEL_RECEIPT");
 log("OFFLINE_GOAL_ORIGINAL_KERNEL_RECEIPT");
 phase="OFFLINE_AGENDA_CREATE";
 await visit(page,"/projects/?workspace_id="+encodeURIComponent(base.scope)+"&club_goal="+encodeURIComponent(goalId)+"#club-goal-map");
 await page.locator("[data-club-goal-list]").getByRole("link",{name:"Запланировать шаг",exact:true}).click();
 const weekForm=page.locator("form[data-club-week-form]");
 const weekSummary=page.locator("[data-club-week-summary]");
 await weekForm.waitFor({state:"visible"});
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
 phase="OFFLINE_CASH_SETUP";
 await page.locator("[data-club-goal-list]").getByRole("link",{name:"Записать деньги по цели",exact:true}).click();
 const calendarGroup=page.locator("#club-money-calendar");
 if(!await calendarGroup.evaluate(el=>el.open))await calendarGroup.locator(":scope > summary").click();
 const cashSetup=page.locator("[data-cash-calendar-setup]");
 const cashEntry=page.locator("[data-cash-calendar-entry]");
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
  {date:cashDates.expense,amountRUB:"-17000",status:"actual",category:"other",note:"Оплачен набор инструментов",goalId},
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
 await cashHistory.locator("[data-cash-calendar-history-detail]").getByText("Полученная зарплата",{exact:true}).waitFor({state:"visible"});
 log("OFFLINE_CASH_RECONCILED_PERIOD_HISTORY");
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
 log("OFFLINE_CASH_ORIGINAL_KERNEL_RECEIPT");
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
  const p=await localProof(),g=await localGoal();
  check(p?.objectId===proofId&&g?.objectId===goalId&&
   p.data.personalEvidence.source.updatedAt===g.updatedAt&&p.kernelSource.workspaceId===g.kernelSource.workspaceId,prefix+"_EXACT_LINK_READBACK");
 }
 await restoreAssessment("ASSESSMENT_COLD");
 log("OFFLINE_GOAL_ASSESSMENT_EXACT_SOURCE_REOPEN");
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
 phase="INDEPENDENT_GOAL_ASSESSMENT_READBACK";
 await poll(async()=>(await transferredGoal.getByTestId("club-native-goal-assessment").textContent()).includes("достигнута частично"),"ASSESSMENT_INDEPENDENT_NATIVE_READBACK");
 await restoreAssessment("ASSESSMENT_INDEPENDENT");
 log("INDEPENDENT_GOAL_ASSESSMENT_BASIS_IWXA_READBACK");
 log("INDEPENDENT_PERSONAL_FULL_KERNEL_READBACK");
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
  importPreviewVisible:!!document.querySelector('[data-testid="club-t0-import-preview"]'),
  importScopeChoices:document.querySelectorAll('[data-testid="club-t0-import-workspace-choice"]').length,
  importScopeFocused:document.querySelectorAll('[data-testid="club-t0-import-workspace-choice"][aria-pressed="true"]').length,
  importRowCount:document.querySelectorAll('[data-testid="club-t0-import-object-checkbox"]').length,
  importRowDisabled:document.querySelectorAll('[data-testid="club-t0-import-object-checkbox"]:disabled').length,
  importConfirmDisabled:document.querySelector('[data-testid="club-t0-import-confirm"]')?.disabled??null,
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
