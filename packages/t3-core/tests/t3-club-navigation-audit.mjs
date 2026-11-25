// Actual built Club pages and actual anchor clicks at both viewports.
// Public QA harness only: never upload site bytes, screenshots or private logs.
import assert from "node:assert/strict";
import {readFile,stat} from "node:fs/promises";
import {spawn} from "node:child_process";
import {join,resolve} from "node:path";
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
 const totals={pageInventory:0,pageLoads:0,links:0,internalClicked:0,casePrefilled:0,externalActionable:0,contactActionable:0,conditional:0,notRun:0,missingRouteChecks:0,externalOK:0,externalBroken:0,externalUnverified:0};
 const failures=[],external=new Set();
 const safeTarget=href=>{
  try{const u=new URL(href,origin);if(u.origin!==origin)return u.protocol==="http:"||u.protocol==="https:"?u.hostname:u.protocol;
   return (known.has(u.pathname)?u.pathname:"unregistered-local-path")+( /^#[a-z0-9-]+$/i.test(u.hash)?u.hash:"");
  }catch{return "invalid-url"}
 };
 const report=(task,stage,href,error)=>{
  const code=/^NAV_[A-Z0-9_]+$/.test(error?.message||"")?error.message:error?.name==="TimeoutError"?"NAV_TIMEOUT":"NAV_UNEXPECTED";
  failures.push({mode:task.mode,state:task.state,source:task.path,stage,target:safeTarget(href),code});
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
  if(task.state==="created")await page.getByTestId("club-native-project-overview").waitFor({state:"visible",timeout:16000});
 }
 async function snapshot(page){
  await nav(page);await disclosures(page);
  return await page.locator("a[href]").evaluateAll(links=>{
   const seen=new Map();
   return links.map(a=>{
    const href=a.getAttribute("href"),ordinal=seen.get(href)||0;seen.set(href,ordinal+1);
    const s=getComputedStyle(a);
    return {href,ordinal,target:a.target,visible:!!a.getClientRects().length&&s.visibility!=="hidden"&&s.visibility!=="collapse",download:a.hasAttribute("download")};
   });
  });
 }
 async function reveal(page,row){
  const selector="a[href="+JSON.stringify(row.href)+"]",link=page.locator(selector).nth(row.ordinal);
  if(!await link.isVisible())await nav(page);
  if(!await link.isVisible())await disclosures(page);
  await link.waitFor({state:"visible",timeout:6000});return link;
 }
 async function verifyCase(page,u){
  const caseId=new URLSearchParams(u.hash.slice(1)).get("club_example");
  const buttons={"CLUB-IND-01":"Подставить значения кейса","CLUB-IND-02":"Подставить условия Павла","CLUB-IND-03":"Подставить условия Ольги"};
  const forms={"/tools/personal-economy/":"[data-pe-form]","/tools/additional-income/":"[data-ai-form]","/tools/resources-and-skills/":"[data-rs-form]","/tools/action-route/":"[data-ar-form]"};
  check(buttons[caseId]&&forms[u.pathname],"CASE_ROUTE_UNKNOWN");
  const form=page.locator(forms[u.pathname]),button=page.getByRole("button",{name:buttons[caseId],exact:true});
  await button.waitFor({state:"visible",timeout:12000});
  const before=await form.evaluate(el=>JSON.stringify(Array.from(el.elements).filter(e=>e.name).map(e=>[e.name,e.value,e.checked])));
  await button.click();
  await page.waitForFunction(({selector,before})=>{
   const f=document.querySelector(selector);
   return f&&JSON.stringify(Array.from(f.elements).filter(e=>e.name).map(e=>[e.name,e.value,e.checked]))!==before;
  },{selector:forms[u.pathname],before},{timeout:20000});
  totals.casePrefilled++;
 }
 async function verifyFragment(page,u){
  if(!u.hash||u.hash==="#")return;
  if(u.hash.startsWith("#/"))return; // exact original Host route was already checked
  if(new URLSearchParams(u.hash.slice(1)).has("club_example"))return verifyCase(page,u);
  let id;try{id=decodeURIComponent(u.hash.slice(1))}catch{throw Error("NAV_FRAGMENT_ENCODING")}
  const target=page.locator("[id="+JSON.stringify(id)+"]");
  check(await target.count()===1,"FRAGMENT_ID");
  await target.waitFor({state:"visible",timeout:10000});
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
   if(task.state==="created"){
    const initial={...task,state:"clean"};await openSource(page,obs,initial);
    await page.getByTestId("club-create-personal-space").click();
    await page.getByTestId("club-native-project-overview").waitFor({state:"visible",timeout:20000});
   }else await openSource(page,obs,task);
   rows=await snapshot(page);
   await ready(page,obs,new URL(origin+task.path),{errorPage:task.path==="/404.html"});
   totals.pageInventory++;totals.links+=rows.length;
   check(rows.length>0,"EMPTY_LINK_INVENTORY");
   for(const [index,row] of rows.entries()){
    if(!row.visible){totals.conditional++;continue}
    let u;
    try{
     check(row.href.trim()!==""&&row.href!=="#","PLACEHOLDER_LINK");
     u=new URL(row.href,origin+task.path);
     await openSource(page,obs,task);
     const link=await reveal(page,row);
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
     let dest=page,targetObs=obs;
     if(row.target==="_blank"){
      const popup=page.waitForEvent("popup",{timeout:12000});
      await link.click();dest=await popup;targetObs=monitor(dest);
     }else await link.click({timeout:8000});
     await dest.waitForURL(value=>sameRoute(value,u),{timeout:12000});
     await ready(dest,targetObs,u,{errorPage:u.pathname==="/404.html"});
     await verifyFragment(dest,u);
     check(targetObs.errors===0&&targetObs.resources===0,"LINK_TARGET_RUNTIME");
     if(dest!==page)await dest.close();
     totals.internalClicked++;
    }catch(e){
     report(task,"link-"+(index+1),row.href,e);
     for(const popup of ctx.pages())if(popup!==page)await popup.close().catch(()=>{});
    }
   }
  }catch(e){report(task,"inventory",task.path,e);totals.notRun+=rows.length}
  finally{await ctx.close();console.log("CLUB_NAV_PAGE "+JSON.stringify({mode:task.mode,state:task.state,source:task.path,links:rows.length,failures:failures.filter(f=>f.mode===task.mode&&f.state===task.state&&f.source===task.path).length}))}
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
   const ctx=await browser.newContext({viewport});const p=await ctx.newPage(),obs=monitor(p);
   try{const url=new URL(origin+"/__club_navigation_missing__/");const r=await p.goto(url.href,{waitUntil:"load"});check(r?.status()===404,"UNKNOWN_ROUTE_STATUS");await ready(p,obs,url,{errorPage:true});totals.missingRouteChecks++}
   catch(e){report({mode,state:"clean",path:"/404.html"},"unknown-route","/404.html",e)}finally{await ctx.close()}
  }
  let next=0;await Promise.all(Array.from({length:4},async()=>{while(next<tasks.length){const task=tasks[next++];await auditTask(browser,task)}}));
  const urls=[...external];next=0;await Promise.all(Array.from({length:4},async()=>{while(next<urls.length)await checkExternal(urls[next++])}));
  const grouped=new Map();for(const f of failures){const key=JSON.stringify(f);grouped.set(key,(grouped.get(key)||0)+1)}
  for(const [key,count] of [...grouped].slice(0,160))console.log("CLUB_NAV_FAILURE "+JSON.stringify({...JSON.parse(key),count}));
  console.log("CLUB_NAV_SUMMARY "+JSON.stringify({...totals,expectedPageInventories:tasks.length,externalDistinct:urls.length,failures:failures.length}));
  check(totals.pageInventory===tasks.length&&totals.missingRouteChecks===2,"INCOMPLETE_PAGES");
  check(totals.links===totals.internalClicked+totals.externalActionable+totals.contactActionable+totals.conditional,"INCOMPLETE_LINK_ACCOUNTING");
  check(!failures.length&&!totals.notRun,"USER_NAVIGATION_FAILURE");
  check(!totals.externalBroken,"BROKEN_EXTERNAL_LINK");
  console.log("CLUB_NAV_INTERNAL=PASS");
  console.log("CLUB_NAV_EXTERNAL="+(totals.externalUnverified?"PARTIAL":"PASS"));
 }finally{if(browser)await browser.close();if(server&&server.exitCode===null)server.kill("SIGTERM")}
}
await main();
