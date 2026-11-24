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
const alias="Сосед Т3";
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
 await restoreButton.click();
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
 console.log("CLUB_DIST_ROUNDTRIP=PASS original full dist; no local model inference; no physical-phone claim");
}catch(e){
 const code=typeof e?.message==="string"&&/^CLUB_DIST_[A-Z_]+$/.test(e.message)?e.message:"CLUB_DIST_UNEXPECTED";
 const page=context?.pages()[0];
 let flags={};
 if(page)try{flags=await page.evaluate(()=>({
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
