#!/usr/bin/env node
// Published QA logic only. Private source remains exclusively in the runner checkout.
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
const site=resolve(process.env.IWXA_SITE_DIR || "site");
const puppeteer=createRequire(join(site,"package.json"))("puppeteer");
const base=process.env.IWXA_BASE || "http://127.0.0.1:4386";
const languages=[
  ["ru","","ru"],["en-GB","en","en-GB"],["zh-Hans-CN","zh-hans","zh-Hans-CN"],
  ["es-ES","es","es-ES"],["ar","ar","ar"],["fr-FR","fr","fr-FR"],
  ["de-DE","de","de-DE"],["pt-BR","pt","pt-BR"]
];
const pathFor=(prefix,path)=>prefix?"/"+prefix+path:path;
const browser=await puppeteer.launch({headless:true,args:["--no-sandbox","--disable-setuid-sandbox"]});
const page=await browser.newPage();
page.setDefaultNavigationTimeout(45000);
await page.setViewport({width:1440,height:900});
const errors=[];
page.on("pageerror",e=>errors.push({path:page.url(),kind:e.name,detail:String(e.message||"").slice(0,100)}));
let passed=0,failed=[];
const check=(ok,label)=>{if(ok)passed++;else failed.push(label);};
const goto=async(p)=>{
  const response=await page.goto(base+p,{waitUntil:"domcontentloaded",timeout:45000});
  await page.waitForSelector("main[data-client-ready]",{timeout:20000});
  const data=await page.evaluate(()=>({
    lang:document.documentElement.lang,
    title:document.title,
    canonical:document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
    mainText:(document.querySelector("main")?.innerText||"").trim().length,
    navLinks:[...document.querySelectorAll(".atlas-language-switch li a[href]")].map(x=>x.getAttribute("href")),
    active:[...document.querySelectorAll('.atlas-language-switch li a[aria-current="page"]')].map(x=>x.getAttribute("href"))
  }));
  return {status:response?.status()??0,...data};
};
try {
  for(let i=0;i<languages.length;i++){
    const [locale,prefix]=languages[i],home=pathFor(prefix,"/"),about=pathFor(prefix,"/about/");
    const h=await goto(home);
    check(h.status===200,"home_http_"+locale);
    check(h.lang===locale,"home_lang_"+locale);
    check(h.canonical==="https://iwxa.ru"+home,"home_canonical_"+locale);
    check(h.title.length>0&&h.mainText>120,"home_content_"+locale);
    check(h.navLinks.length===8&&h.active.length===1&&h.active[0]===home,"home_language_switch_"+locale);
    const a=await goto(about);
    check(a.status===200&&a.lang===locale,"about_http_lang_"+locale);
    check(a.canonical==="https://iwxa.ru"+about,"about_canonical_"+locale);
    check(a.navLinks.length===8&&a.active[0]===about,"about_language_switch_"+locale);
    const [,nextPrefix]=languages[(i+1)%languages.length];
    const nextPath=pathFor(nextPrefix,"/about/");
    await page.click(".atlas-language-switch details > summary");
    await page.waitForSelector(".atlas-language-switch details[open] a",{timeout:10000});
    const target='a[href="'+nextPath+'"]';
    const inMenu=await page.$(".atlas-language-switch details[open] "+target);
    check(Boolean(inMenu),"switch_target_"+locale);
    if(inMenu){
      await inMenu.click();
      await page.waitForFunction(p=>location.pathname===p,{timeout:18000},nextPath);
      check(new URL(page.url()).pathname===nextPath,"switch_click_"+locale);
    }
  }
  for(const [locale,prefix] of languages.filter(x=>["ru","fr-FR","de-DE","pt-BR"].includes(x[0]))){
    const notfound=pathFor(prefix,"/iwxa-invalid-test-location/");
    const response=await page.goto(base+notfound,{waitUntil:"domcontentloaded",timeout:45000});
    await page.waitForSelector(".nf-suggest__grid",{timeout:20000});
    const v=await page.evaluate(()=>({
      lang:document.documentElement.lang,
      n:document.querySelectorAll(".nf-suggest__grid li").length,
      home:document.querySelector(".nf-btn--primary")?.getAttribute("href"),
      title:document.querySelector(".nf-hero__title")?.textContent?.trim()||""
    }));
    check([200,404].includes(response?.status()),"notfound_status_"+locale);
    check(v.lang===locale&&v.n===8&&v.home===pathFor(prefix,"/")&&v.title.length>0,"notfound_localized_"+locale);
  }
  check(errors.length===0,"no_client_javascript_errors");
  console.log("IWXA_EIGHT_BROWSER_ASSERTIONS="+passed);
  console.log("IWXA_EIGHT_BROWSER_FAILURES="+failed.length);
  console.log("IWXA_EIGHT_BROWSER_PAGEERRORS="+errors.length);
  if(failed.length)console.log("IWXA_EIGHT_BROWSER_FAILED_LABELS="+failed.slice(0,20).join(","));
  if(errors.length)console.log("IWXA_EIGHT_BROWSER_JS_ERROR_KIND="+errors.slice(0,5).map(x=>x.kind).join(","));
  if(failed.length||errors.length)process.exitCode=1;
} finally {
  await page.close().catch(()=>{});
  await browser.close().catch(()=>{});
}
