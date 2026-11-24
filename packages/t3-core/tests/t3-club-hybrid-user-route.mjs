// Test-only real UI route using original Club markup, scripts, compiled
// shared assistant and cached model. No separate engine or product dist.
import assert from "node:assert/strict";
import {cpSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";

export async function stageClubHybridUserRoute({root,compiled,site:sitePath}){
 const site=resolve(sitePath);
 const {mountDomainAssistant,mountOriginalControl}=await import(pathToFileURL(join(site,"scripts/assemble-club-t3-dist.mjs")).href);
 const manifest=JSON.parse(readFileSync(join(compiled,".vite/manifest.json"),"utf8"));
 const entry=manifest["candidate-domain-assistant/main.mjs"];
 const panel=manifest["src/modules/t3-local-inference/LocalInferencePanel.tsx"];
 const engine="src/modules/t3-local-inference/engine.mjs";
 assert.ok(entry?.isEntry&&entry.dynamicImports?.includes(engine)&&panel?.dynamicImports?.includes(engine),"T3_D5_CLUB_UI_SHARED_ENGINE");
 const html=readFileSync(join(site,"profile/index.html"),"utf8");
 assert.ok(html.includes("data-profile-form"),"T3_D5_CLUB_UI_ACTUAL_FORM");
 mkdirSync(join(root,"profile"),{recursive:true});
 mkdirSync(join(root,"assets"),{recursive:true});
 for(const name of ["site.css","site.js","club-t3-controls.css","club-personal-resume.mjs","club-assistant-skills.json"]){
  cpSync(join(site,"assets",name),join(root,"assets",name),{errorOnExist:true,force:false});
 }
 cpSync(join(site,"favicon.svg"),join(root,"favicon.svg"));
 writeFileSync(join(root,"profile/index.html"),mountDomainAssistant(mountOriginalControl(html),entry.file));
}
export async function qualifyClubHybridUserRoute({context,origin,model}){
 const page=await context.newPage();
 const check=(value,code)=>assert.ok(value,"T3_D5_CLUB_UI_"+code);
 const wait=async(fn,arg=null,timeout=45000)=>page.waitForFunction(fn,arg,{timeout});
 const at=id=>page.locator("#iwxa-t3-assistant").locator("#"+id);
 const form=()=>page.locator("[data-profile-form]");
 const state=()=>page.evaluate(()=>Object.fromEntries(new FormData(document.querySelector("[data-profile-form]"))));
 const saved=()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem("ru.iwxa.club.session.v1")||"null")?.objects?.filter(o=>o.objectType==="participation-profile")||[]);
 let phase="NAVIGATION";
 try{
  await page.goto(origin+"/profile/",{waitUntil:"domcontentloaded",timeout:45000});
  await wait(()=>navigator.onLine===false&&document.documentElement.hasAttribute("data-iwxa-t3-autonomous")&&Boolean(navigator.serviceWorker.controller));
  await form().waitFor({state:"visible"});
  const baseline=await state();
  check(baseline.alias===""&&baseline.goals===""&&baseline.interests===""&&(await saved()).length===0,"FRESH_FORM");
  await page.evaluate(()=>{window.__clubProfileSubmits=0;document.querySelector("[data-profile-form]").addEventListener("submit",()=>window.__clubProfileSubmits++,true);});
  phase="CACHE_LOAD";
  await at("launcher").click();
  await wait(()=>!document.querySelector("#iwxa-t3-assistant")?.shadowRoot?.getElementById("skill-all")?.disabled);
  await at("model-settings").locator("summary").first().click();
  await wait(()=>!document.querySelector("#iwxa-t3-assistant")?.shadowRoot?.getElementById("model")?.disabled);
  await at("model").selectOption(model.profileId);
  await wait(()=>!document.querySelector("#iwxa-t3-assistant")?.shadowRoot?.getElementById("cached")?.disabled);
  check(await at("install").isDisabled(),"NO_OFFLINE_INSTALL");
  await at("cached").click();
  await wait(()=>!document.querySelector("#iwxa-t3-assistant")?.shadowRoot?.getElementById("unload")?.disabled,null,150000);
  check(await at("model").inputValue()===model.profileId,"PINNED_LEVEL");
  phase="PREVIEW";
  await at("scan-forms").click();
  const options=await at("form-choice").locator("option").evaluateAll(rows=>rows.map(row=>({value:row.value,label:row.textContent})));
  const profile=options.find(o=>o.label.startsWith("Личный профиль ·"));
  check(profile,"ACTUAL_PROFILE_CHOICE");
  await at("form-choice").selectOption(profile.value);
  await at("prompt").fill("Называйте меня «Сосед». Хочу освоить ремонт бытовой техники. Сформулируй мою цель одним коротким предложением для профиля.");
  async function generate(){
   await at("suggest").click();
   await wait(()=>{const root=document.querySelector("#iwxa-t3-assistant")?.shadowRoot;return root?.getElementById("status")?.textContent?.startsWith("Проверьте предложенные значения")&&!root.getElementById("suggest").disabled;},null,180000);
   const items=await at("preview").locator("li").evaluateAll(rows=>rows.map(row=>({label:row.querySelector("label")?.textContent,checked:row.querySelector("input[type=checkbox]")?.checked})));
   const drafts=items.filter(row=>row.label?.includes("черновик ИИ"));
   check(drafts.length===1&&drafts.every(row=>row.checked===false),"DRAFTS_REQUIRE_SELECTION");
   const goal=at("preview").locator("li").filter({hasText:"черновик ИИ"});
   check(await goal.locator('input[aria-label="Цели"]').count()===1,"GOAL_DRAFT_ONLY");
   check((await goal.locator('input[aria-label="Цели"]').inputValue()).trim().length>0,"REAL_NONEMPTY_DRAFT");
   return goal;
  }
  await generate();
  assert.deepEqual(await state(),baseline,"T3_D5_CLUB_UI_PREVIEW_NOT_WRITTEN");
  phase="EXPLICIT_APPLY";
  await at("apply").click();
  assert.deepEqual(await state(),{...baseline,alias:"Сосед"},"T3_D5_CLUB_UI_UNSELECTED_DRAFT_NOT_WRITTEN");
  check((await saved()).length===0,"NO_COMPLETED_RECORD_AFTER_APPLY");
  phase="REVIEWED_APPLY";
  const row=await generate();
  const reviewed="Освоить ремонт бытовой техники.";
  await row.locator('input[aria-label="Цели"]').fill(reviewed);
  await row.locator('input[type=checkbox]').check();
  await at("apply").click();
  assert.deepEqual(await state(),{...baseline,alias:"Сосед",goals:reviewed},"T3_D5_CLUB_UI_REVIEWED_DRAFT_NATIVE_VALUE");
  check((await saved()).length===0&&await page.evaluate(()=>window.__clubProfileSubmits)===0,"NO_AUTOMATIC_SUBMIT");
  phase="EXPLICIT_SAVE";
  await at("unload").click();
  await wait(()=>!document.querySelector("#iwxa-t3-assistant")?.shadowRoot?.getElementById("cached")?.disabled);
  await at("close").click();
  await form().getByRole("button",{name:"Сохранить профиль",exact:true}).click();
  const result=await saved();
  check(result.length===1&&result[0].status==="completed"&&result[0].data.alias==="Сосед"&&result[0].data.goals===reviewed&&result[0].data.interests===baseline.interests,"ORIGINAL_SITE_SAVE");
  check(await page.evaluate(()=>window.__clubProfileSubmits)===1,"ONE_EXPLICIT_SUBMIT");
  phase="RELOAD";
  await page.reload({waitUntil:"domcontentloaded"});
  await form().waitFor({state:"visible"});
  await wait(()=>document.querySelector("[data-profile-form] [name=goals]")?.value==="Освоить ремонт бытовой техники.");
  assert.deepEqual(await state(),{...baseline,alias:"Сосед",goals:reviewed},"T3_D5_CLUB_UI_SITE_SESSION_RESTORED");
  check(await page.evaluate(()=>navigator.onLine===false),"STILL_OFFLINE");
  console.log("T3_D5_CLUB_HYBRID_USER_ROUTE_PASS "+JSON.stringify({modelId:model.id,offline:true,realModelDraft:true,draftUnselected:true,explicitFactsOnlyApply:true,reviewedTextApplied:true,noAutomaticSubmit:true,originalSiteSessionSave:true,offlineReload:true,semanticModelAcceptance:false}));
 }catch(e){
  const reason=typeof e?.message==="string"&&/^T3_D5_CLUB_UI_[A-Z_]+$/.test(e.message)?e.message:"T3_D5_CLUB_UI_UNEXPECTED";
  console.log("T3_D5_CLUB_UI_ROUTE_FAIL "+JSON.stringify({phase,reason}));
  throw Error(reason);
 }finally{await page.close().catch(()=>{});}
}
